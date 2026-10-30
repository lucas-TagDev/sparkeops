import { randomBytes, randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import { hash, now, type Platform, type Principal } from "./platform.ts";
import {
  analyzeSeries,
  type Observation,
  type Prediction,
  type SeriesPoint,
} from "../shared/observability.ts";
import { redact } from "./operations.ts";
export class Observability {
  platform: Platform;
  constructor(platform: Platform) {
    this.platform = platform;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS hardware_samples(server_id TEXT NOT NULL,at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(server_id,at));
      CREATE TABLE IF NOT EXISTS trace_keys(server_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS trace_spans(server_id TEXT NOT NULL,trace_id TEXT NOT NULL,span_id TEXT NOT NULL,parent_id TEXT NOT NULL,service TEXT NOT NULL,name TEXT NOT NULL,start REAL NOT NULL,end REAL NOT NULL,duration_ms REAL NOT NULL,error INTEGER NOT NULL,attributes TEXT NOT NULL,PRIMARY KEY(server_id,trace_id,span_id));
      CREATE INDEX IF NOT EXISTS trace_window ON trace_spans(server_id,start);
      CREATE TABLE IF NOT EXISTS predictive_findings(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,metric TEXT NOT NULL,kind TEXT NOT NULL,opened_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,resolved_at INTEGER,data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS predictive_open ON predictive_findings(server_id,metric,kind) WHERE resolved_at IS NULL;`);
  }
  record(serverId: string, details: unknown) {
    const input = (details as { telemetry?: Record<string, unknown> } | null)
      ?.telemetry;
    if (!input || typeof input !== "object") return;
    const data: Record<string, number> = {};
    for (const [key, max] of Object.entries({
      temperature_max_c: 150,
      disk_await_ms: 360000,
      disk_read_bytes_per_sec: 1e13,
      disk_write_bytes_per_sec: 1e13,
    })) {
      const value = input[key];
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= max
      )
        data[key] = value;
    }
    if (Object.keys(data).length)
      this.platform.store.db
        .prepare("INSERT OR IGNORE INTO hardware_samples VALUES (?,?,?)")
        .run(serverId, Math.floor(now() / 60) * 60, JSON.stringify(data));
  }
  issueKey(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.active(p);
    this.platform.server(p, id);
    const token = randomBytes(32).toString("base64url");
    this.platform.store.db
      .prepare(
        "INSERT INTO trace_keys VALUES (?,?) ON CONFLICT(server_id) DO UPDATE SET token_hash=excluded.token_hash",
      )
      .run(id, hash(token));
    this.platform.audit(p, "observability.key.rotated", id);
    return { token };
  }
  revokeKey(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.server(p, id);
    this.platform.store.db
      .prepare("DELETE FROM trace_keys WHERE server_id=?")
      .run(id);
    this.platform.audit(p, "observability.key.revoked", id);
  }
  trace(p: Principal, id: string, traceId: string) {
    const server = this.platform.server(p, id);
    if (!/^[a-f0-9]{32}$/i.test(traceId))
      throw new APIError(400, "Trace inválido.");
    return this.platform.store.db
      .prepare(
        "SELECT t.*,s.name AS server_name FROM trace_spans t JOIN servers s ON s.id=t.server_id JOIN server_config c ON c.server_id=s.id WHERE s.organization=? AND c.archived=0 AND t.trace_id=? ORDER BY t.start LIMIT 200",
      )
      .all(server.organization, traceId.toLowerCase());
  }
  ingest(token: string, input: Record<string, unknown>) {
    const row = this.platform.store.db
      .prepare(
        "SELECT k.server_id,o.tenant_id FROM trace_keys k JOIN servers s ON s.id=k.server_id JOIN organizations o ON o.id=s.organization JOIN server_config c ON c.server_id=s.id WHERE k.token_hash=? AND c.enabled=1 AND c.archived=0",
      )
      .get(hash(token)) as { server_id: string; tenant_id: string } | undefined;
    if (!row) throw new APIError(401, "Chave de traces inválida.");
    const member = this.platform.store.db
      .prepare(
        "SELECT user_id FROM memberships WHERE tenant_id=? AND role='owner' LIMIT 1",
      )
      .get(row.tenant_id) as { user_id: string };
    this.platform.active(
      this.platform.principal(member.user_id, row.tenant_id),
    );
    if (!Array.isArray(input.resourceSpans) || input.resourceSpans.length > 30)
      throw new APIError(400, "Use OTLP HTTP/JSON resourceSpans.");
    const spans: unknown[][] = [];
    const text = (value: unknown, max = 120) =>
      redact(typeof value === "string" ? value : "").slice(0, max);
    const attrs = (items: unknown) =>
      Object.fromEntries(
        (Array.isArray(items) ? items : [])
          .slice(0, 30)
          .filter(
            (a) => a && typeof a === "object" && typeof a.key === "string",
          )
          .map((a) => [a.key, a.value?.stringValue]),
      );
    for (const resource of input.resourceSpans) {
      if (!resource || !Array.isArray(resource.scopeSpans))
        throw new APIError(400, "Traces inválidos.");
      const attributes = attrs(resource.resource?.attributes),
        service = text(attributes["service.name"] || "application");
      for (const scope of resource.scopeSpans) {
        if (!Array.isArray(scope.spans))
          throw new APIError(400, "Traces inválidos.");
        for (const span of scope.spans) {
          if (spans.length >= 500)
            throw new APIError(400, "Limite de 500 spans por envio.");
          if (
            !span ||
            !/^([a-f0-9]{32})$/i.test(span.traceId) ||
            !/[1-9a-f]/i.test(span.traceId) ||
            !/^([a-f0-9]{16})$/i.test(span.spanId) ||
            !/[1-9a-f]/i.test(span.spanId) ||
            (span.parentSpanId && !/^[a-f0-9]{16}$/i.test(span.parentSpanId)) ||
            !/^\d{1,20}$/.test(String(span.startTimeUnixNano)) ||
            !/^\d{1,20}$/.test(String(span.endTimeUnixNano))
          )
            throw new APIError(
              400,
              "Identificadores ou tempos de span inválidos.",
            );
          const start = Number(BigInt(span.startTimeUnixNano)) / 1e9,
            end = Number(BigInt(span.endTimeUnixNano)) / 1e9;
          if (
            start < now() - 86400 ||
            end > now() + 60 ||
            end < start ||
            end - start > 3600
          )
            throw new APIError(400, "Span fora da janela permitida.");
          const values = attrs(span.attributes),
            safe: Record<string, string> = {};
          for (const key of [
            "db.system.name",
            "db.operation.name",
            "rpc.system",
            "rpc.service",
            "http.request.method",
          ])
            if (values[key]) safe[key] = text(values[key]);
          // Do not persist SQL statements, URLs/query strings, headers, events, or baggage.
          spans.push([
            row.server_id,
            span.traceId.toLowerCase(),
            span.spanId.toLowerCase(),
            String(span.parentSpanId ?? "").toLowerCase(),
            service,
            text(span.name),
            start,
            end,
            (end - start) * 1000,
            span.status?.code === 2 || span.status?.code === "STATUS_CODE_ERROR"
              ? 1
              : 0,
            JSON.stringify(safe),
          ]);
        }
      }
    }
    const quota = this.platform.store.db
      .prepare(
        "SELECT count(*) n FROM trace_spans WHERE server_id=? AND start>=?",
      )
      .get(row.server_id, now() - 3600) as { n: number };
    if (quota.n + spans.length > 10000)
      throw new APIError(429, "Limite de 10.000 spans por servidor por hora.");
    this.platform.transaction(() => {
      const insert = this.platform.store.db.prepare(
        "INSERT OR IGNORE INTO trace_spans VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      );
      for (const span of spans) insert.run(...(span as (string | number)[]));
    });
    return {};
  }
  private series(id: string) {
    const db = this.platform.store.db,
      output: Record<string, SeriesPoint[]> = {};
    for (const metric of ["cpu_percent", "memory_percent", "disk_percent"])
      output[metric] = db
        .prepare(
          `SELECT CAST(received_at/3600 AS INTEGER)*3600 AS at,avg(json_extract(metrics,'$.${metric}')) AS value FROM samples WHERE server_id=? AND received_at>=? GROUP BY at ORDER BY at`,
        )
        .all(id, now() - 30 * 86400) as SeriesPoint[];
    for (const metric of ["temperature_max_c", "disk_await_ms"])
      output[metric] = db
        .prepare(
          `SELECT CAST(at/3600 AS INTEGER)*3600 AS at,avg(json_extract(data,'$.${metric}')) AS value FROM hardware_samples WHERE server_id=? AND at>=? AND json_extract(data,'$.${metric}') IS NOT NULL GROUP BY CAST(at/3600 AS INTEGER) ORDER BY at`,
        )
        .all(id, now() - 30 * 86400) as SeriesPoint[];
    return output;
  }
  context(p: Principal, id: string): Observation {
    const server = this.platform.server(p, id),
      series = this.series(id),
      at = now();
    const findings: Prediction[] = [],
      learning: string[] = [];
    // Only complete hourly buckets are used; a partly collected hour cannot establish an anomaly.
    for (const [metric, points] of Object.entries(series)) {
      const result = analyzeSeries(
        metric,
        points.filter((point) => point.at < Math.floor(at / 3600) * 3600),
        at,
      );
      if (result.finding) findings.push(result.finding);
      if (result.learning) learning.push(`${metric}: ${result.learning}`);
    }
    const fresh = !!server.last_seen && at - server.last_seen <= 120;
    const from = at - 3600,
      until = at,
      db = this.platform.store.db;
    const exists = (name: string) =>
      !!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);
    const logs = exists("local_log_checks")
      ? db
          .prepare(
            "SELECT service,since,until,result FROM local_log_checks WHERE server_id=? AND status='completed' AND until>=? AND since<=? ORDER BY until DESC LIMIT 5",
          )
          .all(id, from, until)
          .map((r) => {
            const result = JSON.parse(String(r.result));
            return {
              ...r,
              result: {
                counts: result.counts,
                scanned: result.scanned,
                read_status: result.read_status,
                truncated: result.truncated,
              },
            };
          })
      : [];
    const processes = exists("process_checks")
      ? db
          .prepare(
            "SELECT created_at,result FROM process_checks WHERE server_id=? AND status='completed' AND created_at>=? ORDER BY created_at DESC LIMIT 1",
          )
          .all(id, from)
          .map((r) => {
            const result = JSON.parse(String(r.result));
            return {
              ...r,
              result: {
                read_status: result.read_status,
                collected_at: result.collected_at,
                processes: Array.isArray(result.processes)
                  ? result.processes.slice(0, 10)
                  : [],
              },
            };
          })
      : [];
    const spans = db
      .prepare(
        "SELECT trace_id,span_id,parent_id,service,name,start,duration_ms,error,attributes FROM trace_spans WHERE server_id=? AND start>=? AND start<=? ORDER BY error DESC,duration_ms DESC LIMIT 20",
      )
      .all(id, from, until);
    const count = db
      .prepare(
        "SELECT count(*) n FROM trace_spans WHERE server_id=? AND start>=?",
      )
      .get(id, from) as { n: number };
    const runbooks = exists("runbooks")
      ? db
          .prepare(
            "SELECT id,name,description,trigger_kind,mode,enabled FROM runbooks WHERE server_id=? AND archived=0 ORDER BY name LIMIT 30",
          )
          .all(id)
      : [];
    return {
      generated_at: at,
      fresh,
      findings: fresh ? findings : [],
      learning,
      coverage: {
        metrics: series.cpu_percent.length,
        hardware: Math.max(
          series.temperature_max_c.length,
          series.disk_await_ms.length,
        ),
        spans: count.n,
      },
      correlations: {
        from,
        until,
        relation:
          "Eventos da mesma janela e servidor são correlacionados temporalmente; isso não comprova causalidade. SQL bruto não é armazenado.",
        logs,
        spans,
        processes,
      },
      runbooks,
      limitations: [
        "Previsão estatística robusta; não é diagnóstico de defeito físico nem garantia de falha futura.",
        "Temperatura e I/O dependem de sensores e permissões do host; ausência de leitura não significa saúde.",
        "Consultas e chamadas específicas exigem instrumentação OpenTelemetry da aplicação.",
        "A análise horária exige histórico; padrões sazonais são usados apenas com amostras suficientes.",
      ],
    };
  }
  evaluate() {
    const db = this.platform.store.db;
    const servers = db
      .prepare(
        "SELECT s.id,o.tenant_id,m.user_id FROM servers s JOIN organizations o ON o.id=s.organization JOIN server_config c ON c.server_id=s.id JOIN memberships m ON m.tenant_id=o.tenant_id AND m.role='owner' WHERE c.enabled=1 AND c.archived=0 GROUP BY s.id",
      )
      .all() as { id: string; tenant_id: string; user_id: string }[];
    for (const server of servers) {
      const p = this.platform.principal(server.user_id, server.tenant_id);
      try {
        this.platform.active(p);
      } catch {
        continue;
      }
      const context = this.context(p, server.id);
      if (!context.fresh) continue;
      const keys = new Set(
        context.findings.map((f) => `${f.metric}:${f.type}`),
      );
      for (const finding of context.findings) {
        const current = db
          .prepare(
            "SELECT id FROM predictive_findings WHERE server_id=? AND metric=? AND kind=? AND resolved_at IS NULL",
          )
          .get(server.id, finding.metric, finding.type) as
          { id: string } | undefined;
        const id = current?.id ?? randomUUID();
        if (current)
          db.prepare(
            "UPDATE predictive_findings SET updated_at=?,data=? WHERE id=?",
          ).run(now(), JSON.stringify(finding), id);
        else {
          db.prepare(
            "INSERT INTO predictive_findings VALUES (?,?,?,?,?,?,NULL,?)",
          ).run(
            id,
            server.id,
            finding.metric,
            finding.type,
            now(),
            now(),
            JSON.stringify(finding),
          );
          this.platform.enqueue({
            event: "predictive.alert.opened",
            alert_id: id,
            kind: "predictive",
            message: `${finding.metric}: ${finding.evidence}${finding.eta_hours ? ` Estimativa até 90%: ${finding.eta_hours}h.` : ""}`,
            at: now(),
          });
        }
      }
      for (const row of db
        .prepare(
          "SELECT id,metric,kind FROM predictive_findings WHERE server_id=? AND resolved_at IS NULL",
        )
        .all(server.id) as { id: string; metric: string; kind: string }[])
        if (
          !keys.has(`${row.metric}:${row.kind}`) &&
          !context.learning.some((message) =>
            message.startsWith(row.metric + ":"),
          )
        ) {
          db.prepare(
            "UPDATE predictive_findings SET resolved_at=? WHERE id=?",
          ).run(now(), row.id);
          this.platform.enqueue({
            event: "predictive.alert.resolved",
            alert_id: row.id,
            kind: "predictive",
            at: now(),
          });
        }
    }
  }
  cleanup() {
    for (const row of this.platform.store.db
      .prepare(
        "SELECT s.id,t.plan FROM servers s JOIN organizations o ON o.id=s.organization JOIN tenants t ON t.id=o.tenant_id",
      )
      .all() as { id: string; plan: string }[]) {
      const cutoff =
        now() - this.platform.catalog.get(row.plan).retentionDays * 86400;
      this.platform.store.db
        .prepare("DELETE FROM hardware_samples WHERE server_id=? AND at<?")
        .run(row.id, cutoff);
      this.platform.store.db
        .prepare("DELETE FROM trace_spans WHERE server_id=? AND start<?")
        .run(row.id, cutoff);
    }
  }
}
