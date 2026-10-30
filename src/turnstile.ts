import { APIError } from "./store.ts";
import { hash, now, type Platform, type Principal } from "./platform.ts";
import type { AISettings } from "./ai-settings.ts";
import type { PlatformAdministration } from "./platform-admin.ts";
export type CaptchaAction =
  "login" | "signup" | "forgot_password" | "reset_password" | "settings_test";
type Row = {
  site_key: string;
  secret: string;
  enabled: number;
  login: number;
  registration: number;
  password_reset: number;
};
export class Turnstile {
  platform: Platform;
  vault: AISettings;
  access: PlatformAdministration;
  hostname: string;
  fetcher: typeof fetch;
  constructor(
    platform: Platform,
    vault: AISettings,
    access: PlatformAdministration,
    origin: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.platform = platform;
    this.vault = vault;
    this.access = access;
    this.hostname = new URL(origin).hostname.toLowerCase();
    this.fetcher = fetcher;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS turnstile_settings(id INTEGER PRIMARY KEY CHECK(id=1),site_key TEXT NOT NULL,secret TEXT NOT NULL,enabled INTEGER NOT NULL,login INTEGER NOT NULL,registration INTEGER NOT NULL,password_reset INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS captcha_used_tokens(hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS captcha_tokens_expiry ON captcha_used_tokens(expires_at);`);
  }
  private row() {
    return this.platform.store.db
      .prepare("SELECT * FROM turnstile_settings WHERE id=1")
      .get() as Row | undefined;
  }
  publicSettings() {
    const row = this.row();
    return {
      enabled: !!row?.enabled,
      siteKey: row?.enabled ? row.site_key : "",
      forms: {
        login: !!row?.login,
        signup: !!row?.registration,
        forgot_password: !!row?.password_reset,
        reset_password: !!row?.password_reset,
      },
    };
  }
  metadata(p: Principal) {
    this.access.authorize(p);
    const row = this.row();
    return {
      ...this.publicSettings(),
      siteKey: row?.site_key ?? "",
      hasSecret: !!row?.secret,
      hostname: this.hostname,
    };
  }
  save(p: Principal, data: Record<string, unknown>) {
    this.access.authorize(p);
    for (const key of ["enabled", "login", "registration", "password_reset"])
      if (typeof data[key] !== "boolean")
        throw new APIError(400, "Configuração do CAPTCHA inválida.");
    const siteKey = String(data.siteKey ?? "").trim(),
      secret = String(data.secret ?? "").trim();
    if (
      (siteKey && !/^[A-Za-z0-9_-]{3,100}$/.test(siteKey)) ||
      (secret && !/^[A-Za-z0-9_-]{3,200}$/.test(secret))
    )
      throw new APIError(400, "Chaves do Turnstile inválidas.");
    const old = this.row();
    if (old?.site_key && siteKey !== old.site_key && !secret)
      throw new APIError(
        400,
        "Ao trocar a Site Key, informe também a Secret Key correspondente.",
      );
    const encrypted = secret
      ? this.vault.protect("platform-security", "turnstile-secret", secret)
      : (old?.secret ?? "");
    if (data.enabled && (!siteKey || !encrypted))
      throw new APIError(
        400,
        "Informe a Site Key e a Secret Key antes de habilitar o CAPTCHA.",
      );
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          "INSERT INTO turnstile_settings VALUES (1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET site_key=excluded.site_key,secret=excluded.secret,enabled=excluded.enabled,login=excluded.login,registration=excluded.registration,password_reset=excluded.password_reset",
        )
        .run(
          siteKey,
          encrypted,
          data.enabled ? 1 : 0,
          data.login ? 1 : 0,
          data.registration ? 1 : 0,
          data.password_reset ? 1 : 0,
        );
      this.platform.audit(p, "platform.security.turnstile.updated");
    });
    return this.metadata(p);
  }
  async verify(
    action: CaptchaAction,
    token: unknown,
    remoteip?: string,
    force = false,
  ) {
    const row = this.row();
    const field =
      action === "login"
        ? "login"
        : action === "signup"
          ? "registration"
          : "password_reset";
    if (!force && (!row?.enabled || !row[field])) return;
    if (!row?.site_key || !row.secret)
      throw new APIError(
        503,
        "CAPTCHA indisponível. Contate o administrador da plataforma.",
      );
    if (typeof token !== "string" || !token.trim() || token.length > 2048)
      throw new APIError(400, "Conclua a verificação de segurança.");
    this.platform.store.db
      .prepare("DELETE FROM captcha_used_tokens WHERE expires_at<?")
      .run(now());
    if (
      this.platform.store.db
        .prepare("SELECT 1 FROM captcha_used_tokens WHERE hash=?")
        .get(hash(token))
    )
      throw new APIError(
        400,
        "Verificação expirada ou já utilizada. Tente novamente.",
      );
    let result: Record<string, unknown>;
    try {
      const response = await this.fetcher(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: this.vault.reveal(
              "platform-security",
              "turnstile-secret",
              row.secret,
            ),
            response: token,
            ...(remoteip ? { remoteip } : {}),
          }),
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error("unavailable");
      result = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new APIError(
        503,
        "Não foi possível validar o CAPTCHA. Tente novamente.",
      );
    }
    const challenged = Date.parse(String(result.challenge_ts ?? "")) / 1000;
    if (
      result.success !== true ||
      result.hostname !== this.hostname ||
      result.action !== action ||
      !Number.isFinite(challenged) ||
      challenged < now() - 300 ||
      challenged > now() + 30
    )
      throw new APIError(
        400,
        "Verificação de segurança inválida ou expirada. Tente novamente.",
      );
    const current = this.row();
    if (current?.secret !== row.secret || current?.site_key !== row.site_key)
      throw new APIError(
        409,
        "A configuração de segurança mudou. Atualize a página.",
      );
    const inserted = this.platform.store.db
      .prepare("INSERT OR IGNORE INTO captcha_used_tokens VALUES (?,?)")
      .run(hash(token), now() + 300);
    if (!inserted.changes)
      throw new APIError(
        400,
        "Verificação expirada ou já utilizada. Tente novamente.",
      );
  }
}
