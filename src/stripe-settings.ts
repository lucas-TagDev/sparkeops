import Stripe from "stripe";
import { APIError } from "./store.ts";
import type { Platform, Principal } from "./platform.ts";
import type { AISettings } from "./ai-settings.ts";
import type { PlatformAdministration } from "./platform-admin.ts";
import type { Billing, BillingConfig } from "./billing.ts";
type Row = {
  token: string;
  secret: string;
  enabled: number;
  tested: number;
  merchant: string | null;
};
export class StripeSettings {
  platform: Platform;
  vault: AISettings;
  access: PlatformAdministration;
  billing: Billing;
  fallback: BillingConfig;
  fetcher: typeof fetch;
  constructor(
    platform: Platform,
    vault: AISettings,
    access: PlatformAdministration,
    billing: Billing,
    fetcher: typeof fetch = fetch,
  ) {
    this.platform = platform;
    this.vault = vault;
    this.access = access;
    this.billing = billing;
    this.fetcher = fetcher;
    this.fallback = { ...billing.config };
    platform.store.db.exec(
      "CREATE TABLE IF NOT EXISTS payment_credentials(provider TEXT PRIMARY KEY,token TEXT NOT NULL,secret TEXT NOT NULL,enabled INTEGER NOT NULL,tested INTEGER NOT NULL,merchant TEXT)",
    );
    this.apply();
  }
  private row() {
    return this.platform.store.db
      .prepare("SELECT * FROM payment_credentials WHERE provider='stripe'")
      .get() as Row | undefined;
  }
  private credentials() {
    const row = this.row();
    return row
      ? {
          key: this.vault.reveal("platform-billing", "stripe-key", row.token),
          webhookSecret: this.vault.reveal(
            "platform-billing",
            "stripe-webhook",
            row.secret,
          ),
        }
      : this.fallback;
  }
  private apply() {
    const row = this.row();
    const credentials = this.credentials();
    this.billing.config = {
      ...this.fallback,
      ...credentials,
      enabled: row ? !!row.enabled && !!row.tested : this.fallback.enabled,
    };
    this.billing.stripe = credentials.key
      ? new Stripe(credentials.key)
      : undefined;
  }
  metadata(p: Principal) {
    this.access.authorize(p);
    const row = this.row();
    return {
      enabled: row
        ? !!row.enabled
        : this.fallback.enabled !== false && !!this.fallback.key,
      hasToken: !!(row?.token || this.fallback.key),
      hasSecret: !!(row?.secret || this.fallback.webhookSecret),
      tested: !!row?.tested,
      ready: this.billing.configured(),
      source: row ? "panel" : "environment",
      webhookUrl: this.fallback.origin + "/api/billing/webhook",
      publicHttps: this.fallback.origin.startsWith("https://"),
      account: row?.merchant ?? null,
    };
  }
  save(p: Principal, data: Record<string, unknown>) {
    this.access.authorize(p);
    if (typeof data.enabled !== "boolean")
      throw new APIError(400, "Configuração Stripe inválida.");
    const key = String(data.token ?? "").trim(),
      secret = String(data.secret ?? "").trim();
    if (
      (key && !/^(sk|rk)_(test|live)_[A-Za-z0-9]{12,300}$/.test(key)) ||
      (secret && !/^whsec_[A-Za-z0-9]{12,300}$/.test(secret))
    )
      throw new APIError(
        400,
        "Informe uma chave secreta Stripe e o segredo whsec_ do webhook válidos.",
      );
    const old = this.row(),
      credentials = this.credentials();
    const finalKey = key || credentials.key,
      finalSecret = secret || credentials.webhookSecret;
    if (!finalKey || !finalSecret)
      throw new APIError(
        400,
        "Informe a chave secreta Stripe e o segredo do webhook.",
      );
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          "INSERT INTO payment_credentials VALUES ('stripe',?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET token=excluded.token,secret=excluded.secret,enabled=excluded.enabled,tested=excluded.tested,merchant=excluded.merchant",
        )
        .run(
          this.vault.protect("platform-billing", "stripe-key", finalKey),
          this.vault.protect("platform-billing", "stripe-webhook", finalSecret),
          data.enabled ? 1 : 0,
          key ? 0 : (old?.tested ?? 0),
          key ? null : (old?.merchant ?? null),
        );
      this.platform.audit(p, "platform.payment.updated", "stripe");
    });
    this.apply();
    return this.metadata(p);
  }
  async test(p: Principal) {
    this.access.authorize(p);
    const row = this.row();
    if (!row)
      throw new APIError(
        400,
        "Salve as credenciais Stripe antes de verificar.",
      );
    let account: { id?: string };
    try {
      const response = await this.fetcher("https://api.stripe.com/v1/account", {
        headers: { Authorization: "Bearer " + this.credentials().key },
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("rejected");
      account = (await response.json()) as typeof account;
      if (!account.id || !/^acct_[A-Za-z0-9]+$/.test(account.id))
        throw new Error("invalid");
    } catch {
      this.platform.store.db
        .prepare(
          "UPDATE payment_credentials SET tested=0 WHERE provider='stripe' AND token=?",
        )
        .run(row.token);
      this.apply();
      throw new APIError(
        502,
        "Não foi possível verificar a credencial Stripe. Confira a chave e as permissões da conta.",
      );
    }
    const changed = this.platform.store.db
      .prepare(
        "UPDATE payment_credentials SET tested=1,merchant=? WHERE provider='stripe' AND token=? AND secret=?",
      )
      .run(account.id, row.token, row.secret).changes;
    if (!changed)
      throw new APIError(
        409,
        "Credenciais alteradas durante a verificação. Verifique novamente.",
      );
    this.platform.audit(p, "platform.payment.tested", "stripe");
    this.apply();
    return this.metadata(p);
  }
}
