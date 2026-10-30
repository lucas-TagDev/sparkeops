import { useEffect, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
export type StripeMetadata = {
  enabled: boolean;
  hasToken: boolean;
  hasSecret: boolean;
  tested: boolean;
  publicHttps: boolean;
  ready: boolean;
  webhookUrl: string;
};
export function StripeSettingsPanel() {
  const [data, setData] = useState<StripeMetadata | null>(null),
    [token, setToken] = useState(""),
    [secret, setSecret] = useState(""),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    let active = true;
    void api<StripeMetadata>("/platform/payments/stripe")
      .then((result) => {
        if (active) {
          setData(result);
          setEnabled(result.enabled);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (test = false) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<StripeMetadata>(
        "/platform/payments/stripe" + (test ? "/test" : ""),
        test ? {} : { token, secret, enabled },
        test ? "POST" : "PUT",
      );
      setData(result);
      setToken("");
      setSecret("");
      setEnabled(result.enabled);
      setDirty(false);
      setNotice(
        t(
          test
            ? "Credencial Stripe verificada. Configure também os eventos do webhook."
            : "Configuração de pagamento salva.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel padded plan-editor">
      <h2>
        <CreditCard size={18} />
        {t("Stripe")}
      </h2>
      <p className="muted">
        {t(
          "Configure a conta que receberá os pagamentos das assinaturas da plataforma.",
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
      {data && (
        <>
          <span className="tag">
            {t(
              data.ready
                ? "Disponível para contratação"
                : data.tested
                  ? "Credencial verificada"
                  : "Configuração pendente",
            )}
          </span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <div className="plan-form-grid">
              <label>
                Chave secreta Stripe
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={1000}
                  value={token}
                  placeholder={t(
                    data.hasToken
                      ? "Credencial salva. Deixe em branco para manter."
                      : "Informe o Chave secreta Stripe",
                  )}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                {t("Chave de assinatura do webhook")}
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={1000}
                  value={secret}
                  placeholder={t(
                    data.hasSecret
                      ? "Credencial salva. Deixe em branco para manter."
                      : "Informe whsec_...",
                  )}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            </div>
            <label className="plan-enabled">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked);
                  setDirty(true);
                }}
              />
              {t("Habilitar novas assinaturas pelo Stripe")}
            </label>
            <div className="platform-row-actions">
              <button className="primary" disabled={busy}>
                {t("Salvar credenciais")}
              </button>
              <button
                type="button"
                disabled={busy || dirty || !data.hasToken || !data.hasSecret}
                onClick={() => void run(true)}
              >
                {t("Verificar credencial")}
              </button>
            </div>
          </form>
          <p className="muted">
            {t(
              "As credenciais são protegidas e não são exibidas novamente. Desabilitar a opção bloqueia novas contratações; as notificações das assinaturas existentes continuam sendo processadas.",
            )}
          </p>
          <h3>{t("Confirmação dos pagamentos")}</h3>
          <p>
            {t(
              "Cadastre esta URL como endpoint de webhook no Stripe e copie o segredo de assinatura whsec_ para o campo acima.",
            )}
          </p>
          <input
            className="payment-webhook-url"
            readOnly
            aria-label={t("URL do webhook")}
            value={data.webhookUrl}
            onFocus={(e) => e.target.select()}
          />
          <p className="muted">
            {t("Selecione estes eventos no webhook:")}{" "}
            <code>customer.subscription.created</code>,{" "}
            <code>customer.subscription.updated</code>,{" "}
            <code>customer.subscription.deleted</code>.
          </p>
          {!data.publicHttps && (
            <p className="banner info">
              {t(
                "O endereço atual é local. Para receber confirmações de pagamento, publique a plataforma em um endereço HTTPS acessível pela internet.",
              )}
            </p>
          )}
          <p className="muted">
            {t(
              "Depois de verificar a credencial, publique os preços na aba Planos e preços para disponibilizar a contratação pelo Stripe. A verificação da chave não valida a entrega do webhook.",
            )}
          </p>
          <a
            href="https://dashboard.stripe.com/apikeys"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Abrir chaves do Stripe")} <ExternalLink size={13} />
          </a>
        </>
      )}
    </section>
  );
}
