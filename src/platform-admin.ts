import { Platform, passwordHash, type Principal } from "./platform.ts";
import { BrandingSettings } from "./branding.ts";
import { APIError } from "./store.ts";
import type {
  ManagedWorkspace,
  WorkspaceDetails,
  WorkspacePage,
} from "../shared/platform-admin.ts";
export class PlatformAdministration {
  platform: Platform;
  access: BrandingSettings;
  constructor(platform: Platform, access: BrandingSettings) {
    this.platform = platform;
    this.access = access;
  }
  authorize(p: Principal) {
    if (!this.access.canManage(p) || p.orgScope)
      throw new APIError(
        403,
        "Somente o administrador geral pode administrar a plataforma.",
      );
  }
  accounts(p: Principal, input: Record<string, unknown>) {
    this.authorize(p);
    const q = String(input.q ?? "")
        .trim()
        .toLowerCase(),
      status = String(input.status ?? "all"),
      page = Number(input.page ?? 1),
      size = Number(input.page_size ?? 10);
    if (
      q.length > 150 ||
      ![10, 25, 50].includes(size) ||
      !Number.isInteger(page) ||
      page < 1 ||
      !["all", "active", "trialing", "expired", "pending"].includes(status)
    )
      throw new APIError(400, "Filtros inválidos.");
    const db = this.platform.store.db;
    const base = `WITH accounts AS (SELECT t.*, CASE WHEN subscription_status='trialing' THEN trial_until ELSE billing_until END AS until,
      CASE WHEN (CASE WHEN subscription_status='trialing' THEN trial_until ELSE billing_until END)<=unixepoch() THEN 'expired' WHEN subscription_status='trialing' THEN 'trialing' WHEN subscription_status IN('active','authorized') THEN 'active' ELSE 'pending' END AS state FROM tenants t)
      SELECT %SELECT% FROM accounts t WHERE (?='all' OR t.state=?) AND (?='' OR instr(lower(t.name),?)>0 OR EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=t.id AND (instr(lower(u.name),?)>0 OR instr(lower(u.email),?)>0)))`;
    const args = [status, status, q, q, q, q];
    const total = Number(
        db.prepare(base.replace("%SELECT%", "count(*) AS n")).get(...args)!.n,
      ),
      pages = Math.max(1, Math.ceil(total / size)),
      current = Math.min(page, pages);
    const items = db
      .prepare(
        base.replace(
          "%SELECT%",
          `t.id,t.name,t.plan,t.subscription_status,t.created_at,t.until,t.state,t.billing_provider,
      (SELECT count(*) FROM invites i WHERE i.tenant_id=t.id AND i.used_at IS NULL AND i.expires_at>unixepoch()) AS pending_invites,
      (SELECT count(*) FROM servers s JOIN organizations o ON o.id=s.organization LEFT JOIN server_config c ON c.server_id=s.id WHERE o.tenant_id=t.id AND coalesce(c.archived,0)=0) AS servers`,
        ) + " ORDER BY t.created_at DESC,t.id LIMIT ? OFFSET ?",
      )
      .all(...args, size, (current - 1) * size)
      .map((row) => ({
        ...row,
        plan_name: this.platform.catalog.get(String(row.plan)).name,
        members: db
          .prepare(
            `SELECT u.id,u.name,u.email,m.role,coalesce(a.disabled,0) AS disabled FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN user_access a ON a.user_id=u.id WHERE m.tenant_id=? ORDER BY m.role='owner' DESC,u.name`,
          )
          .all(String(row.id)),
      }));
    return { items, total, pages, page: current, page_size: size };
  }
  userAccess(p: Principal, user: string, data: Record<string, unknown>) {
    this.authorize(p);
    if (user === p.userId)
      throw new APIError(400, "Não altere sua própria conta nesta área.");
    const db = this.platform.store.db;
    if (!db.prepare("SELECT id FROM users WHERE id=?").get(user))
      throw new APIError(404, "Usuário não encontrado.");
    const password =
      data.password === undefined ? undefined : passwordHash(data.password);
    if (data.disabled !== undefined && typeof data.disabled !== "boolean")
      throw new APIError(400, "Estado inválido.");
    if (password === undefined && data.disabled === undefined)
      throw new APIError(400, "Informe uma alteração.");
    return this.platform.transaction(() => {
      if (
        data.disabled === true &&
        db
          .prepare(
            `SELECT 1 FROM memberships m WHERE m.user_id=? AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM memberships x LEFT JOIN user_access a ON a.user_id=x.user_id WHERE x.tenant_id=m.tenant_id AND x.role='owner' AND x.user_id!=m.user_id AND coalesce(a.disabled,0)=0)`,
          )
          .get(user)
      )
        throw new APIError(
          400,
          "Adicione outro proprietário ativo antes de desativar este usuário.",
        );
      if (data.disabled !== undefined)
        db.prepare(
          "INSERT INTO user_access VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET disabled=excluded.disabled",
        ).run(user, data.disabled ? 1 : 0);
      if (password)
        db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
          password,
          user,
        );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user);
      db.prepare(
        "UPDATE api_tokens SET revoked_at=unixepoch() WHERE user_id=? AND revoked_at IS NULL",
      ).run(user);
      if (
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='account_email_tokens'",
          )
          .get()
      )
        db.prepare(
          "UPDATE account_email_tokens SET used_at=unixepoch() WHERE user_id=? AND used_at IS NULL",
        ).run(user);
      const action = password
        ? "platform.user.password_reset"
        : data.disabled
          ? "platform.user.disabled"
          : "platform.user.enabled";
      this.platform.audit(p, action, user);
      for (const row of db
        .prepare(
          "SELECT tenant_id FROM memberships WHERE user_id=? AND tenant_id!=?",
        )
        .all(user, p.tenantId))
        this.platform.audit(
          { ...p, tenantId: String(row.tenant_id) },
          action,
          user,
        );
      return { ok: true };
    });
  }
  context(p: Principal, id: string): Principal {
    this.authorize(p);
    if (
      !this.platform.store.db
        .prepare("SELECT id FROM tenants WHERE id=?")
        .get(id)
    )
      throw new APIError(404, "Workspace não encontrado.");
    return { ...p, tenantId: id, role: "owner", orgScope: undefined };
  }
  record(p: Principal, id: string, action: string, target = id) {
    this.platform.audit(p, action, target);
    if (id !== p.tenantId)
      this.platform.audit({ ...p, tenantId: id }, action, target);
  }
  list(p: Principal, input: Record<string, unknown>): WorkspacePage {
    this.authorize(p);
    const q = String(input.q ?? "").trim(),
      size = Number(input.page_size ?? 10),
      page = Number(input.page ?? 1);
    if (
      q.length > 150 ||
      ![10, 25, 50].includes(size) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000000
    )
      throw new APIError(400, "Filtros inválidos.");
    const term = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
    const where =
      " WHERE t.name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=t.id AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\'))";
    const total = Number(
        this.platform.store.db
          .prepare("SELECT count(*) AS n FROM tenants t" + where)
          .get(term, term, term)!.n,
      ),
      pages = Math.max(1, Math.ceil(total / size)),
      current = Math.min(page, pages);
    const items = this.platform.store.db
      .prepare(
        "SELECT t.id,t.name,t.plan,t.subscription_status,t.created_at,(SELECT count(*) FROM memberships WHERE tenant_id=t.id) AS users,(SELECT count(*) FROM organizations WHERE tenant_id=t.id) AS organizations,(SELECT count(*) FROM servers s JOIN organizations o ON o.id=s.organization LEFT JOIN server_config c ON c.server_id=s.id WHERE o.tenant_id=t.id AND coalesce(c.archived,0)=0) AS servers FROM tenants t" +
          where +
          " ORDER BY t.created_at DESC,t.id LIMIT ? OFFSET ?",
      )
      .all(term, term, term, size, (current - 1) * size) as ManagedWorkspace[];
    return { items, total, page: current, pages, page_size: size };
  }
  details(p: Principal, id: string): WorkspaceDetails {
    const context = this.context(p, id),
      workspace = this.platform.store.db
        .prepare(
          "SELECT id,name,plan,subscription_status,created_at FROM tenants WHERE id=?",
        )
        .get(id) as ManagedWorkspace;
    const organizations = this.platform
      .organizations(context)
      .map(({ id, name }) => ({ id, name }));
    const members = (
      this.platform.members(context) as {
        id: string;
        name: string;
        email: string;
        role: string;
      }[]
    ).map((m) => ({
      ...m,
      organizations: this.platform.store.db
        .prepare(
          "SELECT g.organization FROM grants g JOIN organizations o ON o.id=g.organization WHERE g.user_id=? AND o.tenant_id=?",
        )
        .all(m.id, id)
        .map((r) => String(r.organization)),
    }));
    return {
      workspace: {
        ...workspace,
        users: members.length,
        organizations: organizations.length,
        servers: this.platform.servers(context).length,
      },
      members,
      organizations,
    };
  }
  rename(p: Principal, id: string, value: unknown) {
    this.context(p, id);
    const name = this.name(value);
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare("UPDATE tenants SET name=? WHERE id=?")
        .run(name, id);
      this.record(p, id, "platform.workspace.updated", id);
    });
    return { ok: true };
  }
  name(value: unknown) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 120)
      throw new APIError(400, "Nome inválido.");
    return value.trim();
  }
  organization(
    p: Principal,
    id: string,
    org: string | undefined,
    value: unknown,
  ) {
    const context = this.context(p, id),
      name = this.name(value);
    if (!org) {
      const result = this.platform.createOrganization(context, name);
      this.record(p, id, "platform.organization.created", result.id);
      return result;
    }
    this.platform.authorizeOrg(context, org);
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare("UPDATE organizations SET name=? WHERE id=? AND tenant_id=?")
        .run(name, org, id);
      this.record(p, id, "platform.organization.updated", org);
    });
    return { ok: true };
  }
  invite(p: Principal, id: string, data: Record<string, unknown>) {
    const context = this.context(p, id);
    return this.platform.transaction(() => {
      const result = this.platform.invite(context, data);
      this.record(p, id, "platform.member.invited", id);
      return result;
    });
  }
  member(
    p: Principal,
    id: string,
    user: string,
    data: Record<string, unknown>,
  ) {
    this.context(p, id);
    const role = String(data.role);
    if (
      !["owner", "admin", "operator", "reader"].includes(role) ||
      !Array.isArray(data.organizations) ||
      data.organizations.length > 100
    )
      throw new APIError(400, "Perfil ou clientes inválidos.");
    const orgs = [
      ...new Set(
        data.organizations.map((org) =>
          this.platform.authorizeOrg(
            { ...p, tenantId: id, role: "owner", orgScope: undefined },
            org,
          ),
        ),
      ),
    ];
    if (!["owner", "admin"].includes(role) && !orgs.length)
      throw new APIError(400, "Selecione pelo menos um cliente.");
    if (user === p.userId)
      throw new APIError(400, "Não altere seu próprio acesso nesta área.");
    this.platform.transaction(() => {
      this.ensureMember(id, user, role === "owner");
      this.platform.store.db
        .prepare(
          "UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?",
        )
        .run(role, user, id);
      this.platform.store.db
        .prepare(
          "DELETE FROM grants WHERE user_id=? AND organization IN(SELECT id FROM organizations WHERE tenant_id=?)",
        )
        .run(user, id);
      for (const org of orgs)
        this.platform.store.db
          .prepare("INSERT INTO grants VALUES (?,?)")
          .run(user, org);
      this.platform.store.db
        .prepare("DELETE FROM sessions WHERE user_id=? AND tenant_id=?")
        .run(user, id);
      this.record(p, id, "platform.member.updated", user);
    });
    return { ok: true };
  }
  ensureMember(id: string, user: string, keepOwner = false) {
    const row = this.platform.store.db
      .prepare("SELECT role FROM memberships WHERE user_id=? AND tenant_id=?")
      .get(user, id);
    if (!row)
      throw new APIError(404, "Usuário não encontrado neste workspace.");
    if (
      row.role === "owner" &&
      !keepOwner &&
      Number(
        this.platform.store.db
          .prepare(
            "SELECT count(*) AS n FROM memberships m LEFT JOIN user_access a ON a.user_id=m.user_id WHERE m.tenant_id=? AND m.role='owner' AND coalesce(a.disabled,0)=0",
          )
          .get(id)!.n,
      ) <= 1
    )
      throw new APIError(
        400,
        "O workspace precisa manter pelo menos um proprietário.",
      );
  }
  remove(p: Principal, id: string, user: string) {
    this.context(p, id);
    if (user === p.userId)
      throw new APIError(400, "Não remova seu próprio acesso nesta área.");
    this.platform.transaction(() => {
      this.ensureMember(id, user);
      this.platform.store.db
        .prepare("DELETE FROM memberships WHERE user_id=? AND tenant_id=?")
        .run(user, id);
      this.platform.store.db
        .prepare(
          "DELETE FROM grants WHERE user_id=? AND organization IN(SELECT id FROM organizations WHERE tenant_id=?)",
        )
        .run(user, id);
      this.platform.store.db
        .prepare("DELETE FROM sessions WHERE user_id=? AND tenant_id=?")
        .run(user, id);
      this.platform.store.db
        .prepare(
          "UPDATE api_tokens SET revoked_at=unixepoch() WHERE user_id=? AND tenant_id=?",
        )
        .run(user, id);
      this.record(p, id, "platform.member.removed", user);
    });
    return { ok: true };
  }
}
