import { randomBytes, randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import { hash, now } from "./platform.ts";
import type { Platform, Principal } from "./platform.ts";
import { Operations, validService } from "./operations.ts";
import { ProcessChecks } from "./process-checks.ts";
import { LiveChecks } from "./live-checks.ts";

export class AgentTasks {
  platform: Platform;
  operations: Operations;
  processes: ProcessChecks;
  live: LiveChecks;
  constructor(platform: Platform, operations: Operations) {
    this.platform = platform;
    this.operations = operations;
    this.processes = new ProcessChecks(platform, (token) => this.agent(token));
    this.live = new LiveChecks(platform, (token) => this.agent(token));
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS ssh_bootstrap(server_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,agent_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS local_log_checks(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,service TEXT NOT NULL,since INTEGER NOT NULL,until INTEGER NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL,result TEXT);`);
  }
  agent(token: string) {
    this.platform.validateAgentSubscription(token);
    const row = this.platform.store.db
      .prepare("SELECT id FROM servers WHERE token_hash=?")
      .get(hash(token)) as { id: string } | undefined;
    if (!row) throw new APIError(401, "Agente inválido.");
    return row.id;
  }
  issue(id: string, p?: Principal) {
    if (p) {
      this.platform.requireRole(p, ["owner"]);
      this.platform.server(p, id);
    }
    if (
      this.platform.store.db
        .prepare("SELECT 1 FROM ssh_connections WHERE server_id=?")
        .get(id)
    )
      throw new APIError(
        409,
        "SSH já cadastrado. Remova a conexão no painel antes de cadastrar outra.",
      );
    const agent = this.platform.store.db
      .prepare("SELECT token_hash FROM servers WHERE id=?")
      .get(id) as { token_hash: string };
    const ticket = randomBytes(32).toString("base64url");
    this.platform.store.db
      .prepare(
        "INSERT INTO ssh_bootstrap VALUES (?,?,?,?) ON CONFLICT(server_id) DO UPDATE SET token_hash=excluded.token_hash,agent_hash=excluded.agent_hash,expires_at=excluded.expires_at",
      )
      .run(id, hash(ticket), agent.token_hash, now() + 900);
    if (p) this.platform.audit(p, "ssh.bootstrap.authorized", id);
    return { ticket, expires_at: now() + 900 };
  }
  bootstrap(token: string, data: Record<string, unknown>) {
    const id = this.agent(token);
    const ticket = this.platform.store.db
      .prepare(
        "SELECT * FROM ssh_bootstrap WHERE server_id=? AND token_hash=? AND agent_hash=? AND expires_at>?",
      )
      .get(id, hash(String(data.ticket ?? "")), hash(token), now());
    if (!ticket)
      throw new APIError(
        403,
        "Autorização SSH expirada ou inválida. Gere outra no painel.",
      );
    if (
      data.username !== "foxops-ssh" ||
      typeof data.privateKey !== "string" ||
      data.password
    )
      throw new APIError(
        400,
        "O cadastro automático exige chave privada do usuário dedicado foxops-ssh.",
      );
    const owner = this.platform.store.db
      .prepare(
        "SELECT m.user_id,o.tenant_id FROM servers s JOIN organizations o ON o.id=s.organization JOIN memberships m ON m.tenant_id=o.tenant_id AND m.role='owner' WHERE s.id=? LIMIT 1",
      )
      .get(id) as { user_id: string; tenant_id: string };
    const p = this.platform.principal(owner.user_id, owner.tenant_id);
    this.platform.transaction(() => {
      if (
        this.platform.store.db
          .prepare("SELECT 1 FROM ssh_connections WHERE server_id=?")
          .get(id)
      )
        throw new APIError(
          409,
          "SSH já cadastrado; não será substituído pelo agente.",
        );
      this.operations.saveSSH(p, id, data);
      this.platform.store.db
        .prepare("DELETE FROM ssh_bootstrap WHERE server_id=?")
        .run(id);
      this.platform.audit(p, "ssh.bootstrap.completed", id);
    });
    return { ok: true };
  }
  request(p: Principal, id: string, data: Record<string, unknown>) {
    this.platform.active(p);
    const server = this.platform.server(p, id);
    const services = new Set([
      ...Object.keys(server.details?.services ?? {}),
      ...JSON.parse(this.operations.config(id).services),
    ]);
    const since = Number(data.since ?? now() - 900),
      until = Number(data.until ?? now());
    if (
      !validService(data.service) ||
      !services.has(data.service) ||
      !Number.isInteger(since) ||
      !Number.isInteger(until) ||
      since >= until ||
      until > now() + 60 ||
      since < now() - 7 * 86400 ||
      until - since > 86400
    )
      throw new APIError(
        400,
        "Escolha um serviço monitorado e um período de até 24 horas nos últimos 7 dias.",
      );
    this.expire();
    if (
      this.platform.store.db
        .prepare(
          "SELECT 1 FROM local_log_checks WHERE server_id=? AND status IN ('pending','running')",
        )
        .get(id)
    )
      throw new APIError(409, "Aguarde a verificação em andamento.");
    const job = randomUUID();
    this.platform.store.db
      .prepare(
        "INSERT INTO local_log_checks VALUES (?,?,?,?,?,?,'pending',NULL)",
      )
      .run(job, id, data.service, since, until, now());
    this.platform.audit(p, "logs.local.requested", id);
    return this.list(p, id).find((r) => r.id === job);
  }
  expire() {
    this.platform.store.db
      .prepare(
        "UPDATE local_log_checks SET status='expired' WHERE status IN ('pending','running') AND created_at<?",
      )
      .run(now() - 600);
    this.platform.store.db
      .prepare("DELETE FROM local_log_checks WHERE created_at<?")
      .run(now() - 7 * 86400);
  }
  list(p: Principal, id: string) {
    this.platform.server(p, id);
    this.expire();
    return this.platform.store.db
      .prepare(
        "SELECT * FROM local_log_checks WHERE server_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20",
      )
      .all(id);
  }
  pending(token: string) {
    const id = this.agent(token);
    this.expire();
    // Delivery is retried until acknowledged; checks only read local data.
    const rows = this.platform.store.db
      .prepare(
        "SELECT id,service,since,until FROM local_log_checks WHERE server_id=? AND status IN ('pending','running') ORDER BY created_at,rowid LIMIT 1",
      )
      .all(id);
    this.platform.store.db
      .prepare(
        "UPDATE local_log_checks SET status='running' WHERE server_id=? AND status='pending'",
      )
      .run(id);
    return rows;
  }
  complete(token: string, job: string, data: Record<string, unknown>) {
    const id = this.agent(token);
    this.expire();
    const counts = data.counts as Record<string, unknown> | undefined;
    const allowed = [
      "permission_denied",
      "connection_refused",
      "upstream_timeout",
      "configuration_error",
      "out_of_memory",
      "other_errors",
      "warnings",
      "tunnel_connection_error",
    ];
    if (
      !counts ||
      typeof counts !== "object" ||
      Array.isArray(counts) ||
      Object.keys(counts).some((k) => !allowed.includes(k)) ||
      Object.values(counts).some(
        (v) => !Number.isInteger(v) || Number(v) < 0 || Number(v) > 500,
      ) ||
      !Number.isInteger(data.scanned) ||
      Number(data.scanned) < 0 ||
      Number(data.scanned) > 500 ||
      !["ok", "unavailable"].includes(String(data.read_status))
    )
      throw new APIError(400, "Resumo local inválido.");
    // No raw messages, filenames or free-form instructions are accepted here.
    const sources = Array.isArray(data.sources)
      ? data.sources.filter((s) =>
          ["journalctl", "service_error_file"].includes(String(s)),
        )
      : ["journalctl"];
    const result = JSON.stringify({
      counts,
      scanned: data.scanned,
      read_status: data.read_status,
      truncated: data.truncated === true,
      sources,
      unparsed: Math.max(0, Math.min(500, Number(data.unparsed) || 0)),
      checked_at: now(),
    });
    const update = this.platform.store.db
      .prepare(
        "UPDATE local_log_checks SET status='completed',result=? WHERE id=? AND server_id=? AND status IN ('pending','running') AND created_at>=?",
      )
      .run(result, job, id, now() - 600);
    if (!update.changes)
      throw new APIError(
        409,
        "Verificação encerrada ou pertencente a outro servidor.",
      );
    return { ok: true };
  }
}
