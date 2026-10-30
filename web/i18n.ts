import { useSyncExternalStore } from "react";
import {
  languageOf,
  detectLanguage,
  type Language,
} from "../shared/language.ts";
import { catalog } from "./locales/catalog.ts";
import { translate } from "../shared/translate.ts";
let language: Language = detectLanguage(navigator.language);
try {
  const stored = localStorage.getItem("foxops-language");
  if (stored) language = languageOf(stored);
} catch {}
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export function setLanguage(value: Language) {
  if (language === value) return;
  language = value;
  document.documentElement.lang = value;
  try {
    localStorage.setItem("foxops-language", value);
  } catch {}
  listeners.forEach((fn) => fn());
}
export const useLanguage = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getLanguage,
    getLanguage,
  );
export function t(
  value: string | TemplateStringsArray,
  ...parameters: unknown[]
): string {
  const key =
    typeof value === "string"
      ? value
      : value
          .map(
            (piece, i) =>
              piece + (i < parameters.length ? "{{" + i + "}}" : ""),
          )
          .join("");
  const translation =
    language === "pt-BR"
      ? key
      : (catalog[key.replace(/\s+/g, " ").trim()]?.[language] ?? key);
  return typeof value === "string"
    ? translate(value, language)
    : translation.replace(/\{\{(\d+)\}\}/g, (_, i) =>
        String(parameters[Number(i)]),
      );
}
document.documentElement.lang = language;
