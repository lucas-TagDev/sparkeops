import { useEffect, useState } from "react";
import { api, stamp } from "./api.ts";
import { t } from "./i18n.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  disabled: number;
};
type Account = {
  id: string;
  name: string;
  plan_name: string;
  subscription_status: string;
  created_at: number;
  until: number | null;
  billing_provider: string | null;
  state: string;
  pending_invites: number;
  servers: number;
  members: Member[];
};
type Page = { items: Account[]; page: number; pages: number; total: number };
const states: Record<string, string> = {
  all: "Todos",
  active: "Assinatura ativa",
  trialing: "Em avaliação",
  expired: "Período encerrado",
  pending: "Pagamento pendente",
};
export function AccountAdministration({ userId }: { userId: string }) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [revision, refresh] = useState(0),
    [data, setData] = useState<Page | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Member | null>(null),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setError("");
      void api<Page>(
        "/platform/accounts?" +
          new URLSearchParams({
            q,
            status,
            page: String(page),
            page_size: String(size),
          }),
      )
        .then((v) => {
          if (active) setData(v);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, status, page, size, revision]);
  async function update(member: Member, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      await api("/platform/users/" + member.id + "/access", payload, "PATCH");
      setEditing(null);
      setPassword("");
      setRepeat("");
      refresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel padded">
      <h2>{t("Assinaturas e contas")}</h2>
      <p className="muted">
        {t(
          "Acompanhe os cadastros, os assinantes e o término de cada período. As alterações de usuário valem para todos os seus workspaces.",
        )}
      </p>
      <div className="platform-admin-form">
        <label>
          {t("Buscar empresa, nome ou e-mail")}
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          {t("Situação")}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {Object.entries(states).map(([v, label]) => (
              <option key={v} value={v}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Por página")}
          <select
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[10, 25, 50].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button onClick={() => refresh((v) => v + 1)}>{t("Atualizar")}</button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editing && (
        <form
          className="panel padded"
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== repeat) {
              setError(t("As senhas não coincidem."));
              return;
            }
            void (async () => {
              if (
                await confirmAction(
                  t(
                    "Redefinir a senha deste usuário e encerrar suas sessões abertas?",
                  ),
                )
              )
                await update(editing, { password });
            })();
          }}
        >
          <h3>
            {t("Redefinir senha")} · {editing.email}
          </h3>
          <div className="platform-admin-form">
            <label>
              {t("Nova senha")}
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              {t("Confirmar senha")}
              <input
                type="password"
                autoComplete="new-password"
                required
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            {t(
              "Use de 12 a 128 caracteres. Compartilhe a nova senha por um canal seguro.",
            )}
          </p>
          <div className="platform-row-actions">
            <button className="primary" disabled={busy}>
              {t("Salvar senha")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setPassword("");
                setRepeat("");
              }}
            >
              {t("Cancelar")}
            </button>
          </div>
        </form>
      )}
      <p className="muted">
        {data?.total ?? 0} {t("workspaces encontrados")}
      </p>
      {data?.items.map((a) => (
        <details key={a.id} className="panel padded">
          <summary style={{ cursor: "pointer", padding: "12px 0" }}>
            <strong>{a.name}</strong> · {a.plan_name} · {t(states[a.state])} ·{" "}
            {t("Fim do período")}:{" "}
            {a.until ? stamp(a.until) : t("Não informado pelo provedor")}
          </summary>
          <p>
            {t("Cadastro")}: {stamp(a.created_at)} · {t("Provedor")}:{" "}
            {a.billing_provider ?? "—"} · {t("Situação da cobrança")}:{" "}
            {a.subscription_status}
          </p>
          <p className="muted">
            {a.servers ? t("Servidor cadastrado") : t("Cadastro sem servidor")}{" "}
            · {t("Convites pendentes")}: {a.pending_invites}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Usuário")}</th>
                  <th>{t("Perfil")}</th>
                  <th>{t("Estado")}</th>
                  <th>{t("Ações")}</th>
                </tr>
              </thead>
              <tbody>
                {a.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small style={{ display: "block" }}>{m.email}</small>
                    </td>
                    <td>
                      {t(
                        (
                          {
                            owner: "Proprietário",
                            admin: "Administrador",
                            operator: "Operador",
                            reader: "Leitor",
                          } as Record<string, string>
                        )[m.role] ?? m.role,
                      )}
                    </td>
                    <td>{t(m.disabled ? "Desativado" : "Ativo")}</td>
                    <td>
                      <div className="platform-row-actions">
                        <button
                          disabled={busy || m.id === userId}
                          onClick={() => {
                            setEditing(m);
                            setPassword("");
                            setRepeat("");
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          {t("Redefinir senha")}
                        </button>
                        <button
                          disabled={busy || m.id === userId}
                          onClick={() =>
                            void (async () => {
                              if (
                                await confirmAction(
                                  t(
                                    m.disabled
                                      ? "Ativar este usuário?"
                                      : "Desativar este usuário em todos os workspaces e encerrar suas sessões?",
                                  ),
                                )
                              )
                                await update(m, { disabled: !m.disabled });
                            })()
                          }
                        >
                          {t(m.disabled ? "Ativar" : "Desativar")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      {data && (
        <div className="platform-row-actions">
          <button disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
            {t("Anterior")}
          </button>
          <span>
            {t("Página")} {data.page} / {data.pages}
          </span>
          <button
            disabled={data.page >= data.pages}
            onClick={() => setPage(data.page + 1)}
          >
            {t("Próxima")}
          </button>
        </div>
      )}
      <p className="muted">
        {t(
          "Cadastros são exibidos após o envio do formulário. Formulários abandonados antes do envio não são registrados. Vencimentos só aparecem quando conhecidos; para avaliações, é exibido o fim do teste.",
        )}
      </p>
    </section>
  );
}
