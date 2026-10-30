import { randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import { now, type Platform, type Principal } from "./platform.ts";
import { type Operations, redact } from "./operations.ts";
export class Runbooks {
  platform: Platform;
  ops: Operations;
  constructor(platform: Platform, ops: Operations) {
    this.platform = platform;
    this.ops = ops;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS runbooks(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,path TEXT NOT NULL,sha256 TEXT NOT NULL,trigger_kind TEXT NOT NULL,mode TEXT NOT NULL,enabled INTEGER NOT NULL,cooldown INTEGER NOT NULL,daily_limit INTEGER NOT NULL,revision INTEGER NOT NULL,connection_revision TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS runbook_runs(id TEXT PRIMARY KEY,runbook_id TEXT NOT NULL,server_id TEXT NOT NULL,revision INTEGER NOT NULL,event_id TEXT,reason TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,started_at INTEGER,finished_at INTEGER,output TEXT,approved_by TEXT,UNIQUE(runbook_id,event_id));
      CREATE UNIQUE INDEX IF NOT EXISTS runbook_executing ON runbook_runs(server_id) WHERE status='executing';`);
    if (
      !(
        platform.store.db.prepare("PRAGMA table_info(runbooks)").all() as {
          name: string;
        }[]
      ).some((c) => c.name === "after_event")
    )
      platform.store.db.exec(
        "ALTER TABLE runbooks ADD COLUMN after_event INTEGER NOT NULL DEFAULT 0; UPDATE runbooks SET after_event=(SELECT value FROM outbox_counter WHERE id=1);",
      );
    if (
      !(
        platform.store.db.prepare("PRAGMA table_info(outbox)").all() as {
          name: string;
        }[]
      ).some((c) => c.name === "runbooks_scanned")
    )
      platform.store.db.exec(
        "ALTER TABLE outbox ADD COLUMN runbooks_scanned INTEGER NOT NULL DEFAULT 0; UPDATE outbox SET runbooks_scanned=1;",
      );
    // An interrupted execution must be investigated, never silently retried.
    platform.store.db
      .prepare(
        "UPDATE runbook_runs SET status='unknown',finished_at=?,output='Execução interrompida; verifique o servidor antes de repetir.' WHERE status='executing' AND started_at<?",
      )
      .run(now(), now() - 300);
  }
  list(p: Principal, id: string) {
    this.platform.server(p, id);
    return {
      items: this.platform.store.db
        .prepare(
          "SELECT * FROM runbooks WHERE server_id=? AND archived=0 ORDER BY name",
        )
        .all(id),
      runs: this.platform.store.db
        .prepare(
          "SELECT r.*,b.name FROM runbook_runs r JOIN runbooks b ON b.id=r.runbook_id WHERE r.server_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 30",
        )
        .all(id),
    };
  }
  private path(value: unknown): string {
    if (
      typeof value !== "string" ||
      value.length > 400 ||
      !/^\/(opt|srv|usr\/local)\/[a-zA-Z0-9_./-]+$/.test(value) ||
      value.split("/").includes("..") ||
      value.includes("//")
    )
      throw new APIError(
        400,
        "Use um caminho absoluto de script em /opt, /srv ou /usr/local.",
      );
    return value;
  }
  async inspect(p: Principal, id: string, path: unknown) {
    this.platform.requireRole(p, ["owner", "admin"]);
    return this.ops.executeRunbook(p, id, {
      action: "inspect",
      path: this.path(path),
    });
  }
  save(
    p: Principal,
    id: string,
    bookId: string | undefined,
    data: Record<string, unknown>,
  ) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.active(p);
    this.platform.server(p, id);
    const db = this.platform.store.db,
      old = bookId
        ? db
            .prepare(
              "SELECT * FROM runbooks WHERE id=? AND server_id=? AND archived=0",
            )
            .get(bookId, id)
        : null;
    if (bookId && !old) throw new APIError(404, "Runbook não encontrado.");
    if (old && old.revision !== data.revision)
      throw new APIError(409, "Runbook alterado. Atualize antes de salvar.");
    const path = this.path(data.path),
      name = String(data.name ?? "").trim(),
      description = String(data.description ?? "").trim(),
      trigger = String(data.trigger_kind ?? "manual"),
      mode = String(data.mode ?? "manual"),
      cooldown = Number(data.cooldown),
      limit = Number(data.daily_limit);
    if (
      !name ||
      name.length > 100 ||
      !description ||
      description.length > 2000 ||
      !/^([a-f0-9]{64})$/.test(String(data.sha256)) ||
      !["manual", "automatic"].includes(mode) ||
      typeof data.enabled !== "boolean" ||
      !Number.isInteger(cooldown) ||
      cooldown < 300 ||
      cooldown > 86400 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 12 ||
      !/^(manual|cpu|memory|disk|offline|service:[a-zA-Z0-9_.@-]{1,100}|predictive:(cpu_percent|memory_percent|disk_percent|temperature_max_c|disk_await_ms):(anomaly|forecast))$/.test(
        trigger,
      ) ||
      (mode === "automatic" && trigger === "manual")
    )
      throw new APIError(
        400,
        "Confira os dados, gatilho, hash e limites do runbook.",
      );
    const revision = this.ops.configRevision(id),
      key = bookId ?? randomUUID();
    if (
      mode === "automatic" &&
      data.enabled &&
      data.authorize_automatic !== true
    )
      throw new APIError(
        400,
        "Confirme a autorização de execução automática deste script.",
      );
    if (
      !old &&
      (
        db
          .prepare(
            "SELECT count(*) n FROM runbooks WHERE server_id=? AND archived=0",
          )
          .get(id) as { n: number }
      ).n >= 30
    )
      throw new APIError(400, "Limite de 30 runbooks por servidor.");
    db.prepare(
      "INSERT INTO runbooks(id,server_id,tenant_id,user_id,name,description,path,sha256,trigger_kind,mode,enabled,cooldown,daily_limit,revision,connection_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,name=excluded.name,description=excluded.description,path=excluded.path,sha256=excluded.sha256,trigger_kind=excluded.trigger_kind,mode=excluded.mode,enabled=excluded.enabled,cooldown=excluded.cooldown,daily_limit=excluded.daily_limit,revision=runbooks.revision+1,connection_revision=excluded.connection_revision",
    ).run(
      key,
      id,
      p.tenantId,
      p.userId,
      name,
      description,
      path,
      String(data.sha256),
      trigger,
      mode,
      data.enabled ? 1 : 0,
      cooldown,
      limit,
      revision,
    );
    db.prepare(
      "UPDATE runbooks SET after_event=(SELECT value FROM outbox_counter WHERE id=1) WHERE id=?",
    ).run(key);
    db.prepare(
      "UPDATE runbook_runs SET status='canceled',finished_at=? WHERE runbook_id=? AND status='pending'",
    ).run(now(), key);
    this.platform.audit(p, "runbook.saved", key);
    return this.list(p, id);
  }
  remove(p: Principal, id: string, key: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.server(p, id);
    this.platform.store.db
      .prepare(
        "UPDATE runbooks SET archived=1,enabled=0,revision=revision+1 WHERE id=? AND server_id=?",
      )
      .run(key, id);
    this.platform.store.db
      .prepare(
        "UPDATE runbook_runs SET status='canceled',finished_at=? WHERE runbook_id=? AND server_id=? AND status='pending'",
      )
      .run(now(), key, id);
    this.platform.audit(p, "runbook.archived", key);
  }
  request(p: Principal, id: string, key: string) {
    this.platform.requireRole(p, ["owner", "admin", "operator"]);
    this.platform.active(p);
    this.platform.server(p, id);
    const book = this.platform.store.db
      .prepare(
        "SELECT * FROM runbooks WHERE id=? AND server_id=? AND enabled=1 AND archived=0",
      )
      .get(key, id);
    if (!book)
      throw new APIError(404, "Runbook não encontrado ou desabilitado.");
    const run = randomUUID();
    this.platform.store.db
      .prepare(
        "INSERT INTO runbook_runs(id,runbook_id,server_id,revision,reason,status,created_at) VALUES (?,?,?,?,?,'pending',?)",
      )
      .run(
        run,
        key,
        id,
        Number(book.revision),
        "Execução solicitada para aprovação.",
        now(),
      );
    this.platform.audit(p, "runbook.requested", run);
    return { id: run };
  }
  reject(p: Principal, id: string, run: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.server(p, id);
    this.platform.store.db
      .prepare(
        "UPDATE runbook_runs SET status='rejected',finished_at=? WHERE id=? AND server_id=? AND status='pending'",
      )
      .run(now(), run, id);
    this.platform.audit(p, "runbook.rejected", run);
  }
  async execute(p: Principal, id: string, runId: string, automatic = false) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.active(p);
    this.platform.server(p, id);
    const db = this.platform.store.db,
      run = db
        .prepare("SELECT * FROM runbook_runs WHERE id=? AND server_id=?")
        .get(runId, id),
      book = run
        ? db
            .prepare("SELECT * FROM runbooks WHERE id=? AND server_id=?")
            .get(run.runbook_id, id)
        : null;
    if (
      !run ||
      !book ||
      run.status !== "pending" ||
      book.archived ||
      !book.enabled ||
      book.revision !== run.revision ||
      (!automatic && Number(run.created_at) < now() - 900) ||
      (automatic && book.mode !== "automatic") ||
      book.connection_revision !== this.ops.configRevision(id)
    )
      throw new APIError(409, "Execução expirada ou configuração alterada.");
    if (
      automatic &&
      String(book.trigger_kind).startsWith("service:") &&
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='service_recovery_settings'",
        )
        .get() &&
      db
        .prepare(
          "SELECT 1 FROM service_recovery_settings WHERE server_id=? AND service=? AND enabled=1",
        )
        .get(id, String(book.trigger_kind).slice(8))
    )
      throw new APIError(
        409,
        "Correção imediata já gerencia este serviço; runbook automático não será executado em paralelo.",
      );
    if (automatic) {
      if (Number(run.created_at) < now() - 300)
        throw new APIError(409, "Gatilho expirado.");
      const event = db
        .prepare("SELECT payload FROM outbox WHERE id=?")
        .get(run.event_id) as { payload: string } | undefined;
      const data = event ? JSON.parse(event.payload) : null;
      const active =
        data?.event === "alert.opened"
          ? db
              .prepare(
                "SELECT kind FROM alerts WHERE id=? AND server_id=? AND resolved_at IS NULL",
              )
              .get(String(data.alert_id), id)
          : data?.event === "predictive.alert.opened"
            ? db
                .prepare(
                  "SELECT 'predictive:'||metric||':'||kind AS kind FROM predictive_findings WHERE id=? AND server_id=? AND resolved_at IS NULL",
                )
                .get(String(data.alert_id), id)
            : null;
      if (!active || active.kind !== book.trigger_kind)
        throw new APIError(409, "Incidente resolvido ou gatilho alterado.");
    }
    if (
      db
        .prepare(
          "SELECT 1 FROM runbook_runs WHERE server_id=? AND status IN ('executing','unknown')",
        )
        .get(id) ||
      db
        .prepare(
          "SELECT 1 FROM remediation_actions WHERE server_id=? AND status IN ('executing','unknown')",
        )
        .get(id)
    )
      throw new APIError(
        409,
        "Há uma execução em andamento ou indeterminada neste servidor.",
      );
    const recent = db
      .prepare(
        "SELECT count(*) n,max(started_at) last FROM runbook_runs WHERE runbook_id=? AND started_at>=?",
      )
      .get(book.id, now() - 86400) as { n: number; last: number | null };
    if (
      recent.n >= Number(book.daily_limit) ||
      (recent.last && now() - recent.last < Number(book.cooldown))
    )
      throw new APIError(
        409,
        "Intervalo mínimo ou limite diário do runbook atingido.",
      );
    if (
      !db
        .prepare(
          "UPDATE runbook_runs SET status='executing',started_at=?,approved_by=? WHERE id=? AND status='pending'",
        )
        .run(now(), p.userId, runId).changes
    )
      throw new APIError(409, "Execução já iniciada.");
    this.platform.audit(
      p,
      automatic ? "runbook.automatic.started" : "runbook.approved",
      runId,
    );
    try {
      const result = await this.ops.executeRunbook(p, id, {
        action: "run",
        path: book.path,
        sha256: book.sha256,
        request_id: runId,
        verify_service: String(book.trigger_kind).startsWith("service:")
          ? String(book.trigger_kind).slice(8)
          : undefined,
      });
      db.prepare(
        "UPDATE runbook_runs SET status=?,finished_at=?,output=? WHERE id=?",
      ).run(
        result.status === "completed" &&
          result.exit_code === 0 &&
          (!result.service_state || result.service_state === "active")
          ? "succeeded"
          : result.status === "completed" || result.status === "rejected"
            ? "failed"
            : "unknown",
        now(),
        redact(JSON.stringify(result)).slice(0, 16000),
        runId,
      );
    } catch {
      db.prepare(
        "UPDATE runbook_runs SET status='unknown',finished_at=?,output='Resultado indeterminado; verifique o servidor antes de repetir.' WHERE id=?",
      ).run(now(), runId);
    }
    this.platform.audit(p, "runbook.finished", runId);
    return this.list(p, id);
  }
  async tick() {
    const db = this.platform.store.db;
    db.prepare(
      "UPDATE runbook_runs SET status='unknown',finished_at=?,output='Execução interrompida; verifique o servidor antes de repetir.' WHERE status='executing' AND started_at<?",
    ).run(now(), now() - 300);
    for (const event of db
      .prepare(
        "SELECT id,payload,event_sequence AS sequence FROM outbox WHERE runbooks_scanned=0 LIMIT 100",
      )
      .all() as { id: string; payload: string; sequence: number }[]) {
      const data = JSON.parse(event.payload);
      const target =
        data.event === "alert.opened"
          ? db
              .prepare(
                "SELECT server_id,kind FROM alerts WHERE id=? AND resolved_at IS NULL",
              )
              .get(String(data.alert_id))
          : data.event === "predictive.alert.opened"
            ? db
                .prepare(
                  "SELECT server_id,'predictive:'||metric||':'||kind AS kind FROM predictive_findings WHERE id=? AND resolved_at IS NULL",
                )
                .get(String(data.alert_id))
            : null;
      if (target)
        for (const book of db
          .prepare(
            "SELECT id,revision,server_id,mode FROM runbooks WHERE server_id=? AND trigger_kind=? AND enabled=1 AND archived=0 AND after_event<?",
          )
          .all(target.server_id, target.kind, event.sequence))
          db.prepare(
            "INSERT OR IGNORE INTO runbook_runs(id,runbook_id,server_id,revision,event_id,reason,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
          ).run(
            randomUUID(),
            book.id,
            book.server_id,
            book.revision,
            event.id,
            `${book.mode === "automatic" ? "Gatilho autorizado" : "Incidente requer aprovação"}: ${String(target.kind)}`,
            now(),
          );
      db.prepare("UPDATE outbox SET runbooks_scanned=1 WHERE id=?").run(
        event.id,
      );
    }
    for (const run of db
      .prepare(
        "SELECT r.id,r.server_id,b.user_id,b.tenant_id FROM runbook_runs r JOIN runbooks b ON b.id=r.runbook_id WHERE r.status='pending' AND r.event_id IS NOT NULL AND b.enabled=1 AND b.archived=0 AND b.mode='automatic' LIMIT 10",
      )
      .all() as {
      id: string;
      server_id: string;
      user_id: string;
      tenant_id: string;
    }[]) {
      try {
        await this.execute(
          this.platform.principal(run.user_id, run.tenant_id),
          run.server_id,
          run.id,
          true,
        );
      } catch {
        db.prepare(
          "UPDATE runbook_runs SET status='skipped',finished_at=?,output='Gatilho não executado: acesso, configuração, intervalo ou limite não permite a ação.' WHERE id=? AND status='pending'",
        ).run(now(), run.id);
      }
    }
  }
  reviewed(p: Principal, id: string, run: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.server(p, id);
    this.platform.store.db
      .prepare(
        "UPDATE runbook_runs SET status='reviewed',finished_at=? WHERE id=? AND server_id=? AND status='unknown'",
      )
      .run(now(), run, id);
    this.platform.audit(p, "runbook.manually.reviewed", run);
  }
}
