import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { useLanguage } from "./i18n.ts";
import { LanguagePicker } from "./LanguagePicker.tsx";
import { loadBranding, updateBrandingDocument } from "./branding.ts";
import "./styles.css";
function LocalizedApp() {
  const language = useLanguage();
  useEffect(() => {
    void loadBranding().catch(() => {});
    const timer = setInterval(() => void loadBranding().catch(() => {}), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    updateBrandingDocument();
  }, [language]);
  return (
    <>
      <LanguagePicker />
      <App />
      <ConfirmDialog />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocalizedApp />
  </React.StrictMode>,
);
