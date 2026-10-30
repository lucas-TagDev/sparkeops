import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import { Platform, now, type Principal } from "./platform.ts";
import { AISettings } from "./ai-settings.ts";
import { PlatformAdministration } from "./platform-admin.ts";
type Settings = {
  token: string;
  secret: string;
  enabled: number;
  tested: number;
  merchant: string | null;
};
type Subscription = {
  reference: string;
  tenant_id: string;
  plan_id: string;
  revision: number;
  amount: number;
  months: number;
  remote_id: string | null;
  url: string | null;
  status: string;
  created_at: number;
};
export const periodEnd = (date: string, months: number) => {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime()))
    throw new APIError(400, "Data de cobrança inválida.");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const end = new Date(d);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  d.setUTCDate(Math.min(day, end.getUTCDate()));
  return Math.floor(d.getTime() / 1000);
};
export class MercadoPagoBilling {
  platform: Platform;
  vault: AISettings;
  access: PlatformAdministration;
  origin: string;
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
    this.origin = new URL(origin).origin;
    this.fetcher = fetcher;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS payment_credentials(provider TEXT PRIMARY KEY,token TEXT NOT NULL,secret TEXT NOT NULL,enabled INTEGER NOT NULL,tested INTEGER NOT NULL,merchant TEXT);
 CREATE TABLE IF NOT EXISTS mp_subscriptions(reference TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,plan_id TEXT NOT NULL,revision INTEGER NOT NULL,amount INTEGER NOT NULL,months INTEGER NOT NULL,remote_id TEXT UNIQUE,url TEXT,status TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mp_invoices(id TEXT PRIMARY KEY,remote_id TEXT NOT NULL,payment_id TEXT NOT NULL UNIQUE,paid_until INTEGER NOT NULL,approved INTEGER NOT NULL);`);
  }
  private row() {
    return this.platform.store.db
      .prepare("SELECT * FROM payment_credentials WHERE provider='mercadopago'")
      .get() as Settings | undefined;
  }
  private credentials() {
    const row = this.row();
    if (!row) throw new APIError(503, "Mercado Pago não configurado.");
    return {
      ...row,
      token: this.vault.reveal("platform-billing", "mp-token", row.token),
      secret: this.vault.reveal("platform-billing", "mp-webhook", row.secret),
    };
  }
  publicHttps() {
    const url = new URL(this.origin);
    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)
    );
  }
  configured() {
    const row = this.row();
    return !!(row?.enabled && row.tested && this.publicHttps());
  }
  ready(id: string) {
    const plan = this.platform.catalog.get(id);
    return (
      this.configured() &&
      id !== "trial" &&
      plan.enabled &&
      plan.currency === "BRL" &&
      plan.amount !== null &&
      plan.amount > 0
    );
  }
  metadata(p: Principal) {
    this.access.authorize(p);
    const row = this.row();
    return {
      enabled: !!row?.enabled,
      hasToken: !!row?.token,
      hasSecret: !!row?.secret,
      tested: !!row?.tested,
      publicHttps: this.publicHttps(),
      ready: this.configured(),
      webhookUrl: this.origin + "/api/billing/mercadopago/webhook",
    };
  }
  save(p: Principal, data: Record<string, unknown>) {
    this.access.authorize(p);
    if (typeof data.enabled !== "boolean")
      throw new APIError(400, "Configuração de pagamento inválida.");
    const previous = this.row();
    const token = String(data.token ?? "").trim(),
      secret = String(data.secret ?? "").trim();
    if (
      (token &&
        (token.length < 10 || token.length > 1000 || /\s/.test(token))) ||
      (secret &&
        (secret.length < 16 || secret.length > 1000 || /\s/.test(secret)))
    )
      throw new APIError(400, "Credenciais de pagamento inválidas.");
    const encryptedToken = token
        ? this.vault.protect("platform-billing", "mp-token", token)
        : previous?.token,
      encryptedSecret = secret
        ? this.vault.protect("platform-billing", "mp-webhook", secret)
        : previous?.secret;
    if (!encryptedToken || !encryptedSecret)
      throw new APIError(
        400,
        "Informe o Access Token e a chave de assinatura do webhook.",
      );
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          "INSERT INTO payment_credentials VALUES ('mercadopago',?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET token=excluded.token,secret=excluded.secret,enabled=excluded.enabled,tested=excluded.tested",
        )
        .run(
          encryptedToken,
          encryptedSecret,
          data.enabled ? 1 : 0,
          token ? 0 : (previous?.tested ?? 0),
          previous?.merchant ?? null,
        );
      this.platform.audit(p, "platform.payment.updated", "mercadopago");
    });
    return this.metadata(p);
  }
  private async api(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    let response: Response;
    try {
      response = await this.fetcher("https://api.mercadopago.com" + path, {
        method,
        headers: {
          Authorization: "Bearer " + this.credentials().token,
          "Content-Type": "application/json",
          ...(key ? { "X-Idempotency-Key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
    } catch {
      throw new APIError(
        502,
        "Não foi possível conectar ao Mercado Pago. Tente novamente.",
      );
    }
    if (!response.ok)
      throw new APIError(
        response.status === 401 || response.status === 403 ? 400 : 502,
        "O Mercado Pago recusou a solicitação. Verifique as credenciais e a configuração.",
      );
    return await response.json();
  }
  async test(p: Principal) {
    this.access.authorize(p);
    const snapshot = this.row(),
      user = await this.api("/users/me");
    if (!user.id || user.site_id !== "MLB")
      throw new APIError(400, "Utilize uma conta Mercado Pago do Brasil.");
    if (snapshot?.merchant && snapshot.merchant !== String(user.id))
      throw new APIError(
        409,
        "A integração já está vinculada a outra conta Mercado Pago.",
      );
    this.platform.store.db
      .prepare(
        "UPDATE payment_credentials SET tested=1,merchant=? WHERE provider='mercadopago' AND token=?",
      )
      .run(String(user.id), snapshot!.token);
    this.platform.audit(p, "platform.payment.tested", "mercadopago");
    return this.metadata(p);
  }
  async checkout(p: Principal, id: unknown, revision: unknown) {
    this.platform.requireRole(p, ["owner"]);
    if (typeof id !== "string" || !this.ready(id))
      throw new APIError(
        503,
        "Este plano não está disponível no Mercado Pago.",
      );
    const plan = this.platform.catalog.get(id);
    if (revision !== plan.revision)
      throw new APIError(
        409,
        "O plano foi atualizado. Recarregue a lista antes de contratar.",
      );
    const account = this.platform.account(p),
      tenant = this.platform.store.db
        .prepare("SELECT subscription_id FROM tenants WHERE id=?")
        .get(p.tenantId)!;
    if (
      tenant.subscription_id &&
      (["active", "past_due", "unpaid", "incomplete"].includes(
        account.subscription_status,
      ) ||
        (account.billing_until ?? 0) > now())
    )
      throw new APIError(
        409,
        "Gerencie sua assinatura existente antes de contratar outro plano.",
      );
    if (
      account.url_monitor_count > (plan.urlMonitors ?? 0) ||
      account.server_count > plan.servers ||
      this.platform.organizations(p).length > plan.organizations
    )
      throw new APIError(409, "Este plano não comporta o uso atual da conta.");
    let record = this.platform.store.db
      .prepare(
        "SELECT * FROM mp_subscriptions WHERE tenant_id=? AND status IN ('creating','pending','authorized') ORDER BY created_at DESC LIMIT 1",
      )
      .get(p.tenantId) as Subscription | undefined;
    if (record && (record.plan_id !== id || record.revision !== plan.revision))
      throw new APIError(
        409,
        "Existe uma assinatura pendente. Cancele-a antes de escolher outro plano.",
      );
    if (record?.url) return { url: record.url };
    if (!record) {
      record = {
        reference: randomUUID(),
        tenant_id: p.tenantId,
        plan_id: id,
        revision: plan.revision,
        amount: plan.amount!,
        months: plan.interval === "year" ? 12 : 1,
        remote_id: null,
        url: null,
        status: "creating",
        created_at: now(),
      };
      this.platform.store.db
        .prepare("INSERT INTO mp_subscriptions VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(
          record.reference,
          record.tenant_id,
          record.plan_id,
          record.revision,
          record.amount,
          record.months,
          null,
          null,
          "creating",
          record.created_at,
        );
    }
    const result = await this.api(
      "/preapproval",
      "POST",
      {
        reason: plan.name,
        external_reference: record.reference,
        payer_email: p.email,
        auto_recurring: {
          frequency: record.months,
          frequency_type: "months",
          transaction_amount: record.amount / 100,
          currency_id: "BRL",
        },
        back_url: this.origin + "/?page=billing",
        status: "pending",
      },
      record.reference,
    );
    const url = new URL(String(result.init_point));
    if (
      !result.id ||
      url.protocol !== "https:" ||
      !(
        url.hostname === "www.mercadopago.com.br" ||
        url.hostname.endsWith(".mercadopago.com.br")
      )
    )
      throw new APIError(502, "Resposta de pagamento inválida.");
    this.platform.store.db
      .prepare(
        "UPDATE mp_subscriptions SET remote_id=?,url=?,status='pending' WHERE reference=?",
      )
      .run(String(result.id), url.href, record.reference);
    this.platform.audit(p, "billing.checkout", "mercadopago:" + id);
    return { url: url.href };
  }
  private signature(id: string, request: string, signature: string) {
    const parts = Object.fromEntries(
      signature.split(",").map((x) => x.trim().split("=")),
    );
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
      !request ||
      request.length > 200 ||
      !/^\d{10,16}$/.test(parts.ts ?? "") ||
      !/^[a-f0-9]{64}$/i.test(parts.v1 ?? "")
    )
      throw new APIError(401, "Assinatura do webhook inválida.");
    const expected = createHmac("sha256", this.credentials().secret)
      .update(`id:${id.toLowerCase()};request-id:${request};ts:${parts.ts};`)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(parts.v1, "hex")))
      throw new APIError(401, "Assinatura do webhook inválida.");
  }
  private async subscription(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw new APIError(400, "Assinatura inválida.");
    const remote = await this.api("/preapproval/" + encodeURIComponent(id));
    const record = this.platform.store.db
      .prepare("SELECT * FROM mp_subscriptions WHERE reference=?")
      .get(String(remote.external_reference)) as Subscription | undefined;
    if (!record) return null;
    if (
      (record.remote_id && record.remote_id !== id) ||
      String(remote.id) !== id ||
      String(remote.collector_id) !== this.row()?.merchant ||
      remote.auto_recurring?.currency_id !== "BRL" ||
      Math.round(Number(remote.auto_recurring?.transaction_amount) * 100) !==
        record.amount ||
      remote.auto_recurring?.frequency_type !== "months" ||
      remote.auto_recurring?.frequency !== record.months
    )
      throw new APIError(
        409,
        "A cobrança recebida não corresponde à assinatura cadastrada.",
      );
    this.platform.store.db
      .prepare(
        "UPDATE mp_subscriptions SET remote_id=?,status=? WHERE reference=?",
      )
      .run(id, String(remote.status), record.reference);
    return { ...record, remote_id: id, status: String(remote.status) };
  }
  async webhook(
    queryId: string,
    requestId: string,
    signature: string,
    body: Record<string, unknown>,
  ) {
    this.signature(queryId, requestId, signature);
    const bodyId = String(
      (body.data as { id?: unknown } | undefined)?.id ?? "",
    );
    if (bodyId && bodyId.toLowerCase() !== queryId.toLowerCase())
      throw new APIError(400, "Identificador de notificação inválido.");
    const topic = String(body.type ?? "");
    if (topic === "subscription_preapproval") {
      const record = await this.subscription(queryId);
      if (record && ["cancelled", "paused"].includes(record.status))
        this.platform.store.db
          .prepare(
            "UPDATE tenants SET subscription_status=? WHERE id=? AND billing_provider='mercadopago' AND subscription_id=?",
          )
          .run(
            record.status === "cancelled" ? "canceled" : "past_due",
            record.tenant_id,
            record.remote_id,
          );
      return;
    }
    if (!["subscription_authorized_payment", "payment"].includes(topic)) return;
    let invoiceId = queryId;
    if (topic === "payment") {
      const search = await this.api(
        "/authorized_payments/search?payment_id=" + encodeURIComponent(queryId),
      );
      const found = search.results?.find(
        (r: { id: unknown; payment?: { id: unknown } }) =>
          String(r.payment?.id) === queryId,
      );
      if (!found) return;
      invoiceId = String(found.id);
    }
    const invoice = await this.api(
      "/authorized_payments/" + encodeURIComponent(invoiceId),
    );
    if (
      String(invoice.id) !== invoiceId ||
      (topic === "payment" && String(invoice.payment?.id) !== queryId) ||
      !invoice.preapproval_id
    )
      return;
    const record = await this.subscription(String(invoice.preapproval_id));
    if (!record) return;
    if (
      invoice.currency_id !== "BRL" ||
      Math.round(Number(invoice.transaction_amount) * 100) !== record.amount ||
      !invoice.payment?.id
    )
      return;
    const payment = await this.api(
      "/v1/payments/" + encodeURIComponent(String(invoice.payment.id)),
    );
    if (
      String(payment.id) !== String(invoice.payment.id) ||
      String(payment.collector_id) !== this.row()?.merchant ||
      payment.currency_id !== "BRL" ||
      Math.round(Number(payment.transaction_amount) * 100) !== record.amount
    )
      throw new APIError(
        409,
        "A cobrança recebida não corresponde à assinatura cadastrada.",
      );
    const approved =
      payment.status === "approved" &&
      !Number(payment.transaction_amount_refunded ?? 0);
    const until = periodEnd(String(invoice.debit_date), record.months);
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          "INSERT INTO mp_invoices VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET approved=excluded.approved",
        )
        .run(
          invoiceId,
          record.remote_id,
          String(payment.id),
          until,
          approved ? 1 : 0,
        );
      const paidUntil = Number(
        this.platform.store.db
          .prepare(
            "SELECT coalesce(max(paid_until),0) AS n FROM mp_invoices WHERE remote_id=? AND approved=1",
          )
          .get(record.remote_id)!.n,
      );
      const current = this.platform.store.db
        .prepare(
          "SELECT subscription_id,billing_provider,subscription_status,billing_until FROM tenants WHERE id=?",
        )
        .get(record.tenant_id)!;
      if (
        current.subscription_id &&
        current.subscription_id !== record.remote_id &&
        (["active", "past_due", "unpaid", "incomplete"].includes(
          String(current.subscription_status),
        ) ||
          Number(current.billing_until ?? 0) > now())
      )
        return;
      if (!approved && current.billing_provider !== "mercadopago") return;
      this.platform.store.db
        .prepare(
          "UPDATE tenants SET plan=?,subscription_id=?,subscription_status=?,billing_provider=?,billing_until=?,billing_event_at=? WHERE id=?",
        )
        .run(
          record.plan_id,
          record.remote_id,
          paidUntil > now()
            ? record.status === "cancelled"
              ? "canceled"
              : "active"
            : "past_due",
          "mercadopago",
          paidUntil,
          now(),
          record.tenant_id,
        );
    });
  }
  async cancel(p: Principal) {
    this.platform.requireRole(p, ["owner"]);
    const tenant = this.platform.store.db
      .prepare(
        "SELECT subscription_id,billing_provider,subscription_status,billing_until FROM tenants WHERE id=?",
      )
      .get(p.tenantId)!;
    const record = (
      tenant.billing_provider === "mercadopago"
        ? this.platform.store.db
            .prepare(
              "SELECT * FROM mp_subscriptions WHERE remote_id=? AND tenant_id=?",
            )
            .get(tenant.subscription_id, p.tenantId)
        : this.platform.store.db
            .prepare(
              "SELECT * FROM mp_subscriptions WHERE tenant_id=? AND status IN ('pending','authorized') ORDER BY created_at DESC LIMIT 1",
            )
            .get(p.tenantId)
    ) as Subscription | undefined;
    if (!record?.remote_id)
      throw new APIError(
        409,
        "Nenhuma assinatura Mercado Pago disponível para cancelar.",
      );
    await this.api(
      "/preapproval/" + encodeURIComponent(record.remote_id),
      "PUT",
      { status: "cancelled" },
    );
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          "UPDATE mp_subscriptions SET status='cancelled' WHERE reference=?",
        )
        .run(record.reference);
      this.platform.store.db
        .prepare(
          "UPDATE tenants SET subscription_status='canceled' WHERE id=? AND billing_provider='mercadopago' AND subscription_id=?",
        )
        .run(p.tenantId, record.remote_id);
      this.platform.audit(p, "billing.subscription.canceled", "mercadopago");
    });
    return { ok: true };
  }
  pending(p: Principal) {
    return !!this.platform.store.db
      .prepare(
        "SELECT 1 FROM mp_subscriptions WHERE tenant_id=? AND status IN ('creating','pending','authorized')",
      )
      .get(p.tenantId);
  }
}
