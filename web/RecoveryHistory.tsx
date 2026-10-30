import {
  recoveryCountdown as countdown,
  recoveryIndicator,
} from "./recovery-time.ts";
import { useEffect, useState } from "react";
import { api, stamp } from "./api.ts";
import { t } from "./i18n.ts";
const labels: Record<string, string> = {
  all: "Todos",
  waiting: "Aguardando próxima tentativa",
  executing: "Em execução",
  recovered: "Recuperado",
  failed: "Falha na correção",
  unknown: "Resultado indeterminado",
  skipped: "Não executado",
  blocked: "Rejeitado pelo gateway",
  succeeded: "Concluído",
  pending: "Aguardando execução",
};
type Step = {
  id: string;
  stage: string;
  commands: string;
  status: string;
  output: string | null;
  created_at: number;
  finished_at: number | null;
};
type Item = {
  alert_id: string;
  service: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  output: string | null;
  summary: string | null;
  report_status: string;
  legacy: boolean;
  steps: Step[];
  next_attempt_at: number | null;
  attempt_limit: number;
  decisions: {
    created_at: number;
    cause: string;
    evidence: string;
    action: string;
    reason: string;
  }[];
};
type Availability = {
  service: string;
  enabled: boolean;
  used: number;
  limit: number;
  configured_limit: number;
  remaining: number;
  state: string;
  next_eligible_at: number | null;
  waiting_until: number | null;
};
type Page = {
  items: Item[];
  total: number;
  page: number;
  pages: number;
  server_now: number;
  configured_limit: number;
  repeat_enabled: boolean;
  repeat_minutes: number;
  availability: Availability[];
};
function commands(value: string) {
  try {
    return (JSON.parse(value) as string[]).join("\n");
  } catch {
    return value;
  }
}
export function RecoveryHistory({ serverId }: { serverId: string }) {
  const [clock, setClock] = useState(Date.now()),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [data, setData] = useState<Page | null>(null),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState(5),
    [error, setError] = useState(""),
    [revision, refresh] = useState(0),
    [open, setOpen] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      void api<Page>(
        `/servers/${serverId}/service-recovery/history?` +
          new URLSearchParams({
            q,
            status,
            page: String(page),
            limit: String(limit),
          }),
      )
        .then((v) => {
          if (active) {
            setData(v);
            setOffset(v.server_now * 1000 - Date.now());
            setClock(Date.now());
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    const delay = setTimeout(load, 250),
      interval = setInterval(load, 15000);
    return () => {
      active = false;
      clearTimeout(delay);
      clearInterval(interval);
    };
  }, [serverId, q, status, page, limit, revision]);
  return (
    <section className="service-incident-reports recovery-history">
      <div className="panel-head">
        <h3>{t("Tentativas de correção imediata")}</h3>
        <button className="secondary" onClick={() => refresh((v) => v + 1)}>
          {t("Atualizar")}
        </button>
      </div>
      <p className="muted">
        {t(
          "Veja o que foi solicitado ao servidor, as respostas recebidas e a análise da IA. Um comando rejeitado não confirma que o serviço foi reiniciado.",
        )}
      </p>
      <p className="muted">
        {data && (
          <>
            {t`Até ${data.configured_limit} tentativas por incidente. A sequência para ao confirmar a recuperação.`}{" "}
            {data.repeat_enabled
              ? t`Intervalo entre tentativas: ${data.repeat_minutes} minutos.`
              : t("Sem intervalo entre tentativas.")}
          </>
        )}
      </p>
      <div className="platform-admin-form">
        <label>
          {t("Buscar serviço")}
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          {t("Resultado")}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {[
              "all",
              "waiting",
              "executing",
              "recovered",
              "failed",
              "unknown",
              "skipped",
              "blocked",
            ].map((v) => (
              <option key={v} value={v}>
                {t(labels[v])}
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
            {[5, 10, 20].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="recovery-budgets">
        {data?.availability
          .filter((a) =>
            data.items.length
              ? data.items.some((row) => row.service === a.service)
              : a.enabled &&
                (!q || a.service.toLowerCase().includes(q.toLowerCase())),
          )
          .slice(0, limit)
          .map((a) => {
            const indicator = recoveryIndicator(a, clock + offset);
            return (
              <div className="panel padded" key={a.service}>
                <strong>{a.service}</strong>
                <p>
                  <span className="tag">{t(indicator.label)}</span>
                </p>
                {a.configured_limit !== a.limit && (
                  <small>
                    {t("Limite atual para novos incidentes")}:{" "}
                    {a.configured_limit}
                  </small>
                )}
                <p>
                  {a.used}/{a.limit} {t("tentativas no último incidente")} ·{" "}
                  {a.remaining} {t("restantes na sequência")}
                </p>
                {a.used > 0 && (
                  <progress
                    value={Math.min(a.used, a.limit)}
                    max={a.limit}
                    aria-label={t("Tentativas por incidente")}
                  />
                )}
                {indicator.deadline !== null && (
                  <>
                    <p>
                      {t(
                        a.waiting_until
                          ? "Próxima tentativa em"
                          : "Nova tentativa permitida em",
                      )}
                    </p>
                    <strong
                      className="recovery-countdown"
                      role="timer"
                      aria-live="off"
                    >
                      {countdown(indicator.deadline, clock + offset)}
                    </strong>
                    <small>
                      {t("Liberação prevista")}: {stamp(indicator.deadline)}
                    </small>
                  </>
                )}
                {a.waiting_until !== null && (
                  <p className="muted">
                    {t(
                      "Agendada enquanto o alerta estiver ativo e a correção permanecer autorizada.",
                    )}
                  </p>
                )}
              </div>
            );
          })}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data?.items.map((row) => (
        <details
          key={row.alert_id}
          open={open === row.alert_id}
          onToggle={(e) => {
            if (e.currentTarget.open) setOpen(row.alert_id);
            else
              setOpen((current) => (current === row.alert_id ? "" : current));
          }}
        >
          <summary>
            <strong>{row.service}</strong> · {stamp(row.started_at)} ·{" "}
            <span className="tag">{t(labels[row.status] ?? row.status)}</span>
          </summary>
          <p className="muted">
            {t("Alerta")}: {row.alert_id} · {t("Finalizado em")}:{" "}
            {row.finished_at ? stamp(row.finished_at) : "—"}
          </p>
          {row.status === "waiting" && row.next_attempt_at !== null && (
            <p>
              {t("Próxima tentativa em")}:{" "}
              <strong
                className="recovery-countdown"
                role="timer"
                aria-live="off"
              >
                {countdown(row.next_attempt_at, clock + offset)}
              </strong>
            </p>
          )}
          <p className="muted">
            {t("Limite ao iniciar esta sequência")}: {row.attempt_limit}
          </p>
          {!row.steps.length && (
            <p>{t("Nenhum comando enviado ao servidor neste registro.")}</p>
          )}
          {row.legacy && (
            <p className="muted">
              {t(
                "Registro anterior: exibindo os comandos vinculados disponíveis; etapas sem vínculo não podem ser reconstruídas.",
              )}
            </p>
          )}
          {row.decisions?.map((decision, i) => (
            <div className="panel padded" key={i}>
              <h4>
                {t("Diagnóstico e decisão da IA")} ·{" "}
                {stamp(decision.created_at)}
              </h4>
              <p>
                <strong>{t("Causa investigada")}: </strong>
                {decision.cause}
              </p>
              <p>
                <strong>{t("Evidências")}: </strong>
                {(() => {
                  try {
                    return (JSON.parse(decision.evidence) as string[]).join(
                      " · ",
                    );
                  } catch {
                    return decision.evidence;
                  }
                })()}
              </p>
              <p>
                <strong>{t("Ação escolhida")}: </strong>
                {decision.action} · {decision.reason}
              </p>
            </div>
          ))}
          {row.steps.map((step, i) => (
            <div className="panel padded" key={step.id}>
              <h4>
                {i + 1}.{" "}
                {t(
                  (
                    {
                      status: "Consulta de estado",
                      diagnose: "Diagnóstico local",
                      verify: "Verificação após correção",
                      start: "Iniciar serviço",
                      restart: "Solicitação de reinício",
                      "reset-failed": "Limpar bloqueio de falhas",
                      reload: "Recarregar serviço",
                      configuration: "Ajustar configuração",
                    } as Record<string, string>
                  )[step.stage] ?? step.stage,
                )}{" "}
                ·{" "}
                {t(
                  step.output?.includes("comando não autorizado")
                    ? "Rejeitado pelo gateway"
                    : (labels[step.status] ?? step.status),
                )}
              </h4>
              <small>
                {stamp(step.created_at)} ·{" "}
                {step.finished_at
                  ? stamp(step.finished_at)
                  : t("Aguardando resultado")}
              </small>
              <p className="muted">{t("Comandos previstos para esta etapa")}</p>
              <pre>
                <code>{commands(step.commands)}</code>
              </pre>
              <p className="muted">{t("Resposta do servidor")}</p>
              <pre>
                <code>
                  {step.output ?? t("Ainda não há resposta registrada.")}
                </code>
              </pre>
            </div>
          ))}
          {row.output && (
            <>
              <h4>{t("Resultado da tentativa")}</h4>
              <pre>
                <code>{row.output}</code>
              </pre>
            </>
          )}
          <h4>{t("Resumo da investigação")}</h4>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {row.summary ??
              t(
                row.status === "waiting"
                  ? "Aguardando liberação para iniciar a tentativa."
                  : "Preparando resumo da investigação…",
              )}
          </p>
        </details>
      ))}
      {data?.total === 0 && (
        <p className="muted">
          {t("Nenhuma tentativa de correção encontrada.")}
        </p>
      )}
      {data && (
        <div className="platform-row-actions">
          <span>
            {data.total} {t("registros")} · {t("Página")} {data.page} /{" "}
            {data.pages}
          </span>
          <button
            disabled={data.page <= 1}
            onClick={() => setPage(data.page - 1)}
          >
            {t("Anterior")}
          </button>
          <button
            disabled={data.page >= data.pages}
            onClick={() => setPage(data.page + 1)}
          >
            {t("Próxima")}
          </button>
        </div>
      )}
    </section>
  );
}
