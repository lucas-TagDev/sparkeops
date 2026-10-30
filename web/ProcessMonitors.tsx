import { useEffect, useRef, useState } from "react";
import { Bell, Plus, Save, Pause, Settings2 } from "lucide-react";
import { api, stamp, pct } from "./api.ts";
import { t } from "./i18n.ts";
import type {
  ProcessRule,
  ProcessMonitoringPage,
} from "../shared/process-monitoring.ts";
export type ProcessSelection = {
  name: string;
  user: string;
  service: string | null;
  nonce: number;
};
type Draft = Omit<
  ProcessRule,
  "id" | "revision" | "latest" | "last_received"
> & { id?: string; revision?: number };
export function ProcessMonitors({
  serverId,
  role,
  selection,
  onRulesChanged,
}: {
  serverId: string;
  role: string;
  selection: ProcessSelection | null;
  onRulesChanged: (rules: ProcessRule[]) => void;
}) {
  const [data, setData] = useState<ProcessMonitoringPage | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [incidentPage, setIncidentPage] = useState(1);
  const handled = useRef<number | null>(null),
    form = useRef<HTMLDivElement>(null),
    root = `/servers/${serverId}/process-monitors`,
    manage = role !== "reader";
  const load = async () => setData(await api<ProcessMonitoringPage>(root));
  useEffect(() => {
    if (data) onRulesChanged(data.rules);
  }, [data, onRulesChanged]);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void api<ProcessMonitoringPage>(root)
        .then((result) => {
          if (active) setData(result);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [root]);
  useEffect(() => {
    if (!selection || !data || handled.current === selection.nonce) return;
    handled.current = selection.nonce;
    const existing = data.rules.find(
      (r) =>
        r.name === selection.name &&
        r.user === selection.user &&
        r.service === (selection.service ?? ""),
    );
    setDraft(
      existing ?? {
        name: selection.name,
        user: selection.user,
        service: selection.service ?? "",
        min_count: 1,
        cpu_limit: null,
        memory_limit: null,
        duration: 60,
        alert_restarts: false,
        ai_summary: true,
        enabled: true,
      },
    );
    setNotice("");
    form.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selection, data]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const filtered = (data?.rules ?? []).filter((r) =>
      `${r.name} ${r.user} ${r.service}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    ),
    pages = Math.max(1, Math.ceil(filtered.length / 5)),
    current = Math.min(page, pages),
    incidents = data?.incidents ?? [],
    incidentPages = Math.max(1, Math.ceil(incidents.length / 5)),
    ip = Math.min(incidentPage, incidentPages);
  return (
    <section className="process-monitors" ref={form}>
      <div className="process-monitors-heading">
        <h3>
          <Bell size={17} />
          {t("Processos monitorados")}
        </h3>
        {manage && (
          <button
            className="secondary"
            onClick={() =>
              setDraft({
                name: "",
                user: "",
                service: "",
                min_count: 1,
                cpu_limit: null,
                memory_limit: null,
                duration: 60,
                alert_restarts: false,
                ai_summary: true,
                enabled: true,
              })
            }
          >
            <Plus size={14} />
            {t("Adicionar por nome")}
          </button>
        )}
      </div>
      <p className="muted">
        {t(
          "Marque Monitorar na lista ou informe um nome. A regra acompanha o nome exato, usuário e serviço, não um PID fixo. Requer agente 0.9 ou superior.",
        )}
      </p>
      <p className="muted">
        {t(
          "Para receber avisos e resumos, habilite Processos monitorados nos canais da organização em Configurações.",
        )}
      </p>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {draft && manage && (
        <form
          className="process-monitor-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(
                root + (draft.id ? "/" + draft.id : ""),
                {
                  ...draft,
                  enabled: !!draft.enabled,
                  ai_summary: !!draft.ai_summary,
                  alert_restarts: !!draft.alert_restarts,
                },
                draft.id ? "PUT" : "POST",
              );
              setDraft(null);
              setNotice(
                t(
                  "Monitoramento salvo. O agente aplicará a regra na próxima coleta.",
                ),
              );
            });
          }}
        >
          <fieldset disabled={busy}>
            <div className="rules-grid">
              <label>
                {t("Nome exato do processo")}
                <input
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                {t("Usuário (opcional)")}
                <input
                  maxLength={100}
                  value={draft.user}
                  onChange={(e) => setDraft({ ...draft, user: e.target.value })}
                />
              </label>
              <label>
                {t("Serviço (opcional)")}
                <input
                  maxLength={100}
                  value={draft.service}
                  onChange={(e) =>
                    setDraft({ ...draft, service: e.target.value })
                  }
                />
              </label>
              <label>
                {t("Mínimo de instâncias ativas")}
                <input
                  type="number"
                  min={1}
                  max={1000}
                  required
                  value={draft.min_count}
                  onChange={(e) =>
                    setDraft({ ...draft, min_count: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                {t("Limite de CPU do host (%) — opcional")}
                <input
                  type="number"
                  min={0.1}
                  max={100}
                  step="0.1"
                  value={draft.cpu_limit ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cpu_limit:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                {t("Limite de memória do host (%) — opcional")}
                <input
                  type="number"
                  min={0.1}
                  max={100}
                  step="0.1"
                  value={draft.memory_limit ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      memory_limit:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                {t("Duração mínima da condição (segundos)")}
                <input
                  type="number"
                  min={30}
                  max={3600}
                  required
                  value={draft.duration}
                  onChange={(e) =>
                    setDraft({ ...draft, duration: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              {t("Monitoramento ativo")}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!draft.alert_restarts}
                onChange={(e) =>
                  setDraft({ ...draft, alert_restarts: e.target.checked })
                }
              />
              {t(
                "Avisar quando todas as instâncias forem substituídas entre coletas",
              )}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!draft.ai_summary}
                onChange={(e) =>
                  setDraft({ ...draft, ai_summary: e.target.checked })
                }
              />
              {t(
                "Gerar resumo com IA e verificar logs locais do serviço em incidentes",
              )}
            </label>
            <p className="muted">
              {t(
                "O alerta técnico é imediato após a duração configurada; o resumo é enviado depois, uma vez por incidente. A IA usa a franquia da conta e não executa correções.",
              )}
            </p>
            <div className="action-row">
              <button type="submit" className="primary">
                <Save size={14} />
                {t("Salvar monitoramento")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setDraft(null)}
              >
                {t("Cancelar")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {data && (
        <>
          <div className="process-monitor-search">
            <label>
              {t("Buscar processos monitorados")}
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder={t("Nome, usuário ou serviço")}
              />
            </label>
          </div>
          <div className="process-monitor-rules">
            {filtered.slice((current - 1) * 5, current * 5).map((rule) => {
              const sample = rule.latest ? JSON.parse(rule.latest) : null,
                fresh =
                  !!rule.last_received &&
                  Date.now() / 1000 - rule.last_received <= 120;
              return (
                <article key={rule.id}>
                  <div className="process-monitors-heading">
                    <strong>
                      {rule.name}{" "}
                      <small>
                        {rule.user || t("Todos os usuários")} ·{" "}
                        {rule.service || t("Qualquer serviço")}
                      </small>
                    </strong>
                    <span className="tag">
                      {t(
                        !rule.enabled
                          ? "Pausado"
                          : !fresh
                            ? "Aguardando coleta recente"
                            : sample?.read_status !== "ok"
                              ? "Leitura incompleta"
                              : "Monitorando",
                      )}
                    </span>
                  </div>
                  <p>
                    {sample && fresh && sample.read_status === "ok"
                      ? `${t("Instâncias")}: ${sample.count} · CPU: ${pct(sample.cpu_percent)} · ${t("Memória")}: ${pct(sample.memory_percent)}`
                      : t(
                          "Sem leitura recente. Isso não confirma parada do processo.",
                        )}
                  </p>
                  {manage && (
                    <div className="action-row">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setDraft(rule)}
                      >
                        <Settings2 size={14} />
                        {t("Editar regra")}
                      </button>
                      {!!rule.enabled && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api(root + "/" + rule.id, {}, "DELETE");
                              setNotice(t("Monitoramento pausado."));
                            })
                          }
                        >
                          <Pause size={14} />
                          {t("Pausar monitoramento")}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {!filtered.length && (
              <p className="muted">
                {t("Nenhum processo monitorado com estes filtros.")}
              </p>
            )}
          </div>
          <nav
            className="service-pagination"
            aria-label={t("Paginação de processos monitorados")}
          >
            <button
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
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
        </>
      )}
      {!!incidents.length && (
        <>
          <h3>{t("Incidentes de processos — últimos 20")}</h3>
          {incidents.slice((ip - 1) * 5, ip * 5).map((incident) => (
            <details key={incident.id} className="process-incident">
              <summary>
                <strong>{incident.name}</strong> · {stamp(incident.opened_at)} ·{" "}
                {t(incident.resolved_at ? "Recuperado" : "Aberto")}
              </summary>
              <p>{incident.message}</p>
              {incident.summary ? (
                <>
                  <h4>
                    {t(
                      incident.summary_mode === "ai"
                        ? "Resumo da IA"
                        : "Resumo técnico",
                    )}
                  </h4>
                  <p>{incident.summary}</p>
                </>
              ) : incident.summary_mode === "pending" ||
                incident.summary_mode === "generating" ? (
                <p className="muted">
                  {t(
                    "Aguardando resumo e verificação local de logs, quando disponível.",
                  )}
                </p>
              ) : null}
              {incident.resolved_at && (
                <p className="muted">
                  {t("Recuperado em")} {stamp(incident.resolved_at)}
                </p>
              )}
            </details>
          ))}
          <nav
            className="service-pagination"
            aria-label={t("Paginação de incidentes de processos")}
          >
            <button disabled={ip === 1} onClick={() => setIncidentPage(ip - 1)}>
              {t("Anterior")}
            </button>
            <span>
              {t("Página")} {ip} {t("de")} {incidentPages}
            </span>
            <button
              disabled={ip === incidentPages}
              onClick={() => setIncidentPage(ip + 1)}
            >
              {t("Próxima")}
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
