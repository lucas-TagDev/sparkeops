import { useEffect, useState, useId, type CSSProperties } from "react";
import {
  Maximize,
  RefreshCw,
  Server,
  Globe,
  Pause,
  Play,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { t, getLanguage } from "./i18n.ts";
import { stampSeconds } from "./api.ts";
import { useBranding } from "./branding.ts";
import type { PublicDashboardSnapshot } from "../shared/public-dashboards.ts";
type ChartPoint = { at: number; value: number | null };
function TrendChart({
  points,
  label,
  color,
  gap = 7200,
}: {
  points: ChartPoint[];
  label: string;
  color: string;
  gap?: number;
}) {
  const id = useId().replace(/:/g, "");
  const valid = points.filter(
    (p) => p.value != null && Number.isFinite(p.value),
  );
  if (!valid.length)
    return <div className="tv-chart-empty">{t("Aguardando histórico")}</div>;
  const start = points[0].at,
    end = points[points.length - 1].at,
    low = Math.min(...valid.map((p) => p.value!)),
    high = Math.max(...valid.map((p) => p.value!)),
    pad = Math.max((high - low) * 0.2, high * 0.03, 0.1),
    min = Math.max(0, low - pad),
    max = high + pad;
  const x = (at: number) => 8 + ((at - start) / Math.max(1, end - start)) * 304,
    y = (value: number) => 76 - ((value - min) / Math.max(0.1, max - min)) * 60;
  const paths: string[] = [];
  let path = "",
    last = 0;
  for (const point of points) {
    if (point.value == null || !Number.isFinite(point.value)) {
      if (path) paths.push(path);
      path = "";
      continue;
    }
    if (path && point.at - last > gap) {
      paths.push(path);
      path = "";
    }
    path +=
      (path ? " L" : "M") +
      x(point.at).toFixed(2) +
      "," +
      y(point.value).toFixed(2);
    last = point.at;
  }
  if (path) paths.push(path);
  return (
    <figure className="tv-trend" style={{ color }}>
      <figcaption>
        <span>{label}</span>
        <small>
          {t("Mín.")}{" "}
          {low.toLocaleString(getLanguage(), { maximumFractionDigits: 1 })} ·{" "}
          {t("Máx.")}{" "}
          {high.toLocaleString(getLanguage(), { maximumFractionDigits: 1 })}
        </small>
      </figcaption>
      <svg
        viewBox="0 0 320 88"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity=".22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[16, 46, 76].map((v) => (
          <path
            key={v}
            d={"M8," + v + " H312"}
            stroke="#334155"
            strokeDasharray="3 6"
            fill="none"
          />
        ))}
        {paths.map((d, i) => (
          <g key={i}>
            <path
              d={
                d +
                " L" +
                d.split(" L").at(-1)!.replace(/^M/, "").split(",")[0] +
                ",84 L" +
                d.slice(1).split(",")[0] +
                ",84 Z"
              }
              fill={"url(#" + id + ")"}
            />
            <path
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {valid.map((p, i) => (
          <circle
            key={i}
            cx={x(p.at)}
            cy={y(p.value!)}
            r={i === valid.length - 1 ? 3.5 : 2}
            fill="currentColor"
          >
            <title>
              {stampSeconds(p.at)} · {p.value}
            </title>
          </circle>
        ))}
      </svg>
      <div className="tv-chart-times">
        <span>
          {new Date(start * 1000).toLocaleTimeString(getLanguage(), {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span>
          {new Date(end * 1000).toLocaleTimeString(getLanguage(), {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </figure>
  );
}
export function PublicDashboard() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
  const branding = useBranding();
  const [data, setData] = useState<PublicDashboardSnapshot | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [kind, setKind] = useState("all"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [auto, setAuto] = useState(true),
    [refresh, setRefresh] = useState(0),
    [clock, setClock] = useState(new Date());
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true,
      busy = false;
    let controller: AbortController;
    const load = async () => {
      if (busy) return;
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(
          "/api/public/dashboard?page=" +
            page +
            "&kind=" +
            kind +
            "&search=" +
            encodeURIComponent(query) +
            "&status=" +
            status,
          {
            headers: { Authorization: "Bearer " + token },
            credentials: "omit",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? t(
                  "Painel indisponível. O link pode ter sido desativado ou trocado.",
                )
              : t("Não foi possível atualizar o painel. Tentaremos novamente."),
          );
        const result = (await response.json()) as PublicDashboardSnapshot;
        if (active) {
          setData(result);
          setError("");
          if (result.page !== page) setPage(result.page);
        }
      } catch (e) {
        if (active) {
          setData(null);
          setError(
            e instanceof Error && e.name !== "TimeoutError"
              ? e.message
              : t("Não foi possível atualizar o painel. Tentaremos novamente."),
          );
        }
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
    };
  }, [token, page, kind, refresh, query, status]);
  useEffect(() => {
    if (!auto || !data || data.pages < 2) return;
    const timer = setInterval(
      () => setPage((value) => (value >= data.pages ? 1 : value + 1)),
      (data.layout.rotation_seconds ?? 20) * 1000,
    );
    return () => clearInterval(timer);
  }, [auto, data?.pages, data?.layout.rotation_seconds]);
  const labels = {
    up: t("Online"),
    down: t("Indisponível"),
    pending: t("Aguardando dados"),
    paused: t("Pausado"),
  };
  const number = (value: number | null | undefined, suffix: string) =>
    value == null
      ? "—"
      : value.toLocaleString(getLanguage(), { maximumFractionDigits: 1 }) +
        suffix;
  return (
    <main className="tv-dashboard">
      <header className="tv-header">
        <div>
          <span className="tv-brand">
            {branding.name} <i />
            {t("Monitoramento público")}
          </span>
          <h1>{data?.title ?? t("Painel de monitoramento")}</h1>
        </div>
        <div className="tv-clock">
          <strong>{clock.toLocaleTimeString(getLanguage())}</strong>
          <small>
            {clock.toLocaleDateString(getLanguage(), { dateStyle: "long" })}
          </small>
        </div>
      </header>
      <div className="tv-toolbar">
        <div className="tabs">
          <button
            className={kind === "all" ? "active" : ""}
            onClick={() => {
              setKind("all");
              setPage(1);
            }}
          >
            {t("Todos")}
          </button>
          <button
            className={kind === "server" ? "active" : ""}
            onClick={() => {
              setKind("server");
              setPage(1);
            }}
          >
            <Server size={15} />
            {t("Servidores")}
          </button>
          <button
            className={kind === "url" ? "active" : ""}
            onClick={() => {
              setKind("url");
              setPage(1);
            }}
          >
            <Globe size={15} />
            {t("URLs")}
          </button>
        </div>
        <div className="platform-row-actions">
          <button onClick={() => setAuto((value) => !value)}>
            {auto ? <Pause size={15} /> : <Play size={15} />}{" "}
            {t(auto ? "Pausar rotação" : "Rotacionar páginas")}
          </button>
          <button onClick={() => setRefresh((value) => value + 1)}>
            <RefreshCw size={15} />
            {t("Atualizar")}
          </button>
          <button
            onClick={() => {
              if (
                !document.fullscreenElement &&
                !document.documentElement.requestFullscreen
              ) {
                setError(t("O navegador não permitiu entrar em tela cheia."));
                return;
              }
              const action = document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen();
              void action.catch(() =>
                setError(t("O navegador não permitiu entrar em tela cheia.")),
              );
            }}
          >
            <Maximize size={15} />
            {t("Tela cheia")}
          </button>
        </div>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {data && (
        <>
          <section className="tv-summary">
            {(["up", "down", "pending", "paused"] as const).map((status) => (
              <div className={"tv-summary-card " + status} key={status}>
                <span>{labels[status]}</span>
                <strong>{data.summary[status]}</strong>
              </div>
            ))}
          </section>
          <div className="tv-status-line">
            <span>
              {data.summary.servers} {t("servidores")} · {data.summary.urls}{" "}
              {t("URLs")}
            </span>
            <span>
              {t("Atualiza a cada 15 segundos")} ·{" "}
              {stampSeconds(data.generated_at)}
            </span>
          </div>
          <div className="tv-filters">
            <input
              maxLength={120}
              aria-label={t("Buscar monitores")}
              placeholder={t("Buscar monitores")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label={t("Status")}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">{t("Todos os estados")}</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <section
            className={
              "tv-card-grid tv-density-" +
              data.layout.density +
              (data.layout.columns ? " tv-fixed-grid" : "")
            }
            style={
              { "--tv-columns": data.layout.columns || 3 } as CSSProperties
            }
          >
            {data.items.map((item) => (
              <article
                className={"tv-monitor-card " + item.status}
                key={item.key}
              >
                <div className="tv-card-heading">
                  <div
                    className={
                      "tv-device-icon " + item.kind + " " + item.status
                    }
                  >
                    {item.kind === "server" ? (
                      <Server size={24} />
                    ) : (
                      <Globe size={24} />
                    )}
                    <span className="tv-device-led" />
                  </div>
                  <div>
                    <h2>{item.name}</h2>
                    {item.address && <small>{item.address}</small>}
                  </div>
                  <span className={"tv-status " + item.status}>
                    {labels[item.status]}
                  </span>
                </div>
                {item.metrics && (
                  <div className="tv-metrics">
                    {(
                      [
                        ["CPU", item.metrics.cpu],
                        ["Memória", item.metrics.memory],
                        ["Disco", item.metrics.disk],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <span>{t(label)}</span>
                        <strong>{number(value, "%")}</strong>
                        <div className="tv-meter">
                          <i
                            style={{
                              width:
                                Math.max(0, Math.min(100, value ?? 0)) + "%",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {item.metric_history && (
                  <div className="tv-server-charts">
                    {(
                      [
                        ["cpu", "CPU", "#64dfb2"],
                        ["memory", t("Memória"), "#b6a0ee"],
                        ["disk", t("Disco"), "#76acfa"],
                      ] as const
                    ).map(([key, label, color]) => (
                      <TrendChart
                        key={key}
                        label={label + " (%)"}
                        color={color}
                        gap={180}
                        points={item.metric_history!.map((p) => ({
                          at: p.at,
                          value: p[key],
                        }))}
                      />
                    ))}
                  </div>
                )}
                {item.kind === "url" && (
                  <>
                    <div className="tv-url-metrics">
                      <div>
                        <span>{t("Latência")}</span>
                        <strong>{number(item.latency_ms, " ms")}</strong>
                      </div>
                      <div>
                        <span>{t("Disponibilidade em 24h")}</span>
                        <strong>{number(item.uptime_percent, "%")}</strong>
                      </div>
                    </div>
                    <TrendChart
                      label={t("Histórico de latência (ms)")}
                      color="#64dfb2"
                      points={(item.history ?? []).map((p) => ({
                        at: p.at,
                        value: p.ok ? p.latency_ms : null,
                      }))}
                    />
                    <div
                      className="tv-history"
                      aria-label={t("Últimas verificações")}
                    >
                      {item.history?.map((check, index) => (
                        <i
                          key={index}
                          className={check.ok ? "up" : "down"}
                          title={
                            stampSeconds(check.at) +
                            " · " +
                            (check.ok ? t("Online") : t("Indisponível")) +
                            " · " +
                            check.latency_ms +
                            " ms"
                          }
                        />
                      ))}
                    </div>
                  </>
                )}
                <footer>
                  {t("Última coleta:")} {stampSeconds(item.updated_at)}
                </footer>
              </article>
            ))}
          </section>
          {!data.items.length && (
            <section className="panel padded">
              {t("Nenhum recurso publicado nesta categoria.")}
            </section>
          )}
          <footer className="tv-pagination">
            <span>
              {t("Somente visualização")} · {data.total} {t("recursos")}
            </span>
            <div>
              <button
                disabled={data.page <= 1}
                aria-label={t("Página anterior")}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft />
              </button>
              <span>
                {data.page} / {data.pages}
              </span>
              <button
                disabled={data.page >= data.pages}
                aria-label={t("Próxima página")}
                onClick={() => setPage((value) => value + 1)}
              >
                <ChevronRight />
              </button>
            </div>
          </footer>
        </>
      )}
      {!data && !error && (
        <p className="tv-loading" role="status">
          {t("Carregando monitoramento…")}
        </p>
      )}
    </main>
  );
}
