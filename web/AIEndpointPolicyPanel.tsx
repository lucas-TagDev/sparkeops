import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
export function AIEndpointPolicyPanel() {
  const [value, setValue] = useState(""),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    void api<{ origins: string[] }>("/platform/ai/endpoints")
      .then((data) => {
        setValue(data.origins.join("\n"));
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel padded">
      <h2>{t("Endpoints de IA")}</h2>
      <p className="muted">
        {t(
          "Autorize os servidores que os workspaces podem usar como APIs compatíveis com OpenAI. Informe um endereço por linha, com protocolo e porta.",
        )}
      </p>
      <p className="muted">
        {t(
          "Exemplos: http://127.0.0.1:1234 para LM Studio nesta máquina ou http://192.168.3.50:1234 para outra máquina da rede. O modelo e a chave são configurados pelo proprietário em Configurações → Inteligência artificial.",
        )}
      </p>
      <p className="muted">
        {t(
          "Autorize somente destinos confiáveis: as perguntas e os dados autorizados do workspace serão enviados a esses servidores. Remover um destino bloqueia novas consultas que usem esse endpoint.",
        )}
      </p>
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
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const result = await api<{ origins: string[] }>(
              "/platform/ai/endpoints",
              {
                origins: value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              },
              "PUT",
            );
            setValue(result.origins.join("\n"));
            setNotice(t("Endpoints permitidos atualizados."));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t("Endereços permitidos")}
          <textarea
            rows={6}
            value={value}
            disabled={!loaded || busy}
            onChange={(e) => setValue(e.target.value)}
            placeholder={"http://127.0.0.1:1234\nhttps://llm.suaempresa.com"}
          />
        </label>
        <button className="primary" disabled={!loaded || busy}>
          {t("Salvar configuração")}
        </button>
      </form>
    </section>
  );
}
