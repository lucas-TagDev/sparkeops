import { useEffect, useRef, useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Check,
  X,
  Terminal,
} from "lucide-react";
import { api, stamp } from "./api.ts";
import { t } from "./i18n.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
import {
  actionStatuses,
  type ActionHistoryPage,
  type RemediationAction,
} from "../shared/action-history.ts";

export function ActionHistory({
  serverId,
  serverName,
  role,
  refreshToken,
  onChanged,
}: {
  serverId: string;
  serverName: string;
  role: string;
  refreshToken: number;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<ActionHistoryPage | null>(null),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("all"),
    [limit, setLimit] = useState(5),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<RemediationAction | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadError,setLoadError] = useState(''),
    [error, setError] = useState("");
  const requests = useRef(0),
    detailRequests = useRef(0),
    privileged = ["owner", "admin"].includes(role),
    root = `/servers/${serverId}/actions`;
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const request = ++requests.current;
      setLoading(true);
      try {
        const result = await api<ActionHistoryPage>(
          root +
            "/history?" +
            new URLSearchParams({
              q,
              status,
              limit: String(limit),
              page: String(page),
            }),
        );
        if (active && request === requests.current) {
          setData(result);
          setLoadError("");
          if (result.page !== page) setPage(result.page);
        }
      } catch (e) {
        if (active && request === requests.current)
          setLoadError((e as Error).message);
      } finally {
        if (active && request === requests.current) setLoading(false);
      }
    };
    if (!busy) void load();
    const timer = setInterval(() => {
      if (!busy) void load();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [root, q, status, limit, page, refreshToken, busy]);
  useEffect(() => {
    setSelected(null);
    setDetail(null);
  }, [q, status, limit, page]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const request = ++detailRequests.current;
    setDetail(null);
    void api<RemediationAction>(root + "/" + selected)
      .then((result) => {
        if (active && request === detailRequests.current) setDetail(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [root, selected, data]);
  const act = async (kind: "approve" | "reject") => {
    if (!detail) return;
    if (
      kind === "approve" &&
      !(await confirmAction(
        t`Executar a alteração exibida em ${serverName}? ${["restart", "reload", "configuration", "command"].includes(detail.action) ? t("A ação pode interromper requisições ou conexões do serviço.") : ""}`,
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(root + `/${detail.id}/${kind}`, {});
      setSelected(null);
      setDetail(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="action-history" aria-label={t("Histórico de ações")}>
      <div className="action-history-heading">
        <h3>{t("Histórico de ações")}</h3>
        <span className="muted">
          {data
            ? `${data.total} ${t("registro(s) encontrado(s)")}`
            : t("Carregando…")}
        </span>
      </div>
      <div className="action-history-filters">
        <label className="action-history-search">
          {t("Buscar ações")}
          <div>
            <Search size={16} aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Buscar por serviço, ação ou motivo")}
            />
          </div>
        </label>
        <label>
          {t("Status")}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t("Todos os status")}</option>
            {Object.entries(actionStatuses).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Por página")}
          <select
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
          >
            {[5, 10, 20].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(error||loadError) && (
        <p className="notice danger" role="alert">
          {error||loadError}
        </p>
      )}
      <div className="action-history-list" aria-busy={loading}>
        {data?.items.map((item) => (
          <article
            key={item.id}
            className={`action-history-item${selected === item.id ? " expanded" : ""}`}
          >
            <button
              className="action-history-summary"
              type="button"
              aria-expanded={selected === item.id}
              aria-controls={"action-" + item.id}
              disabled={busy}
              onClick={() => setSelected(selected === item.id ? null : item.id)}
            >
              <span className="action-history-icon">
                <Terminal size={17} />
              </span>
              <span className="action-history-description">
                <strong>
                  {item.service} · {item.action}
                </strong>
                <span title={item.reason}>{item.reason}</span>
              </span>
              <time>{stamp(item.created_at)}</time>
              <span className={`tag action-state-${item.status}`}>
                {t(actionStatuses[item.status] ?? item.status)}
              </span>
              {selected === item.id ? (
                <ChevronUp size={17} />
              ) : (
                <ChevronDown size={17} />
              )}
              <span className="sr-only">{t("Ver detalhes da ação")}</span>
            </button>
            {selected === item.id && (
              <div className="action-history-detail" id={"action-" + item.id}>
                {!detail ? (
                  <p className="muted">{t("Carregando detalhes…")}</p>
                ) : (
                  <>
                    <p>{detail.reason}</p>
                    <ActionContent action={detail} />
                    {detail.output && (
                      <>
                        <h4>{t("Resultado da execução")}</h4>
                        <pre>{detail.output}</pre>
                      </>
                    )}
                    {detail.status === "pending" && privileged && (
                      <div className="action-row">
                        <button
                          type="button"
                          className="primary"
                          disabled={busy}
                          onClick={() => void act("approve")}
                        >
                          <Check size={15} />
                          {t("Aprovar e executar")}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void act("reject")}
                        >
                          <X size={15} />
                          {t("Rejeitar")}
                        </button>
                      </div>
                    )}
                    {detail.status === "expired" && (
                      <p className="muted">
                        {t(
                          "Esta ação expirou. Prepare uma nova ação para executar.",
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </article>
        ))}
        {data && !data.items.length && (
          <p className="action-history-empty">
            {t("Nenhuma ação encontrada para os filtros selecionados.")}
          </p>
        )}
      </div>
      {data && (
        <nav
          className="action-history-pagination"
          aria-label={t("Paginação do histórico de ações")}
        >
          <span>
            {data.total
              ? `${(data.page - 1) * data.limit + 1}–${Math.min(data.page * data.limit, data.total)}`
              : "0"}{" "}
            {t("de")} {data.total}
          </span>
          <div>
            <button
              type="button"
              className="secondary"
              disabled={busy || loading || data.page === 1}
              aria-label={t("Primeira página")}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft size={16} />
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || loading || data.page === 1}
              aria-label={t("Página anterior")}
              onClick={() => setPage(data.page - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {t("Página")} {data.page} {t("de")} {data.pages}
            </span>
            <button
              type="button"
              className="secondary"
              disabled={busy || loading || data.page === data.pages}
              aria-label={t("Próxima página")}
              onClick={() => setPage(data.page + 1)}
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || loading || data.page === data.pages}
              aria-label={t("Última página")}
              onClick={() => setPage(data.pages)}
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}

export function ActionContent({ action }: { action: RemediationAction }) {
  if (action.operator_command)
    return (
      <>
        <h4>{t("Comando preparado")}</h4>
        <pre>{action.operator_command}</pre>
      </>
    );
  if (action.configuration) {
    try {
      const config = JSON.parse(action.configuration);
      return (
        <>
          <h4>{t("Alteração de configuração revisada")}</h4>
          <p>
            {config.path} ·{" "}
            {t(
              config.activation === "restart"
                ? "Reinício: pode interromper conexões"
                : "Recarregamento",
            )}
          </p>
          <pre>
            {config.changes
              .map(
                (change: { key: string; before: number; after: number }) =>
                  `- ${change.key}: ${change.before}\n+ ${change.key}: ${change.after}`,
              )
              .join("\n")}
          </pre>
          <p className="muted">
            {t(
              "Backup antes da gravação, teste de configuração e tentativa de restauração em caso de falha.",
            )}
          </p>
        </>
      );
    } catch {
      return <p>{t("Detalhes de configuração indisponíveis.")}</p>;
    }
  }
  let commands: string[] = [];
  try {
    const value = JSON.parse(action.commands ?? "[]");
    if (Array.isArray(value)) commands = value;
  } catch {
    /* Legacy records without a valid command payload remain readable. */
  }
  return (
    <>
      <h4>{t("Comandos preparados")}</h4>
      <pre>{commands.join("\n")}</pre>
    </>
  );
}
