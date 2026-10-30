import { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  RefreshCw,
  Plus,
  Save,
  Play,
  ShieldCheck,
  Trash2,
  KeyRound,
  ShieldOff,
  Network,
} from "lucide-react";
import { api, stamp, pct } from "./api.ts";
import { t } from "./i18n.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
import { AgentActivationGuide } from "./AgentActivationGuide.tsx";
import { PersistentDetails } from "./PersistentDetails.tsx";
import type { Observation } from "../shared/observability.ts";
type Book = {
  id?: string;
  name: string;
  description: string;
  path: string;
  sha256: string;
  trigger_kind: string;
  mode: string;
  enabled: number | boolean;
  cooldown: number;
  daily_limit: number;
  revision?: number;
};
type Run = {
  id: string;
  name: string;
  status: string;
  reason: string;
  created_at: number;
  output: string | null;
};
type Books = { items: Book[]; runs: Run[] };
const empty = (): Book => ({
  name: "",
  description: "",
  path: "/opt/foxops-runbooks/",
  sha256: "",
  trigger_kind: "manual",
  mode: "manual",
  enabled: false,
  cooldown: 3600,
  daily_limit: 3,
});
const metricNames: Record<string, string> = {
  cpu_percent: "CPU",
  memory_percent: "Memória",
  disk_percent: "Disco",
  temperature_max_c: "Temperatura máxima",
  disk_await_ms: "Latência de I/O",
};
export function ObservabilityPanel({
  serverId,
  role,
}: {
  serverId: string;
  role: string;
}) {
  const [data, setData] = useState<Observation | null>(null),
    [books, setBooks] = useState<Books>({ items: [], runs: [] }),
    [tab, setTab] = useState("insights"),
    [draft, setDraft] = useState<Book | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [key, setKey] = useState("");
  const [trace, setTrace] = useState<
    | {
        service: string;
        server_name: string;
        name: string;
        parent_id: string;
        span_id: string;
        duration_ms: number;
        error: number;
      }[]
    | null
  >(null);
  const admin = ["owner", "admin"].includes(role),
    operator = admin || role === "operator",
    base = `/servers/${serverId}`;
  const load = async () => {
    const [observation, runbooks] = await Promise.all([
      api<Observation>(base + "/observability"),
      api<Books>(base + "/runbooks"),
    ]);
    setData(observation);
    setBooks(runbooks);
  };
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void Promise.all([
        api<Observation>(base + "/observability"),
        api<Books>(base + "/runbooks"),
      ])
        .then(([observation, runbooks]) => {
          if (active) {
            setData(observation);
            setBooks(runbooks);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [base]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const format = (metric: string, value: number) =>
    metric.endsWith("_percent")
      ? pct(value)
      : `${value.toFixed(2)} ${metric === "temperature_max_c" ? "°C" : "ms"}`;
  return (
    <PersistentDetails
      storageKey={"server:" + serverId + ":observability"}
      className="panel padded observability-panel collapsible-panel"
    >
      <summary className="observation-heading collapsible-heading">
        <h2>
          <Activity size={19} />
          {t("Observabilidade e AIOps")}
        </h2>
        <button disabled={busy} onClick={() => void run(load)}>
          <RefreshCw size={15} />
          {t("Atualizar")}
        </button>
      </summary>
      <div className="observation-tabs" role="tablist">
        {[
          ["insights", "Previsões e contexto"],
          ["runbooks", "Runbooks"],
          ["traces", "Instrumentação de traces"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {id === "insights" ? (
              <Activity size={16} />
            ) : id === "runbooks" ? (
              <BookOpen size={16} />
            ) : (
              <Network size={16} />
            )}
            {t(label)}
          </button>
        ))}
      </div>
      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {tab === "insights" && data && (
        <>
          <p className="muted">
            {t(
              "Análise estatística local do histórico, sem gastar tokens de IA a cada coleta. A IA recebe apenas o contexto resumido quando consultada.",
            )}
          </p>
          <div className="observation-coverage">
            <span>
              {t("Métricas horárias")}: <strong>{data.coverage.metrics}</strong>
            </span>
            <span>
              {t("Hardware / I/O")}: <strong>{data.coverage.hardware}</strong>
            </span>
            <span>
              {t("Spans na última hora")}:{" "}
              <strong>{data.coverage.spans}</strong>
            </span>
          </div>
          {!data.fresh && (
            <p className="notice">
              {t("Coleta desatualizada: previsão suspensa.")}
            </p>
          )}
          {!data.findings.length && (
            <p>
              {t(
                data.learning.length
                  ? "Aprendendo o comportamento deste servidor"
                  : "Nenhum desvio persistente ou previsão de saturação identificado.",
              )}
            </p>
          )}
          <div className="observation-findings">
            {data.findings.map((f) => (
              <article key={`${f.metric}:${f.type}`}>
                <h3>
                  {t(metricNames[f.metric])} ·{" "}
                  {t(
                    f.type === "forecast"
                      ? "Previsão de saturação"
                      : "Anomalia persistente",
                  )}
                </h3>
                <div>
                  <strong>{format(f.metric, f.current)}</strong>
                  <span>
                    {t("Referência histórica")}: {format(f.metric, f.baseline)}
                  </span>
                </div>
                {f.eta_hours !== null && (
                  <p>
                    {t("Estimativa até 90% de uso")}:{" "}
                    <strong>{f.eta_hours} h</strong>
                  </p>
                )}
                <p>{t(f.evidence)}</p>
                <small>
                  {t("Qualidade do sinal")}:{" "}
                  {t(f.confidence === "high" ? "Alta" : "Moderada")} ·{" "}
                  {f.samples} {t("amostras horárias")}
                </small>
              </article>
            ))}
          </div>
          {!!data.learning.length && (
            <details>
              <summary>{t("Histórico necessário")}</summary>
              <ul>
                {data.learning.map((text, i) => (
                  <li key={i}>
                    {t(metricNames[text.split(":")[0]] ?? text.split(":")[0])}:{" "}
                    {t(text.slice(text.indexOf(":") + 1).trim())}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <h3>{t("Contexto correlacionado — última hora")}</h3>
          <p className="muted">
            {t(
              "Eventos da mesma janela e servidor são correlacionados temporalmente; isso não comprova causalidade. SQL bruto não é armazenado.",
            )}
          </p>
          {data.correlations.spans.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Serviço")}</th>
                    <th>{t("Operação")}</th>
                    <th>{t("Duração")}</th>
                    <th>{t("Trace")}</th>
                    <th>{t("Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    data.correlations.spans as {
                      trace_id: string;
                      service: string;
                      name: string;
                      duration_ms: number;
                      error: number;
                      attributes: string;
                    }[]
                  ).map((s, i) => (
                    <tr key={i}>
                      <td>{s.service}</td>
                      <td>
                        {s.name}
                        <small>{s.attributes}</small>
                      </td>
                      <td>{s.duration_ms.toFixed(1)} ms</td>
                      <td>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () =>
                              setTrace(
                                await api(base + "/traces/" + s.trace_id),
                              ),
                            )
                          }
                        >
                          <code>{s.trace_id.slice(0, 12)}…</code>
                        </button>
                      </td>
                      <td>{t(s.error ? "Erro" : "Sem erro reportado")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              {t(
                "Nenhum trace recebido nesta janela. Instrumente a aplicação para identificar chamadas e operações específicas.",
              )}
            </p>
          )}
          <div className="observation-context">
            {[
              ["Resumos locais de logs", data.correlations.logs],
              ["Processos coletados", data.correlations.processes],
            ].map(([label, items]) => (
              <details key={String(label)}>
                <summary>
                  {t(String(label))} ({(items as unknown[]).length})
                </summary>
                <pre>{JSON.stringify(items, null, 2)}</pre>
              </details>
            ))}
          </div>
          <details>
            <summary>{t("Limites da análise")}</summary>
            <ul>
              {data.limitations.map((text, i) => (
                <li key={i}>{t(text)}</li>
              ))}
            </ul>
          </details>
          <p className="muted">
            {t("Atualizado em")}: {stamp(data.generated_at)}
          </p>
        </>
      )}
      {trace && tab === "insights" && (
        <div className="notice">
          <div className="observation-heading">
            <h3>{t("Caminho do trace na organização")}</h3>
            <button onClick={() => setTrace(null)}>{t("Fechar")}</button>
          </div>
          <p>
            {t(
              "Relações entre spans seguem os identificadores enviados pela aplicação; não provam causa raiz.",
            )}
          </p>
          {trace.map((span, i) => (
            <p key={i}>
              <strong>{span.service}</strong> · {span.server_name} · {span.name}{" "}
              · {span.duration_ms.toFixed(1)} ms · <code>{span.span_id}</code> ←{" "}
              <code>{span.parent_id || "root"}</code>
            </p>
          ))}
        </div>
      )}
      {tab === "traces" && (
        <>
          <h3>{t("Receber traces OpenTelemetry")}</h3>
          <p>
            {t(
              "Configure um exportador ou Collector OTLP HTTP/JSON. Este receptor aceita JSON, não gRPC nem Protobuf binário. A chave é exclusiva deste servidor.",
            )}
          </p>
          <pre>
            {typeof window !== "undefined" ? window.location.origin : ""}
            /api/telemetry/v1/traces
            {"\nAuthorization: Bearer <token>\nContent-Type: application/json"}
          </pre>
          <p className="muted">
            {t(
              "SQL completo, cabeçalhos, URLs e baggage não são persistidos. Não envie segredos nos nomes dos spans.",
            )}
          </p>
          {admin && (
            <div className="observation-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirmAction(
                      t(
                        "Gerar uma nova chave revoga imediatamente a chave anterior. Continuar?",
                      ),
                    )
                  )
                    void run(async () => {
                      const result = await api<{ token: string }>(
                        base + "/trace-key",
                        {},
                      );
                      setKey(result.token);
                    });
                }}
              >
                <KeyRound size={16} />
                {t("Gerar / rotacionar chave")}
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirmAction(
                      t("Revogar a chave de traces deste servidor?"),
                    )
                  )
                    void run(async () => {
                      await api(base + "/trace-key", {}, "DELETE");
                      setKey("");
                      setNotice(t("Chave revogada."));
                    });
                }}
              >
                <ShieldOff size={16} />
                {t("Revogar chave")}
              </button>
            </div>
          )}
          {key && (
            <div className="notice">
              <p>{t("Copie agora. A chave não será exibida novamente.")}</p>
              <code>{key}</code>
              <button onClick={() => setKey("")}>{t("Ocultar")}</button>
            </div>
          )}
        </>
      )}
      {tab === "runbooks" && (
        <>
          <div className="observation-heading">
            <h3>
              <BookOpen size={17} />
              {t("Scripts de correção por servidor")}
            </h3>
            {admin && (
              <button onClick={() => setDraft(empty())}>
                <Plus size={15} />
                {t("Novo runbook")}
              </button>
            )}
          </div>
          <p className="muted">
            {t(
              "Cadastre um script existente e descreva quando deve ser usado. A IA pode recomendar o runbook; somente gatilhos explicitamente autorizados executam automaticamente.",
            )}
          </p>
          <p className="notice">
            {t(
              "Requer SSH gerenciado e o auxiliar local habilitado com upgrade.sh --enable-runbooks. Scripts devem pertencer a root, ter shebang e execução permitida, sem escrita por grupo ou outros.",
            )}
          </p>
          {draft && admin && (
            <form
              className="runbook-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  let authorized = false;
                  if (draft.mode === "automatic" && draft.enabled) {
                    authorized = await confirmAction(
                      t(
                        "Autorizar a execução automática deste script como root para o gatilho e limites cadastrados?",
                      ),
                    );
                    if (!authorized) return;
                  }
                  await api(
                    base + "/runbooks" + (draft.id ? "/" + draft.id : ""),
                    {
                      ...draft,
                      enabled: !!draft.enabled,
                      authorize_automatic: authorized,
                    },
                    draft.id ? "PUT" : "POST",
                  );
                  setDraft(null);
                  await load();
                  setNotice(t("Runbook salvo."));
                });
              }}
            >
              <fieldset disabled={busy}>
                <div className="runbook-grid">
                  <label>
                    {t("Nome")}
                    <input
                      required
                      maxLength={100}
                      value={draft.name}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t("Caminho absoluto do script")}
                    <input
                      required
                      value={draft.path}
                      onChange={(e) =>
                        setDraft({ ...draft, path: e.target.value, sha256: "" })
                      }
                    />
                  </label>
                  <label className="full">
                    {t("Descrição e quando usar")}
                    <textarea
                      required
                      maxLength={2000}
                      rows={3}
                      value={draft.description}
                      onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t("Gatilho")}
                    <select
                      value={
                        draft.trigger_kind.split(":")[0] === "service"
                          ? "service"
                          : draft.trigger_kind
                      }
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          trigger_kind:
                            e.target.value === "service"
                              ? "service:"
                              : e.target.value,
                        })
                      }
                    >
                      {[
                        ["manual", "Somente manual"],
                        ["cpu", "CPU"],
                        ["memory", "Memória"],
                        ["disk", "Disco"],
                        ["offline", "Servidor sem comunicação"],
                        ["service", "Serviço específico"],
                        [
                          "predictive:disk_percent:forecast",
                          "Previsão de saturação de disco",
                        ],
                        [
                          "predictive:memory_percent:anomaly",
                          "Anomalia de memória",
                        ],
                        ["predictive:cpu_percent:anomaly", "Anomalia de CPU"],
                        [
                          "predictive:temperature_max_c:anomaly",
                          "Anomalia de temperatura",
                        ],
                        ["predictive:disk_await_ms:anomaly", "Anomalia de I/O"],
                      ].map(([value, label]) => (
                        <option key={value} value={value}>
                          {t(label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.trigger_kind.startsWith("service:") && (
                    <label>
                      {t("Serviço")}
                      <input
                        required
                        value={draft.trigger_kind.slice(8)}
                        placeholder="nginx"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            trigger_kind: "service:" + e.target.value,
                          })
                        }
                      />
                    </label>
                  )}
                  <label>
                    {t("Modo")}
                    <select
                      value={draft.mode}
                      onChange={(e) =>
                        setDraft({ ...draft, mode: e.target.value })
                      }
                    >
                      <option value="manual">{t("Aprovação humana")}</option>
                      <option value="automatic">
                        {t("Automático autorizado")}
                      </option>
                    </select>
                  </label>
                  <label>
                    {t("Intervalo mínimo (segundos)")}
                    <input
                      type="number"
                      required
                      min={300}
                      max={86400}
                      value={draft.cooldown}
                      onChange={(e) =>
                        setDraft({ ...draft, cooldown: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    {t("Máximo de execuções em 24 horas")}
                    <input
                      required
                      type="number"
                      min={1}
                      max={12}
                      value={draft.daily_limit}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          daily_limit: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <label className="runbook-toggle">
                  <input
                    type="checkbox"
                    checked={!!draft.enabled}
                    onChange={(e) =>
                      setDraft({ ...draft, enabled: e.target.checked })
                    }
                  />
                  {t("Runbook habilitado")}
                </label>
                <div className="observation-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        const report = await api<{
                          status: string;
                          sha256?: string;
                        }>(base + "/runbooks/inspect", { path: draft.path });
                        if (report.status !== "inspected" || !report.sha256)
                          throw new Error(
                            t(
                              "Arquivo recusado pelo servidor. Confira habilitação e permissões.",
                            ),
                          );
                        setDraft({ ...draft, sha256: report.sha256 });
                        setNotice(
                          t(
                            "Arquivo verificado. O conteúdo fica vinculado ao hash exibido.",
                          ),
                        );
                      })
                    }
                  >
                    <ShieldCheck size={15} />
                    {t("Verificar arquivo no servidor")}
                  </button>
                  <button
                    type="submit"
                    className="primary"
                    disabled={!draft.sha256}
                  >
                    <Save size={15} />
                    {t("Salvar runbook")}
                  </button>
                  <button type="button" onClick={() => setDraft(null)}>
                    {t("Cancelar")}
                  </button>
                </div>
                {draft.sha256 && (
                  <code className="runbook-hash">SHA-256: {draft.sha256}</code>
                )}
              </fieldset>
            </form>
          )}
          <div className="runbook-cards">
            {books.items.map((book) => (
              <article key={book.id}>
                <div className="observation-heading">
                  <h3>{book.name}</h3>
                  <span className="badge">
                    {t(
                      book.enabled
                        ? book.mode === "automatic"
                          ? "Automático autorizado"
                          : "Aprovação humana"
                        : "Desabilitado",
                    )}
                  </span>
                </div>
                <p>{book.description}</p>
                <code>{book.path}</code>
                <p className="muted">
                  {t("Gatilho")}: {book.trigger_kind} · {book.cooldown}s ·{" "}
                  {book.daily_limit}/24h
                </p>
                <div className="observation-actions">
                  {operator && (
                    <button
                      disabled={busy || !book.enabled}
                      onClick={() =>
                        void run(async () => {
                          await api(base + `/runbooks/${book.id}/request`, {});
                          await load();
                          setNotice(t("Execução preparada para aprovação."));
                        })
                      }
                    >
                      <Play size={14} />
                      {t("Preparar execução")}
                    </button>
                  )}
                  {admin && (
                    <>
                      <button onClick={() => setDraft(book)}>
                        {t("Editar")}
                      </button>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await confirmAction(
                              t(
                                "Arquivar este runbook e cancelar suas execuções pendentes?",
                              ),
                            )
                          )
                            void run(async () => {
                              await api(
                                base + `/runbooks/${book.id}`,
                                {},
                                "DELETE",
                              );
                              await load();
                            });
                        }}
                      >
                        <Trash2 size={14} />
                        {t("Arquivar")}
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
          <AgentActivationGuide feature="runbooks" />
          <h3>{t("Últimas 30 execuções")}</h3>
          {!books.runs.length && (
            <p className="muted">{t("Nenhuma execução registrada.")}</p>
          )}
          {books.runs.map((item) => (
            <details key={item.id} className="runbook-run">
              <summary>
                {item.name} · {stamp(item.created_at)} ·{" "}
                {t(
                  (
                    {
                      pending: "Aguardando aprovação",
                      executing: "Em execução",
                      succeeded: "Concluído",
                      failed: "Falhou",
                      unknown: "Resultado indeterminado",
                      reviewed: "Verificado manualmente",
                      skipped: "Não executado",
                      canceled: "Cancelado",
                      rejected: "Rejeitado",
                    } as Record<string, string>
                  )[item.status] ?? item.status,
                )}
              </summary>
              <p>{item.reason}</p>
              {item.output && <pre>{item.output}</pre>}
              {item.status === "unknown" && admin && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmAction(
                        t(
                          "Confirma que verificou manualmente o servidor e o resultado desta execução? Isso libera novas ações, sem repetir o script.",
                        ),
                      )
                    )
                      void run(async () => {
                        await api(
                          base + `/runbook-runs/${item.id}/reviewed`,
                          {},
                        );
                        await load();
                      });
                  }}
                >
                  {t("Confirmar verificação manual")}
                </button>
              )}
              {item.status === "pending" && admin && (
                <div className="observation-actions">
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await confirmAction(
                          t("Executar este script no servidor agora?"),
                        )
                      )
                        void run(async () => {
                          await api(
                            base + `/runbook-runs/${item.id}/approve`,
                            {},
                          );
                          await load();
                        });
                    }}
                  >
                    {t("Aprovar e executar")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(base + `/runbook-runs/${item.id}/reject`, {});
                        await load();
                      })
                    }
                  >
                    {t("Rejeitar")}
                  </button>
                </div>
              )}
            </details>
          ))}
        </>
      )}
    </PersistentDetails>
  );
}
