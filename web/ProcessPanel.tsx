import { t as tx, getLanguage } from "./i18n.ts";
import { useEffect, useState } from "react";
import { Bot, RefreshCw, ShieldCheck } from "lucide-react";
import { api, stampSeconds } from "./api.ts";
import type { Server } from "../src/platform.ts";
import { ProcessMonitors, type ProcessSelection } from "./ProcessMonitors.tsx";
import type { ProcessRule } from "../shared/process-monitoring.ts";

type Process = {
  pid: number;
  name: string;
  user: string;
  state: string;
  cpu_percent: number;
  memory_percent: number;
  rss_bytes: number;
  elapsed_seconds: number;
  service: string | null;
};
type Result = {
  processes: Process[];
  visible: number;
  skipped: number;
  truncated: boolean;
  read_status: string;
  sample_seconds: number;
  collected_at: number;
};
type Snapshot = {
  id: string;
  created_at: number;
  status: string;
  result: string | null;
};
type Suggestion = { service: string; action: string; reason: string };
const percent = (n: number) =>
  n.toLocaleString(getLanguage(), { maximumFractionDigits: 2 }) + "%";
const elapsed = (seconds: number) =>
  seconds >= 86400
    ? `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
    : seconds >= 3600
      ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`
      : `${Math.floor(seconds / 60)}min ${Math.floor(seconds % 60)}s`;

export function ProcessPanel({
  server,
  role,
  onPrepared,
}: {
  server: Server;
  role: string;
  onPrepared: () => void;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [watchSelection, setWatchSelection] = useState<ProcessSelection | null>(
      null,
    ),
    [monitoredRules, setMonitoredRules] = useState<ProcessRule[]>([]),
    [selected, setSelected] = useState(""),
    [sort, setSort] = useState("cpu"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [answer, setAnswer] = useState(""),
    [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const root = `/servers/${server.id}/processes`;
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await api<Snapshot[]>(root);
        if (active) setSnapshots(rows);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [root]);
  const snapshot = snapshots.find((s) => s.id === selected) ?? snapshots[0];
  const result: Result | null = snapshot?.result
    ? JSON.parse(snapshot.result)
    : null;
  const waiting = snapshots.some((s) =>
    ["pending", "running"].includes(s.status),
  );
  const fresh = result && Date.now() / 1000 - result.collected_at <= 600;
  const known = new Set([
    ...Object.keys(server.details?.services ?? {}),
    ...((server.details?.discovered_services as string[]) ?? []),
  ]);
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const prepare = async (s: Suggestion) => {
    await api(`/servers/${server.id}/actions`, s);
    onPrepared();
  };
  const rows = [...(result?.processes ?? [])].sort((a, b) =>
    sort === "memory"
      ? b.rss_bytes - a.rss_bytes || b.cpu_percent - a.cpu_percent
      : b.cpu_percent - a.cpu_percent || b.rss_bytes - a.rss_bytes,
  );
  return (
    <div className="process-panel">
      <div className="action-row">
        <button
          className="primary"
          disabled={busy || waiting}
          onClick={() =>
            void run(async () => {
              const job = await api<Snapshot>(root, {});
              setSnapshots(await api<Snapshot[]>(root));
              setSelected(job.id);
              setAnswer("");
              setSuggestions([]);
              setNotice(
                tx(
                  "Consulta solicitada. O agente mede os processos no próprio Ubuntu na próxima coleta.",
                ),
              );
            })
          }
        >
          <RefreshCw size={15} />
          {tx("Consultar processos agora")}
        </button>
        <select
          aria-label={tx("Ordenar processos")}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="cpu">{tx("Maior CPU")}</option>
          <option value="memory">{tx("Maior memória")}</option>
        </select>
        {snapshots.length > 0 && (
          <select
            aria-label={tx("Coleta de processos")}
            disabled={busy}
            value={snapshot?.id ?? ""}
            onChange={(e) => {
              setSelected(e.target.value);
              setAnswer("");
              setSuggestions([]);
            }}
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {stampSeconds(s.created_at)} ·{" "}
                {(
                  {
                    pending: tx("Aguardando agente"),
                    running: tx("Enviado ao agente"),
                    completed: tx("Concluído"),
                    expired: tx("Expirou"),
                  } as Record<string, string>
                )[s.status] ?? s.status}
              </option>
            ))}
          </select>
        )}
        <button
          className="secondary"
          disabled={busy || !fresh || result?.read_status !== "ok"}
          onClick={() =>
            void run(async () => {
              if (snapshot) setSelected(snapshot.id);
              const response = await api<{
                answer: string;
                suggestions: Suggestion[];
              }>("/assistant", {
                organization: server.organization,
                server_id: server.id,
                include_processes: true,
                process_check_id: snapshot?.id,
                question:
                  "Analise os maiores consumidores de CPU e memória desta coleta de processos. Diferencie evidências e hipóteses, identifique o serviço associado quando disponível e proponha investigação ou teste de configuração antes de qualquer reinício. Não invente configurações nem afirme que o consumo isolado comprova erro.",
              });
              setAnswer(response.answer);
              setSuggestions(response.suggestions ?? []);
            })
          }
        >
          <Bot size={15} />
          {tx("Analisar processos com IA")}
        </button>
      </div>
      <p className="muted">
        {tx(
          "CPU é a porcentagem da capacidade total do servidor, medida num intervalo. A lista combina os 10 maiores por CPU e os 10 maiores por memória. Não coleta argumentos de comandos nem variáveis de ambiente. A análise com IA envia esta coleta ao provedor configurado na conta.",
        )}
      </p>
      {busy && <p role="status">{tx("Processando solicitação…")}</p>}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!snapshot && (
        <p>
          {tx(
            "Consulte os processos para identificar os maiores consumidores neste servidor. Requer agente 0.5 ou superior.",
          )}
        </p>
      )}
      {snapshot && ["pending", "running"].includes(snapshot.status) && (
        <p role="status">
          {tx(
            "Aguardando medição pelo agente. Esta tela consulta o resultado a cada 15 segundos; a solicitação expira em 10 minutos.",
          )}
        </p>
      )}
      {snapshot?.status === "expired" && (
        <p className="banner error">
          {tx(
            "O agente não respondeu a tempo. Confira a versão, a conectividade e o serviço foxops-agent no Ubuntu antes de consultar novamente.",
          )}
        </p>
      )}
      {result && result.read_status !== "ok" && (
        <p className="banner error">
          {tx(
            "Não foi possível obter uma amostra válida dos processos. Verifique o acesso do agente ao /proc. Isso não significa ausência de consumo.",
          )}
        </p>
      )}
      {result?.read_status === "ok" && (
        <>
          <p>
            {tx("Coletado em")}
            {stampSeconds(result.collected_at)}
            {tx("· intervalo de")}{" "}
            {result.sample_seconds.toLocaleString(getLanguage(), {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            {tx("s ·")}
            {result.visible}
            {tx("processos visíveis ·")}
            {result.skipped}
            {tx("leituras inacessíveis, encerradas ou sem amostra comparável.")}
          </p>
          {!fresh && (
            <p className="banner info">
              {tx(
                "Coleta antiga. Consulte novamente para analisar o estado atual com IA.",
              )}
            </p>
          )}
          {result.truncated && (
            <p className="banner info">
              {tx(
                "A leitura atingiu o limite de tempo ou quantidade. A classificação cobre apenas os processos lidos.",
              )}
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tx("Processo / PID")}</th>
                  <th>{tx("Usuário")}</th>
                  <th>CPU</th>
                  <th>{tx("Memória")}</th>
                  <th>{tx("Tempo")}</th>
                  <th>{tx("Serviço / investigação")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.pid}>
                    <td>
                      <strong>{p.name}</strong>
                      <small>
                        PID {p.pid}
                        {tx("· estado")}
                        {p.state}
                      </small>
                    </td>
                    <td>{p.user}</td>
                    <td>{percent(p.cpu_percent)}</td>
                    <td>
                      {percent(p.memory_percent)}
                      <small>
                        {(p.rss_bytes / 1048576).toLocaleString(getLanguage(), {
                          maximumFractionDigits: 1,
                        })}{" "}
                        {tx("MiB residentes")}
                      </small>
                    </td>
                    <td>{elapsed(p.elapsed_seconds)}</td>
                    <td>
                      {p.service ?? tx("Sem associação identificada")}
                      {role !== "reader" && (
                        <button
                          type="button"
                          className="secondary"
                          aria-pressed={monitoredRules.some(
                            (r) =>
                              r.enabled &&
                              r.name === p.name &&
                              r.user === p.user &&
                              r.service === (p.service ?? ""),
                          )}
                          onClick={() =>
                            setWatchSelection({
                              name: p.name,
                              user: p.user,
                              service: p.service,
                              nonce: Date.now(),
                            })
                          }
                        >
                          <ShieldCheck size={14} />
                          {tx(
                            monitoredRules.some(
                              (r) =>
                                r.enabled &&
                                r.name === p.name &&
                                r.user === p.user &&
                                r.service === (p.service ?? ""),
                            )
                              ? "Monitorado"
                              : "Monitorar processo",
                          )}
                        </button>
                      )}
                      {role !== "reader" &&
                        p.service &&
                        known.has(p.service) &&
                        fresh && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                prepare({
                                  service: p.service!,
                                  action:
                                    /^(nginx|apache2|httpd|php\d+\.\d+-fpm)$/.test(
                                      p.service!,
                                    )
                                      ? "configtest"
                                      : "status",
                                  reason: tx`Investigar ${p.name} (PID ${p.pid}) observado na coleta de ${stampSeconds(result.collected_at)}. Verificar o serviço antes de alterar configurações.`,
                                }),
                              )
                            }
                          >
                            <ShieldCheck size={14} />
                            {tx("Preparar verificação do serviço")}
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {tx(
              "Memória residente pode ser compartilhada entre processos; não some as porcentagens como memória exclusiva. Processos ocultos por permissões e processos iniciados durante a amostra podem não aparecer. Os dados do PID são históricos: nenhuma ação é enviada diretamente a ele.",
            )}
          </p>
        </>
      )}
      <ProcessMonitors
        serverId={server.id}
        role={role}
        selection={watchSelection}
        onRulesChanged={setMonitoredRules}
      />
      {answer && (
        <div className="operations-analysis">
          <h3>{tx("Análise da coleta selecionada")}</h3>
          <p>{answer}</p>
          {suggestions.map((s, i) => (
            <div key={i}>
              <p>{s.reason}</p>
              {role !== "reader" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run(() => prepare(s))}
                >
                  <ShieldCheck size={14} />
                  {tx("Preparar")}
                  {s.action}
                  {tx("de")}
                  {s.service}
                  {tx("para aprovação")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="muted">
        {tx(
          "Verificações e correções de serviços são preparadas para revisão em Ações e aprovações. Alterações exigem aprovação; o consumo alto, sozinho, não inicia reinício, encerramento de processo ou edição de arquivos.",
        )}
      </p>
    </div>
  );
}
