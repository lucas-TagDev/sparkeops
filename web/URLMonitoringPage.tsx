import { useEffect, useState } from "react";
import {
  Globe,
  Plus,
  RefreshCw,
  Activity,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Pause,
  Play,
  Trash2,
  Pencil,
} from "lucide-react";
import { api } from "./api.ts";
import { t, getLanguage } from "./i18n.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
import type {
  URLMonitor,
  URLDetails,
  URLPage,
  URLCheck,
} from "../shared/url-monitors.ts";
const states: Record<string, string> = {
  pending: "Aguardando verificação",
  up: "Disponível",
  down: "Indisponível",
  paused: "Pausado",
};
const stamp = (value: number | null) =>
  value
    ? new Date(value * 1000).toLocaleString(getLanguage(), {
        dateStyle: "short",
        timeStyle: "medium",
      })
    : "—";
export function URLHistoryChart({
  checks,
  intervalSeconds = 300,
}: {
  checks: URLCheck[];
  intervalSeconds?: number;
}) {
  const points = [...checks].reverse(),
    max = Math.max(1, ...points.map((p) => p.latency_ms)),
    start = points[0]?.checked_at ?? 0,
    end = points.at(-1)?.checked_at ?? start;
  const x = (p: URLCheck) =>
      55 + (end === start ? 0.5 : (p.checked_at - start) / (end - start)) * 700,
    y = (p: URLCheck) => 140 - (p.latency_ms / max) * 110;
  return (
    <div className="url-chart">
      {!points.length ? (
        <p className="audit-message">
          {t("O histórico aparecerá após a primeira verificação.")}
        </p>
      ) : (
        <svg
          viewBox="0 0 800 190"
          role="img"
          aria-label={t("Histórico do tempo de resposta")}
        >
          <title>{t("Histórico do tempo de resposta")}</title>
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line
                x1={55}
                x2={755}
                y1={140 - v * 110}
                y2={140 - v * 110}
                stroke="#303c4b"
                strokeDasharray="4 6"
              />
              <text x={5} y={144 - v * 110} fill="#91a1b7" fontSize={11}>
                {Math.round(max * v)} ms
              </text>
            </g>
          ))}
          {points
            .slice(1)
            .map((p, i) =>
              p.checked_at - points[i].checked_at <= intervalSeconds * 1.8 ? (
                <line
                  key={"line" + p.id}
                  x1={x(points[i])}
                  x2={x(p)}
                  y1={y(points[i])}
                  y2={y(p)}
                  stroke="#586779"
                  strokeWidth={1.5}
                />
              ) : null,
            )}
          {points.map((p) => (
            <circle
              key={p.id}
              cx={x(p)}
              cy={y(p)}
              r={points.length > 200 ? 2 : 4}
              fill={p.ok ? "#78dab3" : "#f18b8b"}
            >
              <title>
                {stamp(p.checked_at)} · {p.latency_ms} ms ·{" "}
                {p.ok ? t("Disponível") : t("Indisponível")}
              </title>
            </circle>
          ))}
          <text x={55} y={178} fill="#91a1b7" fontSize={11}>
            {stamp(start)}
          </text>
          <text x={755} y={178} textAnchor="end" fill="#91a1b7" fontSize={11}>
            {stamp(end)}
          </text>
        </svg>
      )}
    </div>
  );
}
export function URLMonitoringPage({
  organizations,
  role,
}: {
  organizations: { id: string; name: string }[];
  role: string;
}) {
  const [data, setData] = useState<URLPage | null>(null),
    [detail, setDetail] = useState<URLDetails | null>(null),
    [selected, setSelected] = useState(""),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [hours, setHours] = useState(24),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [form, setForm] = useState<Partial<URLMonitor> | null>(null);
  const canManage = role !== "reader";
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
    const query = new URLSearchParams({
      q: search,
      status,
      page: String(page),
    });
    void Promise.all([
      api<URLPage>("/url-monitors?" + query),
      selected
        ? api<URLDetails>("/url-monitors/" + selected + "?hours=" + hours)
        : Promise.resolve(null),
    ])
      .then(([list, details]) => {
        if (active) {
          setData(list);
          setDetail(details);
          setError("");
        }
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
  }, [search, status, page, selected, hours, revision]);
  useEffect(() => {
    if (busy || form) return;
    const timer = setInterval(() => setRevision((v) => v + 1), 15000);
    return () => clearInterval(timer);
  }, [busy, !!form]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fresh = () =>
    setForm({
      organization: organizations[0]?.id,
      name: "",
      url: "",
      method: "GET",
      interval_seconds: 300,
      timeout_seconds: 10,
      expected_status: 200,
      failure_threshold: 2,
      enabled: 1,
    });
  const change = (key: keyof URLMonitor, value: unknown) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  return (
    <div className="url-monitoring">
      <section className="panel padded">
        <div className="panel-head">
          <div>
            <h2>
              <Globe size={19} />
              {t("Monitoramento de URLs")}
            </h2>
            <p className="muted">
              {t(
                "Acompanhe a disponibilidade dos seus sites e APIs, sem instalar agente.",
              )}
            </p>
          </div>
          <div className="platform-row-actions">
            <button
              disabled={loading || busy}
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={15} />
              {t("Atualizar")}
            </button>
            {canManage && (
              <button
                className="primary"
                disabled={
                  busy ||
                  !organizations.length ||
                  (data?.used ?? 0) >= (data?.limit ?? 0)
                }
                onClick={fresh}
              >
                <Plus size={16} />
                {t("Adicionar URL")}
              </button>
            )}
          </div>
        </div>
        <p className="muted">
          {data?.used ?? 0} / {data?.limit ?? 0} {t("URLs do plano")} ·{" "}
          {t("Atualização automática a cada 15 segundos")}
        </p>
      </section>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="banner success" role="status">
          {notice}
        </p>
      )}
      {form && (
        <section className="panel padded url-form">
          <div className="panel-head">
            <h2>{t(form.id ? "Editar URL" : "Adicionar URL")}</h2>
            <button disabled={busy} onClick={() => setForm(null)}>
              {t("Cancelar")}
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await api<URLMonitor>(
                  "/url-monitors" + (form.id ? "/" + form.id : ""),
                  { ...form, enabled: !!form.enabled },
                  form.id ? "PUT" : "POST",
                );
                setForm(null);
                setSelected(result.id);
                setDetail(null);
                setNotice(t("Monitor de URL salvo."));
                setPage(1);
              });
            }}
          >
            <div className="plan-form-grid">
              <label>
                {t("Nome")}
                <input
                  autoFocus
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => change("name", e.target.value)}
                  placeholder={t("Site principal")}
                />
              </label>
              <label>
                {t("Cliente")}
                <select
                  required
                  disabled={!!form.id}
                  value={form.organization}
                  onChange={(e) => change("organization", e.target.value)}
                >
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="plan-description">
                {t("URL ou IP com porta")}
                <input
                  type="url"
                  required
                  maxLength={2048}
                  value={form.url}
                  onChange={(e) => change("url", e.target.value)}
                  placeholder="https://example.com/health"
                />
                <small>
                  {t(
                    "Aceita domínio ou IP público com porta personalizada. Ex.: http://seu-servidor.com:8096",
                  )}
                </small>
              </label>
              <label>
                {t("Método HTTP")}
                <select
                  value={form.method}
                  onChange={(e) => change("method", e.target.value)}
                >
                  <option>GET</option>
                  <option>HEAD</option>
                </select>
              </label>
              <label>
                {t("Intervalo entre verificações")}
                <select
                  value={form.interval_seconds}
                  onChange={(e) =>
                    change("interval_seconds", Number(e.target.value))
                  }
                >
                  {[60, 300, 600, 900, 1800, 3600].map((n) => (
                    <option key={n} value={n}>
                      {n / 60} {t("minutos")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Tempo limite")}
                <select
                  value={form.timeout_seconds}
                  onChange={(e) =>
                    change("timeout_seconds", Number(e.target.value))
                  }
                >
                  {[5, 10, 15, 30].map((n) => (
                    <option key={n} value={n}>
                      {n} {t("segundos")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Status HTTP esperado")}
                <input
                  required
                  type="number"
                  min={100}
                  max={599}
                  step={1}
                  value={form.expected_status}
                  onChange={(e) =>
                    change("expected_status", Number(e.target.value))
                  }
                />
              </label>
              <label>
                {t("Falhas consecutivas para alertar")}
                <input
                  required
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  value={form.failure_threshold}
                  onChange={(e) =>
                    change("failure_threshold", Number(e.target.value))
                  }
                />
              </label>
            </div>
            <label className="plan-enabled">
              <input
                type="checkbox"
                checked={!!form.enabled}
                onChange={(e) => change("enabled", e.target.checked ? 1 : 0)}
              />
              {t("Monitoramento ativo")}
            </label>
            <button className="primary" disabled={busy}>
              {busy ? t("Salvando...") : t("Salvar monitoramento")}
            </button>
          </form>
        </section>
      )}
      <section className="panel">
        <div className="audit-toolbar">
          <label className="audit-search">
            {t("Buscar URLs")}
            <input
              maxLength={150}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Nome ou endereço")}
            />
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
              <option value="all">{t("Todos")}</option>
              {Object.entries(states).map(([key, label]) => (
                <option key={key} value={key}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>{t("Monitor")}</th>
                <th>{t("Status")}</th>
                <th>{t("Tempo de resposta")}</th>
                <th>{t("Disponibilidade em 24h")}</th>
                <th>{t("Última verificação")}</th>
                <th>{t("Ações")}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <button
                      className="url-name"
                      onClick={() => {
                        setSelected(m.id);
                        setDetail(null);
                      }}
                    >
                      {m.name}
                    </button>
                    <small className="url-address" title={m.url}>
                      {m.url}
                    </small>
                    <small>{m.organization_name}</small>
                  </td>
                  <td>
                    <span className={"url-status " + m.status}>
                      {t(states[m.status])}
                    </span>
                    <small>
                      {m.last_status ? "HTTP " + m.last_status : ""}
                    </small>
                  </td>
                  <td>{m.latency_ms === null ? "—" : m.latency_ms + " ms"}</td>
                  <td>
                    {m.uptime_percent === null
                      ? "—"
                      : m.uptime_percent.toLocaleString(getLanguage(), {
                          maximumFractionDigits: 2,
                        }) + "%"}
                  </td>
                  <td>{stamp(m.last_checked)}</td>
                  <td>
                    <div className="platform-row-actions">
                      <button
                        onClick={() => {
                          setSelected(m.id);
                          setDetail(null);
                        }}
                      >
                        {t("Detalhes")}
                      </button>
                      {canManage && (
                        <>
                          <button
                            disabled={busy || !m.enabled}
                            onClick={() =>
                              void run(async () => {
                                const result = await api<URLDetails>(
                                  "/url-monitors/" + m.id + "/check",
                                  {},
                                );
                                setSelected(m.id);
                                setDetail(result);
                              })
                            }
                          >
                            {busy ? t("Aguarde...") : t("Verificar agora")}
                          </button>
                          <button
                            disabled={busy}
                            aria-label={t("Editar URL")}
                            title={t("Editar URL")}
                            onClick={() => setForm({ ...m })}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            disabled={busy}
                            title={t(m.enabled ? "Pausar" : "Ativar")}
                            aria-label={t(m.enabled ? "Pausar" : "Ativar")}
                            onClick={() =>
                              void run(() =>
                                api(
                                  "/url-monitors/" + m.id,
                                  { ...m, enabled: !m.enabled },
                                  "PUT",
                                ),
                              )
                            }
                          >
                            {m.enabled ? (
                              <Pause size={14} />
                            ) : (
                              <Play size={14} />
                            )}
                          </button>
                          <button
                            disabled={busy}
                            title={t("Arquivar")}
                            aria-label={t("Arquivar")}
                            onClick={async () => {
                              if (
                                await confirmAction(
                                  t(
                                    "Arquivar este monitor de URL? As verificações serão interrompidas.",
                                  ),
                                )
                              )
                                void run(async () => {
                                  await api(
                                    "/url-monitors/" + m.id,
                                    undefined,
                                    "DELETE",
                                  );
                                  if (selected === m.id) {
                                    setSelected("");
                                    setDetail(null);
                                  }
                                });
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data?.items.length && (
          <div className="audit-message">
            <Globe size={26} />
            <p>
              {loading
                ? t("Carregando...")
                : t("Nenhum monitor de URL encontrado.")}
            </p>
            <p>
              {t(
                "Cadastre seu primeiro site ou endpoint para começar a acompanhar.",
              )}
            </p>
          </div>
        )}
        <div className="audit-footer">
          <span>
            {data?.total ?? 0} {t("monitores")}
          </span>
          <nav className="audit-pagination" aria-label={t("Paginação de URLs")}>
            <button
              disabled={loading || (data?.page ?? 1) <= 1}
              onClick={() => setPage((data?.page ?? 1) - 1)}
            >
              {t("Anterior")}
            </button>
            <span>
              {t("Página")} {data?.page ?? 1} {t("de")} {data?.pages ?? 1}
            </span>
            <button
              disabled={loading || (data?.page ?? 1) >= (data?.pages ?? 1)}
              onClick={() => setPage((data?.page ?? 1) + 1)}
            >
              {t("Próxima")}
            </button>
          </nav>
        </div>
      </section>
      {detail && (
        <section className="panel padded url-details">
          <div className="panel-head">
            <div>
              <h2>{detail.monitor.name}</h2>
              <p className="muted url-address">{detail.monitor.url}</p>
            </div>
            <div className="platform-row-actions">
              <select
                aria-label={t("Período do histórico")}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                {[1, 6, 24, 168].map((h) => (
                  <option key={h} value={h}>
                    {h === 168 ? t("Últimos 7 dias") : h + " " + t("horas")}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  setSelected("");
                  setDetail(null);
                }}
              >
                {t("Fechar")}
              </button>
            </div>
          </div>
          <div className="url-summary">
            <div>
              <Activity size={18} />
              <span>
                {t("Status")}
                <strong className={"url-status " + detail.monitor.status}>
                  {t(states[detail.monitor.status])}
                </strong>
              </span>
            </div>
            <div>
              <Clock3 size={18} />
              <span>
                {t("Tempo de resposta")}
                <strong>
                  {detail.monitor.latency_ms === null
                    ? "—"
                    : detail.monitor.latency_ms + " ms"}
                </strong>
              </span>
            </div>
            <div>
              <CheckCircle2 size={18} />
              <span>
                {t("Disponibilidade no período")}
                <strong>
                  {detail.monitor.uptime_percent === null
                    ? "—"
                    : detail.monitor.uptime_percent.toLocaleString(
                        getLanguage(),
                        { maximumFractionDigits: 2 },
                      ) + "%"}
                </strong>
              </span>
            </div>
            <div>
              <Globe size={18} />
              <span>
                {t("Verificações no período")}
                <strong>{detail.monitor.checks}</strong>
              </span>
            </div>
          </div>
          {detail.monitor.last_error && (
            <p className="banner error">{t(detail.monitor.last_error)}</p>
          )}
          <h3>{t("Histórico do tempo de resposta")}</h3>
          {detail.monitor.checks > detail.checks.length && (
            <p className="muted">{t`O gráfico exibe as últimas ${detail.checks.length} verificações do período.`}</p>
          )}
          <URLHistoryChart
            checks={detail.checks}
            intervalSeconds={detail.monitor.interval_seconds}
          />
          <p className="muted">
            {t(
              "Disponibilidade calculada pelas verificações realizadas. A coleta ocorre a partir da plataforma.",
            )}
          </p>
          <h3>{t("Últimas verificações")}</h3>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>{t("Data e hora")}</th>
                  <th>HTTP</th>
                  <th>{t("Tempo de resposta")}</th>
                  <th>{t("Resultado")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.checks.slice(0, 20).map((c) => (
                  <tr key={c.id}>
                    <td>{stamp(c.checked_at)}</td>
                    <td>{c.status_code ?? "—"}</td>
                    <td>{c.latency_ms} ms</td>
                    <td>{c.error ? t(c.error) : t("Disponível")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{t("Incidentes recentes")}</h3>
          {!detail.incidents.length ? (
            <p className="muted">{t("Nenhum incidente registrado.")}</p>
          ) : (
            <div className="url-incidents">
              {detail.incidents.map((i) => (
                <div key={i.id}>
                  <AlertTriangle size={16} />
                  <div>
                    <strong>
                      {t(
                        i.resolved_at
                          ? i.resolution === "recovered"
                            ? "Recuperado"
                            : "Encerrado"
                          : "Incidente aberto",
                      )}
                    </strong>
                    <p>{t(i.message)}</p>
                    <small>
                      {stamp(i.opened_at)}
                      {i.resolved_at ? " → " + stamp(i.resolved_at) : ""}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
