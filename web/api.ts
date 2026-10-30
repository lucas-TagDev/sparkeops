import { getLanguage, setLanguage, t } from "./i18n.ts";
export async function api<T = unknown>(
  path: string,
  data?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(
    path.startsWith("/api/") ? path : "/api/v1" + path,
    {
      method: method ?? (data === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      headers: {
        "Accept-Language": getLanguage(),
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
  );
  const result = await response.json();
  if (path === "/me" && response.ok) {
    if (result.user?.language) setLanguage(result.user.language);
    else {
      void fetch("/api/v1/me/language", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: getLanguage() }),
      });
    }
  }
  if (!response.ok)
    throw new Error(
      t(result.error ?? "Não foi possível concluir a solicitação."),
    );
  return result as T;
}
export const stamp = (value: number | null | undefined) =>
  value
    ? new Date(value * 1000).toLocaleString(getLanguage(), {
        dateStyle: "short",
        timeStyle: "short",
      })
    : t("Sem coleta");
export const pct = (value?: number | null) =>
  value == null
    ? "—"
    : `${value.toLocaleString(getLanguage(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const stampSeconds = (value: number | null | undefined) =>
  value == null
    ? t("Sem coleta")
    : new Date(value * 1000).toLocaleString(getLanguage(), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
export const roleName: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  operator: "Operador",
  reader: "Leitor",
};
