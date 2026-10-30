import { useState } from "react";
import { t } from "./i18n.ts";
import { stamp } from "./api.ts";
export type ServiceWatchData = {
  watches: { service: string; enabled: number; ai_summary: number }[];
  reports: {
    alert_id: string;
    service: string;
    created_at: number;
    status: string;
    summary: string | null;
    message: string;
    resolved_at: number | null;
  }[];
};
export function ServiceReports({
  reports,
}: {
  reports: ServiceWatchData["reports"];
}) {
  const [page, setPage] = useState(1),
    pages = Math.max(1, Math.ceil(reports.length / 5)),
    current = Math.min(page, pages);
  if (!reports.length) return null;
  return (
    <section className="service-incident-reports">
      <h3>{t("Incidentes de serviços — últimos 20")}</h3>
      {reports.slice((current - 1) * 5, current * 5).map((report) => (
        <details key={report.alert_id}>
          <summary>
            <strong>{report.service}</strong> · {stamp(report.created_at)} ·{" "}
            {t(report.resolved_at ? "Recuperado" : "Aberto")}
          </summary>
          <p>{report.message}</p>
          {report.summary ? (
            <>
              <h4>
                {t(report.status === "ai" ? "Resumo da IA" : "Resumo técnico")}
              </h4>
              <p>{report.summary}</p>
            </>
          ) : (
            <p className="muted">
              {t(
                report.status === "canceled"
                  ? "Resumo cancelado por alteração da configuração."
                  : "Aguardando resumo e verificação local de logs, quando disponível.",
              )}
            </p>
          )}
          {report.resolved_at && (
            <p className="muted">
              {t("Recuperado em")} {stamp(report.resolved_at)}
            </p>
          )}
        </details>
      ))}
      <nav
        className="service-pagination"
        aria-label={t("Paginação de incidentes de serviços")}
      >
        <button disabled={current === 1} onClick={() => setPage(current - 1)}>
          {t("Anterior")}
        </button>
        <span>
          {t("Página")} {current} {t("de")} {pages}
        </span>
        <button
          disabled={current === pages}
          onClick={() => setPage(current + 1)}
        >
          {t("Próxima")}
        </button>
      </nav>
    </section>
  );
}
