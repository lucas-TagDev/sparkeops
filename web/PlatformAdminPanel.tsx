import { TurnstileSettingsPanel } from "./TurnstileSettingsPanel.tsx";
import { BrandingPanel } from "./BrandingPanel.tsx";
import { PlatformEmailPanel } from "./PlatformEmailPanel.tsx";
import { AccountAdministration } from "./AccountAdministration.tsx";
import { PaymentSettingsPanel } from "./PaymentSettingsPanel.tsx";
import { PlanManagementPanel } from "./PlanManagementPanel.tsx";
import { useEffect, useState } from "react";
import { ArrowLeft, Building2, Search, Users } from "lucide-react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
import type {
  ManagedMember,
  WorkspaceDetails,
  WorkspacePage,
} from "../shared/platform-admin.ts";
const roles = ["owner", "admin", "operator", "reader"];
const labels: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  operator: "Operador",
  reader: "Leitor",
};
export function PlatformAdminPanel({ userId }: { userId: string }) {
  const [section, setSection] = useState("workspaces");
  return (
    <div className="platform-administration">
      <div
        className="panel platform-admin-tabs"
        role="tablist"
        aria-label={t("Administração da plataforma")}
      >
        <button
          role="tab"
          aria-selected={section === "security"}
          onClick={() => setSection("security")}
        >
          {t("Segurança e CAPTCHA")}
        </button>
        <button
          role="tab"
          aria-selected={section === "branding"}
          onClick={() => setSection("branding")}
        >
          {t("Identidade visual")}
        </button>
        <button
          role="tab"
          aria-selected={section === "email"}
          onClick={() => setSection("email")}
        >
          {t("E-mails da plataforma")}
        </button>
        <button
          role="tab"
          aria-selected={section === "accounts"}
          onClick={() => setSection("accounts")}
        >
          {t("Assinaturas e contas")}
        </button>
        <button
          role="tab"
          aria-selected={section === "workspaces"}
          onClick={() => setSection("workspaces")}
        >
          {t("Workspaces e usuários")}
        </button>
        <button
          role="tab"
          aria-selected={section === "plans"}
          onClick={() => setSection("plans")}
        >
          {t("Planos e preços")}
        </button>
        <button
          role="tab"
          aria-selected={section === "payments"}
          onClick={() => setSection("payments")}
        >
          {t("Pagamentos")}
        </button>
      </div>
      {section === "security" ? (
        <TurnstileSettingsPanel />
      ) : section === "branding" ? (
        <BrandingPanel />
      ) : section === "email" ? (
        <PlatformEmailPanel />
      ) : section === "accounts" ? (
        <AccountAdministration userId={userId} />
      ) : section === "payments" ? (
        <PaymentSettingsPanel />
      ) : section === "plans" ? (
        <PlanManagementPanel />
      ) : (
        <WorkspaceAdminPanel userId={userId} />
      )}
    </div>
  );
}
function WorkspaceAdminPanel({ userId }: { userId: string }) {
  const [listing, setListing] = useState<WorkspacePage | null>(null),
    [id, setId] = useState(""),
    [details, setDetails] = useState<WorkspaceDetails | null>(null),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [name, setName] = useState(""),
    [orgName, setOrgName] = useState(""),
    [editOrg, setEditOrg] = useState(""),
    [editMember, setEditMember] = useState<ManagedMember | null>(null),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("reader"),
    [orgs, setOrgs] = useState<string[]>([]),
    [inviteLink, setInviteLink] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const path = id
      ? "/platform/workspaces/" + id
      : "/platform/workspaces?" +
        new URLSearchParams({ q: search, page: String(page) });
    void api<WorkspaceDetails | WorkspacePage>(path)
      .then((result) => {
        if (!active) return;
        if ("workspace" in result) {
          setDetails(result);
          setName(result.workspace.name);
        } else setListing(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, search, page, revision]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setRevision((v) => v + 1);
      setNotice(t("Alteração salva."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const base = "/platform/workspaces/" + id;
  const selectWorkspace = (next: string) => {
    setDetails(null);
    setId(next);
    setEditMember(null);
    setInviteLink("");
    setNotice("");
    setEmail("");
    setOrgs([]);
    setOrgName("");
    setEditOrg("");
  };
  return (
    <div className="platform-administration">
      <section className="panel padded">
        <h2>
          <Building2 size={18} />
          {t("Administração da plataforma")}
        </h2>
        <p className="muted">
          {t("Gerencie empresas, workspaces e acessos de toda a plataforma.")}
        </p>
        <p className="muted">
          {t(
            "As alterações são registradas com a identificação do administrador geral.",
          )}
        </p>
      </section>
      {error && (
        <p role="alert" className="audit-message">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="audit-message">
          {notice}
        </p>
      )}
      {!id ? (
        <section className="panel">
          <div className="audit-toolbar">
            <label className="audit-search">
              {t("Buscar workspace ou usuário")}
              <span>
                <Search size={16} />
                <input
                  value={q}
                  maxLength={150}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("Empresa, nome ou e-mail")}
                />
              </span>
            </label>
          </div>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>{t("Plano")}</th>
                  <th>{t("Usuários")}</th>
                  <th>{t("Clientes")}</th>
                  <th>{t("Servidores")}</th>
                  <th>{t("Ações")}</th>
                </tr>
              </thead>
              <tbody>
                {listing?.items.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <strong>{w.name}</strong>
                      <small>{w.subscription_status}</small>
                    </td>
                    <td>{w.plan}</td>
                    <td>{w.users}</td>
                    <td>{w.organizations}</td>
                    <td>{w.servers}</td>
                    <td>
                      <button
                        disabled={loading}
                        onClick={() => selectWorkspace(w.id)}
                      >
                        {t("Gerenciar")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!listing?.items.length && (
            <p className="audit-message">
              {loading ? t("Carregando...") : t("Nenhum workspace encontrado.")}
            </p>
          )}
          <div className="audit-footer">
            <span>
              {listing?.total ?? 0} {t("workspaces")}
            </span>
            <nav className="audit-pagination">
              <button
                disabled={loading || (listing?.page ?? 1) <= 1}
                onClick={() => setPage((listing?.page ?? 1) - 1)}
              >
                {t("Anterior")}
              </button>
              <span>
                {t("Página")} {listing?.page ?? 1} {t("de")}{" "}
                {listing?.pages ?? 1}
              </span>
              <button
                disabled={
                  loading || (listing?.page ?? 1) >= (listing?.pages ?? 1)
                }
                onClick={() => setPage((listing?.page ?? 1) + 1)}
              >
                {t("Próxima")}
              </button>
            </nav>
          </div>
        </section>
      ) : (
        <>
          <button className="secondary" onClick={() => selectWorkspace("")}>
            <ArrowLeft size={15} />
            {t("Voltar aos workspaces")}
          </button>
          {loading && !details ? (
            <p>{t("Carregando...")}</p>
          ) : (
            details && (
              <>
                <section className="panel padded">
                  <h2>{details.workspace.name}</h2>
                  <p className="muted">
                    {details.workspace.plan} · {details.workspace.users}{" "}
                    {t("Usuários")} · {details.workspace.servers}{" "}
                    {t("Servidores")}
                  </p>
                  <form
                    className="platform-admin-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(() => api(base, { name }, "PATCH"));
                    }}
                  >
                    <label>
                      {t("Nome do workspace")}
                      <input
                        required
                        maxLength={120}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <button disabled={busy || loading} className="primary">
                      {t("Salvar")}
                    </button>
                  </form>
                </section>
                <section className="panel padded">
                  <h2>
                    <Building2 size={18} />
                    {t("Empresas e clientes")}
                  </h2>
                  <div className="platform-org-list">
                    {details.organizations.map((o) => (
                      <div key={o.id}>
                        <span>{o.name}</span>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setEditOrg(o.id);
                            setOrgName(o.name);
                          }}
                        >
                          {t("Editar")}
                        </button>
                      </div>
                    ))}
                  </div>
                  <form
                    className="platform-admin-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await api(
                          base +
                            "/organizations" +
                            (editOrg ? "/" + editOrg : ""),
                          { name: orgName },
                          editOrg ? "PATCH" : "POST",
                        );
                        setOrgName("");
                        setEditOrg("");
                      });
                    }}
                  >
                    <label>
                      {t(editOrg ? "Editar cliente" : "Novo cliente")}
                      <input
                        required
                        maxLength={120}
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                      />
                    </label>
                    <button disabled={busy || loading}>
                      {t(editOrg ? "Salvar" : "Adicionar")}
                    </button>
                    {editOrg && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditOrg("");
                          setOrgName("");
                        }}
                      >
                        {t("Cancelar")}
                      </button>
                    )}
                  </form>
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <h2>
                      <Users size={18} />
                      {t("Usuários e permissões")}
                    </h2>
                  </div>
                  <div className="audit-table-wrap">
                    <table className="audit-table">
                      <thead>
                        <tr>
                          <th>{t("Usuário")}</th>
                          <th>{t("Perfil")}</th>
                          <th>{t("Clientes autorizados")}</th>
                          <th>{t("Ações")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.members.map((m) => (
                          <tr key={m.id}>
                            <td>
                              <strong>{m.name}</strong>
                              <small>{m.email}</small>
                            </td>
                            <td>{t(labels[m.role] ?? m.role)}</td>
                            <td>
                              {["owner", "admin"].includes(m.role)
                                ? t("Todos os clientes")
                                : details.organizations
                                    .filter((o) =>
                                      m.organizations.includes(o.id),
                                    )
                                    .map((o) => o.name)
                                    .join(", ") || "—"}
                            </td>
                            <td>
                              <div className="platform-row-actions">
                                <button
                                  disabled={busy || m.id === userId}
                                  onClick={() => {
                                    setEditMember(m);
                                    setRole(m.role);
                                    setOrgs(m.organizations);
                                    setInviteLink("");
                                  }}
                                >
                                  {t("Editar acesso")}
                                </button>
                                <button
                                  disabled={busy || m.id === userId}
                                  onClick={async () => {
                                    if (
                                      await confirmAction(
                                        t(
                                          "Remover o acesso deste usuário ao workspace?",
                                        ),
                                      )
                                    )
                                      void run(() =>
                                        api(
                                          base + "/members/" + m.id,
                                          undefined,
                                          "DELETE",
                                        ),
                                      );
                                  }}
                                >
                                  {t("Remover acesso")}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="panel padded">
                  <h2>
                    {t(editMember ? "Editar acesso" : "Convidar usuário")}
                  </h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        if (editMember) {
                          await api(
                            base + "/members/" + editMember.id,
                            { role, organizations: orgs },
                            "PATCH",
                          );
                          setEditMember(null);
                        } else {
                          const invite = await api<{ token: string }>(
                            base + "/invites",
                            { email, role, organizations: orgs },
                          );
                          setInviteLink(
                            location.origin + "/#invite=" + invite.token,
                          );
                        }
                        setOrgs([]);
                        setRole("reader");
                      });
                    }}
                  >
                    <div className="platform-admin-form">
                      {editMember ? (
                        <p>
                          {editMember.name} · {editMember.email}
                        </p>
                      ) : (
                        <label>
                          {t("E-mail")}
                          <input
                            type="email"
                            required
                            maxLength={254}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                          />
                        </label>
                      )}
                      <label>
                        {t("Perfil")}
                        <select
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                        >
                          {roles
                            .filter((r) => editMember || r !== "owner")
                            .map((r) => (
                              <option key={r} value={r}>
                                {t(labels[r])}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    {["owner", "admin"].includes(role) ? (
                      <p className="muted">
                        {t(
                          "Este perfil administra todos os clientes do workspace.",
                        )}
                      </p>
                    ) : (
                      <fieldset className="platform-org-checks">
                        <legend>{t("Clientes autorizados")}</legend>
                        {details.organizations.map((o) => (
                          <label key={o.id}>
                            <input
                              type="checkbox"
                              checked={orgs.includes(o.id)}
                              onChange={(e) =>
                                setOrgs(
                                  e.target.checked
                                    ? [...orgs, o.id]
                                    : orgs.filter((v) => v !== o.id),
                                )
                              }
                            />
                            {o.name}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <div className="platform-row-actions">
                      <button className="primary" disabled={busy || loading}>
                        {t(editMember ? "Salvar acesso" : "Gerar convite")}
                      </button>
                      {editMember && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditMember(null);
                            setRole("reader");
                            setOrgs([]);
                          }}
                        >
                          {t("Cancelar")}
                        </button>
                      )}
                    </div>
                  </form>
                  {inviteLink && (
                    <div className="platform-invite">
                      <p>
                        {t(
                          "Compartilhe este convite com o usuário. Válido por 24 horas.",
                        )}
                      </p>
                      <input
                        readOnly
                        value={inviteLink}
                        aria-label={t("Link do convite")}
                        onFocus={(e) => e.target.select()}
                      />
                    </div>
                  )}
                </section>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
