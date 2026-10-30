import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
import { TurnstileWidget } from "./TurnstileWidget.tsx";
type Settings = {
  enabled: boolean;
  siteKey: string;
  hasSecret: boolean;
  hostname: string;
  forms: Record<string, boolean>;
};
export function TurnstileSettingsPanel() {
  const [data, setData] = useState<Settings | null>(null),
    [siteKey, setSiteKey] = useState(""),
    [secret, setSecret] = useState(""),
    [enabled, setEnabled] = useState(false),
    [login, setLogin] = useState(true),
    [registration, setRegistration] = useState(true),
    [passwordReset, setPasswordReset] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(false),
    [token, setToken] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    void api<Settings>("/platform/security/turnstile")
      .then((result) => {
        setData(result);
        setSiteKey(result.siteKey);
        setEnabled(result.enabled);
        if (result.hasSecret) {
          setLogin(result.forms.login);
          setRegistration(result.forms.signup);
          setPasswordReset(result.forms.reset_password);
        }
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel padded plan-editor">
      <h2>Cloudflare Turnstile</h2>
      <p className="muted">
        {t(
          "Proteja os formulários públicos contra robôs. A validação é feita no navegador e no servidor.",
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
          <p>
            {t("Domínio da plataforma:")} <strong>{data.hostname}</strong>
          </p>
          <p className="muted">
            {t(
              "Crie um widget Turnstile na Cloudflare, autorize o domínio acima e informe as chaves. Salve e teste a configuração antes de habilitar a proteção.",
            )}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = await api<Settings>(
                  "/platform/security/turnstile",
                  {
                    siteKey,
                    secret,
                    enabled,
                    login,
                    registration,
                    password_reset: passwordReset,
                  },
                  "PUT",
                );
                setData(result);
                setSecret("");
                setDirty(false);
                setPreview(false);
                setNotice(t("Configuração do CAPTCHA salva."));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="plan-form-grid">
              <label>
                Site Key
                <input
                  value={siteKey}
                  maxLength={100}
                  disabled={busy}
                  onChange={(e) => {
                    setSiteKey(e.target.value);
                    setDirty(true);
                    setPreview(false);
                  }}
                  autoComplete="off"
                />
              </label>
              <label>
                Secret Key
                <input
                  type="password"
                  value={secret}
                  maxLength={200}
                  disabled={busy}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    setDirty(true);
                    setPreview(false);
                  }}
                  autoComplete="new-password"
                  placeholder={
                    data.hasSecret
                      ? t("Credencial salva. Deixe em branco para manter.")
                      : t("Informe a Secret Key")
                  }
                />
              </label>
            </div>
            <label className="plan-enabled">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(e) => {
                  setEnabled(e.target.checked);
                  setDirty(true);
                }}
              />
              {t("Habilitar proteção Turnstile")}
            </label>
            <h3>{t("Formulários protegidos")}</h3>
            <label className="plan-enabled">
              <input
                type="checkbox"
                checked={registration}
                disabled={busy}
                onChange={(e) => {
                  setRegistration(e.target.checked);
                  setDirty(true);
                }}
              />
              {t("Cadastro e aceite de convites")}
            </label>
            <label className="plan-enabled">
              <input
                type="checkbox"
                checked={login}
                disabled={busy}
                onChange={(e) => {
                  setLogin(e.target.checked);
                  setDirty(true);
                }}
              />
              {t("Login")}
            </label>
            <label className="plan-enabled">
              <input
                type="checkbox"
                checked={passwordReset}
                disabled={busy}
                onChange={(e) => {
                  setPasswordReset(e.target.checked);
                  setDirty(true);
                }}
              />
              {t("Solicitação e redefinição de senha")}
            </label>
            <div className="platform-row-actions">
              <button className="primary" disabled={busy}>
                {t("Salvar configuração")}
              </button>
              <button
                type="button"
                disabled={busy || dirty || !data.siteKey || !data.hasSecret}
                onClick={() => {
                  setPreview(true);
                  setToken("");
                  setRevision((value) => value + 1);
                  setNotice("");
                }}
              >
                {t("Testar configuração salva")}
              </button>
            </div>
          </form>
          {preview && !dirty && (
            <div className="panel padded">
              <TurnstileWidget
                siteKey={data.siteKey}
                action="settings_test"
                onToken={setToken}
                resetKey={revision}
              />
              <button
                className="secondary"
                disabled={busy || !token}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api("/platform/security/turnstile/test", {
                      captcha_token: token,
                    });
                    setNotice(
                      t(
                        "Verificação concluída. As chaves e o domínio responderam corretamente.",
                      ),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                    setToken("");
                    setRevision((value) => value + 1);
                  }
                }}
              >
                {t("Validar teste no servidor")}
              </button>
            </div>
          )}
          <p className="muted">
            {t(
              "A Secret Key fica criptografada e não é exibida após salvar. Quando habilitado, o formulário bloqueia o envio se a verificação estiver indisponível.",
            )}
          </p>
          <a
            href="https://dash.cloudflare.com/?to=/:account/turnstile"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Abrir Turnstile na Cloudflare")}
          </a>
        </>
      )}
    </section>
  );
}
