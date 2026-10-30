export const languages = ["pt-BR", "en", "es"] as const;
export type Language = (typeof languages)[number];
export const detectLanguage = (value: string): Language =>
  value.toLowerCase().startsWith("en")
    ? "en"
    : value.toLowerCase().startsWith("es")
      ? "es"
      : "pt-BR";
export const languageOf = (value: unknown): Language =>
  value === "en" || value === "es" || value === "pt-BR" ? value : "pt-BR";
export const languageInstruction = (value: unknown) =>
  `Respond in ${languageOf(value) === "en" ? "English" : languageOf(value) === "es" ? "Spanish" : "Brazilian Portuguese"}. Translate explanations, not commands, file paths, JSON keys, service identifiers or technical evidence.`;
