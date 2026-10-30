import { useEffect, useState } from "react";
import { api, stamp } from "./api.ts";
import { t } from "./i18n.ts";
type Settings = {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  from: string;
  has_password: boolean;
  origin: string;
  delivery?: { pending: number; failed: number; last_sent_at: number | null };
};
export function PlatformEmailPanel() {
  const [data, setData] = useState<Settings | null>(null),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    void api<Settings>("/platform/email")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel padded">
      <h2>{t("E-mails da plataforma")}</h2>
      <p className="muted">
        {t(
          "Configure o remetente usado na recuperação de senha, confirmação de e-mail e avisos de segurança. Esta configuração atende todas as organizações.",
        )}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setData(
                await api<Settings>(
                  "/platform/email",
                  { ...data, password: password || undefined },
                  "PUT",
                ),
              );
              setPassword("");
              setMessage(t("Configuração salva."));
            });
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={data.enabled}
              onChange={(e) => setData({ ...data, enabled: e.target.checked })}
            />{" "}
            {t("Habilitar envio de e-mails da plataforma")}
          </label>
          <div className="platform-admin-form">
            <label>
              {t("Servidor SMTP")}
              <input
                required
                value={data.host}
                onChange={(e) => setData({ ...data, host: e.target.value })}
              />
            </label>
            <label>
              {t("Porta e segurança")}
              <select
                value={data.port}
                onChange={(e) =>
                  setData({ ...data, port: Number(e.target.value) })
                }
              >
                <option value={587}>587 — STARTTLS</option>
                <option value={465}>465 — TLS</option>
              </select>
            </label>
            <label>
              {t("Usuário SMTP")}
              <input
                required
                autoComplete="off"
                value={data.user}
                onChange={(e) => setData({ ...data, user: e.target.value })}
              />
            </label>
            <label>
              {t("Senha SMTP")}
              <input
                type="password"
                autoComplete="new-password"
                required={!data.has_password}
                placeholder={
                  data.has_password
                    ? t("Deixe vazio para manter a senha atual")
                    : ""
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              {t("E-mail remetente")}
              <input
                type="email"
                required
                value={data.from}
                onChange={(e) => setData({ ...data, from: e.target.value })}
              />
            </label>
          </div>
          <p className="muted">
            {t("Os links usam o endereço público da plataforma")}: {data.origin}
            . {t("Use um remetente autorizado pelo provedor SMTP.")}
          </p>
          <div className="platform-row-actions">
            <button className="primary" disabled={busy}>
              {t("Salvar configuração")}
            </button>
            <button
              type="button"
              disabled={busy || !data.enabled || !data.has_password}
              onClick={() =>
                void run(async () => {
                  await api("/platform/email/test", {});
                  setMessage(
                    t(
                      "E-mail de teste enviado para sua conta de administrador.",
                    ),
                  );
                })
              }
            >
              {t("Enviar teste para meu e-mail")}
            </button>
          </div>
          <p className="muted">
            {t("Pendentes")}: {data.delivery?.pending ?? 0} · {t("Falhas")}:{" "}
            {data.delivery?.failed ?? 0} · {t("Último envio")}:{" "}
            {data.delivery?.last_sent_at
              ? stamp(data.delivery.last_sent_at)
              : "—"}
          </p>
        </form>
      )}
    </section>
  );
}
export function ChangeEmailPanel({ email }: { email: string }) {
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel padded">
      <h2>{t("E-mail da minha conta")}</h2>
      <p>{email}</p>
      <p className="muted">
        {t(
          "A alteração só será concluída após confirmar o link no novo endereço. Suas sessões serão encerradas.",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          setError("");
          try {
            await api("/me/email", Object.fromEntries(new FormData(form)));
            form.reset();
            setMessage(t("Confira o novo e-mail para confirmar a alteração."));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="platform-admin-form">
          <label>
            {t("Novo e-mail")}
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            {t("Senha atual")}
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button disabled={busy}>{t("Enviar confirmação")}</button>
      </form>
    </section>
  );
}
export function AccountRecovery({
  kind,
  token,
  onBack,
}: {
  kind: "forgot" | "reset" | "confirm-email";
  token?: string;
  onBack: () => void;
}) {
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="loading">
      <section className="panel padded" style={{ width: "min(480px,90vw)" }}>
        <h2>
          {t(
            kind === "forgot"
              ? "Recuperar senha"
              : kind === "reset"
                ? "Definir nova senha"
                : "Confirmar novo e-mail",
          )}
        </h2>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message ? (
          <p role="status">{message}</p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              if (kind === "reset" && data.password !== data.repeat) {
                setError(t("As senhas não coincidem."));
                return;
              }
              setBusy(true);
              setError("");
              try {
                await api(
                  "/api/auth/" +
                    (kind === "forgot"
                      ? "forgot-password"
                      : kind === "reset"
                        ? "reset-password"
                        : "confirm-email"),
                  { ...data, token },
                );
                setMessage(
                  t(
                    kind === "forgot"
                      ? "Se houver uma conta ativa para este e-mail, enviaremos as instruções de recuperação."
                      : kind === "reset"
                        ? "Senha redefinida. Entre com sua nova senha."
                        : "E-mail confirmado. Entre com seu novo endereço.",
                  ),
                );
                if (kind !== "forgot") history.replaceState(null, "", "/");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {kind === "forgot" && (
              <label>
                {t("E-mail")}
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                />
              </label>
            )}
            {kind === "reset" && (
              <>
                <label>
                  {t("Nova senha")}
                  <input
                    type="password"
                    name="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  {t("Confirmar senha")}
                  <input
                    type="password"
                    name="repeat"
                    required
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}
            <p className="muted">
              {t(
                kind === "confirm-email"
                  ? "Confirme para concluir a alteração do endereço da sua conta."
                  : "O link é válido por 30 minutos e pode ser usado uma única vez.",
              )}
            </p>
            <button className="primary" disabled={busy}>
              {t(
                busy
                  ? "Aguarde…"
                  : kind === "forgot"
                    ? "Enviar instruções"
                    : kind === "reset"
                      ? "Salvar nova senha"
                      : "Confirmar e-mail",
              )}
            </button>
          </form>
        )}
        <button onClick={onBack}>{t("Voltar para entrar")}</button>
      </section>
    </div>
  );
}

export function ChangePasswordPanel() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <section className="panel padded">
      <h2>{t("Alterar minha senha")}</h2>
      <p className="muted">
        {t(
          "Informe sua senha atual e escolha uma nova senha de 12 a 128 caracteres. As outras sessões serão encerradas e os tokens MCP revogados.",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            data = Object.fromEntries(new FormData(form));
          setError("");
          setMessage("");
          if (data.password !== data.confirm_password) {
            setError(t("As senhas não coincidem."));
            return;
          }
          setBusy(true);
          try {
            await api("/me/password", data);
            form.reset();
            setMessage(
              t(
                "Senha alterada com sucesso. Sua sessão atual permanece conectada.",
              ),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="platform-admin-form">
          <label>
            {t("Senha atual")}
            <input
              type="password"
              name="current_password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <label>
            {t("Nova senha")}
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <label>
            {t("Confirmar senha")}
            <input
              type="password"
              name="confirm_password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button className="primary" disabled={busy}>
          {t(busy ? "Aguarde…" : "Alterar senha")}
        </button>
      </form>
    </section>
  );
}
