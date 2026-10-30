import { useState } from "react";
import { Clipboard, Check, Terminal } from "lucide-react";
import { t } from "./i18n.ts";
const features = [
  {
    id: "update",
    title: "Atualizar o agente",
    description:
      "Uma instalação nova já baixa a versão atual. Use este comando em agentes antigos para receber os recursos mais recentes.",
    flag: "",
  },
  {
    id: "ssh",
    title: "Configurar SSH gerenciado",
    description:
      "Cria o acesso SSH dedicado e cadastra a chave no painel. Primeiro, em Conexão SSH, gere a autorização de configuração automática. Execute o comando e informe a autorização quando solicitada.",
    flag: " --setup-ssh",
  },
  {
    id: "terminal",
    title: "Habilitar terminal interativo",
    description:
      "Requer SSH gerenciado configurado. Libera uma shell administrativa como root. Depois, o proprietário deve clicar em Habilitar terminal no painel e conectar.",
    flag: " --enable-terminal",
  },
  {
    id: "commands",
    title: "Habilitar comandos da IA",
    description:
      "Requer SSH gerenciado configurado. Permite executar os comandos preparados no chat somente depois da aprovação de um administrador. A habilitação, sozinha, não executa comandos.",
    flag: " --enable-approved-commands",
  },
  {
    id: "runbooks",
    title: "Habilitar runbooks",
    description:
      "Requer SSH gerenciado configurado. Permite os scripts cadastrados no painel. Cadastre o caminho, verifique o arquivo e defina aprovação humana ou autorize explicitamente um gatilho automático.",
    flag: " --enable-runbooks",
  },
];
export function AgentActivationGuide({
  feature,
}: {
  feature?: "ssh" | "terminal" | "commands" | "runbooks";
}) {
  const [copied, setCopied] = useState(""),
    [error, setError] = useState("");
  const origin =
    typeof location !== "undefined"
      ? location.origin
      : "https://sua-plataforma.example";
  return (
    <details className="agent-activation-guide">
      <summary>
        <Terminal size={15} />
        {t("Como instalar e habilitar os recursos do agente")}
      </summary>
      <p className="muted">
        {t(
          "Execute os comandos no terminal do servidor Linux, não no computador do painel. Habilite apenas os recursos desejados. Cada comando abaixo baixa o script antes de executar; não precisa ter baixado o upgrade anteriormente.",
        )}
      </p>
      {features
        .filter((item) => !feature || item.id === feature)
        .map((item) => {
          const command = `curl -fsS '${origin}/agent/upgrade.sh' -o /tmp/foxops-upgrade.sh\nsudo bash /tmp/foxops-upgrade.sh${item.flag}`;
          return (
            <article key={item.id}>
              <h4>{t(item.title)}</h4>
              <p>{t(item.description)}</p>
              <div className="agent-activation-command">
                <pre>{command}</pre>
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(command);
                      setCopied(item.id);
                      setError("");
                    } catch {
                      setError(
                        t(
                          "Não foi possível copiar. Selecione o comando para copiar manualmente.",
                        ),
                      );
                    }
                  }}
                >
                  {copied === item.id ? (
                    <Check size={14} />
                  ) : (
                    <Clipboard size={14} />
                  )}{" "}
                  {t(copied === item.id ? "Copiado" : "Copiar comando")}
                </button>
              </div>
            </article>
          );
        })}
      {error && <p role="alert">{error}</p>}
      <p className="muted">
        {t(
          "Em uma instalação nova, a configuração SSH também pode ser escolhida no instalador. Monitoramento não exige habilitar terminal, comandos da IA ou runbooks. Para desligar um recurso no servidor, use o mesmo comando trocando a opção por --disable-terminal, --disable-approved-commands ou --disable-runbooks.",
        )}
      </p>
    </details>
  );
}
