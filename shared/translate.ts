import { catalog } from "../web/locales/catalog.ts";
import { languageOf } from "./language.ts";
export function translate(value: string, locale: unknown) {
  const language = languageOf(locale);
  if (language === "pt-BR") return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (catalog[normalized]) return catalog[normalized][language];
  for (const [key, text] of Object.entries(catalog)) {
    if (!key.includes("{{")) continue;
    const expression = key
      .split(/(\{\{\d+\}\})/)
      .map((piece) =>
        /^\{\{\d+\}\}$/.test(piece)
          ? "([\\s\\S]*?)"
          : piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    const found = normalized.match(new RegExp("^" + expression + "$"));
    if (found)
      return text[language].replace(
        /\{\{(\d+)\}\}/g,
        (_, index) => found[Number(index) + 1],
      );
  }
  return value;
}
