import { AIEndpointPolicy } from "./ai-endpoints.ts";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { APIError } from "./store.ts";
import { now } from "./platform.ts";
import type { Platform, Principal } from "./platform.ts";
import { PROVIDERS, providerId, testProvider } from "./ai-providers.ts";
import type { Provider, Credentials } from "./ai-providers.ts";

export type VaultOptions = {
  masterKey?: Buffer;
  keyFile?: string;
  fetch?: typeof fetch;
};
type Row = {
  base_url: string | null;
  no_key: number;
  provider: Provider;
  model: string;
  encrypted_key: string;
  enabled: number;
  updated_at: number;
  tested_at: number | null;
  test_ok: number | null;
};
type Preference = {
  mode: "own" | "platform" | "off";
  provider: Provider | null;
};

export class AISettings {
  platform: Platform;
  options: VaultOptions;
  endpoints: AIEndpointPolicy;
  constructor(platform: Platform, options: VaultOptions = {}) {
    this.platform = platform;
    this.options = options;
    this.endpoints = new AIEndpointPolicy(platform);
    platform.store.db.exec(`CREATE TABLE IF NOT EXISTS ai_credentials (
      tenant_id TEXT NOT NULL REFERENCES tenants(id), provider TEXT NOT NULL, model TEXT NOT NULL,
      encrypted_key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
      tested_at INTEGER, test_ok INTEGER, PRIMARY KEY(tenant_id,provider));
      CREATE TABLE IF NOT EXISTS ai_preferences(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),mode TEXT NOT NULL,provider TEXT);`);
    const columns = platform.store.db
      .prepare("PRAGMA table_info(ai_credentials)")
      .all();
    if (!columns.some((column) => column.name === "base_url"))
      platform.store.db.exec(
        "ALTER TABLE ai_credentials ADD COLUMN base_url TEXT",
      );
    if (!columns.some((column) => column.name === "no_key"))
      platform.store.db.exec(
        "ALTER TABLE ai_credentials ADD COLUMN no_key INTEGER NOT NULL DEFAULT 0",
      );
  }
  private key(create = false) {
    if (this.options.masterKey) {
      if (this.options.masterKey.length !== 32)
        throw new APIError(
          503,
          "Proteção das chaves de IA não configurada corretamente.",
        );
      return this.options.masterKey;
    }
    const path = resolve(
      this.options.keyFile ??
        process.env.FOXOPS_AI_KEY_FILE ??
        ".secrets/ai-master.key",
    );
    if (!existsSync(path) && create) {
      if (
        (this.platform.store.db
          .prepare("SELECT 1 FROM sqlite_master WHERE name='public_dashboards'")
          .get() &&
          this.platform.store.db
            .prepare("SELECT 1 FROM public_dashboards LIMIT 1")
            .get()) ||
        (this.platform.store.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='turnstile_settings'",
          )
          .get() &&
          this.platform.store.db
            .prepare(
              "SELECT 1 FROM turnstile_settings WHERE secret<>'' LIMIT 1",
            )
            .get()) ||
        (this.platform.store.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='platform_email_config'",
          )
          .get() &&
          this.platform.store.db
            .prepare("SELECT 1 FROM platform_email_config LIMIT 1")
            .get()) ||
        (this.platform.store.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='notification_channels'",
          )
          .get() &&
          this.platform.store.db
            .prepare("SELECT 1 FROM notification_channels LIMIT 1")
            .get()) ||
        (this.platform.store.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='payment_credentials'",
          )
          .get() &&
          this.platform.store.db
            .prepare("SELECT 1 FROM payment_credentials LIMIT 1")
            .get()) ||
        this.platform.store.db
          .prepare("SELECT 1 FROM ai_credentials LIMIT 1")
          .get() ||
        (this.platform.store.db
          .prepare("SELECT 1 FROM sqlite_master WHERE name='ssh_connections'")
          .get() &&
          this.platform.store.db
            .prepare("SELECT 1 FROM ssh_connections LIMIT 1")
            .get())
      )
        throw new APIError(
          503,
          "Restaure o arquivo de proteção antes de cadastrar novas chaves.",
        );
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try {
        writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST")
          throw new APIError(
            503,
            "Não foi possível proteger a chave. Verifique as permissões de armazenamento.",
          );
      }
    }
    try {
      const key = readFileSync(path);
      if (key.length === 32) return key;
    } catch {
      /* Never regenerate a missing key when encrypted credentials exist. */
    }
    throw new APIError(
      503,
      "A chave de proteção da instalação não está disponível. Restaure o arquivo de proteção junto com o backup.",
    );
  }
  protect(tenant: string, purpose: string, value: string) {
    return this.seal(tenant, purpose, value);
  }
  reveal(tenant: string, purpose: string, value: string) {
    return this.unseal(tenant, purpose, value);
  }
  private seal(tenant: string, provider: string, value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(true), iv);
    cipher.setAAD(Buffer.from(`${tenant}:${provider}`));
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((b) => b.toString("base64"))
      .join(".");
  }
  private unseal(tenant: string, provider: string, value: string) {
    const key = this.key();
    try {
      const [iv, tag, encrypted] = value
        .split(".")
        .map((part) => Buffer.from(part, "base64"));
      const cipher = createDecipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(`${tenant}:${provider}`));
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString(
        "utf8",
      );
    } catch {
      throw new APIError(
        503,
        "Não foi possível abrir a credencial de IA. Verifique a chave de proteção ou cadastre a credencial novamente.",
      );
    }
  }
  private preference(tenant: string, platformAvailable: boolean): Preference {
    return (
      (this.platform.store.db
        .prepare("SELECT mode,provider FROM ai_preferences WHERE tenant_id=?")
        .get(tenant) as Preference | undefined) ?? {
        mode: platformAvailable ? "platform" : "off",
        provider: null,
      }
    );
  }
  private row(tenant: string, provider: Provider) {
    return this.platform.store.db
      .prepare("SELECT * FROM ai_credentials WHERE tenant_id=? AND provider=?")
      .get(tenant, provider) as Row | undefined;
  }
  status(p: Principal, platformAvailable: boolean) {
    const preference = this.preference(p.tenantId, platformAvailable);
    const credential = preference.provider
      ? this.row(p.tenantId, preference.provider)
      : undefined;
    return {
      ...preference,
      enabled:
        preference.mode === "platform"
          ? platformAvailable
          : preference.mode === "own" && !!credential?.enabled,
      provider: preference.mode === "platform" ? "openai" : preference.provider,
      model: preference.mode === "own" ? (credential?.model ?? null) : null,
      platform_available: platformAvailable,
    };
  }
  metadata(p: Principal, platformAvailable: boolean) {
    this.platform.requireRole(p, ["owner", "admin"]);
    return {
      status: this.status(p, platformAvailable),
      can_manage: p.role === "owner",
      providers: Object.entries(PROVIDERS).map(([id, info]) => {
        const row = this.row(p.tenantId, id as Provider);
        return {
          id,
          ...info,
          configured: !!row,
          enabled: !!row?.enabled,
          model: row?.model ?? "",
          base_url: row?.base_url ?? "",
          no_key: !!row?.no_key,
          updated_at: row?.updated_at ?? null,
          tested_at: row?.tested_at ?? null,
          test_ok:
            row?.test_ok === null || row?.test_ok === undefined
              ? null
              : !!row.test_ok,
        };
      }),
    };
  }
  save(p: Principal, id: string, data: Record<string, unknown>) {
    this.platform.requireRole(p, ["owner"]);
    const provider = providerId(id);
    if (
      typeof data.model !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,149}$/.test(data.model.trim())
    )
      throw new APIError(
        400,
        "Informe um identificador de modelo válido, com até 150 caracteres.",
      );
    if (typeof data.enabled !== "boolean")
      throw new APIError(400, "Informe se o provedor deve ficar habilitado.");
    const model = data.model
      .trim()
      .replace(provider === "gemini" ? /^models\// : /^$/, "");
    const existing = this.row(p.tenantId, provider);
    const baseUrl =
      provider === "compatible" ? this.endpoints.allowed(data.base_url) : null;
    const noKey = provider === "compatible" && data.no_key === true;
    if (
      provider === "compatible" &&
      (existing?.no_key || !existing) &&
      data.no_key === false &&
      !data.key
    )
      throw new APIError(
        400,
        "Informe a chave ou mantenha a opção sem chave habilitada.",
      );
    let encrypted = existing?.encrypted_key;
    if (data.key !== undefined && data.key !== "") {
      if (
        typeof data.key !== "string" ||
        data.key.trim().length < (provider === "compatible" ? 1 : 8) ||
        data.key.trim().length > 4096 ||
        /\s/.test(data.key.trim())
      )
        throw new APIError(
          400,
          "Informe uma chave de API válida, sem espaços.",
        );
      encrypted = this.seal(p.tenantId, provider, data.key.trim());
    }
    if (noKey || (provider === "compatible" && !encrypted && !data.key))
      encrypted = this.seal(p.tenantId, provider, "");
    if (!encrypted)
      throw new APIError(400, "Cadastre a chave de API deste provedor.");
    const preferenceExists = !!this.platform.store.db
      .prepare("SELECT 1 FROM ai_preferences WHERE tenant_id=?")
      .get(p.tenantId);
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          `INSERT INTO ai_credentials (tenant_id,provider,model,encrypted_key,enabled,updated_at,tested_at,test_ok,base_url,no_key) VALUES (?,?,?,?,?,?,NULL,NULL,?,?) ON CONFLICT(tenant_id,provider)
        DO UPDATE SET model=excluded.model,encrypted_key=excluded.encrypted_key,enabled=excluded.enabled,updated_at=excluded.updated_at,tested_at=NULL,test_ok=NULL,base_url=excluded.base_url,no_key=excluded.no_key`,
        )
        .run(
          p.tenantId,
          provider,
          model,
          encrypted!,
          data.enabled ? 1 : 0,
          now(),
          baseUrl,
          noKey || (provider === "compatible" && !existing && !data.key)
            ? 1
            : 0,
        );
      if (data.enabled && !preferenceExists)
        this.platform.store.db
          .prepare(
            "INSERT INTO ai_preferences VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET mode=excluded.mode,provider=excluded.provider",
          )
          .run(p.tenantId, "own", provider);
      this.platform.audit(p, "ai.provider.saved", provider);
    });
  }
  select(
    p: Principal,
    data: Record<string, unknown>,
    platformAvailable: boolean,
  ) {
    this.platform.requireRole(p, ["owner"]);
    if (!["own", "platform", "off"].includes(String(data.mode)))
      throw new APIError(400, "Modo de IA inválido.");
    let provider: Provider | null = null;
    if (data.mode === "own") {
      provider = providerId(String(data.provider));
      if (!this.row(p.tenantId, provider)?.enabled)
        throw new APIError(
          400,
          "Cadastre e habilite este provedor antes de selecioná-lo.",
        );
    }
    if (data.mode === "platform" && !platformAvailable)
      throw new APIError(
        400,
        "A IA da plataforma ainda não foi disponibilizada.",
      );
    this.platform.store.db
      .prepare(
        "INSERT INTO ai_preferences VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET mode=excluded.mode,provider=excluded.provider",
      )
      .run(p.tenantId, String(data.mode), provider);
    this.platform.audit(
      p,
      "ai.preference.updated",
      String(data.mode) + ":" + (provider ?? ""),
    );
  }
  remove(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner"]);
    const provider = providerId(id);
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare("DELETE FROM ai_credentials WHERE tenant_id=? AND provider=?")
        .run(p.tenantId, provider);
      this.platform.store.db
        .prepare(
          "UPDATE ai_preferences SET mode='off',provider=NULL WHERE tenant_id=? AND provider=?",
        )
        .run(p.tenantId, provider);
      this.platform.audit(p, "ai.provider.removed", provider);
    });
  }
  choices(p: Principal, platformAvailable: boolean) {
    return {
      providers: Object.entries(PROVIDERS).flatMap(([id, info]) => {
        const row = this.row(p.tenantId, id as Provider);
        return row?.enabled ? [{ id, name: info.name, model: row.model }] : [];
      }),
      platform_available: platformAvailable,
    };
  }
  resolveChoice(
    p: Principal,
    fallback: { key?: string; model?: string },
    choice: unknown,
  ) {
    if (choice === undefined || choice === "auto")
      return this.resolve(p, fallback);
    if (choice === "diagnostic") return null;
    if (choice === "platform") {
      if (!fallback.key || !fallback.model)
        throw new APIError(400, "IA selecionada indisponível.");
      return {
        provider: "openai" as Provider,
        key: fallback.key,
        model: fallback.model,
      };
    }
    const id = providerId(String(choice)),
      row = this.row(p.tenantId, id);
    if (!row?.enabled)
      throw new APIError(
        400,
        "IA selecionada indisponível. Configure e habilite o provedor nas configurações.",
      );
    return {
      ...(id === "compatible"
        ? { baseUrl: this.endpoints.allowed(row.base_url) }
        : {}),
      provider: id,
      model: row.model,
      key: this.unseal(p.tenantId, id, row.encrypted_key),
    };
  }
  resolve(
    p: Principal,
    fallback: { key?: string; model?: string },
  ): Credentials | null {
    const preference = this.preference(
      p.tenantId,
      !!(fallback.key && fallback.model),
    );
    if (preference.mode === "off") return null;
    if (preference.mode === "platform")
      return fallback.key && fallback.model
        ? { provider: "openai", key: fallback.key, model: fallback.model }
        : null;
    const row = preference.provider
      ? this.row(p.tenantId, preference.provider)
      : undefined;
    if (!row?.enabled) return null;
    return {
      ...(row.provider === "compatible"
        ? { baseUrl: this.endpoints.allowed(row.base_url) }
        : {}),
      provider: row.provider,
      model: row.model,
      key: this.unseal(p.tenantId, row.provider, row.encrypted_key),
    };
  }
  async test(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner"]);
    const provider = providerId(id);
    const row = this.row(p.tenantId, provider);
    if (!row)
      throw new APIError(400, "Salve a chave e o modelo antes de testar.");
    try {
      const result = await testProvider(
        {
          ...(provider === "compatible"
            ? { baseUrl: this.endpoints.allowed(row.base_url) }
            : {}),
          provider,
          model: row.model,
          key: this.unseal(p.tenantId, provider, row.encrypted_key),
        },
        this.options.fetch,
      );
      this.platform.store.db
        .prepare(
          "UPDATE ai_credentials SET tested_at=?,test_ok=1 WHERE tenant_id=? AND provider=? AND updated_at=? AND encrypted_key=?",
        )
        .run(now(), p.tenantId, provider, row.updated_at, row.encrypted_key);
      this.platform.audit(p, "ai.provider.tested", provider);
      return result;
    } catch (error) {
      this.platform.store.db
        .prepare(
          "UPDATE ai_credentials SET tested_at=?,test_ok=0 WHERE tenant_id=? AND provider=? AND encrypted_key=?",
        )
        .run(now(), p.tenantId, provider, row.encrypted_key);
      if (error instanceof APIError) throw error;
      throw new APIError(
        502,
        "Não foi possível testar a conexão com o provedor.",
      );
    }
  }
}
