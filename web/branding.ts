import { useSyncExternalStore } from "react";
import {
  defaultBranding,
  brandingTextColor,
  type Branding,
} from "../shared/branding.ts";
import { t } from "./i18n.ts";
let current: Branding = defaultBranding;
const listeners = new Set<() => void>();
export const useBranding = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => current,
    () => current,
  );
export function applyBranding(value: Branding) {
  current = value;
  document.documentElement.style.setProperty("--green", value.primaryColor);
  document.documentElement.style.setProperty(
    "--brand-button-text",
    brandingTextColor(value.primaryColor),
  );
  document.title = value.name + " · " + t("Monitoramento Linux");
  const theme = document.querySelector('meta[name="theme-color"]');
  theme?.setAttribute("content", value.primaryColor);
  const description = document.querySelector('meta[name="description"]');
  description?.setAttribute(
    "content",
    value.name + " — " + t("Monitoramento Linux"),
  );
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    document.head.append(icon);
  }
  icon.href =
    value.favicon ??
    "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#f5a368" d="M4 3 13 9 19 9 28 3 26 21 16 29 6 21Z"/><path fill="#14171d" d="m8 14 8 5 8-5-3 8H11Z"/></svg>',
      );
  listeners.forEach((fn) => fn());
}
export async function loadBranding() {
  const response = await fetch("/api/branding", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(t("Não foi possível carregar a identidade visual."));
  const value = (await response.json()) as Branding;
  applyBranding(value);
  return value;
}
export function updateBrandingDocument() {
  applyBranding(current);
}
