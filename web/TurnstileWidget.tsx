import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { t, getLanguage } from "./i18n.ts";
type CaptchaSettings = {
  enabled: boolean;
  siteKey: string;
  forms: Record<string, boolean>;
};
type TurnstileAPI = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}
let loading: Promise<TurnstileAPI> | undefined;
function loadAPI() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading)
    loading = new Promise<TurnstileAPI>((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      const timer = setTimeout(() => {
        script.remove();
        reject(new Error("timeout"));
      }, 15000);
      script.onload = () => {
        clearTimeout(timer);
        if (window.turnstile) resolve(window.turnstile);
        else {
          script.remove();
          reject(new Error("unavailable"));
        }
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error("unavailable"));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      loading = undefined;
      throw error;
    });
  return loading;
}
export function TurnstileWidget({
  siteKey,
  action,
  onToken,
  resetKey = 0,
}: {
  siteKey: string;
  action: string;
  onToken: (token: string) => void;
  resetKey?: number;
}) {
  const element = useRef<HTMLDivElement>(null),
    callback = useRef(onToken);
  callback.current = onToken;
  const [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const language = getLanguage();
  useEffect(() => {
    let cancelled = false,
      id: string | undefined;
    setError("");
    callback.current("");
    void loadAPI()
      .then((turnstile) => {
        if (cancelled || !element.current) return;
        id = turnstile.render(element.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          size: "flexible",
          language: language === "pt-BR" ? "pt-br" : language,
          "response-field": false,
          callback: (token: string) => callback.current(token),
          "expired-callback": () => callback.current(""),
          "error-callback": () => {
            callback.current("");
            setError(
              t("Não foi possível carregar a verificação de segurança."),
            );
            return true;
          },
          "timeout-callback": () => {
            callback.current("");
            setError(t("A verificação de segurança expirou. Tente novamente."));
          },
        });
      })
      .catch(() => {
        if (!cancelled)
          setError(t("Não foi possível carregar a verificação de segurança."));
      });
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, action, resetKey, attempt, language]);
  return (
    <div className="captcha-field">
      <div ref={element} />
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("Tentar novamente")}
          </button>
        </p>
      )}
    </div>
  );
}
export function useCaptcha(action: string | null) {
  const [settings, setSettings] = useState<CaptchaSettings | null>(null),
    [error, setError] = useState(""),
    [token, setToken] = useState(""),
    [resetKey, setResetKey] = useState(0),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    setSettings(null);
    void api<CaptchaSettings>("/api/auth/captcha")
      .then((result) => {
        if (active) setSettings(result);
      })
      .catch(() => {
        if (active)
          setError(t("Não foi possível carregar a configuração de segurança."));
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const required = !!(action && settings?.enabled && settings.forms[action]);
  const reset = () => {
    setToken("");
    setResetKey((value) => value + 1);
    setRetry((value) => value + 1);
  };
  return {
    token,
    canSubmit: !action || (!!settings && (!required || !!token)),
    reset,
    element: action ? (
      <>
        {error && (
          <p className="banner error" role="alert">
            {error}{" "}
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Tentar novamente")}
            </button>
          </p>
        )}
        {!settings && !error && (
          <p className="muted" role="status">
            {t("Carregando proteção de segurança…")}
          </p>
        )}
        {required && (
          <TurnstileWidget
            siteKey={settings!.siteKey}
            action={action}
            onToken={setToken}
            resetKey={resetKey}
          />
        )}
      </>
    ) : null,
  };
}
