import { randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import { now } from "./platform.ts";
import type { Platform, Principal } from "./platform.ts";
import { redact, validService } from "./operations.ts";

export class LiveChecks {
  platform: Platform;
  identify: (token: string) => string;
  constructor(platform: Platform, identify: (token: string) => string) {
    this.platform = platform;
    this.identify = identify;
    platform.store.db.exec(
      "CREATE TABLE IF NOT EXISTS live_checks(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,question TEXT NOT NULL,plan TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL,result TEXT);",
    );
  }
  expire() {
    this.platform.store.db
      .prepare(
        "UPDATE live_checks SET status='expired' WHERE status IN ('pending','running') AND created_at<?",
      )
      .run(now() - 120);
    this.platform.store.db
      .prepare("DELETE FROM live_checks WHERE created_at<?")
      .run(now() - 86400);
  }
  request(p: Principal, data: Record<string, unknown>) {
    this.platform.active(p);
    const server = this.platform.server(p, String(data.server_id));
    if (
      server.organization !==
        this.platform.authorizeOrg(p, data.organization) ||
      typeof data.question !== "string" ||
      !data.question.trim() ||
      data.question.length > 2000
    )
      throw new APIError(400, "Selecione um servidor e escreva a pergunta.");
    const version = String(server.details?.agent_version ?? "0.0")
      .split(".")
      .map(Number);
    if (!(version[0] >= 1 || version[1] >= 7))
      throw new APIError(
        409,
        "Atualize o agente para 0.7 ou superior para verificar pedidos do chat diretamente no servidor.",
      );
    const q = data.question
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const known = Object.keys(server.details?.services ?? {});
    const services = known.filter((s) =>
      new RegExp(
        "(^|[^a-z0-9_.@-])" +
          s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          "($|[^a-z0-9_.@-])",
      ).test(q),
    );
    if (
      /cloudflare|cloudflared|tunel|tunnel/.test(q) &&
      !services.includes("cloudflared")
    )
      services.push("cloudflared");
    if (/\bssh\b/.test(q) && !services.includes("ssh")) services.push("ssh");
    const named = q.match(
      /(?:servico|service|servicio)\s+([a-z0-9_.@-]+)/,
    )?.[1];
    if (
      named &&
      validService(named) &&
      !["esta", "está", "ativo", "inativo", "do", "de"].includes(named) &&
      !services.includes(named)
    )
      services.push(named);
    const plan = {
      services: services.slice(0, 5),
      processes:
        data.include_processes === true ||
        /process|consum|cpu|memor|lent|slow|recurso|resource/.test(q),
      logs:
        data.include_logs === true ||
        services.length > 0 ||
        /logs?|erro|falha|fail|problem|registro/.test(q),
      origin: /site|http|cloudflare|tunel|tunnel|port|web/.test(q),
      all_services:
        /todos.*servic|listar.*servic|quais.*servic|all.*services|list.*services|which.*services/.test(
          q,
        ),
    };
    this.expire();
    if (
      this.platform.store.db
        .prepare(
          "SELECT 1 FROM live_checks WHERE server_id=? AND status IN ('pending','running')",
        )
        .get(server.id)
    )
      throw new APIError(
        409,
        "Já existe uma verificação em andamento neste servidor.",
      );
    const id = randomUUID();
    this.platform.store.db
      .prepare("INSERT INTO live_checks VALUES (?,?,?,?,?,'pending',NULL)")
      .run(id, server.id, data.question, JSON.stringify(plan), now());
    this.platform.audit(p, "assistant.live.requested", server.id);
    return { id, status: "pending", plan };
  }
  get(p: Principal, id: string) {
    this.expire();
    const row = this.platform.store.db
      .prepare("SELECT * FROM live_checks WHERE id=?")
      .get(id);
    if (!row) throw new APIError(404, "Verificação não encontrada.");
    this.platform.server(p, String(row.server_id));
    return row;
  }
  pending(token: string) {
    const id = this.identify(token);
    this.expire();
    const rows = this.platform.store.db
      .prepare(
        "SELECT id,plan FROM live_checks WHERE server_id=? AND status IN ('pending','running') ORDER BY created_at LIMIT 1",
      )
      .all(id);
    this.platform.store.db
      .prepare(
        "UPDATE live_checks SET status='running' WHERE server_id=? AND status='pending'",
      )
      .run(id);
    return rows.map((r) => ({ id: r.id, ...JSON.parse(String(r.plan)) }));
  }
  complete(token: string, id: string, data: Record<string, unknown>) {
    const server = this.identify(token);
    this.expire();
    if (
      !data ||
      JSON.stringify(data).length > 120000 ||
      typeof data.checked_at !== "number" ||
      !Number.isFinite(data.checked_at) ||
      Math.abs(data.checked_at - now()) > 120 ||
      typeof data.metrics !== "object" ||
      !data.metrics ||
      typeof data.services !== "object" ||
      !data.services
    )
      throw new APIError(400, "Diagnóstico inválido.");
    const pick = (value: unknown, keys: string[]) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            keys
              .filter((k) => Object.hasOwn(value, k))
              .map((k) => [k, (value as Record<string, unknown>)[k]]),
          )
        : {};
    const metrics = pick(data.metrics, [
      "cpu_percent",
      "memory_percent",
      "disk_percent",
    ]);
    if (
      Object.values(metrics).some(
        (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100,
      ) ||
      Object.keys(metrics).length !== 3 ||
      Object.entries(data.services as object).some(
        ([s, state]) =>
          !validService(s) ||
          typeof state !== "string" ||
          !/^[a-z_-]{1,30}$/.test(state),
      )
    )
      throw new APIError(400, "Métricas ou serviços inválidos.");
    const logs = Object.fromEntries(
      Object.entries((data.logs ?? {}) as object)
        .filter(([s]) => validService(s))
        .slice(0, 3)
        .map(([s, r]) => [
          s,
          pick(r, [
            "counts",
            "scanned",
            "read_status",
            "sources",
            "unparsed",
            "truncated",
          ]),
        ]),
    );
    const processData = pick(data.processes, [
      "visible",
      "skipped",
      "truncated",
      "read_status",
      "sample_seconds",
      "collected_at",
    ]);
    if (
      data.processes &&
      Array.isArray((data.processes as Record<string, unknown>).processes)
    )
      processData.processes = (
        data.processes as { processes: unknown[] }
      ).processes
        .slice(0, 20)
        .map((r) =>
          pick(r, [
            "pid",
            "name",
            "user",
            "state",
            "cpu_percent",
            "memory_percent",
            "rss_bytes",
            "elapsed_seconds",
            "service",
          ]),
        );
    const text = redact(
      JSON.stringify({
        checked_at: data.checked_at,
        metrics,
        services: data.services,
        service_details: Object.fromEntries(
          Object.entries((data.service_details ?? {}) as object)
            .filter(([s]) => validService(s))
            .slice(0, 5)
            .map(([s, r]) => [
              s,
              pick(r, [
                "Id",
                "LoadState",
                "ActiveState",
                "SubState",
                "MainPID",
                "NRestarts",
                "ExecMainStatus",
                "Result",
                "Type",
                "UnitFileState",
              ]),
            ]),
        ),
        logs,
        processes: processData,
        origin: pick(data.origin, ["status", "http_status"]),
        origin_tests: Array.isArray(data.origin_tests)
          ? data.origin_tests
              .slice(0, 5)
              .map((r) => pick(r, ["status", "http_status"]))
          : [],
        tunnel: pick(data.tunnel, ["management", "source", "read_errors"]),
        limitations: Array.isArray(data.limitations)
          ? data.limitations.slice(0, 6).map((s) => String(s).slice(0, 500))
          : [],
      }),
    );
    const result = this.platform.store.db
      .prepare(
        "UPDATE live_checks SET status='completed',result=? WHERE id=? AND server_id=? AND status IN ('pending','running')",
      )
      .run(text, id, server);
    if (!result.changes)
      throw new APIError(409, "Verificação encerrada ou de outro servidor.");
    return { ok: true };
  }
}
