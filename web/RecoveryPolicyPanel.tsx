import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
type Policy = {
  max_attempts: number;
  allow_config_repairs: boolean;
  can_manage: boolean;
  repeat_enabled: boolean;
  repeat_minutes: number;
};
export function RecoveryPolicyPanel() {
  const [allowConfig, setAllowConfig] = useState(false);
  const [repeat, setRepeat] = useState(false),
    [minutes, setMinutes] = useState(15);
  const [policy, setPolicy] = useState<Policy | null>(null),
    [value, setValue] = useState(5),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    void api<Policy>("/recovery-policy")
      .then((p) => {
        setPolicy(p);
        setValue(p.max_attempts);
        setAllowConfig(p.allow_config_repairs);
        setRepeat(p.repeat_enabled);
        setMinutes(p.repeat_minutes);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel padded">
      <h2>{t("Correção automática de serviços")}</h2>
      <p className="muted">
        {t(
          "Defina quantas tentativas sequenciais podem ocorrer por incidente nos serviços com Correção imediata habilitada. A sequência para quando recuperar; não há intervalo obrigatório nem limite diário.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {policy && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const updated = await api<Policy>(
                "/recovery-policy",
                {
                  max_attempts: value,
                  repeat_enabled: repeat,
                  repeat_minutes: minutes,
                  allow_config_repairs: allowConfig,
                },
                "PUT",
              );
              setPolicy(updated);
              setNotice(t("Limite de tentativas atualizado."));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {t("Máximo de tentativas por incidente")}
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              required
              value={value}
              disabled={busy || !policy.can_manage}
              onChange={(e) => setValue(Number(e.target.value))}
            />
          </label>
          <p className="muted">
            {t(
              "Escolha de 1 a 20 tentativas. Apenas o proprietário pode alterar. Aumentos valem para novas sequências; reduções também limitam as próximas etapas de uma sequência em andamento.",
            )}
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={repeat}
              disabled={busy || !policy.can_manage}
              onChange={(e) => setRepeat(e.target.checked)}
            />
            {t("Aguardar entre tentativas")}
          </label>
          <p className="muted">
            {t(
              "Desmarcado: executa as tentativas em sequência. Marcado: aguarda o intervalo escolhido entre elas, respeitando o máximo por incidente.",
            )}
          </p>
          {repeat && (
            <>
              <label>
                {t("Repetir a cada (minutos)")}
                <input
                  type="number"
                  min={1}
                  max={1440}
                  required
                  step={1}
                  value={minutes}
                  disabled={busy || !policy.can_manage}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
              <div className="banner info" role="note">
                {t(
                  "Repetições e novas análises podem aumentar os custos com solicitações de IA no seu provedor. O consumo continua sujeito à franquia de IA da conta.",
                )}
              </div>
            </>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={allowConfig}
              disabled={busy || !policy.can_manage}
              onChange={(e) => setAllowConfig(e.target.checked)}
            />
            {t("Permitir ajustes automáticos de configuração suportados")}
          </label>
          <p className="muted">
            {t(
              "Autoriza parâmetros numéricos suportados de Nginx, Apache, PHP-FPM e MySQL, com backup, teste e restauração quando houver falha. Não autoriza arquivos arbitrários, comandos livres ou alterações em outros serviços.",
            )}
          </p>
          <p className="muted">
            {t(
              "Com IA configurada, cada tentativa investiga a causa antes de agir e pode consumir uma nova solicitação de IA. Sem IA, a recuperação permanece no modo simples de reinício.",
            )}
          </p>
          {policy.can_manage ? (
            <button
              className="primary"
              disabled={
                busy ||
                (value === policy.max_attempts &&
                  repeat === policy.repeat_enabled &&
                  minutes === policy.repeat_minutes &&
                  allowConfig === policy.allow_config_repairs)
              }
            >
              {t("Salvar configuração")}
            </button>
          ) : (
            <p className="muted">
              {t("O proprietário do workspace define este limite.")}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
