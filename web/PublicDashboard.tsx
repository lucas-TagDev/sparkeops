import { useEffect, useState } from "react";
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
export function PublicDashboard() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
  const branding = useBranding();
  const [data, setData] = useState<PublicDashboardSnapshot | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [kind, setKind] = useState("all"),
    [auto, setAuto] = useState(true),
    [refresh, setRefresh] = useState(0),
    [clock, setClock] = useState(new Date());
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
          "/api/public/dashboard?page=" + page + "&kind=" + kind,
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
  }, [token, page, kind, refresh]);
  useEffect(() => {
    if (!auto || !data || data.pages < 2) return;
    const timer = setInterval(
      () => setPage((value) => (value >= data.pages ? 1 : value + 1)),
      20000,
    );
    return () => clearInterval(timer);
  }, [auto, data?.pages]);
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
          <section className="tv-card-grid">
            {data.items.map((item) => (
              <article
                className={"tv-monitor-card " + item.status}
                key={item.key}
              >
                <div className="tv-card-heading">
                  {item.kind === "server" ? (
                    <Server size={24} />
                  ) : (
                    <Globe size={24} />
                  )}
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
