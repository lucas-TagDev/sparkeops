import { randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import type { Platform, Principal } from "./platform.ts";
import { defaultBranding } from "../shared/branding.ts";
type Asset = { mime: string; data: string };
type Stored = {
  name: string;
  primaryColor: string;
  logo: Asset | null;
  favicon: Asset | null;
  revision: string;
};
export class BrandingSettings {
  platform: Platform;
  admins: Set<string>;
  constructor(platform: Platform, admins: string[] = []) {
    this.platform = platform;
    this.admins = new Set(
      admins.map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    platform.store.db.exec(
      "CREATE TABLE IF NOT EXISTS platform_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
  }
  canManage(p: Principal) {
    return (
      this.admins.has(p.email.toLowerCase()) &&
      ["owner", "admin"].includes(p.role)
    );
  }
  authorize(p: Principal) {
    if (!this.canManage(p))
      throw new APIError(
        403,
        "Somente o administrador da plataforma pode alterar a identidade visual.",
      );
  }
  stored(): Stored {
    const row = this.platform.store.db
      .prepare("SELECT value FROM platform_settings WHERE key='branding'")
      .get();
    return row
      ? JSON.parse(String(row.value))
      : { ...defaultBranding, logo: null, favicon: null };
  }
  public() {
    const value = this.stored();
    return {
      ...value,
      logo: value.logo ? "/branding/logo?v=" + value.revision : null,
      favicon: value.favicon ? "/branding/favicon?v=" + value.revision : null,
    };
  }
  asset(kind: "logo" | "favicon") {
    return this.stored()[kind];
  }
  validateAsset(value: unknown, kind: "logo" | "favicon"): Asset | null {
    if (value === null) return null;
    if (typeof value !== "string" || value.length > 710000)
      throw new APIError(400, "A imagem deve ter no máximo 512 KB.");
    const match = value.match(
      /^data:(image\/(?:png|jpeg|webp|x-icon));base64,([A-Za-z0-9+/]+={0,2})$/,
    );
    if (!match)
      throw new APIError(
        400,
        "Use imagens PNG, JPEG ou WebP; favicon também aceita ICO.",
      );
    const bytes = Buffer.from(match[2], "base64"),
      mime = match[1];
    const png =
      bytes.length >= 33 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.subarray(12, 16).toString() === "IHDR";
    const jpeg =
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255;
    const webp =
      bytes.length >= 16 &&
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP";
    const ico =
      bytes.length >= 22 &&
      bytes.readUInt16LE(0) === 0 &&
      bytes.readUInt16LE(2) === 1 &&
      bytes.readUInt16LE(4) > 0;
    if (
      bytes.length > 524288 ||
      !bytes.length ||
      (mime === "image/png" && !png) ||
      (mime === "image/jpeg" && !jpeg) ||
      (mime === "image/webp" && !webp) ||
      (mime === "image/x-icon" && (!ico || kind !== "favicon"))
    )
      throw new APIError(
        400,
        "O conteúdo da imagem não corresponde ao formato informado.",
      );
    if (
      png &&
      (bytes.readUInt32BE(16) < 1 ||
        bytes.readUInt32BE(16) > 4096 ||
        bytes.readUInt32BE(20) < 1 ||
        bytes.readUInt32BE(20) > 4096)
    )
      throw new APIError(400, "A imagem deve ter até 4096 pixels por lado.");
    return { mime, data: bytes.toString("base64") };
  }
  save(p: Principal, input: Record<string, unknown>) {
    this.authorize(p);
    if (
      typeof input.name !== "string" ||
      input.name.trim().length < 2 ||
      input.name.trim().length > 60 ||
      /[\x00-\x1f\x7f<>]/.test(input.name) ||
      typeof input.primaryColor !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(input.primaryColor)
    )
      throw new APIError(
        400,
        "Informe um nome de 2 a 60 caracteres e uma cor hexadecimal válida.",
      );
    const current = this.stored(),
      next: Stored = {
        name: input.name.trim(),
        primaryColor: input.primaryColor.toLowerCase(),
        logo:
          input.logo === undefined
            ? current.logo
            : this.validateAsset(input.logo, "logo"),
        favicon:
          input.favicon === undefined
            ? current.favicon
            : this.validateAsset(input.favicon, "favicon"),
        revision: randomUUID(),
      };
    this.platform.store.db
      .prepare(
        "INSERT INTO platform_settings VALUES ('branding',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(next));
    this.platform.audit(p, "platform.branding.updated");
    return this.public();
  }
  reset(p: Principal) {
    this.authorize(p);
    this.platform.store.db
      .prepare("DELETE FROM platform_settings WHERE key='branding'")
      .run();
    this.platform.audit(p, "platform.branding.reset");
    return this.public();
  }
}
