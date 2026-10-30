import { StripeSettingsPanel } from "./StripeSettingsPanel.tsx";
import { useEffect, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
export type MercadoPagoMetadata = {
  enabled: boolean;
  hasToken: boolean;
  hasSecret: boolean;
  tested: boolean;
  publicHttps: boolean;
  ready: boolean;
  webhookUrl: string;
};
function MercadoPagoSettingsPanel() {
  const [data, setData] = useState<MercadoPagoMetadata | null>(null),
    [token, setToken] = useState(""),
    [secret, setSecret] = useState(""),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    let active = true;
    void api<MercadoPagoMetadata>("/platform/payments/mercadopago")
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
      const result = await api<MercadoPagoMetadata>(
        "/platform/payments/mercadopago" + (test ? "/test" : ""),
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
            ? "Credencial Mercado Pago verificada."
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
        {t("Mercado Pago")}
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
                Access Token
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={1000}
                  value={token}
                  placeholder={t(
                    data.hasToken
                      ? "Credencial salva. Deixe em branco para manter."
                      : "Informe o Access Token",
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
                      : "Informe a chave de assinatura",
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
              {t("Habilitar novas assinaturas pelo Mercado Pago")}
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
              "Cadastre esta URL nas notificações da sua integração Mercado Pago e copie a chave de assinatura para o campo acima.",
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
            {t("Selecione os eventos de pagamentos e de planos e assinaturas:")}{" "}
            <code>payment</code>, <code>subscription_preapproval</code>,{" "}
            <code>subscription_authorized_payment</code>.
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
              "Os planos em reais salvos no painel são usados nas novas assinaturas, com cobrança mensal ou anual. A ativação ocorre após a confirmação do pagamento.",
            )}
          </p>
          <a
            href="https://www.mercadopago.com.br/developers/panel/app"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Abrir integrações do Mercado Pago")} <ExternalLink size={13} />
          </a>
        </>
      )}
    </section>
  );
}

export function PaymentSettingsPanel() {
  const [provider, setProvider] = useState("stripe");
  return (
    <div>
      <div
        className="tabs operations-tabs"
        role="tablist"
        aria-label={t("Provedor de pagamento")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={provider === "stripe"}
          className={provider === "stripe" ? "active" : ""}
          onClick={() => setProvider("stripe")}
        >
          Stripe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={provider === "mercadopago"}
          className={provider === "mercadopago" ? "active" : ""}
          onClick={() => setProvider("mercadopago")}
        >
          Mercado Pago
        </button>
      </div>
      <div hidden={provider !== "stripe"}>
        <StripeSettingsPanel />
      </div>
      <div hidden={provider !== "mercadopago"}>
        <MercadoPagoSettingsPanel />
      </div>
    </div>
  );
}
