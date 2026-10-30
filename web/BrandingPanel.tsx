import { useState } from "react";
import { Palette } from "lucide-react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
import { applyBranding, useBranding } from "./branding.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
import { brandingTextColor, type Branding } from "../shared/branding.ts";

export function BrandingPanel() {
  const current = useBranding();
  const [name, setName] = useState(current.name),
    [color, setColor] = useState(current.primaryColor),
    [logo, setLogo] = useState<string | null | undefined>(undefined),
    [favicon, setFavicon] = useState<string | null | undefined>(undefined),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const previewLogo = logo === undefined ? current.logo : logo,
    previewFavicon = favicon === undefined ? current.favicon : favicon;
  const read = async (file: File | undefined, kind: "logo" | "favicon") => {
    if (!file) return;
    setError("");
    setNotice("");
    if (file.size > 524288) {
      setError(t("A imagem deve ter no máximo 512 KB."));
      return;
    }
    const type =
      file.type === "image/vnd.microsoft.icon" ? "image/x-icon" : file.type;
    if (
      !(
        kind === "favicon"
          ? ["image/png", "image/jpeg", "image/webp", "image/x-icon"]
          : ["image/png", "image/jpeg", "image/webp"]
      ).includes(type)
    ) {
      setError(t("Use imagens PNG, JPEG ou WebP; favicon também aceita ICO."));
      return;
    }
    setBusy(true);
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(
            String(reader.result).replace(
              /^data:image\/vnd.microsoft.icon;/,
              "data:image/x-icon;",
            ),
          );
        reader.onerror = () => reject(new Error());
        reader.readAsDataURL(file);
      });
      if (kind === "logo") setLogo(url);
      else setFavicon(url);
    } catch {
      setError(t("Não foi possível ler a imagem."));
    } finally {
      setBusy(false);
    }
  };
  const sync = (value: Branding) => {
    applyBranding(value);
    setName(value.name);
    setColor(value.primaryColor);
    setLogo(undefined);
    setFavicon(undefined);
  };
  return (
    <section className="panel branding-panel">
      <div className="panel-head">
        <h2>
          <Palette size={18} />
          {t("Identidade visual da plataforma")}
        </h2>
        <span className="tag">{t("Administrador da plataforma")}</span>
      </div>
      <div className="branding-body">
        <p>
          {t(
            "Estas configurações são globais: alteram a tela de login e o painel de todos os clientes.",
          )}
        </p>
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="ai-message" role="status">
            {notice}
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              !(await confirmAction(
                t(
                  "Aplicar esta identidade visual para todos os clientes da plataforma?",
                ),
              ))
            )
              return;
            setBusy(true);
            setError("");
            setNotice("");
            try {
              sync(
                await api<Branding>(
                  "/platform/branding",
                  { name, primaryColor: color, logo, favicon },
                  "PUT",
                ),
              );
              setNotice(t("Identidade visual salva."));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="rules-grid">
            <label>
              {t("Nome da plataforma")}
              <input
                aria-label={t("Nome da plataforma")}
                value={name}
                minLength={2}
                maxLength={60}
                required
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              {t("Cor principal")}
              <div className="branding-color">
                <input
                  aria-label={t("Escolher cor principal")}
                  type="color"
                  value={color}
                  disabled={busy}
                  onChange={(e) => setColor(e.target.value)}
                />
                <code>{color}</code>
              </div>
            </label>
          </div>
          <div className="rules-grid">
            <label>
              {t("Logo da plataforma")}
              <input
                aria-label={t("Enviar logo")}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  void read(e.target.files?.[0], "logo");
                  e.target.value = "";
                }}
              />
              {previewLogo && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setLogo(null)}
                >
                  {t("Remover logo personalizada")}
                </button>
              )}
            </label>
            <label>
              {t("Ícone da aba (favicon)")}
              <input
                aria-label={t("Enviar favicon")}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico"
                disabled={busy}
                onChange={(e) => {
                  void read(e.target.files?.[0], "favicon");
                  e.target.value = "";
                }}
              />
              {previewFavicon && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setFavicon(null)}
                >
                  {t("Remover favicon personalizado")}
                </button>
              )}
            </label>
          </div>
          <p className="muted">
            {t(
              "PNG, JPEG ou WebP, até 512 KB por imagem. Favicon também aceita ICO. SVG e URLs externas não são aceitos.",
            )}
          </p>
          <div className="branding-preview">
            <small>{t("Prévia antes de salvar")}</small>
            <div className="branding-preview-header">
              {previewLogo && (
                <img src={previewLogo} alt={t("Prévia da logo")} />
              )}
              <strong>{name || t("Nome da plataforma")}</strong>
            </div>
            <div className="branding-preview-tab">
              {previewFavicon && (
                <img src={previewFavicon} alt={t("Prévia do favicon")} />
              )}
              <span>
                {name} · {t("Monitoramento Linux")}
              </span>
            </div>
            <span
              className="branding-preview-button"
              style={{ background: color, color: brandingTextColor(color) }}
            >
              {t("Exemplo de botão")}
            </span>
          </div>
          <div className="action-row">
            <button className="primary" disabled={busy}>
              {busy ? t("Salvando…") : t("Salvar identidade visual")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                if (
                  !(await confirmAction(
                    t(
                      "Restaurar o nome, a logo, o favicon e a cor padrão da plataforma?",
                    ),
                  ))
                )
                  return;
                setBusy(true);
                setError("");
                try {
                  sync(
                    await api<Branding>(
                      "/platform/branding",
                      undefined,
                      "DELETE",
                    ),
                  );
                  setNotice(t("Identidade visual restaurada."));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("Restaurar padrão")}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
