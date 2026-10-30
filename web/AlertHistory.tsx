import { recoveryCountdown } from "./recovery-time.ts";
import { useEffect, useState } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api, stamp } from "./api.ts";
import { t } from "./i18n.ts";
import type { Alert, Server } from "../src/platform.ts";
import { PersistentDetails } from "./PersistentDetails.tsx";
type Page = {
  server_now: number;
  items: Alert[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  counts: { active: number; resolved: number; total: number };
};
export function AlertHistory({
  organization,
  servers,
  canManage,
  onAck,
  onAssistant,
  busy,
}: {
  organization: string;
  servers: Server[];
  canManage: boolean;
  onAck: (id: string) => void;
  onAssistant: (alert: Alert) => void;
  busy: boolean;
}) {
  const [clock, setClock] = useState(Date.now()),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [data, setData] = useState<Page | null>(null),
    [status, setStatus] = useState("active"),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [severity, setSeverity] = useState("all"),
    [kind, setKind] = useState("all"),
    [server, setServer] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [limit, setLimit] = useState(10),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setServer("");
    setPage(1);
  }, [organization]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          status,
          q,
          severity,
          kind,
          limit: String(limit),
          page: String(page),
        });
        if (organization !== "all") params.set("organization", organization);
        if (server) params.set("server", server);
        if (from) params.set("from", String(new Date(from).getTime() / 1000));
        if (to) params.set("to", String(new Date(to).getTime() / 1000 + 59));
        const result = await api<Page>("/alerts/history?" + params);
        if (active) {
          setData(result);
          setOffset(result.server_now * 1000 - Date.now());
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    organization,
    status,
    q,
    severity,
    kind,
    server,
    from,
    to,
    limit,
    page,
    busy,
  ]);
  const change = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };
  return (
    <>
      <div className="tabs">
        {[
          ["active", "Ativos"],
          ["resolved", "Recuperados"],
          ["all", "Todo o histórico"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={status === value ? "active" : ""}
            onClick={() => change(setStatus, value)}
          >
            {t(label)}
            <span>
              {data?.counts[
                value === "all" ? "total" : (value as "active" | "resolved")
              ] ?? 0}
            </span>
          </button>
        ))}
      </div>
      <PersistentDetails
        storageKey={"alerts:" + organization + ":filters"}
        className="panel padded alert-history-filters alert-filter-disclosure"
      >
        <summary>
          {t("Filtros e busca")}
          <span className="tag">
            {
              [
                q,
                server,
                from,
                to,
                severity !== "all" ? severity : "",
                kind !== "all" ? kind : "",
                ["acknowledged", "unacknowledged"].includes(status)
                  ? status
                  : "",
              ].filter(Boolean).length
            }{" "}
            {t("filtro(s) aplicado(s)")}
          </span>
          <span className="alert-filter-disclosure-hint">
            {t("Expandir / recolher")}
          </span>
        </summary>
        <div>
          <label>
            {t("Buscar alertas")}
            <input
              placeholder={t("Servidor, mensagem ou serviço")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            {t("Servidor")}
            <select
              value={server}
              onChange={(e) => change(setServer, e.target.value)}
            >
              <option value="">{t("Todos os servidores")}</option>
              {servers
                .filter(
                  (s) =>
                    organization === "all" || s.organization === organization,
                )
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("Gravidade")}
            <select
              value={severity}
              onChange={(e) => change(setSeverity, e.target.value)}
            >
              <option value="all">{t("Todas")}</option>
              <option value="critical">{t("Crítico")}</option>
              <option value="warning">{t("Atenção")}</option>
            </select>
          </label>
          <label>
            {t("Tipo de alerta")}
            <select
              value={kind}
              onChange={(e) => change(setKind, e.target.value)}
            >
              {[
                ["all", "Todos"],
                ["offline", "Sem comunicação"],
                ["cpu", "CPU"],
                ["memory", "Memória"],
                ["disk", "Disco"],
                ["service", "Serviços"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("De")}
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => change(setFrom, e.target.value)}
            />
          </label>
          <label>
            {t("Até")}
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => change(setTo, e.target.value)}
            />
          </label>
          <label>
            {t("Reconhecimento")}
            <select
              value={
                ["acknowledged", "unacknowledged"].includes(status)
                  ? status
                  : "all"
              }
              onChange={(e) => change(setStatus, e.target.value)}
            >
              <option value="all">{t("Todos")}</option>
              <option value="acknowledged">{t("Reconhecidos")}</option>
              <option value="unacknowledged">
                {t("Ativos não reconhecidos")}
              </option>
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
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          {t("O período considera a abertura do alerta, no seu horário local.")}
        </p>
        <button
          className="secondary"
          onClick={() => {
            setSearch("");
            setQ("");
            setSeverity("all");
            setKind("all");
            setServer("");
            setFrom("");
            setTo("");
            setStatus("all");
            setPage(1);
          }}
        >
          {t("Limpar filtros")}
        </button>
      </PersistentDetails>
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      <section className="panel" aria-busy={loading}>
        <div className="alerts-list">
          {data?.items.map((a) => (
            <article key={a.id}>
              <span
                className={
                  "alert-symbol " + (a.resolved_at ? "resolved" : a.severity)
                }
              >
                {a.resolved_at ? <Check size={20} /> : <Bell size={20} />}
              </span>
              <div>
                <div className="alert-title">
                  <h3>{a.server_name}</h3>
                  <span className="tag">
                    {t(
                      a.resolved_at
                        ? "Recuperado"
                        : a.severity === "critical"
                          ? "Crítico"
                          : "Atenção",
                    )}
                  </span>
                </div>
                <p>{a.message}</p>
                {a.recovery && (
                  <details>
                    <summary>
                      {t("Correção imediata")} ·{" "}
                      {t(
                        (
                          {
                            recovered: "Recuperado",
                            failed: "Falha na correção",
                            unknown: "Resultado indeterminado",
                            skipped: "Não executado",
                            executing: "Em execução",
                            blocked: "Rejeitado pelo gateway",
                            waiting: "Aguardando próxima tentativa",
                          } as Record<string, string>
                        )[a.recovery.status] ?? a.recovery.status,
                      )}
                      {a.recovery.status === "waiting" &&
                        a.recovery.next_attempt_at && (
                          <>
                            {" "}
                            · {t("Próxima tentativa em")}:{" "}
                            <span
                              role="timer"
                              aria-live="off"
                              style={{ fontVariantNumeric: "tabular-nums" }}
                            >
                              {recoveryCountdown(
                                a.recovery.next_attempt_at,
                                clock + offset,
                              )}
                            </span>
                          </>
                        )}
                    </summary>
                    <p>
                      {a.recovery.summary ??
                        a.recovery.output ??
                        t("Preparando resumo da investigação…")}
                    </p>
                  </details>
                )}
                <small>
                  {t("Aberto em")} {stamp(a.opened_at)}
                  {a.resolved_at
                    ? ` · ${t("Recuperado em")} ${stamp(a.resolved_at)}`
                    : a.acknowledged_at
                      ? ` · ${t("Reconhecido pela equipe")}`
                      : ""}
                </small>
              </div>
              <button
                className="secondary"
                disabled={busy || !servers.some((s) => s.id === a.server_id)}
                title={
                  !servers.some((s) => s.id === a.server_id)
                    ? t("Servidor indisponível para investigação.")
                    : undefined
                }
                onClick={() => onAssistant(a)}
              >
                {t("Tratar com o assistente")}
              </button>
              {!a.resolved_at && !a.acknowledged_at && canManage && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => onAck(a.id)}
                >
                  <CheckCheck size={16} />
                  {t("Reconhecer")}
                </button>
              )}
            </article>
          ))}
        </div>
        {data && !data.items.length && (
          <p className="alert-history-empty">
            {t("Nenhum alerta encontrado com estes filtros.")}
          </p>
        )}
        {data && (
          <nav
            className="alert-history-pagination"
            aria-label={t("Paginação do histórico de alertas")}
          >
            <span>
              {data.total
                ? `${(data.page - 1) * data.limit + 1}–${Math.min(data.page * data.limit, data.total)}`
                : "0"}{" "}
              {t("de")} {data.total}
            </span>
            <div>
              <button
                className="secondary"
                disabled={loading || data.page <= 1}
                onClick={() => setPage(1)}
              >
                {t("Primeira")}
              </button>
              <button
                className="secondary"
                disabled={loading || data.page <= 1}
                onClick={() => setPage(data.page - 1)}
              >
                <ChevronLeft size={15} />
                {t("Anterior")}
              </button>
              <span>
                {t("Página")} {data.page} {t("de")} {data.pages}
              </span>
              <button
                className="secondary"
                disabled={loading || data.page >= data.pages}
                onClick={() => setPage(data.page + 1)}
              >
                {t("Próxima")}
                <ChevronRight size={15} />
              </button>
              <button
                className="secondary"
                disabled={loading || data.page >= data.pages}
                onClick={() => setPage(data.pages)}
              >
                {t("Última")}
              </button>
            </div>
          </nav>
        )}
      </section>
    </>
  );
}
