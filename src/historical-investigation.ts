import { randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import { now, type Platform, type Principal } from "./platform.ts";
import { historicalWindow } from "../shared/historical-time.ts";
export class HistoricalInvestigation {
  platform: Platform;
  constructor(platform: Platform) {
    this.platform = platform;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS historical_investigations(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,user_id TEXT NOT NULL,question TEXT NOT NULL,window TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS historical_log_jobs(investigation_id TEXT NOT NULL,check_id TEXT NOT NULL,PRIMARY KEY(investigation_id,check_id));
    CREATE TABLE IF NOT EXISTS local_log_checks(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,service TEXT NOT NULL,since INTEGER NOT NULL,until INTEGER NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL,result TEXT);`);
  }
  request(p: Principal, data: Record<string, unknown>) {
    this.platform.active(p);
    const server = this.platform.server(p, String(data.server_id));
    if (
      server.organization !==
        this.platform.authorizeOrg(p, data.organization) ||
      typeof data.question !== "string" ||
      data.question.length > 2000 ||
      typeof data.time_zone !== "string" ||
      data.time_zone.length > 80
    )
      throw new APIError(
        400,
        "Selecione o servidor, data e fuso para investigar.",
      );
    let window;
    try {
      window = historicalWindow(data.question, data.time_zone);
    } catch (e) {
      throw new APIError(400, (e as Error).message);
    }
    if (window.day_from > now())
      throw new APIError(400, "Não é possível investigar uma data futura.");
    window.to = Math.min(window.to, now());
    window.day_to = Math.min(window.day_to, now());
    if (window.to <= window.from)
      throw new APIError(400, "O horário informado ainda não ocorreu.");
    const db = this.platform.store.db,
      id = randomUUID();
    db.prepare(
      "DELETE FROM historical_log_jobs WHERE investigation_id IN (SELECT id FROM historical_investigations WHERE created_at<?)",
    ).run(now() - 86400);
    db.prepare("DELETE FROM historical_investigations WHERE created_at<?").run(
      now() - 86400,
    );
    const version = String(server.details?.agent_version ?? "0.0")
        .split(".")
        .map(Number),
      compatible = version[0] >= 1 || version[1] >= 10;
    const alerts = db
      .prepare(
        "SELECT kind FROM alerts WHERE server_id=? AND opened_at<? AND coalesce(resolved_at,?)>=? AND kind LIKE 'service:%' ORDER BY opened_at DESC LIMIT 3",
      )
      .all(server.id, window.day_to, now(), window.day_from);
    this.platform.transaction(() => {
      db.prepare(
        "INSERT INTO historical_investigations VALUES (?,?,?,?,?,?)",
      ).run(
        id,
        server.id,
        p.userId,
        data.question as string,
        JSON.stringify(window),
        now(),
      );
      if (compatible && window.from >= now() - 30 * 86400) {
        const services = [
          "__system__",
          ...new Set(alerts.map((a) => String(a.kind).slice(8))),
        ].slice(0, 4);
        for (const service of services) {
          const check = randomUUID();
          db.prepare(
            "INSERT INTO local_log_checks VALUES (?,?,?,?,?,?,'pending',NULL)",
          ).run(
            check,
            server.id,
            service,
            Math.floor(window.from),
            Math.floor(window.to),
            now(),
          );
          db.prepare("INSERT INTO historical_log_jobs VALUES (?,?)").run(
            id,
            check,
          );
        }
      }
      this.platform.audit(p, "assistant.history.requested", server.id);
    });
    return this.get(p, id);
  }
  get(p: Principal, id: string) {
    this.platform.active(p);
    const db = this.platform.store.db,
      row = db
        .prepare(
          "SELECT * FROM historical_investigations WHERE id=? AND user_id=? AND created_at>=?",
        )
        .get(id, p.userId, now() - 3600);
    if (!row)
      throw new APIError(
        404,
        "Investigação histórica expirada ou não encontrada.",
      );
    const server = this.platform.server(p, String(row.server_id)),
      window = JSON.parse(String(row.window)) as ReturnType<
        typeof historicalWindow
      >;
    const jobs = db
      .prepare(
        "SELECT c.id,c.service,c.since,c.until,c.status,c.result,c.created_at FROM historical_log_jobs j JOIN local_log_checks c ON c.id=j.check_id WHERE j.investigation_id=?",
      )
      .all(id);
    const waiting = jobs.some(
      (job) =>
        ["pending", "running"].includes(String(job.status)) &&
        Number(job.created_at) >= now() - 100,
    );
    return {
      id,
      server_id: server.id,
      question: row.question,
      status: waiting ? "pending" : "completed",
      window,
      logs: jobs.map((job) => ({
        service: job.service === "__system__" ? "system_journal" : job.service,
        since: job.since,
        until: job.until,
        status:
          ["pending", "running"].includes(String(job.status)) &&
          Number(job.created_at) < now() - 100
            ? "unavailable"
            : job.status,
        result: job.result ? JSON.parse(String(job.result)) : null,
      })),
      created_at: Number(row.created_at),
    };
  }
  context(p: Principal, id: string, question: string, serverId: string) {
    const check = this.get(p, id);
    if (check.server_id !== serverId || check.question !== question)
      throw new APIError(
        409,
        "Investigação histórica pertence a outra pergunta ou servidor.",
      );
    const db = this.platform.store.db,
      w = check.window;
    const metrics = this.platform.history(p, serverId, 1, {
      from: w.from,
      to: w.to,
    });
    const alertWhere =
        "server_id=? AND opened_at<? AND coalesce(resolved_at,?)>=?",
      values = [serverId, w.day_to, now(), w.day_from];
    const total = (
      db
        .prepare("SELECT count(*) n FROM alerts WHERE " + alertWhere)
        .get(...values) as { n: number }
    ).n;
    const alerts = db
      .prepare(
        "SELECT kind,severity,message,opened_at,resolved_at,acknowledged_at FROM alerts WHERE " +
          alertWhere +
          " ORDER BY opened_at DESC LIMIT 100",
      )
      .all(...values);
    const exists = (name: string) =>
      !!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);
    const processes = exists("process_checks")
      ? db
          .prepare(
            "SELECT created_at,result FROM process_checks WHERE server_id=? AND status='completed' AND created_at>=? AND created_at<=? ORDER BY created_at LIMIT 3",
          )
          .all(serverId, w.from, w.to)
          .map((row) => ({ ...row, result: JSON.parse(String(row.result)) }))
      : [];
    const spans = exists("trace_spans")
      ? db
          .prepare(
            "SELECT service,name,start,duration_ms,error,trace_id FROM trace_spans WHERE server_id=? AND start>=? AND start<=? ORDER BY error DESC,duration_ms DESC LIMIT 15",
          )
          .all(serverId, w.from, w.to)
      : [];
    const incidents = exists("process_incidents")
      ? db
          .prepare(
            "SELECT opened_at,resolved_at,message,summary FROM process_incidents WHERE server_id=? AND opened_at<? AND coalesce(resolved_at,?)>=? ORDER BY opened_at DESC LIMIT 15",
          )
          .all(serverId, w.day_to, now(), w.day_from)
      : [];
    const predictive = exists("predictive_findings")
      ? db
          .prepare(
            "SELECT metric,kind,opened_at,resolved_at,data FROM predictive_findings WHERE server_id=? AND opened_at<? AND coalesce(resolved_at,?)>=? ORDER BY opened_at DESC LIMIT 15",
          )
          .all(serverId, w.day_to, now(), w.day_from)
      : [];
    const actions = exists("remediation_actions")
      ? db
          .prepare(
            "SELECT service,action,status,created_at,finished_at,reason FROM remediation_actions WHERE server_id=? AND created_at>=? AND created_at<? ORDER BY created_at LIMIT 15",
          )
          .all(serverId, w.day_from, w.day_to)
      : [];
    const stride = Math.max(1, Math.ceil(metrics.length / 120));
    const compactMetrics = Array.from(
      { length: Math.ceil(metrics.length / stride) },
      (_, i) => {
        const chunk = metrics.slice(i * stride, (i + 1) * stride) as Record<
          string,
          number
        >[];
        const result = { ...chunk[0] };
        result.samples = chunk.reduce((sum, point) => sum + point.samples, 0);
        result.bucket_seconds = chunk[0].bucket_seconds * chunk.length;
        for (const metric of ["cpu", "memory", "disk"]) {
          result[metric + "_max"] = Math.max(
            ...chunk.map((point) => point[metric + "_max"]),
          );
          result[metric + "_min"] = Math.min(
            ...chunk.map((point) => point[metric + "_min"]),
          );
          result[metric + "_percent"] =
            chunk.reduce(
              (sum, point) => sum + point[metric + "_percent"] * point.samples,
              0,
            ) / result.samples;
        }
        return result;
      },
    );
    return {
      ...check,
      metrics: compactMetrics,
      alerts,
      alert_total: total,
      alerts_truncated: total > alerts.length,
      process_snapshots: processes,
      traces: spans,
      process_incidents: incidents,
      predictive_findings: predictive,
      remediation_history: actions,
      limitations: [
        "A janela das métricas e logs é de 30 minutos antes e depois do horário; sem horário explícito, cobre o dia informado.",
        "Os alertas incluem os abertos ou ainda em andamento nesse dia, não somente os ativos agora.",
        "Métricas, processos, traces e logs dependem de coleta e retenção. Ausência não comprova que não houve incidente.",
        "Leitura local limitada a 500 registros por fonte; categorias não comprovam causalidade. Sem processos históricos não é possível atribuir o pico a um processo específico.",
        "Logs históricos requerem agente 0.10 ou superior e disponibilidade local do journal (até 30 dias).",
      ],
    };
  }
}
