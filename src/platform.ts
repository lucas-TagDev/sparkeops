import { PlanCatalog } from "./plans.ts";
import { SERVER_REMOVAL_WORD } from "../shared/server-actions.ts";
import { isServerIcon, type ServerIconId } from "../shared/server-icons.ts";
import { DEFAULT_LIMITS } from "../shared/plans.ts";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { translate } from "../shared/translate.ts";
import { APIError, Store } from "./store.ts";
import { languageOf, type Language } from "../shared/language.ts";
import {
  auditCategory,
  auditActions,
  type AuditPage,
  type AuditEvent,
} from "../shared/audit.ts";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export const now = () => Math.floor(Date.now() / 1000);
export type Role = "owner" | "admin" | "operator" | "reader";
export type Principal = {
  language?: Language;
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
  orgScope?: string;
};
export const PLANS = DEFAULT_LIMITS;
export type Plan = string;
export type Organization = {
  id: string;
  tenant_id: string;
  name: string;
  created_at: number;
};
export type Server = ReturnType<Store["listServers"]>[number] & {
  organization: string;
  organization_name: string;
  created_at: number;
  enabled: number;
  details: Record<string, unknown> | null;
  icon?: ServerIconId;
};
export type Alert = {
  recovery?: {
    next_attempt_at?: number | null;
    status: string;
    summary: string | null;
    output: string | null;
    finished_at: number | null;
  } | null;
  id: string;
  server_id: string;
  organization: string;
  server_name: string;
  kind: string;
  severity: string;
  message: string;
  opened_at: number;
  resolved_at: number | null;
  acknowledged_at: number | null;
};

function text(value: unknown, field: string, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new APIError(400, `${field} inválido.`);
  return value.trim();
}
export function emailAddress(value: unknown) {
  const email = text(value, "E-mail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new APIError(400, "E-mail inválido.");
  return email;
}
export function passwordHash(password: unknown) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new APIError(400, "Use uma senha de 12 a 128 caracteres.");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password: unknown, encoded: string) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [salt, expected] = encoded.split(":");
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    scryptSync(password, salt, 64),
  );
}

export class Platform {
  store: Store;
  catalog: PlanCatalog;
  constructor(store: Store) {
    this.store = store;
    this.catalog = new PlanCatalog(store);
    const db = store.db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'trial',
        subscription_status TEXT NOT NULL DEFAULT 'trialing', customer_id TEXT, subscription_id TEXT, billing_event_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, trial_until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL REFERENCES tenants(id),
        role TEXT NOT NULL, PRIMARY KEY(user_id,tenant_id));
      CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(user_id TEXT NOT NULL, organization TEXT NOT NULL REFERENCES organizations(id), PRIMARY KEY(user_id,organization));
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS account_registration_policy(id INTEGER PRIMARY KEY CHECK(id=1),require_confirmation INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS user_email_verification(user_id TEXT PRIMARY KEY,email TEXT NOT NULL,verified_at INTEGER);
      CREATE TABLE IF NOT EXISTS enrollments(token_hash TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id), expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS server_config(server_id TEXT PRIMARY KEY REFERENCES servers(id), created_at INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        cpu REAL NOT NULL DEFAULT 85, memory REAL NOT NULL DEFAULT 90, disk REAL NOT NULL DEFAULT 90,
        offline INTEGER NOT NULL DEFAULT 120, duration INTEGER NOT NULL DEFAULT 60, details TEXT);
      CREATE TABLE IF NOT EXISTS rule_states(server_id TEXT NOT NULL, kind TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY(server_id,kind));
      CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id), kind TEXT NOT NULL,
        severity TEXT NOT NULL, message TEXT NOT NULL, opened_at INTEGER NOT NULL, resolved_at INTEGER, acknowledged_at INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS active_alert ON alerts(server_id,kind) WHERE resolved_at IS NULL;
      CREATE TABLE IF NOT EXISTS api_tokens(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
        organization TEXT, name TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, email TEXT NOT NULL,
        role TEXT NOT NULL, organizations TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS chat(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, organization TEXT NOT NULL, question TEXT NOT NULL,
        answer TEXT NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_usage(tenant_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(tenant_id,day));
      CREATE TABLE IF NOT EXISTS billing_events(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, delivered_at INTEGER);
    `);
    db.exec(
      "CREATE TABLE IF NOT EXISTS user_access(user_id TEXT PRIMARY KEY REFERENCES users(id), disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN(0,1)))",
    );
    const tenantColumns = db.prepare("PRAGMA table_info(tenants)").all() as {
      name: string;
    }[];
    if (!tenantColumns.some((c) => c.name === "billing_provider"))
      db.exec("ALTER TABLE tenants ADD COLUMN billing_provider TEXT");
    if (!tenantColumns.some((c) => c.name === "billing_until"))
      db.exec("ALTER TABLE tenants ADD COLUMN billing_until INTEGER");
    const columns = db.prepare("PRAGMA table_info(server_config)").all() as {
      name: string;
    }[];
    if (
      !(
        db.prepare("PRAGMA table_info(outbox)").all() as { name: string }[]
      ).some((c) => c.name === "event_sequence")
    )
      db.exec(
        "ALTER TABLE outbox ADD COLUMN event_sequence INTEGER; UPDATE outbox SET event_sequence=rowid;",
      );
    db.exec(
      "CREATE TABLE IF NOT EXISTS outbox_counter(id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL); INSERT OR IGNORE INTO outbox_counter VALUES (1,0); UPDATE outbox_counter SET value=max(value,coalesce((SELECT max(event_sequence) FROM outbox),0));",
    );
    if (!columns.some((c) => c.name === "archived"))
      db.exec(
        "ALTER TABLE server_config ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
      );
    if (!columns.some((c) => c.name === "icon"))
      db.exec(
        "ALTER TABLE server_config ADD COLUMN icon TEXT NOT NULL DEFAULT 'server'",
      );
    const chatColumns = db.prepare("PRAGMA table_info(chat)").all() as {
      name: string;
    }[];
    if (!chatColumns.some((c) => c.name === "scope"))
      db.exec("ALTER TABLE chat ADD COLUMN scope TEXT NOT NULL DEFAULT 'all'");
    if (!chatColumns.some((c) => c.name === "cleared_id"))
      db.exec("ALTER TABLE chat ADD COLUMN cleared_id TEXT");
    db.exec(
      "CREATE TABLE IF NOT EXISTS user_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),language TEXT NOT NULL)",
    );
    const auditColumns = db.prepare("PRAGMA table_info(audit)").all() as {
      name: string;
    }[];
    if (!auditColumns.some((c) => c.name === "actor_name"))
      db.exec("ALTER TABLE audit ADD COLUMN actor_name TEXT");
    if (!auditColumns.some((c) => c.name === "actor_email"))
      db.exec("ALTER TABLE audit ADD COLUMN actor_email TEXT");
    db.exec(
      "CREATE INDEX IF NOT EXISTS audit_recent_tenant ON audit(tenant_id,created_at DESC)",
    );
  }

  transaction<T>(fn: () => T): T {
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.store.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error;
    }
  }

  audit(p: Principal, action: string, target = "") {
    this.store.db
      .prepare(
        "INSERT INTO audit(id,tenant_id,user_id,action,target,created_at,actor_name,actor_email) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        p.tenantId,
        p.userId,
        action,
        target,
        now(),
        p.name,
        p.email,
      );
  }

  accountConfirmationRequired() {
    return !!this.store.db
      .prepare(
        "SELECT require_confirmation FROM account_registration_policy WHERE id=1",
      )
      .get()?.require_confirmation;
  }
  pendingAccountConfirmation(userId: string) {
    return (
      this.accountConfirmationRequired() &&
      !!this.store.db
        .prepare(
          "SELECT 1 FROM user_email_verification v JOIN users u ON u.id=v.user_id WHERE v.user_id=? AND v.email=u.email AND v.verified_at IS NULL",
        )
        .get(userId)
    );
  }
  signup(data: Record<string, unknown>, afterCreate?: (p: Principal) => void) {
    const name = text(data.name, "Nome");
    const company = text(data.company, "Empresa");
    const email = emailAddress(data.email);
    const encoded = passwordHash(data.password);
    if (this.store.db.prepare("SELECT 1 FROM users WHERE email=?").get(email))
      throw new APIError(409, "E-mail já cadastrado. Faça login.");
    return this.transaction(() => {
      const userId = randomUUID(),
        tenantId = randomUUID();
      this.store.db
        .prepare("INSERT INTO users VALUES (?,?,?,?)")
        .run(userId, name, email, encoded);
      this.store.db
        .prepare(
          "INSERT INTO tenants(id,name,created_at,trial_until) VALUES (?,?,?,?)",
        )
        .run(
          tenantId,
          company,
          now(),
          now() + this.catalog.get("trial").trialDays * 86400,
        );
      this.store.db
        .prepare("INSERT INTO memberships VALUES (?,?,?)")
        .run(userId, tenantId, "owner");
      this.store.db
        .prepare("INSERT INTO organizations VALUES (?,?,?,?)")
        .run(randomUUID(), tenantId, company, now());
      const principal: Principal = {
        userId,
        tenantId,
        name,
        email,
        role: "owner",
      };
      this.audit(principal, "account.created");
      if (this.accountConfirmationRequired())
        this.store.db
          .prepare("INSERT INTO user_email_verification VALUES(?,?,NULL)")
          .run(userId, email);
      afterCreate?.(principal);
      return this.pendingAccountConfirmation(userId)
        ? { token: "", principal }
        : this.newSession(principal);
    });
  }

  login(data: Record<string, unknown>) {
    const email = emailAddress(data.email);
    const row = this.store.db
      .prepare(
        `SELECT u.*, m.tenant_id, m.role FROM users u JOIN memberships m ON m.user_id=u.id
      WHERE u.email=? ORDER BY m.tenant_id LIMIT 1`,
      )
      .get(email) as
      | {
          id: string;
          name: string;
          email: string;
          password_hash: string;
          tenant_id: string;
          role: Role;
        }
      | undefined;
    // Run scrypt even for unknown accounts to reduce account enumeration by timing.
    const dummy = "0".repeat(32) + ":" + "0".repeat(128);
    const valid = passwordMatches(data.password, row?.password_hash ?? dummy);
    if (
      !row ||
      !valid ||
      this.store.db
        .prepare("SELECT 1 FROM user_access WHERE user_id=? AND disabled=1")
        .get(row.id)
    )
      throw new APIError(401, "E-mail ou senha incorretos.");
    return this.newSession({
      userId: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      email: row.email,
      role: row.role,
    });
  }

  newSession(p: Principal) {
    this.principal(p.userId, p.tenantId);
    const token = secret();
    this.store.db.prepare("DELETE FROM sessions WHERE expires_at<?").run(now());
    this.store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
      .run(hash(token), p.userId, p.tenantId, now() + 7 * 86400);
    return { token, principal: p };
  }

  principal(userId: string, tenantId: string): Principal {
    const row = this.store.db
      .prepare(
        `SELECT u.name,u.email,m.role FROM users u JOIN memberships m ON m.user_id=u.id
      WHERE u.id=? AND m.tenant_id=? AND NOT EXISTS(SELECT 1 FROM user_access a WHERE a.user_id=u.id AND a.disabled=1)`,
      )
      .get(userId, tenantId) as
      { name: string; email: string; role: Role } | undefined;
    if (!row) throw new APIError(401, "Acesso expirado. Faça login novamente.");
    if (this.pendingAccountConfirmation(userId))
      throw new APIError(403, "Confirme seu e-mail para acessar a plataforma.");
    const pref = this.store.db
      .prepare("SELECT language FROM user_preferences WHERE user_id=?")
      .get(userId);
    return {
      userId,
      tenantId,
      ...row,
      ...(pref ? { language: languageOf(pref.language) } : {}),
    };
  }
  setLanguage(p: Principal, value: unknown) {
    if (!["pt-BR", "en", "es"].includes(String(value)))
      throw new APIError(400, "Idioma inválido.");
    this.store.db
      .prepare(
        "INSERT INTO user_preferences VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET language=excluded.language",
      )
      .run(p.userId, String(value));
    this.audit(p, "user.language.updated");
    return { language: languageOf(value) };
  }

  session(token: string) {
    const row = this.store.db
      .prepare(
        "SELECT user_id,tenant_id FROM sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(hash(token), now()) as
      { user_id: string; tenant_id: string } | undefined;
    if (!row) throw new APIError(401, "Faça login para continuar.");
    return this.principal(row.user_id, row.tenant_id);
  }

  logout(token: string) {
    this.store.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(hash(token));
  }

  requireRole(p: Principal, roles: Role[]) {
    if (!roles.includes(p.role))
      throw new APIError(403, "Seu perfil não permite esta ação.");
  }

  organizations(p: Principal): Organization[] {
    let rows = this.store.db
      .prepare("SELECT * FROM organizations WHERE tenant_id=? ORDER BY name")
      .all(p.tenantId) as Organization[];
    if (!["owner", "admin"].includes(p.role))
      rows = rows.filter(
        (org) =>
          !!this.store.db
            .prepare("SELECT 1 FROM grants WHERE user_id=? AND organization=?")
            .get(p.userId, org.id),
      );
    if (p.orgScope) rows = rows.filter((org) => org.id === p.orgScope);
    return rows;
  }

  authorizeOrg(p: Principal, id: unknown) {
    if (
      typeof id !== "string" ||
      !this.organizations(p).some((org) => org.id === id)
    ) {
      this.audit(p, "access.denied");
      throw new APIError(404, "Cliente não encontrado ou sem permissão.");
    }
    return id;
  }

  renameWorkspace(p: Principal, value: unknown) {
    this.requireRole(p, ["owner"]);
    if (p.orgScope)
      throw new APIError(
        403,
        "Use a conta do proprietário para alterar o workspace.",
      );
    const name = text(value, "Nome do workspace");
    if (/[\u0000-\u001f\u007f]/.test(name))
      throw new APIError(400, "Nome do workspace inválido.");
    const previous = this.account(p).name;
    this.transaction(() => {
      this.store.db
        .prepare("UPDATE tenants SET name=? WHERE id=?")
        .run(name, p.tenantId);
      if (previous !== name)
        this.audit(p, "workspace.name.updated", p.tenantId);
    });
    return { id: p.tenantId, name };
  }

  account(p: Principal) {
    const tenant = this.store.db
      .prepare(
        "SELECT id,name,plan,subscription_status,trial_until,billing_provider,billing_until FROM tenants WHERE id=?",
      )
      .get(p.tenantId) as {
      id: string;
      name: string;
      plan: Plan;
      subscription_status: string;
      trial_until: number;
      billing_provider: string | null;
      billing_until: number | null;
    };
    const usage = this.store.db
      .prepare("SELECT * FROM ai_usage WHERE tenant_id=? AND day=?")
      .get(p.tenantId, new Date().toISOString().slice(0, 10)) ?? {
      calls: 0,
      tokens: 0,
    };
    const total = this.store.db
      .prepare(
        "SELECT count(*) AS n FROM servers s LEFT JOIN server_config c ON c.server_id=s.id WHERE coalesce(c.archived,0)=0 AND organization IN (SELECT id FROM organizations WHERE tenant_id=?)",
      )
      .get(p.tenantId) as { n: number };
    return {
      ...tenant,
      limits: {
        ...this.catalog.public()[tenant.plan],
        aiDaily:
          process.env.NODE_ENV === "development" &&
          /^\d+$/.test(process.env.FOXOPS_DEV_AI_DAILY_LIMIT ?? "")
            ? Math.max(
                1,
                Math.min(10000, Number(process.env.FOXOPS_DEV_AI_DAILY_LIMIT)),
              )
            : this.catalog.get(tenant.plan).aiDaily,
      },
      server_count: total.n,
      url_monitor_count: this.store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='url_monitors'")
        .get()
        ? Number(
            this.store.db
              .prepare(
                "SELECT count(*) AS n FROM url_monitors WHERE tenant_id=? AND archived=0",
              )
              .get(p.tenantId)!.n,
          )
        : 0,
      ai_usage: usage,
    };
  }

  active(p: Principal) {
    const account = this.account(p);
    if (
      account.billing_provider === "mercadopago"
        ? !["active", "canceled"].includes(account.subscription_status) ||
          (account.billing_until ?? 0) <= now()
        : account.subscription_status === "trialing"
          ? now() > account.trial_until
          : !["active"].includes(account.subscription_status)
    ) {
      throw new APIError(
        402,
        "Seu período de uso terminou. Consulte o plano da conta.",
      );
    }
    return account;
  }

  createOrganization(p: Principal, value: unknown) {
    this.requireRole(p, ["owner", "admin"]);
    const account = this.active(p);
    if (this.organizations(p).length >= account.limits.organizations)
      throw new APIError(402, "Limite de clientes do plano atingido.");
    const id = randomUUID();
    this.store.db
      .prepare("INSERT INTO organizations VALUES (?,?,?,?)")
      .run(id, p.tenantId, text(value, "Nome"), now());
    this.audit(p, "organization.created", id);
    return { id };
  }

  servers(p: Principal, organization?: string): Server[] {
    const orgs = organization
      ? this.organizations(p).filter(
          (org) => org.id === this.authorizeOrg(p, organization),
        )
      : this.organizations(p);
    return orgs.flatMap((org) =>
      this.store
        .listServers(org.id)
        .map((server): Server | null => {
          const config = this.store.db
            .prepare(
              "SELECT created_at,enabled,offline,details,archived,icon FROM server_config WHERE server_id=?",
            )
            .get(server.id) as
            | {
                created_at: number;
                enabled: number;
                offline: number;
                details: string | null;
                archived: number;
                icon: ServerIconId;
              }
            | undefined;
          if (config?.archived) return null;
          return {
            ...server,
            status:
              server.last_seen === null
                ? "awaiting"
                : now() - server.last_seen < (config?.offline ?? 90)
                  ? "online"
                  : "offline",
            organization: org.id,
            organization_name: org.name,
            created_at: config?.created_at ?? 0,
            enabled: config?.enabled ?? 1,
            details: config?.details ? JSON.parse(config.details) : null,
            icon: config?.icon ?? "server",
          };
        })
        .filter((server): server is Server => server !== null),
    );
  }

  server(p: Principal, id: string) {
    const row = this.store.db
      .prepare("SELECT organization FROM servers WHERE id=?")
      .get(id) as { organization: string } | undefined;
    if (!row) throw new APIError(404, "Servidor não encontrado.");
    this.authorizeOrg(p, row.organization);
    const server = this.servers(p, row.organization).find((s) => s.id === id);
    if (!server) throw new APIError(404, "Servidor arquivado.");
    return server;
  }
  updateServerIcon(p: Principal, id: string, icon: unknown) {
    this.requireRole(p, ["owner", "admin", "operator"]);
    this.server(p, id);
    if (!isServerIcon(icon))
      throw new APIError(400, "Escolha um ícone válido para o servidor.");
    this.store.db
      .prepare("UPDATE server_config SET icon=? WHERE server_id=?")
      .run(icon, id);
    this.audit(p, "server.icon.updated", id);
    return this.server(p, id);
  }

  createServer(
    p: Principal,
    organization: unknown,
    name: unknown,
    icon: unknown = "server",
  ) {
    this.requireRole(p, ["owner", "admin", "operator"]);
    if (!isServerIcon(icon))
      throw new APIError(400, "Escolha um ícone válido para o servidor.");
    const org = this.authorizeOrg(p, organization);
    const account = this.active(p);
    if (account.server_count >= account.limits.servers)
      throw new APIError(402, "Limite de servidores do plano atingido.");
    return this.transaction(() => {
      const registered = this.store.register(org, name);
      this.store.db
        .prepare(
          "INSERT INTO server_config(server_id,created_at,enabled,icon) VALUES (?,?,0,?)",
        )
        .run(registered.server_id, now(), icon);
      const enrollment_token = secret();
      this.store.db
        .prepare("INSERT INTO enrollments VALUES (?,?,?,NULL)")
        .run(hash(enrollment_token), registered.server_id, now() + 900);
      this.audit(p, "server.created", registered.server_id);
      return {
        server_id: registered.server_id,
        enrollment_token,
        expires_at: now() + 900,
      };
    });
  }

  enroll(token: unknown) {
    if (typeof token !== "string")
      throw new APIError(400, "Token de instalação obrigatório.");
    return this.transaction(() => {
      const row = this.store.db
        .prepare(
          "SELECT server_id FROM enrollments WHERE token_hash=? AND expires_at>? AND used_at IS NULL",
        )
        .get(hash(token), now()) as { server_id: string } | undefined;
      if (!row)
        throw new APIError(
          401,
          "Token expirado ou já utilizado. Gere outro no painel.",
        );
      const agent_token = secret();
      this.store.db
        .prepare("UPDATE enrollments SET used_at=? WHERE token_hash=?")
        .run(now(), hash(token));
      this.store.db
        .prepare("UPDATE servers SET token_hash=? WHERE id=?")
        .run(hash(agent_token), row.server_id);
      this.store.db
        .prepare(
          "UPDATE server_config SET enabled=1,created_at=? WHERE server_id=?",
        )
        .run(now(), row.server_id);
      return { server_id: row.server_id, agent_token };
    });
  }

  revokeAgent(p: Principal, id: string) {
    this.requireRole(p, ["owner", "admin", "operator"]);
    this.server(p, id);
    this.transaction(() => {
      this.store.db
        .prepare("UPDATE servers SET token_hash=? WHERE id=?")
        .run(hash(secret()), id);
      this.store.db
        .prepare("UPDATE server_config SET enabled=0 WHERE server_id=?")
        .run(id);
      this.store.db
        .prepare(
          "UPDATE enrollments SET used_at=? WHERE server_id=? AND used_at IS NULL",
        )
        .run(now(), id);
      this.store.db
        .prepare(
          "UPDATE alerts SET resolved_at=? WHERE server_id=? AND resolved_at IS NULL",
        )
        .run(now(), id);
      this.store.db
        .prepare("DELETE FROM rule_states WHERE server_id=?")
        .run(id);
      this.audit(p, "agent.revoked", id);
    });
  }

  renewEnrollment(p: Principal, id: string) {
    this.requireRole(p, ["owner", "admin", "operator"]);
    this.server(p, id);
    this.active(p);
    const enrollment_token = secret();
    this.store.db
      .prepare(
        "UPDATE enrollments SET used_at=? WHERE server_id=? AND used_at IS NULL",
      )
      .run(now(), id);
    this.store.db
      .prepare("INSERT INTO enrollments VALUES (?,?,?,NULL)")
      .run(hash(enrollment_token), id, now() + 900);
    return { server_id: id, enrollment_token, expires_at: now() + 900 };
  }

  archiveServer(p: Principal, id: string) {
    this.revokeAgent(p, id);
    this.store.db
      .prepare("UPDATE server_config SET archived=1 WHERE server_id=?")
      .run(id);
    this.audit(p, "server.archived", id);
  }
  removeServer(p: Principal, id: string, confirmation: unknown) {
    this.requireRole(p, ["owner", "admin", "operator"]);
    this.server(p, id);
    if (confirmation !== SERVER_REMOVAL_WORD)
      throw new APIError(
        400,
        "Digite REMOVER para confirmar a remoção do servidor.",
      );
    this.archiveServer(p, id);
  }

  validateAgentSubscription(token: string) {
    const row = this.store.db
      .prepare(
        `SELECT t.subscription_status,t.trial_until FROM servers s JOIN organizations o ON o.id=s.organization
      JOIN tenants t ON t.id=o.tenant_id WHERE s.token_hash=?`,
      )
      .get(hash(token)) as
      { subscription_status: string; trial_until: number } | undefined;
    if (
      row &&
      (row.subscription_status === "trialing"
        ? row.trial_until < now()
        : row.subscription_status !== "active")
    )
      throw new APIError(402, "Assinatura inativa. Consulte o plano da conta.");
  }

  recordDetails(token: string, details: unknown) {
    if (details === undefined) return;
    if (
      !details ||
      typeof details !== "object" ||
      Array.isArray(details) ||
      JSON.stringify(details).length > 384000
    )
      throw new APIError(400, "Detalhes inválidos.");
    this.store.db
      .prepare(
        "UPDATE server_config SET details=? WHERE server_id=(SELECT id FROM servers WHERE token_hash=?)",
      )
      .run(JSON.stringify(details), hash(token));
  }

  history(
    p: Principal,
    id: string,
    hours = 6,
    range?: { from: number; to: number },
  ) {
    this.server(p, id);
    if (!range && (!Number.isFinite(hours) || hours < 1 || hours > 168))
      throw new APIError(400, "Use uma janela entre 1 e 168 horas.");
    const from = range?.from ?? now() - hours * 3600,
      to = range?.to ?? now();
    if (
      ![from, to].every(Number.isFinite) ||
      from < 0 ||
      to <= from ||
      to - from > 90 * 86400
    )
      throw new APIError(
        400,
        "Informe início e fim válidos, com início anterior ao fim e intervalo máximo de 90 dias.",
      );
    const bucket = Math.max(60, Math.ceil((to - from) / 900 / 60) * 60);
    const rows = this.store.db
      .prepare(
        `SELECT min(received_at) AS timestamp, count(*) AS samples, ? AS bucket_seconds,
      avg(json_extract(metrics,'$.cpu_percent')) AS cpu_percent,
      avg(json_extract(metrics,'$.memory_percent')) AS memory_percent,
      avg(json_extract(metrics,'$.disk_percent')) AS disk_percent,
      min(json_extract(metrics,'$.cpu_percent')) AS cpu_min, max(json_extract(metrics,'$.cpu_percent')) AS cpu_max,
      min(json_extract(metrics,'$.memory_percent')) AS memory_min, max(json_extract(metrics,'$.memory_percent')) AS memory_max,
      min(json_extract(metrics,'$.disk_percent')) AS disk_min, max(json_extract(metrics,'$.disk_percent')) AS disk_max
      FROM samples WHERE server_id=? AND received_at>=? AND received_at<=? GROUP BY CAST(received_at/? AS INTEGER) ORDER BY timestamp ASC LIMIT 1000`,
      )
      .all(bucket, id, from, to, bucket);
    return rows;
  }

  rules(p: Principal, id: string) {
    this.server(p, id);
    return this.store.db
      .prepare(
        "SELECT cpu,memory,disk,offline,duration FROM server_config WHERE server_id=?",
      )
      .get(id);
  }

  updateRules(p: Principal, id: string, data: Record<string, unknown>) {
    this.requireRole(p, ["owner", "admin", "operator"]);
    this.server(p, id);
    for (const key of ["cpu", "memory", "disk", "offline", "duration"]) {
      const value = data[key];
      const max = key === "offline" ? 3600 : key === "duration" ? 900 : 100;
      const min = key === "offline" ? 60 : key === "duration" ? 0 : 1;
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max
      )
        throw new APIError(400, `Limite ${key} inválido.`);
    }
    this.store.db
      .prepare(
        "UPDATE server_config SET cpu=?,memory=?,disk=?,offline=?,duration=? WHERE server_id=?",
      )
      .run(
        data.cpu as number,
        data.memory as number,
        data.disk as number,
        data.offline as number,
        data.duration as number,
        id,
      );
    this.audit(p, "rules.updated", id);
  }

  evaluate(at = now()) {
    const configs = this.store.db
      .prepare(
        `SELECT c.*, s.name FROM server_config c JOIN servers s ON s.id=c.server_id WHERE c.enabled=1`,
      )
      .all() as Array<{
      server_id: string;
      name: string;
      created_at: number;
      cpu: number;
      memory: number;
      disk: number;
      offline: number;
      duration: number;
      details: string | null;
    }>;
    for (const c of configs) {
      const last = this.store.db
        .prepare(
          "SELECT received_at,metrics FROM samples WHERE server_id=? ORDER BY received_at DESC LIMIT 1",
        )
        .get(c.server_id) as
        { received_at: number; metrics: string } | undefined;
      const offline = at - (last?.received_at ?? c.created_at) >= c.offline;
      const metrics = last ? JSON.parse(last.metrics) : null;
      const checks = [
        {
          kind: "offline",
          bad: offline,
          duration: 0,
          message: `Sem comunicação há pelo menos ${c.offline}s.`,
        },
        ...(["cpu", "memory", "disk"] as const).map((kind) => ({
          kind,
          bad: !offline && metrics && metrics[kind + "_percent"] >= c[kind],
          duration: c.duration,
          message: `${{ cpu: "CPU", memory: "Memória", disk: "Disco" }[kind]} acima do limite de ${c[kind]}%.`,
        })),
      ];
      const services = (c.details ? JSON.parse(c.details).services : {}) ?? {};
      const failedOnly =
        c.details && JSON.parse(c.details).service_alert_mode === "failed_only";
      const watched = this.store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='service_watches'")
        .get()
        ? this.store.db
            .prepare(
              "SELECT service,enabled FROM service_watches WHERE server_id=?",
            )
            .all(c.server_id)
        : [];
      for (const [name, status] of Object.entries(services)) {
        const watch = watched.find((row) => row.service === name);
        checks.push({
          kind: "service:" + name,
          bad:
            !offline &&
            (watch
              ? !!watch.enabled &&
                ["inactive", "failed", "not_loaded"].includes(String(status))
              : failedOnly
                ? status === "failed"
                : status !== "active" &&
                  status !== "unknown" &&
                  status !== "not_loaded"),
          duration: c.duration,
          message: `Serviço ${name}: ${String(status)}.`,
        });
      }
      for (const check of checks) {
        const current = this.store.db
          .prepare(
            "SELECT id FROM alerts WHERE server_id=? AND kind=? AND resolved_at IS NULL",
          )
          .get(c.server_id, check.kind) as { id: string } | undefined;
        if (check.bad) {
          this.store.db
            .prepare("INSERT OR IGNORE INTO rule_states VALUES (?,?,?)")
            .run(c.server_id, check.kind, at);
          const state = this.store.db
            .prepare(
              "SELECT since FROM rule_states WHERE server_id=? AND kind=?",
            )
            .get(c.server_id, check.kind) as { since: number };
          if (!current && at - state.since >= check.duration) {
            const id = randomUUID();
            this.store.db
              .prepare(
                "INSERT INTO alerts(id,server_id,kind,severity,message,opened_at) VALUES (?,?,?,?,?,?)",
              )
              .run(
                id,
                c.server_id,
                check.kind,
                check.kind === "offline" || check.kind === "disk"
                  ? "critical"
                  : "warning",
                check.message,
                at,
              );
            this.enqueue({
              event: "alert.opened",
              alert_id: id,
              server: c.name,
              kind: check.kind,
              message: check.message,
              at,
            });
          }
        } else {
          this.store.db
            .prepare("DELETE FROM rule_states WHERE server_id=? AND kind=?")
            .run(c.server_id, check.kind);
          // Lack of telemetry cannot prove that a metric recovered.
          if (
            current &&
            !(offline && check.kind !== "offline") &&
            !(
              check.kind.startsWith("service:") &&
              services[check.kind.slice(8)] !== "active"
            )
          ) {
            this.store.db
              .prepare("UPDATE alerts SET resolved_at=? WHERE id=?")
              .run(at, current.id);
            this.enqueue({
              event: "alert.resolved",
              alert_id: current.id,
              server: c.name,
              kind: check.kind,
              at,
            });
          }
        }
      }
    }
  }

  enqueue(data: unknown) {
    const sequence = this.store.db
      .prepare(
        "UPDATE outbox_counter SET value=value+1 WHERE id=1 RETURNING value",
      )
      .get() as { value: number };
    this.store.db
      .prepare(
        "INSERT INTO outbox(id,payload,next_at,event_sequence) VALUES (?,?,?,?)",
      )
      .run(randomUUID(), JSON.stringify(data), now(), sequence.value);
  }

  alerts(p: Principal): Alert[] {
    const orgs = this.organizations(p).map((org) => org.id);
    if (!orgs.length) return [];
    return this.store.db
      .prepare(
        `SELECT a.*,s.organization,s.name AS server_name FROM alerts a JOIN servers s ON s.id=a.server_id
      WHERE s.organization IN (${orgs.map(() => "?").join(",")}) ORDER BY a.opened_at DESC LIMIT 200`,
      )
      .all(...orgs) as Alert[];
  }

  acknowledge(p: Principal, id: string) {
    this.requireRole(p, ["owner", "admin", "operator"]);
    const alert = this.alerts(p).find((a) => a.id === id);
    if (!alert) throw new APIError(404, "Alerta não encontrado.");
    this.store.db
      .prepare("UPDATE alerts SET acknowledged_at=? WHERE id=?")
      .run(now(), id);
    this.audit(p, "alert.acknowledged", id);
  }

  createToken(p: Principal, data: Record<string, unknown>) {
    const organization = data.organization
      ? this.authorizeOrg(p, data.organization)
      : null;
    const id = randomUUID(),
      token = "fox_mcp_" + secret();
    const days = Number(data.days ?? 30);
    if (![7, 30, 90].includes(days))
      throw new APIError(400, "Validade permitida: 7, 30 ou 90 dias.");
    this.store.db
      .prepare("INSERT INTO api_tokens VALUES (?,?,?,?,?,?,?,?,NULL)")
      .run(
        id,
        hash(token),
        p.tenantId,
        p.userId,
        organization,
        text(data.name, "Nome"),
        now(),
        now() + days * 86400,
      );
    this.audit(p, "mcp.token.created", id);
    return { id, token, expires_at: now() + days * 86400 };
  }

  tokenPrincipal(token: string) {
    const row = this.store.db
      .prepare(
        "SELECT user_id,tenant_id,organization FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?",
      )
      .get(hash(token), now()) as
      | { user_id: string; tenant_id: string; organization: string | null }
      | undefined;
    if (!row)
      throw new APIError(401, "Token MCP inválido, revogado ou expirado.");
    const p = this.principal(row.user_id, row.tenant_id);
    if (row.organization) p.orgScope = row.organization;
    return p;
  }

  tokens(p: Principal) {
    return this.store.db
      .prepare(
        "SELECT id,name,organization,created_at,expires_at,revoked_at FROM api_tokens WHERE user_id=? AND tenant_id=? ORDER BY created_at DESC",
      )
      .all(p.userId, p.tenantId);
  }

  revokeToken(p: Principal, id: string) {
    this.store.db
      .prepare(
        "UPDATE api_tokens SET revoked_at=? WHERE id=? AND user_id=? AND tenant_id=?",
      )
      .run(now(), id, p.userId, p.tenantId);
    this.audit(p, "mcp.token.revoked", id);
  }

  members(p: Principal) {
    this.requireRole(p, ["owner", "admin"]);
    return this.store.db
      .prepare(
        "SELECT u.id,u.name,u.email,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=? ORDER BY u.name",
      )
      .all(p.tenantId);
  }

  invite(p: Principal, data: Record<string, unknown>) {
    this.requireRole(p, ["owner", "admin"]);
    if (!["admin", "operator", "reader"].includes(String(data.role)))
      throw new APIError(400, "Perfil inválido.");
    if (!Array.isArray(data.organizations) || data.organizations.length > 100)
      throw new APIError(400, "Selecione os clientes autorizados.");
    const orgs = data.organizations.map((id) => this.authorizeOrg(p, id));
    if (data.role !== "admin" && !orgs.length)
      throw new APIError(400, "Selecione pelo menos um cliente.");
    const token = secret();
    this.store.db
      .prepare("INSERT INTO invites VALUES (?,?,?,?,?,?,?,NULL)")
      .run(
        randomUUID(),
        hash(token),
        p.tenantId,
        emailAddress(data.email),
        String(data.role),
        JSON.stringify(orgs),
        now() + 86400,
      );
    this.audit(p, "team.invited");
    return { token, expires_at: now() + 86400 };
  }

  acceptInvite(
    data: Record<string, unknown>,
    afterCreate?: (p: Principal) => void,
  ) {
    const token = text(data.token, "Convite", 128);
    const invite = this.store.db
      .prepare(
        "SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
      )
      .get(hash(token), now()) as
      | {
          id: string;
          tenant_id: string;
          email: string;
          role: Role;
          organizations: string;
        }
      | undefined;
    if (!invite) throw new APIError(400, "Convite inválido ou expirado.");
    const existing = this.store.db
      .prepare("SELECT id,password_hash,name FROM users WHERE email=?")
      .get(invite.email) as
      { id: string; password_hash: string; name: string } | undefined;
    let encoded: string | undefined;
    if (existing) {
      if (!passwordMatches(data.password, existing.password_hash))
        throw new APIError(
          401,
          "Informe sua senha atual para aceitar o convite.",
        );
    } else {
      encoded = passwordHash(data.password);
    }
    const name = existing?.name ?? text(data.name, "Nome");
    return this.transaction(() => {
      const userId = existing?.id ?? randomUUID();
      if (!existing)
        this.store.db
          .prepare("INSERT INTO users VALUES (?,?,?,?)")
          .run(userId, name, invite.email, encoded!);
      if (
        this.store.db
          .prepare("SELECT 1 FROM memberships WHERE user_id=? AND tenant_id=?")
          .get(userId, invite.tenant_id)
      )
        throw new APIError(409, "Você já faz parte desta conta.");
      this.store.db
        .prepare("INSERT INTO memberships VALUES (?,?,?)")
        .run(userId, invite.tenant_id, invite.role);
      for (const org of JSON.parse(invite.organizations))
        this.store.db
          .prepare("INSERT OR IGNORE INTO grants VALUES (?,?)")
          .run(userId, org);
      this.store.db
        .prepare("UPDATE invites SET used_at=? WHERE id=?")
        .run(now(), invite.id);
      const principal: Principal = {
        userId,
        tenantId: invite.tenant_id,
        name,
        email: invite.email,
        role: invite.role,
      };
      if (!existing && this.accountConfirmationRequired())
        this.store.db
          .prepare("INSERT INTO user_email_verification VALUES(?,?,NULL)")
          .run(userId, invite.email);
      afterCreate?.(principal);
      return this.pendingAccountConfirmation(userId)
        ? { token: "", principal }
        : this.newSession(principal);
    });
  }

  removeMember(p: Principal, userId: string) {
    this.requireRole(p, ["owner", "admin"]);
    const row = this.store.db
      .prepare("SELECT role FROM memberships WHERE user_id=? AND tenant_id=?")
      .get(userId, p.tenantId) as { role: Role } | undefined;
    if (
      !row ||
      row.role === "owner" ||
      p.userId === userId ||
      (p.role === "admin" && row.role === "admin")
    )
      throw new APIError(403, "Não é possível remover este membro.");
    this.transaction(() => {
      this.store.db
        .prepare("DELETE FROM memberships WHERE user_id=? AND tenant_id=?")
        .run(userId, p.tenantId);
      this.store.db
        .prepare(
          "DELETE FROM grants WHERE user_id=? AND organization IN (SELECT id FROM organizations WHERE tenant_id=?)",
        )
        .run(userId, p.tenantId);
      this.store.db
        .prepare("DELETE FROM sessions WHERE user_id=? AND tenant_id=?")
        .run(userId, p.tenantId);
      this.store.db
        .prepare(
          "UPDATE api_tokens SET revoked_at=? WHERE user_id=? AND tenant_id=?",
        )
        .run(now(), userId, p.tenantId);
      this.audit(p, "team.removed", userId);
    });
  }

  auditLog(p: Principal) {
    this.requireRole(p, ["owner", "admin"]);
    return this.store.db
      .prepare(
        "SELECT a.*,u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? ORDER BY a.created_at DESC LIMIT 100",
      )
      .all(p.tenantId);
  }
  auditPage(p: Principal, input: Record<string, unknown>): AuditPage {
    this.requireRole(p, ["owner", "admin"]);
    const page = Number(input.page ?? 1),
      size = Number(input.page_size ?? 25),
      q = String(input.q ?? "").trim(),
      category = String(input.category ?? "all"),
      actor = String(input.actor ?? "");
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000000 ||
      ![10, 25, 50, 100].includes(size) ||
      q.length > 150 ||
      !["all", "changes", "checks", "access"].includes(category) ||
      actor.length > 100
    )
      throw new APIError(400, "Filtros de auditoria inválidos.");
    const clauses = ["a.tenant_id=?"],
      params: (string | number)[] = [p.tenantId];
    if (actor) {
      clauses.push("a.user_id=?");
      params.push(actor);
    }
    if (category !== "all") {
      clauses.push(
        "(CASE WHEN a.action='access.denied' OR a.action GLOB 'ssh.*' OR a.action GLOB 'mcp.*' OR a.action GLOB 'team.*' OR a.action GLOB 'member.*' OR a.action GLOB 'invite.*' THEN 'access' WHEN a.action GLOB 'query.*' OR a.action GLOB 'assistant.*' OR a.action GLOB 'logs.*' OR a.action GLOB 'processes.*' OR a.action='configuration.inspected' THEN 'checks' ELSE 'changes' END)=?",
      );
      params.push(category);
    }
    const joins =
      " FROM audit a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN servers s ON s.id=a.target AND s.organization IN (SELECT id FROM organizations WHERE tenant_id=a.tenant_id) LEFT JOIN organizations o ON o.id=a.target AND o.tenant_id=a.tenant_id";
    if (q) {
      const mapped = Object.entries(auditActions)
        .filter(([, label]) =>
          [label, translate(label, p.language)].some((text) =>
            text.toLowerCase().includes(q.toLowerCase()),
          ),
        )
        .map(([key]) => key);
      const term = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
      clauses.push(
        `(a.action LIKE ? ESCAPE '\\' OR coalesce(a.actor_name,u.name,'') LIKE ? ESCAPE '\\' OR coalesce(a.actor_email,u.email,'') LIKE ? ESCAPE '\\' OR coalesce(s.name,o.name,a.target,'') LIKE ? ESCAPE '\\'${mapped.length ? " OR a.action IN (" + mapped.map(() => "?").join(",") + ")" : ""})`,
      );
      params.push(term, term, term, term, ...mapped);
    }
    const where = " WHERE " + clauses.join(" AND "),
      total = Number(
        this.store.db
          .prepare("SELECT count(*) AS n" + joins + where)
          .get(...params)!.n,
      ),
      pages = Math.max(1, Math.ceil(total / size)),
      effective = Math.min(page, pages);
    const events = this.store.db
      .prepare(
        "SELECT a.id,a.action,a.target,a.created_at,a.user_id,coalesce(a.actor_name,u.name) AS actor_name,coalesce(a.actor_email,u.email) AS actor_email,coalesce(s.name,o.name) AS resource_name" +
          joins +
          where +
          " ORDER BY a.created_at DESC,a.rowid DESC LIMIT ? OFFSET ?",
      )
      .all(...params, size, (effective - 1) * size)
      .map((row) => ({
        ...row,
        category: auditCategory(String(row.action)),
      })) as AuditEvent[];
    const actors = this.store.db
      .prepare(
        "SELECT a.user_id AS id,max(coalesce(a.actor_name,u.name,'Usuário indisponível')) AS name,max(coalesce(a.actor_email,u.email,'')) AS email FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? GROUP BY a.user_id ORDER BY name",
      )
      .all(p.tenantId) as AuditPage["actors"];
    return { events, total, page: effective, page_size: size, pages, actors };
  }

  snapshot(p: Principal, organization?: string) {
    if (organization) this.authorizeOrg(p, organization);
    const servers = this.servers(p, organization);
    const ids = new Set(servers.map((s) => s.id));
    return {
      servers,
      alerts: this.alerts(p).filter(
        (a) => ids.has(a.server_id) && !a.resolved_at,
      ),
      collected_at: now(),
    };
  }

  reserveAI(p: Principal) {
    const account = this.active(p);
    const day = new Date().toISOString().slice(0, 10);
    this.store.db
      .prepare("INSERT OR IGNORE INTO ai_usage(tenant_id,day) VALUES (?,?)")
      .run(p.tenantId, day);
    const result = this.store.db
      .prepare(
        "UPDATE ai_usage SET calls=calls+1 WHERE tenant_id=? AND day=? AND calls<?",
      )
      .run(p.tenantId, day, account.limits.aiDaily);
    if (!result.changes)
      throw new APIError(
        429,
        `Limite diário de ${account.limits.aiDaily} chamadas de IA atingido. Consulte Plano e consumo ou use o diagnóstico básico. Limpar o chat não reinicia o consumo.`,
      );
    return day;
  }

  chatHistory(p: Principal, organization: string, serverId?: string) {
    this.authorizeOrg(p, organization);
    if (serverId && this.server(p, serverId).organization !== organization)
      throw new APIError(404, "Servidor não pertence ao cliente selecionado.");
    return this.store.db
      .prepare(
        "SELECT id,question,answer,mode,created_at FROM chat WHERE user_id=? AND tenant_id=? AND organization=? AND scope=? AND cleared_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 30",
      )
      .all(p.userId, p.tenantId, organization, serverId ?? "all")
      .reverse();
  }

  clearChat(p: Principal, organization: string, serverId?: string) {
    this.chatHistory(p, organization, serverId);
    const id = randomUUID();
    this.store.db
      .prepare(
        "UPDATE chat SET cleared_id=? WHERE user_id=? AND tenant_id=? AND organization=? AND scope=? AND cleared_id IS NULL",
      )
      .run(id, p.userId, p.tenantId, organization, serverId ?? "all");
    this.audit(p, "chat.cleared", serverId ?? organization);
    return { clear_id: id };
  }
  restoreChat(
    p: Principal,
    organization: string,
    serverId: string | undefined,
    id: unknown,
  ) {
    this.chatHistory(p, organization, serverId);
    if (typeof id !== "string" || id.length > 100)
      throw new APIError(400, "Conversa inválida.");
    this.store.db
      .prepare(
        "UPDATE chat SET cleared_id=NULL WHERE user_id=? AND tenant_id=? AND organization=? AND scope=? AND cleared_id=?",
      )
      .run(p.userId, p.tenantId, organization, serverId ?? "all", id);
    this.audit(p, "chat.restored", serverId ?? organization);
    return { ok: true };
  }
  cleanup() {
    if (
      this.store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='server_logs'")
        .get()
    )
      this.store.db
        .prepare("DELETE FROM server_logs WHERE received_at<?")
        .run(now() - 7 * 86400);
    for (const [plan, limits] of Object.entries(this.catalog.all())) {
      this.store.db
        .prepare(
          `DELETE FROM samples WHERE received_at<? AND server_id IN (SELECT s.id FROM servers s JOIN organizations o ON o.id=s.organization JOIN tenants t ON t.id=o.tenant_id WHERE t.plan=?)`,
        )
        .run(now() - limits.retentionDays * 86400, plan);
    }
    this.store.db.prepare("DELETE FROM sessions WHERE expires_at<?").run(now());
    this.store.db
      .prepare("DELETE FROM outbox WHERE delivered_at<?")
      .run(now() - 7 * 86400);
    this.store.db
      .prepare("DELETE FROM audit WHERE created_at<?")
      .run(now() - 90 * 86400);
  }
}
