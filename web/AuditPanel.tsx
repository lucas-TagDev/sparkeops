import { useEffect, useState } from "react";
import {
  Search,
  RefreshCw,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "./api.ts";
import { t, getLanguage } from "./i18n.ts";
import {
  auditActions,
  type AuditEvent,
  type AuditPage,
} from "../shared/audit.ts";

export function AuditEventsTable({ events }: { events: AuditEvent[] }) {
  return (
    <div className="audit-table-wrap">
      <table className="audit-table">
        <thead>
          <tr>
            <th>{t("Data e hora")}</th>
            <th>{t("Ação")}</th>
            <th>{t("Usuário responsável")}</th>
            <th>{t("Recurso")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="audit-date">
                {new Date(e.created_at * 1000).toLocaleString(getLanguage(), {
                  dateStyle: "short",
                  timeStyle: "medium",
                })}
              </td>
              <td>
                <strong>{t(auditActions[e.action] ?? "Outra ação")}</strong>
                <details>
                  <summary>{t("Detalhes")}</summary>
                  <code>{e.action}</code>
                  <small>ID: {e.id}</small>
                </details>
              </td>
              <td>
                <div className="audit-person">
                  <span className="audit-avatar" aria-hidden="true">
                    {(e.actor_name ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{e.actor_name || t("Usuário indisponível")}</strong>
                    <small>{e.actor_email || t("E-mail indisponível")}</small>
                  </div>
                </div>
              </td>
              <td className="audit-resource">
                {e.resource_name ||
                  (e.action.startsWith("platform.")
                    ? t("Plataforma")
                    : e.action === "user.language.updated"
                      ? t("Preferência do usuário")
                      : e.target || "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditPanel() {
  const [data, setData] = useState<AuditPage | null>(null),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [actor, setActor] = useState(""),
    [category, setCategory] = useState("all"),
    [page, setPage] = useState(1),
    [size, setSize] = useState(25),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    const query = new URLSearchParams({
      q: search,
      actor,
      category,
      page: String(page),
      page_size: String(size),
    });
    void api<AuditPage>("/audit/events?" + query)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [search, actor, category, page, size, revision]);
  const current = data?.page ?? 1,
    pages = data?.pages ?? 1;
  return (
    <section className="panel audit-panel" aria-busy={busy}>
      <div className="panel-head">
        <div>
          <h2>
            <ShieldCheck size={18} />
            {t("Registro de auditoria")}
          </h2>
          <p>{t("Acompanhe as ações e quem realizou cada alteração.")}</p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={14} />
          {t("Atualizar")}
        </button>
      </div>
      <div className="audit-toolbar">
        <label className="audit-search">
          {t("Buscar registros")}
          <span>
            <Search size={16} />
            <input
              value={q}
              maxLength={150}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Ação, nome, e-mail ou recurso")}
            />
          </span>
        </label>
        <label>
          {t("Tipo de registro")}
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t("Todas as ações")}</option>
            <option value="changes">{t("Alterações")}</option>
            <option value="checks">{t("Consultas e diagnósticos")}</option>
            <option value="access">{t("Acessos e segurança")}</option>
          </select>
        </label>
        <label>
          {t("Usuário responsável")}
          <select
            value={actor}
            onChange={(e) => {
              setActor(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("Todos os usuários")}</option>
            {data?.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.email ? " · " + a.email : ""}
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
            {[10, 25, 50, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p className="audit-message" role="alert">
          {error}
        </p>
      ) : data?.events.length ? (
        <AuditEventsTable events={data.events} />
      ) : (
        <p className="audit-message" role="status">
          {busy
            ? t("Carregando...")
            : t("Nenhum evento encontrado para estes filtros.")}
        </p>
      )}
      <div className="audit-footer">
        <span role="status">
          {busy
            ? t("Carregando...")
            : data
              ? `${data.total ? (current - 1) * size + 1 : 0}–${Math.min(current * size, data.total)} ${t("de")} ${data.total} ${t("registros")}`
              : ""}
        </span>
        <nav
          className="audit-pagination"
          aria-label={t("Paginação da auditoria")}
        >
          <button
            type="button"
            disabled={busy || current === 1}
            onClick={() => setPage(1)}
            aria-label={t("Primeira página")}
          >
            «
          </button>
          <button
            type="button"
            disabled={busy || current === 1}
            onClick={() => setPage(current - 1)}
            aria-label={t("Página anterior")}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {t("Página")} {current} {t("de")} {pages}
          </span>
          <button
            type="button"
            disabled={busy || current >= pages}
            onClick={() => setPage(current + 1)}
            aria-label={t("Próxima página")}
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            disabled={busy || current >= pages}
            onClick={() => setPage(pages)}
            aria-label={t("Última página")}
          >
            »
          </button>
        </nav>
      </div>
    </section>
  );
}
