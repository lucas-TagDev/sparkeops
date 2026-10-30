import { useState } from "react";
import { Globe } from "lucide-react";
import { getLanguage, setLanguage, t, useLanguage } from "./i18n.ts";
import type { Language } from "../shared/language.ts";
export function LanguagePicker() {
  const language = useLanguage(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="language-picker">
      <Globe size={15} />
      <select
        aria-label={t("Idioma da interface")}
        value={language}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.value as Language,
            previous = getLanguage();
          setError("");
          setBusy(true);
          try {
            const response = await fetch("/api/v1/me/language", {
              method: "PUT",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ language: next }),
            });
            if (!response.ok && response.status !== 401) throw new Error();
            setLanguage(next);
          } catch {
            setLanguage(previous);
            setError(t("Não foi possível salvar o idioma."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="pt-BR">Português</option>
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
