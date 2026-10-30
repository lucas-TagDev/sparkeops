import { t as tx, getLanguage } from "./i18n.ts";
import { useState } from "react";
import { api } from "./api.ts";
import type { Server } from "../src/platform.ts";
type Snapshot = {
  id: string;
  service: string;
  path: string;
  activation: string;
  values: Record<string, number | string>;
  limits: Record<string, [number, number]>;
};
export function ConfigPanel({
  server,
  onPrepared,
}: {
  server: Server;
  onPrepared: () => void;
}) {
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<
    { path: string; content: string; truncated: boolean }[]
  >([]);
  const [readNotice, setReadNotice] = useState("");
  const [service, setService] = useState(""),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [values, setValues] = useState<Record<string, number>>({}),
    [goal, setGoal] = useState(""),
    [answer, setAnswer] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const services = Object.keys(server.details?.services ?? {}).sort((a, b) =>
    a.localeCompare(b),
  );
  const editable = /^(nginx|apache2|mysql|php\d{1,2}\.\d{1,2}-fpm)$/.test(
    service,
  );
  const root = `/servers/${server.id}/configuration`;
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const changes = Object.entries(values).filter(
    ([k, v]) => Number.isFinite(v) && snapshot?.values[k] !== v,
  );
  return (
    <div>
      <h3>{tx("Arquivos e parâmetros de configuração")}</h3>
      <p>
        {tx(
          "Consulte os arquivos encontrados no servidor e a definição do serviço no systemd. A consulta não altera o servidor nem envia o conteúdo à IA.",
        )}
      </p>
      <p className="muted">
        {tx(
          "A leitura tem limite de tamanho e oculta linhas com credenciais conhecidas. Arquivos externos, formatos personalizados e parâmetros definidos em memória podem exigir investigação pelo assistente.",
        )}
      </p>
      <label>
        {tx("Buscar serviço")}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="nginx, mysql, ssh..."
        />
      </label>
      <div className="action-row">
        <select
          aria-label={tx("Serviço para ajustar configuração")}
          value={service}
          disabled={busy}
          onChange={(e) => {
            setService(e.target.value);
            setSnapshot(null);
            setFiles([]);
            setReadNotice("");
            setValues({});
            setAnswer("");
          }}
        >
          <option value="">{tx("Selecione um serviço")}</option>
          {services
            .filter(
              (s) =>
                s === service || s.toLowerCase().includes(search.toLowerCase()),
            )
            .map((s) => (
              <option key={s}>{s}</option>
            ))}
        </select>
        <button
          className="primary"
          disabled={busy || !service}
          onClick={() =>
            void run(async () => {
              const result = await api<{
                files: typeof files;
                limited: boolean;
                message: string;
              }>(root + "/browse", { service });
              setFiles(result.files);
              setReadNotice(
                result.message +
                  (result.limited
                    ? " Limite de leitura atingido ou arquivos omitidos."
                    : ""),
              );
            })
          }
        >
          {tx("Consultar arquivos no servidor")}
        </button>
        <button
          className="secondary"
          disabled={busy || !service || !editable}
          onClick={() =>
            void run(async () => {
              const result = await api<Snapshot>(root + "/inspect", {
                service,
              });
              setSnapshot(result);
              setValues(
                Object.fromEntries(
                  Object.entries(result.values).map(([k, v]) => [
                    k,
                    typeof v === "number" ? v : NaN,
                  ]),
                ),
              );
              setAnswer("");
            })
          }
        >
          {tx("Carregar parâmetros editáveis")}
        </button>
      </div>
      {service && !editable && (
        <p className="muted">
          {tx(
            "Este serviço permite consulta. Para investigar outros parâmetros ou preparar alterações, utilize o assistente.",
          )}
        </p>
      )}
      {readNotice && (
        <p className="muted" role="status">
          {readNotice}
        </p>
      )}
      {readNotice && !files.length && (
        <p>
          {tx(
            "Nenhum arquivo encontrado nos caminhos consultados. Investigue o caminho personalizado pelo assistente.",
          )}
        </p>
      )}
      {files.map((file) => (
        <details
          key={file.path}
          className="panel"
          style={{ padding: 16, marginTop: 12 }}
        >
          <summary style={{ cursor: "pointer" }}>
            <code>{file.path}</code>
            {file.truncated ? " (parcial)" : ""}
          </summary>
          <pre
            style={{
              maxHeight: 360,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {file.content}
          </pre>
        </details>
      ))}
      {busy && <p role="status">{tx("Processando…")}</p>}
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {snapshot && (
        <>
          <p>
            {tx("Arquivo:")}
            <code>{snapshot.path}</code>
            {tx(". Ativação:")}{" "}
            <strong>
              {snapshot.activation === "restart"
                ? tx("reinício do serviço (pode interromper conexões)")
                : tx("recarregamento do serviço")}
            </strong>
            .
          </p>
          {!Object.keys(snapshot.values).length && (
            <p>
              {tx(
                "Nenhuma diretiva numérica suportada foi encontrada de forma única. Não serão adicionadas diretivas ou seções automaticamente.",
              )}
            </p>
          )}
          <div className="rules-grid">
            {Object.keys(snapshot.values).map((key) => (
              <label key={key}>
                {key}
                {tx("· atual:")}
                {snapshot.values[key]}
                <input
                  aria-label={key}
                  type="number"
                  min={snapshot.limits[key][0]}
                  max={snapshot.limits[key][1]}
                  value={Number.isFinite(values[key]) ? values[key] : ""}
                  disabled={busy}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [key]:
                        e.target.value === "" ? NaN : Number(e.target.value),
                    })
                  }
                />
                <small>
                  {tx("Permitido:")}
                  {snapshot.limits[key].join(" a ")}
                </small>
              </label>
            ))}
          </div>
          <label>
            {tx("Problema ou objetivo do ajuste")}
            <textarea
              aria-label={tx("Objetivo do ajuste")}
              maxLength={700}
              value={goal}
              disabled={busy}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={tx(
                "Descreva o problema observado e o resultado esperado.",
              )}
            />
          </label>
          <button
            className="secondary"
            disabled={
              busy ||
              goal.trim().length < 5 ||
              !Object.keys(snapshot.values).length
            }
            onClick={() =>
              void run(async () => {
                const result = await api<{
                  answer: string;
                  values: Record<string, number> | null;
                }>(root + "/suggest", { snapshot_id: snapshot.id, goal });
                setAnswer(result.answer);
                if (result.values)
                  setValues({
                    ...Object.fromEntries(
                      Object.entries(snapshot.values).map(([k, v]) => [
                        k,
                        typeof v === "number" ? v : NaN,
                      ]),
                    ),
                    ...result.values,
                  });
              })
            }
          >
            {tx("Pedir sugestão à IA")}
          </button>
          <p className="muted">
            {tx(
              "A IA recebe apenas parâmetros numéricos e o retrato autorizado do servidor, sem o arquivo completo ou credenciais. A sugestão pode estar errada; revise capacidade e impacto. Sem evidência suficiente, não é proposto ajuste.",
            )}
          </p>
          {answer && (
            <div className="operations-analysis">
              <p style={{ whiteSpace: "pre-wrap" }}>{answer}</p>
            </div>
          )}
          {!!changes.length && (
            <>
              <h3>{tx("Comparação antes/depois")}</h3>
              <pre>
                {changes
                  .map(
                    ([k, v]) => `- ${k}: ${snapshot.values[k]}\n+ ${k}: ${v}`,
                  )
                  .join("\n")}
              </pre>
              <p>
                {tx(
                  "Backup root em /var/lib/foxops-config/backups. O arquivo será conferido novamente antes da gravação; alterações externas invalidam a proposta. Se o teste ou a ativação falhar, o auxiliar tentará restaurar o arquivo original e recuperar o serviço.",
                )}
              </p>
              <button
                className="primary"
                disabled={busy || changes.some(([, v]) => !Number.isInteger(v))}
                onClick={() =>
                  void run(async () => {
                    await api(root + "/propose", {
                      snapshot_id: snapshot.id,
                      values: Object.fromEntries(changes),
                      reason: goal || tx("Ajuste numérico revisado no painel."),
                    });
                    onPrepared();
                  })
                }
              >
                {tx("Preparar alteração para aprovação")}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
