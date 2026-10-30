import { createHash, randomUUID } from "node:crypto";
import ssh2 from "ssh2";
const { Client } = ssh2;
import { APIError } from "./store.ts";
import { hash, now } from "./platform.ts";
import type { Platform, Principal } from "./platform.ts";
import type { AISettings } from "./ai-settings.ts";
import type { RemediationAction } from "../shared/action-history.ts";

export const validService = (s: unknown): s is string =>
  typeof s === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}$/.test(s);
export const redact = (s: string) =>
  s
    .replace(
      /(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;"']+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:password|passwd|token|api[_-]?key|secret)\s*[:=]\s*)[^\s,;"']+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(sk-[a-zA-Z0-9_-]{12,}|AIza[a-zA-Z0-9_-]{20,})\b/g,
      "[REDACTED]",
    );
type Monitor = {
  auto_discover: number;
  services: string;
  logs_enabled: number;
};
type SSH = {
  host: string;
  port: number;
  username: string;
  fingerprint: string;
  encrypted: string;
  revision: string;
};
type Credential = {
  privateKey?: string;
  password?: string;
  passphrase?: string;
};
export type SSHResult = { code: number; output: string };
export type SSHExecutor = (
  config: SSH & Credential,
  commands: string[],
) => Promise<SSHResult>;

export const sshExecute: SSHExecutor = (config, commands) =>
  new Promise((resolve, reject) => {
    const client = new Client();
    let finished = false,
      output = "";
    const finish = (error?: Error, code = 0) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      client.end();
      error
        ? reject(error)
        : resolve({ code, output: redact(output).slice(0, 16000) });
    };
    const timer = setTimeout(
      () => finish(new Error("timeout")),
      commands.some((c) => c.includes("/usr/local/sbin/foxops-config "))
        ? 120000
        : 45000,
    );
    client.on("error", () => finish(new Error("ssh")));
    client.on("close", () => {
      if (!finished) finish(new Error("closed"));
    });
    client.on("ready", () => {
      let index = 0;
      const next = () => {
        if (index >= commands.length) return finish(undefined, 0);
        const command = commands[index++];
        output += "\n$ " + command + "\n";
        client.exec(command, { pty: false }, (error, stream) => {
          if (error) return finish(new Error("exec"));
          const read = (chunk: Buffer) => {
            output += chunk.toString("utf8");
            if (output.length > 20000) {
              stream.close();
              finish(new Error("output-limit"));
            }
          };
          stream.on("data", read);
          stream.stderr.on("data", read);
          stream.on("close", (code: number | null) => {
            if (finished) return;
            if (code !== 0) return finish(undefined, code ?? 1);
            next();
          });
        });
      };
      next();
    });
    try {
      client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        privateKey: config.privateKey,
        password: config.password,
        passphrase: config.passphrase,
        readyTimeout: 15000,
        algorithms: {
          serverHostKey: [
            "ssh-ed25519",
            "ecdsa-sha2-nistp256",
            "rsa-sha2-512",
            "rsa-sha2-256",
          ],
        },
        hostVerifier: (key: Buffer) =>
          "SHA256:" +
            createHash("sha256")
              .update(key)
              .digest("base64")
              .replace(/=+$/, "") ===
          config.fingerprint,
      });
    } catch {
      finish(new Error("ssh-config"));
    }
  });

export function actionCommands(
  service: string,
  action: string,
  username: string,
) {
  if (
    !validService(service) ||
    ![
      "status",
      "diagnose",
      "start",
      "reset-failed",
      "configtest",
      "restart",
      "reload",
    ].includes(action)
  )
    throw new APIError(400, "Ação ou serviço inválido.");
  const unit = service.replace(/\.service$/, "");
  const sudo = username === "root" ? "" : "sudo -n ";
  const check =
    unit === "nginx"
      ? `${sudo}/usr/sbin/nginx -t`
      : ["apache2", "httpd"].includes(unit)
        ? `${sudo}/usr/sbin/apachectl configtest`
        : /^php\d+\.\d+-fpm$/.test(unit)
          ? `${sudo}/usr/sbin/php-fpm${unit.slice(3, -4)} -t`
          : null;
  if (action === "diagnose")
    return [
      `${sudo}/usr/bin/python3 /opt/foxops-agent/linux_agent.py --diagnose-service '${unit}'`,
    ];
  if (action === "reset-failed")
    return [`${sudo}/usr/bin/systemctl reset-failed -- '${unit}.service'`];
  if (action === "configtest") {
    if (!check)
      throw new APIError(
        400,
        "Este serviço não tem teste de configuração disponível.",
      );
    return [check];
  }
  if (action === "status")
    return [`/usr/bin/systemctl is-active -- '${unit}.service'`];
  return [
    ...(check ? [check] : []),
    `${sudo}/usr/bin/systemctl ${action} -- '${unit}.service'`,
    `/usr/bin/systemctl is-active -- '${unit}.service'`,
  ];
}

export class Operations {
  platform: Platform;
  vault: AISettings;
  execute: SSHExecutor;
  constructor(
    platform: Platform,
    vault: AISettings,
    execute: SSHExecutor = sshExecute,
  ) {
    this.platform = platform;
    this.vault = vault;
    this.execute = execute;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS monitors(server_id TEXT PRIMARY KEY REFERENCES servers(id),auto_discover INTEGER NOT NULL DEFAULT 1,services TEXT NOT NULL DEFAULT '[]',logs_enabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS server_logs(server_id TEXT NOT NULL REFERENCES servers(id),event_id TEXT NOT NULL,service TEXT NOT NULL,timestamp REAL NOT NULL,priority TEXT NOT NULL,message TEXT NOT NULL,received_at INTEGER NOT NULL,PRIMARY KEY(server_id,event_id));
      CREATE INDEX IF NOT EXISTS recent_server_logs ON server_logs(server_id,timestamp DESC);
      CREATE TABLE IF NOT EXISTS ssh_connections(server_id TEXT PRIMARY KEY REFERENCES servers(id),host TEXT NOT NULL,port INTEGER NOT NULL,username TEXT NOT NULL,fingerprint TEXT NOT NULL,encrypted TEXT NOT NULL,revision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remediation_actions(id TEXT PRIMARY KEY,server_id TEXT NOT NULL REFERENCES servers(id),tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,service TEXT NOT NULL,action TEXT NOT NULL,commands TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,connection_revision TEXT NOT NULL,created_at INTEGER NOT NULL,approved_by TEXT,finished_at INTEGER,output TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_execution ON remediation_actions(server_id) WHERE status='executing';`);
    // A process restart cannot establish whether an already-started remote command completed.
    platform.store.db
      .prepare(
        "UPDATE remediation_actions SET status='unknown',finished_at=?,output='Aplicação reiniciada durante a execução. Verifique o serviço antes de tentar novamente.' WHERE status='executing'",
      )
      .run(now());
  }
  private agent(token: string) {
    this.platform.validateAgentSubscription(token);
    const s = this.platform.store.db
      .prepare("SELECT id FROM servers WHERE token_hash=?")
      .get(hash(token)) as { id: string } | undefined;
    if (!s) throw new APIError(401, "Credencial de agente inválida.");
    return s.id;
  }
  config(serverId: string) {
    return (
      (this.platform.store.db
        .prepare("SELECT * FROM monitors WHERE server_id=?")
        .get(serverId) as Monitor | undefined) ?? {
        auto_discover: 1,
        services: "[]",
        logs_enabled: 0,
      }
    );
  }
  agentConfig(token: string) {
    const id = this.agent(token),
      c = this.config(id),
      db = this.platform.store.db;
    return {
      auto_discover: !!c.auto_discover,
      services: JSON.parse(c.services),
      logs_enabled: !!c.logs_enabled,
      required_services: db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='service_watches'")
        .get()
        ? db
            .prepare(
              "SELECT service FROM service_watches WHERE server_id=? AND enabled=1",
            )
            .all(id)
            .map((row) => row.service)
        : [],
    };
  }
  get(p: Principal, id: string) {
    const s = this.platform.server(p, id),
      c = this.config(id);
    return {
      auto_discover: !!c.auto_discover,
      services: JSON.parse(c.services),
      logs_enabled: !!c.logs_enabled,
      discovered_services: s.details?.discovered_services ?? [],
      agent_version: s.details?.agent_version ?? "0.1",
      log_error: s.details?.log_error ?? null,
    };
  }
  save(p: Principal, id: string, data: Record<string, unknown>) {
    this.platform.requireRole(p, ["owner", "admin", "operator"]);
    this.platform.server(p, id);
    if (
      typeof data.auto_discover !== "boolean" ||
      typeof data.logs_enabled !== "boolean" ||
      !Array.isArray(data.services) ||
      data.services.length > 20 ||
      !data.services.every(validService)
    )
      throw new APIError(400, "Selecione até 20 serviços válidos.");
    this.platform.store.db
      .prepare(
        "INSERT INTO monitors VALUES (?,?,?,?) ON CONFLICT(server_id) DO UPDATE SET auto_discover=excluded.auto_discover,services=excluded.services,logs_enabled=excluded.logs_enabled",
      )
      .run(
        id,
        data.auto_discover ? 1 : 0,
        JSON.stringify([...new Set(data.services)]),
        data.logs_enabled ? 1 : 0,
      );
    this.platform.audit(p, "monitor.updated", id);
  }
  ingestLogs(token: string, entries: unknown) {
    const id = this.agent(token);
    if (!this.config(id).logs_enabled)
      throw new APIError(403, "Coleta de logs desabilitada.");
    if (!Array.isArray(entries) || entries.length > 30)
      throw new APIError(400, "Envie no máximo 30 eventos.");
    const sanitized = entries.map((e: Record<string, unknown>) => {
      if (
        !e ||
        typeof e.event_id !== "string" ||
        e.event_id.length > 150 ||
        !validService(e.service) ||
        typeof e.timestamp !== "number" ||
        !Number.isFinite(e.timestamp) ||
        Math.abs(e.timestamp - now()) > 7 * 86400 ||
        typeof e.message !== "string" ||
        e.message.length > 2000
      )
        throw new APIError(400, "Evento de log inválido.");
      return {
        event_id: e.event_id,
        service: e.service,
        timestamp: e.timestamp,
        message: redact(e.message),
        priority: String(e.priority ?? "6").slice(0, 20),
      };
    });
    this.platform.transaction(() => {
      const q = this.platform.store.db.prepare(
        "INSERT OR IGNORE INTO server_logs VALUES (?,?,?,?,?,?,?)",
      );
      for (const e of sanitized)
        q.run(
          id,
          e.event_id as string,
          e.service as string,
          e.timestamp as number,
          e.priority,
          e.message,
          now(),
        );
      this.platform.store.db
        .prepare(
          "DELETE FROM server_logs WHERE server_id=? AND rowid NOT IN (SELECT rowid FROM server_logs WHERE server_id=? ORDER BY timestamp DESC LIMIT 5000)",
        )
        .run(id, id);
    });
    return { accepted: sanitized.length };
  }
  logs(p: Principal, id: string, service?: string) {
    this.platform.server(p, id);
    if (service && !validService(service))
      throw new APIError(400, "Serviço inválido.");
    this.platform.audit(p, "logs.read", id);
    return this.platform.store.db
      .prepare(
        `SELECT service,timestamp,priority,message FROM server_logs WHERE server_id=? AND received_at>=? ${service ? "AND service=?" : ""} ORDER BY timestamp DESC LIMIT 100`,
      )
      .all(id, now() - 7 * 86400, ...(service ? [service] : []));
  }
  sshMetadata(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.server(p, id);
    const row = this.platform.store.db
      .prepare(
        "SELECT host,port,username,fingerprint,revision FROM ssh_connections WHERE server_id=?",
      )
      .get(id);
    return { configured: !!row, ...row };
  }
  saveSSH(p: Principal, id: string, data: Record<string, unknown>) {
    this.platform.requireRole(p, ["owner"]);
    this.platform.server(p, id);
    if (
      typeof data.host !== "string" ||
      !data.host ||
      data.host.length > 253 ||
      !/^[a-zA-Z0-9.:-]+$/.test(data.host) ||
      typeof data.username !== "string" ||
      !/^[a-z_][a-z0-9_-]{0,31}$/.test(data.username) ||
      typeof data.fingerprint !== "string" ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(data.fingerprint) ||
      !Number.isInteger(data.port) ||
      Number(data.port) < 1 ||
      Number(data.port) > 65535
    )
      throw new APIError(
        400,
        "Informe host, porta, usuário e fingerprint SSH válidos.",
      );
    const existing = this.connection(id);
    let encrypted = existing?.encrypted;
    if (data.privateKey || data.password) {
      if (
        data.privateKey &&
        (typeof data.privateKey !== "string" ||
          data.privateKey.length > 16000 ||
          !data.privateKey.includes("PRIVATE KEY"))
      )
        throw new APIError(400, "Chave privada SSH inválida.");
      if (
        data.password &&
        (typeof data.password !== "string" || data.password.length > 1000)
      )
        throw new APIError(400, "Senha SSH inválida.");
      if (
        data.passphrase &&
        (typeof data.passphrase !== "string" || data.passphrase.length > 1000)
      )
        throw new APIError(400, "Frase secreta inválida.");
      encrypted = this.vault.protect(
        p.tenantId,
        "ssh:" + id,
        JSON.stringify({
          privateKey: data.privateKey || undefined,
          password: data.privateKey ? undefined : data.password,
          passphrase: data.passphrase || undefined,
        }),
      );
    }
    if (!encrypted)
      throw new APIError(400, "Cadastre uma chave privada ou senha SSH.");
    this.platform.store.db
      .prepare(
        "INSERT INTO ssh_connections VALUES (?,?,?,?,?,?,?) ON CONFLICT(server_id) DO UPDATE SET host=excluded.host,port=excluded.port,username=excluded.username,fingerprint=excluded.fingerprint,encrypted=excluded.encrypted,revision=excluded.revision",
      )
      .run(
        id,
        data.host,
        Number(data.port),
        data.username,
        data.fingerprint,
        encrypted,
        randomUUID(),
      );
    this.platform.audit(p, "ssh.configured", id);
  }
  private connection(id: string) {
    return this.platform.store.db
      .prepare("SELECT * FROM ssh_connections WHERE server_id=?")
      .get(id) as SSH | undefined;
  }
  private credentials(p: Principal, id: string) {
    const row = this.connection(id);
    if (!row) throw new APIError(400, "Configure o SSH deste servidor.");
    return {
      ...row,
      ...JSON.parse(this.vault.reveal(p.tenantId, "ssh:" + id, row.encrypted)),
    } as SSH & Credential;
  }
  configRevision(id: string) {
    const row = this.connection(id);
    if (!row) throw new APIError(400, "Configure o SSH deste servidor.");
    return row.revision;
  }
  terminalConnection(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.active(p);
    this.platform.server(p, id);
    return this.credentials(p, id);
  }
  proposeCommand(p: Principal, id: string, command: string, reason: string) {
    this.platform.requireRole(p, ["owner", "admin", "operator"]);
    this.platform.server(p, id);
    this.platform.active(p);
    if (!command.trim() || command.length > 2000 || command.includes("\0"))
      throw new APIError(400, "Comando inválido.");
    const connection = this.credentials(p, id),
      actionId = randomUUID();
    if (
      Buffer.from(JSON.stringify({ command })).toString("base64").length > 4000
    )
      throw new APIError(400, "Comando muito grande para o executor.");
    const wrapper = `${connection.username === "root" ? "" : "sudo -n "}/usr/local/sbin/foxops-command '${Buffer.from(JSON.stringify({ command })).toString("base64")}'`;
    this.platform.store.db
      .prepare(
        "INSERT INTO remediation_actions(id,server_id,tenant_id,user_id,service,action,commands,reason,status,connection_revision,created_at) VALUES (?,?,?,?,?,'command',?,?,'pending',?,?)",
      )
      .run(
        actionId,
        id,
        p.tenantId,
        p.userId,
        "operador",
        JSON.stringify([wrapper]),
        reason.slice(0, 1000),
        connection.revision,
        now(),
      );
    this.platform.audit(p, "command.proposed", id);
    return actionId;
  }
  configCommand(p: Principal, id: string, data: Record<string, unknown>) {
    const c = this.credentials(p, id);
    return `${c.username === "root" ? "" : "sudo -n "}/usr/local/sbin/foxops-config '${Buffer.from(JSON.stringify(data)).toString("base64")}'`;
  }
  async executeRunbook(
    p: Principal,
    id: string,
    data: Record<string, unknown>,
  ) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.active(p);
    this.platform.server(p, id);
    const c = this.credentials(p, id);
    const encoded = Buffer.from(JSON.stringify(data)).toString("base64");
    if (encoded.length > 4000) throw new APIError(400, "Runbook muito grande.");
    const result = await this.execute(c, [
      `${c.username === "root" ? "" : "sudo -n "}/usr/local/sbin/foxops-runbook '${encoded}'`,
    ]);
    const line = result.output
      .split(/\r?\n/)
      .find((s) => s.startsWith("FOXOPS_RUNBOOK:"));
    if (!line)
      throw new APIError(
        502,
        "Auxiliar de runbooks indisponível. Atualize e habilite os runbooks no servidor.",
      );
    return JSON.parse(line.slice("FOXOPS_RUNBOOK:".length)) as {
      status: string;
      sha256?: string;
      exit_code?: number;
      output?: string;
      service_state?: string;
    };
  }
  async executeConfig(p: Principal, id: string, data: Record<string, unknown>) {
    const result = await this.execute(this.credentials(p, id), [
      this.configCommand(p, id, data),
    ]);
    const line = result.output
      .split(/\r?\n/)
      .find((s) => s.startsWith("FOXOPS_CONFIG:"));
    if (!line)
      throw new APIError(
        502,
        "Auxiliar de configuração indisponível. Atualize o agente e os auxiliares SSH.",
      );
    return JSON.parse(line.slice("FOXOPS_CONFIG:".length)) as Record<
      string,
      unknown
    >;
  }
  removeSSH(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner"]);
    this.platform.server(p, id);
    this.platform.store.db
      .prepare("DELETE FROM ssh_connections WHERE server_id=?")
      .run(id);
    this.platform.audit(p, "ssh.removed", id);
  }
  async testSSH(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.server(p, id);
    try {
      const r = await this.execute(this.credentials(p, id), [
        "/usr/bin/hostname",
      ]);
      this.platform.audit(p, "ssh.tested", id);
      return r;
    } catch {
      throw new APIError(
        502,
        "Falha SSH: confira rede, autenticação e fingerprint do servidor.",
      );
    }
  }
  propose(p: Principal, id: string, data: Record<string, unknown>) {
    this.platform.requireRole(p, ["owner", "admin", "operator"]);
    const server = this.platform.server(p, id);
    this.platform.active(p);
    const service = String(data.service),
      action = String(data.action);
    if (!validService(service)) throw new APIError(400, "Serviço inválido.");
    const known = new Set([
      ...Object.keys((server.details?.services ?? {}) as object),
      ...((server.details?.discovered_services as string[]) ?? []),
      ...JSON.parse(this.config(id).services),
    ]);
    if (!known.has(service))
      throw new APIError(
        400,
        "O serviço precisa estar identificado ou configurado no monitoramento.",
      );
    const ssh = this.connection(id);
    if (!ssh)
      throw new APIError(
        400,
        "Configure a conexão SSH antes de preparar uma ação.",
      );
    const commands = actionCommands(service, action, ssh.username),
      reason =
        typeof data.reason === "string"
          ? data.reason.slice(0, 1000)
          : "Ação solicitada no painel.";
    const actionId = randomUUID();
    this.platform.store.db
      .prepare(
        "INSERT INTO remediation_actions(id,server_id,tenant_id,user_id,service,action,commands,reason,status,connection_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        actionId,
        id,
        p.tenantId,
        p.userId,
        service,
        action,
        JSON.stringify(commands),
        reason,
        "pending",
        ssh.revision,
        now(),
      );
    this.platform.audit(p, "action.proposed", id);
    return { id: actionId, commands, status: "pending" };
  }
  actions(p: Principal, id: string) {
    this.platform.server(p, id);
    return this.platform.store.db
      .prepare(
        "SELECT a.id,a.service,a.action,a.commands,a.reason,a.status,a.created_at,a.approved_by,a.finished_at,a.output FROM remediation_actions a WHERE server_id=? AND tenant_id=? ORDER BY created_at DESC LIMIT 30",
      )
      .all(id, p.tenantId)
      .map((row) =>
        Object.assign(row, {
          operator_command: this.platform.store.db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='command_steps'",
            )
            .get()
            ? this.platform.store.db
                .prepare("SELECT command FROM command_steps WHERE action_id=?")
                .get(row.id)?.command
            : null,
          configuration: this.platform.store.db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='config_changes'",
            )
            .get()
            ? this.platform.store.db
                .prepare("SELECT summary FROM config_changes WHERE action_id=?")
                .get(row.id)?.summary
            : null,
        }),
      );
  }
  actionHistory(p: Principal, id: string, input: Record<string, unknown>) {
    this.platform.server(p, id);
    const db = this.platform.store.db,
      at = now(),
      q = String(input.q ?? "")
        .trim()
        .slice(0, 160),
      status = String(input.status ?? "all");
    const statuses = [
      "canceled",
      "replaced",
      "pending",
      "expired",
      "executing",
      "succeeded",
      "failed",
      "unknown",
      "rejected",
      "rolled_back",
      "rollback_failed",
    ];
    if (status !== "all" && !statuses.includes(status))
      throw new APIError(400, "Status de ação inválido.");
    const requestedLimit = Number(input.limit ?? 5),
      limit = [5, 10, 20].includes(requestedLimit) ? requestedLimit : 5;
    const state =
      "CASE WHEN a.status='pending' AND a.created_at<" +
      (at - 900) +
      " THEN 'expired' ELSE a.status END";
    let where = "a.server_id=? AND a.tenant_id=?";
    const values: (string | number)[] = [id, p.tenantId];
    if (status !== "all") {
      where += ` AND (${state})=?`;
      values.push(status);
    }
    if (q) {
      const term = "%" + q.replace(/[!%_]/g, "!$&") + "%";
      where +=
        " AND (a.service LIKE ? ESCAPE '!' OR a.action LIKE ? ESCAPE '!' OR a.reason LIKE ? ESCAPE '!')";
      values.push(term, term, term);
    }
    const total = (
        db
          .prepare(
            "SELECT count(*) n FROM remediation_actions a WHERE " + where,
          )
          .get(...values) as { n: number }
      ).n,
      pages = Math.max(1, Math.ceil(total / limit)),
      page = Math.min(pages, Math.max(1, Math.floor(Number(input.page) || 1)));
    const items = db
      .prepare(
        `SELECT a.id,a.service,a.action,a.reason,(${state}) status,a.created_at,a.finished_at FROM remediation_actions a WHERE ${where} ORDER BY a.created_at DESC,a.rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, (page - 1) * limit);
    const pending = (
      db
        .prepare(
          "SELECT count(*) n FROM remediation_actions WHERE server_id=? AND tenant_id=? AND status='pending' AND created_at>=?",
        )
        .get(id, p.tenantId, at - 900) as { n: number }
    ).n;
    return { items, total, page, pages, limit, pending };
  }
  actionDetail(p: Principal, id: string, key: string) {
    this.platform.server(p, id);
    const db = this.platform.store.db,
      row = db
        .prepare(
          "SELECT id,service,action,commands,reason,status,created_at,finished_at,output FROM remediation_actions WHERE id=? AND server_id=? AND tenant_id=?",
        )
        .get(key, id, p.tenantId);
    if (!row) throw new APIError(404, "Ação não encontrada.");
    const exists = (table: string) =>
      !!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table);
    return {
      ...row,
      status:
        row.status === "pending" && Number(row.created_at) < now() - 900
          ? "expired"
          : row.status,
      operator_command: exists("command_steps")
        ? (db
            .prepare("SELECT command FROM command_steps WHERE action_id=?")
            .get(key)?.command ?? null)
        : null,
      configuration: exists("config_changes")
        ? (db
            .prepare("SELECT summary FROM config_changes WHERE action_id=?")
            .get(key)?.summary ?? null)
        : null,
    } as unknown as RemediationAction;
  }
  async approve(p: Principal, id: string, actionId: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.server(p, id);
    this.platform.active(p);
    if (
      this.platform.store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='runbook_runs'")
        .get() &&
      this.platform.store.db
        .prepare(
          "SELECT 1 FROM runbook_runs WHERE server_id=? AND status='executing'",
        )
        .get(id)
    )
      throw new APIError(409, "Há um runbook em execução neste servidor.");
    const action = this.platform.store.db
      .prepare(
        "SELECT * FROM remediation_actions WHERE id=? AND server_id=? AND tenant_id=?",
      )
      .get(actionId, id, p.tenantId) as
      | {
          status: string;
          commands: string;
          connection_revision: string;
          created_at: number;
          action: string;
        }
      | undefined;
    const connection = this.connection(id);
    if (
      !action ||
      action.status !== "pending" ||
      now() - action.created_at > 900 ||
      !connection ||
      connection.revision !== action.connection_revision
    )
      throw new APIError(
        409,
        "Ação expirada, já utilizada ou conexão alterada. Prepare uma nova ação.",
      );
    const credentials = this.credentials(p, id);
    try {
      const result = this.platform.store.db
        .prepare(
          "UPDATE remediation_actions SET status='executing',approved_by=? WHERE id=? AND status='pending'",
        )
        .run(p.userId, actionId);
      if (!result.changes) throw new Error();
    } catch {
      throw new APIError(
        409,
        "Já existe uma execução neste servidor. Aguarde o resultado.",
      );
    }
    this.platform.audit(p, "action.approved", actionId);
    try {
      const result = await this.execute(
        credentials,
        JSON.parse(action.commands),
      );
      let status = result.code === 0 ? "succeeded" : "failed";
      if (action.action === "configuration") {
        try {
          const line = result.output
            .split(/\r?\n/)
            .find((s) => s.startsWith("FOXOPS_CONFIG:"));
          const report = JSON.parse(line!.slice("FOXOPS_CONFIG:".length));
          status =
            report.status === "applied"
              ? "succeeded"
              : ["rolled_back", "rollback_failed"].includes(report.status)
                ? report.status
                : "failed";
        } catch {
          status = "unknown";
        }
      }
      if (action.action === "command") {
        try {
          const line = result.output
            .split(/\r?\n/)
            .find((s) => s.startsWith("FOXOPS_COMMAND:"));
          const report = JSON.parse(line!.slice("FOXOPS_COMMAND:".length));
          status = ["timed_out", "output_limit"].includes(report.status)
            ? "unknown"
            : report.status === "completed" && report.exit_code === 0
              ? "succeeded"
              : "failed";
        } catch {
          status = "unknown";
        }
      }
      this.platform.store.db
        .prepare(
          "UPDATE remediation_actions SET status=?,finished_at=?,output=? WHERE id=?",
        )
        .run(status, now(), redact(result.output).slice(0, 16000), actionId);
    } catch {
      this.platform.store.db
        .prepare(
          "UPDATE remediation_actions SET status='unknown',finished_at=?,output=? WHERE id=?",
        )
        .run(
          now(),
          "Conexão interrompida ou tempo excedido. Verifique o serviço antes de repetir a ação.",
          actionId,
        );
    }
    this.platform.audit(p, "action.finished", actionId);
    return this.actionDetail(p, id, actionId);
  }
  reject(p: Principal, id: string, actionId: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.server(p, id);
    this.platform.store.db
      .prepare(
        "UPDATE remediation_actions SET status='rejected',finished_at=? WHERE id=? AND server_id=? AND tenant_id=? AND status='pending'",
      )
      .run(now(), actionId, id, p.tenantId);
    this.platform.audit(p, "action.rejected", actionId);
  }
}
