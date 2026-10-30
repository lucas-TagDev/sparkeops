import { randomUUID } from "node:crypto";
import { Platform, now, type Principal } from "./platform.ts";
import { APIError } from "./store.ts";
import { monitoringURL, probeURL, type ProbeResult } from "./url-probe.ts";
import type {
  URLMonitor,
  URLDetails,
  URLPage,
  URLCheck,
  URLIncident,
} from "../shared/url-monitors.ts";
type Row = URLMonitor & {
  tenant_id: string;
  archived: number;
  lease_until: number;
  last_attempt: number;
  failures: number;
  history_version: number;
};
export type URLProbe = (
  url: string,
  method: string,
  timeout: number,
) => Promise<ProbeResult>;
export class URLMonitoring {
  platform: Platform;
  probe: URLProbe;
  constructor(platform: Platform, probe: URLProbe = probeURL) {
    this.platform = platform;
    this.probe = probe;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS url_monitors(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,organization TEXT NOT NULL,name TEXT NOT NULL,url TEXT NOT NULL,method TEXT NOT NULL,interval_seconds INTEGER NOT NULL,timeout_seconds INTEGER NOT NULL,expected_status INTEGER NOT NULL,failure_threshold INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,archived INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',last_checked INTEGER,last_status INTEGER,latency_ms INTEGER,last_error TEXT,next_check INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,lease_until INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,history_version INTEGER NOT NULL DEFAULT 1);
 CREATE INDEX IF NOT EXISTS url_monitor_due ON url_monitors(archived,enabled,next_check);
 CREATE TABLE IF NOT EXISTS url_checks(id TEXT PRIMARY KEY,monitor_id TEXT NOT NULL,checked_at INTEGER NOT NULL,ok INTEGER NOT NULL,status_code INTEGER,latency_ms INTEGER NOT NULL,error TEXT,monitor_version INTEGER NOT NULL DEFAULT 1);
 CREATE INDEX IF NOT EXISTS url_checks_recent ON url_checks(monitor_id,checked_at);
 CREATE TABLE IF NOT EXISTS url_incidents(id TEXT PRIMARY KEY,monitor_id TEXT NOT NULL,opened_at INTEGER NOT NULL,resolved_at INTEGER,message TEXT NOT NULL,resolution TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS url_active_incident ON url_incidents(monitor_id) WHERE resolved_at IS NULL;`);
    const monitorColumns = platform.store.db
      .prepare("PRAGMA table_info(url_monitors)")
      .all() as { name: string }[];
    if (!monitorColumns.some((c) => c.name === "history_version"))
      platform.store.db.exec(
        "ALTER TABLE url_monitors ADD COLUMN history_version INTEGER NOT NULL DEFAULT 1",
      );
    const checkColumns = platform.store.db
      .prepare("PRAGMA table_info(url_checks)")
      .all() as { name: string }[];
    if (!checkColumns.some((c) => c.name === "monitor_version"))
      platform.store.db.exec(
        "ALTER TABLE url_checks ADD COLUMN monitor_version INTEGER NOT NULL DEFAULT 1",
      );
  }
  private row(id: string) {
    const row = this.platform.store.db
      .prepare(
        "SELECT m.*,o.name AS organization_name FROM url_monitors m JOIN organizations o ON o.id=m.organization WHERE m.id=? AND m.archived=0",
      )
      .get(id) as Row | undefined;
    if (!row) throw new APIError(404, "Monitor de URL não encontrado.");
    return row;
  }
  private authorize(p: Principal, id: string) {
    const row = this.row(id);
    if (row.tenant_id !== p.tenantId)
      throw new APIError(404, "Monitor de URL não encontrado.");
    this.platform.authorizeOrg(p, row.organization);
    return row;
  }
  private limits(p: Principal) {
    return this.platform.account(p).limits.urlMonitors ?? 0;
  }
  private used(p: Principal) {
    return Number(
      this.platform.store.db
        .prepare(
          "SELECT count(*) AS n FROM url_monitors WHERE tenant_id=? AND archived=0",
        )
        .get(p.tenantId)!.n,
    );
  }
  private clean(row: Row): URLMonitor {
    const {
      tenant_id,
      archived,
      lease_until,
      last_attempt,
      failures,
      history_version,
      ...result
    } = row;
    const stats = this.platform.store.db
      .prepare(
        "SELECT count(*) AS n,avg(ok)*100 AS uptime FROM url_checks WHERE monitor_id=? AND monitor_version=? AND checked_at>=?",
      )
      .get(row.id, row.history_version, now() - 86400)!;
    return {
      ...result,
      status: row.enabled ? row.status : "paused",
      checks: Number(stats.n),
      uptime_percent: stats.uptime as number | null,
    };
  }
  list(p: Principal, input: Record<string, unknown>): URLPage {
    const orgs = this.platform.organizations(p).map((o) => o.id),
      q = String(input.q ?? "").trim(),
      status = String(input.status ?? "all"),
      page = Number(input.page ?? 1);
    if (
      q.length > 150 ||
      !["all", "pending", "up", "down", "paused"].includes(status) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000000
    )
      throw new APIError(400, "Filtros de URLs inválidos.");
    const limit = this.limits(p),
      used = this.used(p);
    if (!orgs.length)
      return { items: [], total: 0, page: 1, pages: 1, limit, used };
    const clauses = [
        `m.tenant_id=? AND m.archived=0 AND m.organization IN(${orgs.map(() => "?").join(",")})`,
      ],
      params: (string | number)[] = [p.tenantId, ...orgs];
    if (q) {
      clauses.push("(m.name LIKE ? ESCAPE '!' OR m.url LIKE ? ESCAPE '!')");
      const term = "%" + q.replace(/[!%_]/g, "!$&") + "%";
      params.push(term, term);
    }
    if (status === "paused") clauses.push("m.enabled=0");
    else if (status !== "all") {
      clauses.push("m.enabled=1 AND m.status=?");
      params.push(status);
    }
    const where = clauses.join(" AND "),
      total = Number(
        this.platform.store.db
          .prepare("SELECT count(*) AS n FROM url_monitors m WHERE " + where)
          .get(...params)!.n,
      ),
      pages = Math.max(1, Math.ceil(total / 10)),
      current = Math.min(page, pages);
    const rows = this.platform.store.db
      .prepare(
        "SELECT m.*,o.name AS organization_name FROM url_monitors m JOIN organizations o ON o.id=m.organization WHERE " +
          where +
          " ORDER BY m.name,m.id LIMIT 10 OFFSET ?",
      )
      .all(...params, (current - 1) * 10) as Row[];
    return {
      items: rows.map((r) => this.clean(r)),
      total,
      page: current,
      pages,
      limit,
      used,
    };
  }
  save(p: Principal, id: string | undefined, data: Record<string, unknown>) {
    this.platform.requireRole(p, ["owner", "admin", "operator"]);
    this.platform.active(p);
    const previous = id ? this.authorize(p, id) : undefined,
      org =
        previous?.organization ??
        this.platform.authorizeOrg(p, data.organization);
    const name = typeof data.name === "string" ? data.name.trim() : "",
      url = monitoringURL(data.url).href,
      method = String(data.method ?? "GET"),
      interval = Number(data.interval_seconds ?? 300),
      timeout = Number(data.timeout_seconds ?? 10),
      expected = Number(data.expected_status ?? 200),
      threshold = Number(data.failure_threshold ?? 2);
    if (
      !name ||
      name.length > 120 ||
      !["GET", "HEAD"].includes(method) ||
      ![60, 300, 600, 900, 1800, 3600].includes(interval) ||
      ![5, 10, 15, 30].includes(timeout) ||
      !Number.isInteger(expected) ||
      expected < 100 ||
      expected > 599 ||
      !Number.isInteger(threshold) ||
      threshold < 1 ||
      threshold > 5 ||
      typeof data.enabled !== "boolean"
    )
      throw new APIError(400, "Configuração de URL inválida.");
    return this.platform.transaction(() => {
      if (!previous && this.used(p) >= this.limits(p))
        throw new APIError(402, "Limite de URLs do plano atingido.");
      if (previous && data.version !== previous.version)
        throw new APIError(
          409,
          "O monitor foi atualizado. Recarregue antes de salvar.",
        );
      const monitorId = id ?? randomUUID();
      const reset =
        !!previous &&
        (previous.url !== url ||
          previous.method !== method ||
          previous.expected_status !== expected);

      if (previous)
        this.platform.store.db
          .prepare(
            "UPDATE url_monitors SET name=?,url=?,method=?,interval_seconds=?,timeout_seconds=?,expected_status=?,failure_threshold=?,enabled=?," +
              (reset
                ? "status='pending',last_checked=NULL,last_status=NULL,latency_ms=NULL,last_error=NULL,history_version=history_version+1,"
                : !previous.enabled && data.enabled
                  ? "status='pending',"
                  : "") +
              "failures=0,next_check=?,lease_until=0,version=version+1 WHERE id=?",
          )
          .run(
            name,
            url,
            method,
            interval,
            timeout,
            expected,
            threshold,
            data.enabled ? 1 : 0,
            now(),
            monitorId,
          );
      else
        this.platform.store.db
          .prepare(
            "INSERT INTO url_monitors(id,tenant_id,organization,name,url,method,interval_seconds,timeout_seconds,expected_status,failure_threshold,enabled,next_check) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            monitorId,
            p.tenantId,
            org,
            name,
            url,
            method,
            interval,
            timeout,
            expected,
            threshold,
            data.enabled ? 1 : 0,
            now(),
          );
      if (previous && (reset || !data.enabled))
        this.platform.store.db
          .prepare(
            "UPDATE url_incidents SET resolved_at=?,resolution='configuration' WHERE monitor_id=? AND resolved_at IS NULL",
          )
          .run(now(), monitorId);
      this.platform.audit(
        p,
        previous ? "url.monitor.updated" : "url.monitor.created",
        monitorId,
      );
      return this.clean(this.row(monitorId));
    });
  }
  archive(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner", "admin", "operator"]);
    this.authorize(p, id);
    this.platform.store.db
      .prepare(
        "UPDATE url_monitors SET archived=1,enabled=0,version=version+1 WHERE id=?",
      )
      .run(id);
    this.platform.store.db
      .prepare(
        "UPDATE url_incidents SET resolved_at=?,resolution='archived' WHERE monitor_id=? AND resolved_at IS NULL",
      )
      .run(now(), id);
    this.platform.audit(p, "url.monitor.archived", id);
    return { ok: true };
  }
  details(p: Principal, id: string, hours = 24): URLDetails {
    const row = this.authorize(p, id);
    if (![1, 6, 24, 168].includes(hours))
      throw new APIError(400, "Período de URLs inválido.");
    const checks = this.platform.store.db
      .prepare(
        "SELECT id,checked_at,ok,status_code,latency_ms,error FROM url_checks WHERE monitor_id=? AND monitor_version=? AND checked_at>=? ORDER BY checked_at DESC,rowid DESC LIMIT 1000",
      )
      .all(id, row.history_version, now() - hours * 3600) as URLCheck[];
    const stats = this.platform.store.db
      .prepare(
        "SELECT count(*) AS n,avg(ok)*100 AS uptime FROM url_checks WHERE monitor_id=? AND monitor_version=? AND checked_at>=?",
      )
      .get(id, row.history_version, now() - hours * 3600)!;
    const incidents = this.platform.store.db
      .prepare(
        "SELECT id,opened_at,resolved_at,message,resolution FROM url_incidents WHERE monitor_id=? ORDER BY opened_at DESC LIMIT 50",
      )
      .all(id) as URLIncident[];
    return {
      monitor: {
        ...this.clean(row),
        uptime_percent: stats.uptime as number | null,
        checks: Number(stats.n),
      },
      checks,
      incidents,
      range_hours: hours,
    };
  }
  async check(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner", "admin", "operator"]);
    this.platform.active(p);
    const row = this.authorize(p, id);
    if (!row.enabled)
      throw new APIError(409, "Ative o monitor antes de verificar.");
    if (!this.claim(row, true))
      throw new APIError(
        409,
        "Uma verificação está em andamento. Aguarde alguns segundos.",
      );
    this.platform.audit(p, "url.monitor.checked", id);
    await this.execute(row);
    return this.details(p, id);
  }
  private claim(row: Row, manual = false) {
    const at = now();
    return (
      Number(
        this.platform.store.db
          .prepare(
            "UPDATE url_monitors SET lease_until=?,last_attempt=?,next_check=? WHERE id=? AND version=? AND archived=0 AND enabled=1 AND lease_until<=? AND last_attempt<=?" +
              (manual ? "" : " AND next_check<=?"),
          )
          .run(
            at + row.timeout_seconds + 15,
            at,
            at + row.interval_seconds,
            row.id,
            row.version,
            at,
            at - 15,
            ...(manual ? [] : [at]),
          ).changes,
      ) === 1
    );
  }
  private async execute(row: Row) {
    let result: ProbeResult;
    try {
      result = await this.probe(row.url, row.method, row.timeout_seconds);
    } catch {
      result = {
        status_code: null,
        latency_ms: 0,
        error: "Não foi possível conectar ao endereço.",
      };
    }
    const at = now();
    this.platform.transaction(() => {
      const current = this.platform.store.db
        .prepare(
          "SELECT * FROM url_monitors WHERE id=? AND version=? AND archived=0 AND enabled=1",
        )
        .get(row.id, row.version) as Row | undefined;
      if (!current) return;
      const ok = !result.error && result.status_code === row.expected_status,
        failures = ok ? 0 : current.failures + 1,
        message =
          result.error ??
          `HTTP ${result.status_code}; esperado ${row.expected_status}.`;
      this.platform.store.db
        .prepare(
          "INSERT INTO url_checks(id,monitor_id,checked_at,ok,status_code,latency_ms,error,monitor_version) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          row.id,
          at,
          ok ? 1 : 0,
          result.status_code,
          result.latency_ms,
          ok ? null : message,
          row.history_version,
        );
      this.platform.store.db
        .prepare(
          "UPDATE url_monitors SET status=?,last_checked=?,last_status=?,latency_ms=?,last_error=?,failures=?,lease_until=0 WHERE id=? AND version=?",
        )
        .run(
          ok ? "up" : "down",
          at,
          result.status_code,
          result.latency_ms,
          ok ? null : message,
          failures,
          row.id,
          row.version,
        );
      const incident = this.platform.store.db
        .prepare(
          "SELECT id FROM url_incidents WHERE monitor_id=? AND resolved_at IS NULL",
        )
        .get(row.id);
      if (!ok && !incident && failures >= row.failure_threshold) {
        const id = randomUUID();
        this.platform.store.db
          .prepare(
            "INSERT INTO url_incidents(id,monitor_id,opened_at,resolved_at,message) VALUES (?,?,?,NULL,?)",
          )
          .run(id, row.id, at, message);
        this.platform.enqueue({
          event: "url.alert.opened",
          alert_id: id,
          monitor_id: row.id,
          monitor: row.name,
          kind: "url",
          message,
          at,
        });
      } else if (ok && incident) {
        this.platform.store.db
          .prepare(
            "UPDATE url_incidents SET resolved_at=?,resolution='recovered' WHERE id=?",
          )
          .run(at, incident.id);
        this.platform.enqueue({
          event: "url.alert.resolved",
          alert_id: incident.id,
          monitor_id: row.id,
          monitor: row.name,
          kind: "url",
          at,
        });
      }
    });
  }
  async tick() {
    const at = now();
    const due = this.platform.store.db
      .prepare(
        "SELECT m.* FROM url_monitors m JOIN tenants t ON t.id=m.tenant_id WHERE m.archived=0 AND m.enabled=1 AND m.next_check<=? AND m.lease_until<=? AND ((t.billing_provider='mercadopago' AND t.billing_until>? AND t.subscription_status IN ('active','canceled')) OR (coalesce(t.billing_provider,'')!='mercadopago' AND (t.subscription_status='active' OR(t.subscription_status='trialing' AND t.trial_until>=?)))) ORDER BY m.next_check LIMIT 50",
      )
      .all(at, at, at, at) as Row[];
    await Promise.all(
      due.map(async (row) => {
        if (this.claim(row)) await this.execute(row);
      }),
    );
  }

  cleanup() {
    for (const [plan, limits] of Object.entries(this.platform.catalog.all()))
      this.platform.store.db
        .prepare(
          "DELETE FROM url_checks WHERE checked_at<? AND monitor_id IN (SELECT m.id FROM url_monitors m JOIN tenants t ON t.id=m.tenant_id WHERE t.plan=?)",
        )
        .run(now() - limits.retentionDays * 86400, plan);
  }
}
