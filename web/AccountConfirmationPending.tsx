import { useState } from "react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
import { useCaptcha } from "./TurnstileWidget.tsx";
export function AccountConfirmationPending({
  email: initialEmail,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const captcha = useCaptcha("signup");
  return (
    <div className="loading">
      <section className="panel padded" style={{ width: "min(480px,90vw)" }}>
        <h2>{t("Confirme sua conta")}</h2>
        <p>
          {t(
            "Confira sua caixa de entrada e a pasta de spam. Abra o link de confirmação para liberar o acesso. O link é válido por 30 minutos.",
          )}
        </p>
        <p className="muted">
          {t("Não recebeu o e-mail? Você pode solicitar um novo link abaixo.")}
        </p>
        {error && (
          <p role="alert" className="banner error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="banner success">
            {message}
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!captcha.canSubmit) return;
            setBusy(true);
            setError("");
            try {
              const result = await api<{ message: string }>(
                "/api/auth/resend-confirmation",
                { email, captcha_token: captcha.token },
              );
              setMessage(t(result.message));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
              captcha.reset();
            }
          }}
        >
          <label>
            {t("E-mail")}
            <input
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {captcha.element}
          <button className="primary" disabled={busy || !captcha.canSubmit}>
            {t("Reenviar confirmação de conta")}
          </button>
        </form>
        <button type="button" className="text-button" onClick={onBack}>
          {t("Voltar para entrar")}
        </button>
      </section>
    </div>
  );
}
