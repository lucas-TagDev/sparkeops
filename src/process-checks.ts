import { randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import { now } from "./platform.ts";
import type { Platform, Principal } from "./platform.ts";
import { redact, validService } from "./operations.ts";

export class ProcessChecks {
  platform: Platform;
  identify: (token: string) => string;
  constructor(platform: Platform, identify: (token: string) => string) {
    this.platform = platform;
    this.identify = identify;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS process_checks(id TEXT PRIMARY KEY,server_id TEXT NOT NULL REFERENCES servers(id),created_at INTEGER NOT NULL,status TEXT NOT NULL,result TEXT);
      CREATE INDEX IF NOT EXISTS process_checks_recent ON process_checks(server_id,created_at DESC);`);
  }
  expire() {
    this.platform.store.db
      .prepare(
        "UPDATE process_checks SET status='expired' WHERE status IN ('pending','running') AND created_at<?",
      )
      .run(now() - 600);
    this.platform.store.db
      .prepare("DELETE FROM process_checks WHERE created_at<?")
      .run(now() - 7 * 86400);
  }
  list(p: Principal, id: string) {
    this.platform.active(p);
    this.platform.server(p, id);
    this.expire();
    return this.platform.store.db
      .prepare(
        "SELECT * FROM process_checks WHERE server_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10",
      )
      .all(id);
  }
  request(p: Principal, id: string) {
    this.list(p, id);
    if (
      this.platform.store.db
        .prepare(
          "SELECT 1 FROM process_checks WHERE server_id=? AND status IN ('pending','running')",
        )
        .get(id)
    )
      throw new APIError(409, "Aguarde a consulta de processos em andamento.");
    const job = randomUUID();
    this.platform.store.db
      .prepare("INSERT INTO process_checks VALUES (?,?,?,'pending',NULL)")
      .run(job, id, now());
    this.platform.audit(p, "processes.local.requested", id);
    return this.list(p, id).find((row) => row.id === job);
  }
  pending(token: string) {
    const id = this.identify(token);
    this.expire();
    const rows = this.platform.store.db
      .prepare(
        "SELECT id FROM process_checks WHERE server_id=? AND status IN ('pending','running') ORDER BY created_at LIMIT 1",
      )
      .all(id);
    this.platform.store.db
      .prepare(
        "UPDATE process_checks SET status='running' WHERE server_id=? AND status='pending'",
      )
      .run(id);
    return rows;
  }
  complete(token: string, job: string, data: Record<string, unknown>) {
    const id = this.identify(token);
    this.expire();
    const numeric = (value: unknown, min: number, max: number) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max;
    const text = (value: unknown, max: number) =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= max &&
      !/[\x00-\x1f\x7f]/.test(value);
    if (
      !Array.isArray(data.processes) ||
      data.processes.length > 30 ||
      !["ok", "unavailable"].includes(String(data.read_status)) ||
      !numeric(data.sample_seconds, 0.1, 60) ||
      !Number.isInteger(data.visible) ||
      !numeric(data.visible, 0, 20000) ||
      !Number.isInteger(data.skipped) ||
      !numeric(data.skipped, 0, 200000) ||
      !numeric(data.collected_at, now() - 600, now() + 60)
    )
      throw new APIError(400, "Resultado de processos inválido.");
    const seen = new Set<number>();
    const rows = data.processes.map((entry: unknown) => {
      const r = entry as Record<string, unknown>;
      if (
        !r ||
        typeof r !== "object" ||
        !Number.isInteger(r.pid) ||
        !numeric(r.pid, 1, 4194304) ||
        seen.has(Number(r.pid)) ||
        !text(r.name, 100) ||
        !text(r.user, 100) ||
        !numeric(r.cpu_percent, 0, 100) ||
        !numeric(r.memory_percent, 0, 100) ||
        !numeric(r.rss_bytes, 0, 2 ** 53 - 1) ||
        !numeric(r.elapsed_seconds, 0, 10 ** 11) ||
        !text(r.state, 1) ||
        (r.service !== null &&
          r.service !== undefined &&
          !validService(r.service))
      )
        throw new APIError(400, "Processo inválido.");
      seen.add(Number(r.pid));
      return {
        pid: r.pid,
        name: redact(String(r.name)),
        user: redact(String(r.user)),
        cpu_percent: r.cpu_percent,
        memory_percent: r.memory_percent,
        rss_bytes: r.rss_bytes,
        elapsed_seconds: r.elapsed_seconds,
        state: r.state,
        service: r.service ?? null,
      };
    });
    if (
      (data.read_status === "unavailable" && rows.length) ||
      Number(data.visible) < rows.length
    )
      throw new APIError(400, "Contagem de processos inválida.");
    const result = JSON.stringify({
      processes: rows,
      visible: data.visible,
      skipped: data.skipped,
      truncated: data.truncated === true,
      read_status: data.read_status,
      sample_seconds: data.sample_seconds,
      collected_at: data.collected_at,
      cpu_basis: "host_total",
      received_at: now(),
    });
    const update = this.platform.store.db
      .prepare(
        "UPDATE process_checks SET status='completed',result=? WHERE id=? AND server_id=? AND status IN ('pending','running') AND created_at>=?",
      )
      .run(result, job, id, now() - 600);
    if (!update.changes)
      throw new APIError(
        409,
        "Consulta encerrada ou pertencente a outro servidor.",
      );
    return { ok: true };
  }
}
