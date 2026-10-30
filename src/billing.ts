import Stripe from "stripe";
import type { Platform, Principal, Plan } from "./platform.ts";

import { APIError } from "./store.ts";

export type BillingConfig = {
  enabled?: boolean;
  key?: string;
  webhookSecret?: string;
  prices?: Partial<Record<Plan, string>>;
  origin: string;
};
export class Billing {
  config: BillingConfig;
  stripe?: Stripe;
  constructor(config: BillingConfig) {
    this.config = config;
    if (config.key) this.stripe = new Stripe(config.key);
  }
  configured() {
    return (
      this.config.enabled !== false &&
      !!(this.stripe && this.config.webhookSecret)
    );
  }
  price(platform: Platform, id: string) {
    const plan = platform.catalog.get(id);
    return platform.catalog.matches(plan)
      ? plan.priceId
      : plan.amount === null && plan.legacyPriceAllowed
        ? this.config.prices?.[id]
        : undefined;
  }
  ready(plan?: string, platform?: Platform): boolean {
    if (!this.configured()) return false;
    if (!platform)
      return plan
        ? !!this.config.prices?.[plan]
        : Object.values(this.config.prices ?? {}).some(Boolean);
    if (!plan)
      return Object.keys(platform.catalog.all()).some(
        (id) => id !== "trial" && this.ready(id, platform),
      );
    const selected = platform.catalog.get(plan);
    return plan !== "trial" && selected.enabled && !!this.price(platform, plan);
  }
  management(platform: Platform) {
    return {
      paymentsConfigured: this.configured(),
      plans: Object.entries(platform.catalog.public()).map(([id, plan]) => ({
        ...plan,
        id,
        subscribers: Number(
          platform.store.db
            .prepare("SELECT count(*) AS n FROM tenants WHERE plan=?")
            .get(id)!.n,
        ),
        checkoutReady: this.ready(id, platform),
        published: platform.catalog.matches(platform.catalog.get(id)),
      })),
    };
  }
  async publish(
    platform: Platform,
    p: Principal,
    id: string,
    revision: unknown,
  ) {
    const plan = platform.catalog.get(id);
    if (revision !== plan.revision)
      throw new APIError(
        409,
        "O plano foi atualizado. Recarregue a lista antes de salvar.",
      );
    if (id === "trial" || plan.amount === null)
      throw new APIError(400, "Defina o preço do plano antes de publicar.");
    if (!this.configured())
      throw new APIError(
        503,
        "Configure a conta Stripe e o webhook antes de publicar preços.",
      );
    if (platform.catalog.matches(plan)) return this.management(platform);
    const installation = String(
      platform.store.db.prepare("SELECT id FROM plan_catalog_meta").get()!.id,
    );
    if (plan.productId && plan.publishedName !== plan.name)
      await this.stripe!.products.update(
        plan.productId,
        { name: plan.name },
        {
          idempotencyKey: `foxops-${installation}-${id}-${plan.revision}-name`,
        },
      );
    const price = await this.stripe!.prices.create(
      {
        currency: plan.currency.toLowerCase(),
        unit_amount: plan.amount,
        recurring: { interval: plan.interval },
        ...(plan.productId
          ? { product: plan.productId }
          : { product_data: { name: plan.name } }),
        nickname: plan.name,
        metadata: { foxops_plan: id, revision: String(plan.revision) },
      },
      { idempotencyKey: `foxops-${installation}-${id}-${plan.revision}` },
    );
    platform.transaction(() => {
      platform.catalog.published(id, plan.revision, {
        id: price.id,
        product:
          typeof price.product === "string" ? price.product : price.product.id,
        unit_amount: price.unit_amount,
        currency: price.currency,
        recurring: price.recurring,
      });
      platform.audit(p, "platform.plan.published", id);
    });
    return this.management(platform);
  }
  async checkout(
    platform: Platform,
    p: Principal,
    plan: unknown,
    revision?: unknown,
  ) {
    platform.requireRole(p, ["owner"]);
    if (
      typeof plan !== "string" ||
      plan === "trial" ||
      !platform.catalog.all()[plan]
    )
      throw new APIError(400, "Plano inválido.");
    if (!this.ready(plan, platform))
      throw new APIError(
        503,
        "Este plano não está disponível para contratação.",
      );
    const account = platform.account(p);
    if (
      account.billing_provider === "mercadopago" &&
      (account.billing_until ?? 0) > Date.now() / 1000
    )
      throw new APIError(
        409,
        "Gerencie sua assinatura existente antes de contratar outro plano.",
      );
    const selected = platform.catalog.get(plan);
    if (revision !== selected.revision)
      throw new APIError(
        409,
        "O plano foi atualizado. Recarregue a lista antes de contratar.",
      );
    if (
      account.url_monitor_count > (selected.urlMonitors ?? 0) ||
      account.server_count > selected.servers ||
      platform.organizations(p).length > selected.organizations
    )
      throw new APIError(409, "Este plano não comporta o uso atual da conta.");
    const existing = platform.store.db
      .prepare("SELECT customer_id,subscription_id FROM tenants WHERE id=?")
      .get(p.tenantId) as {
      customer_id: string | null;
      subscription_id: string | null;
    };
    if (
      existing.subscription_id &&
      ["active", "past_due", "unpaid", "incomplete"].includes(
        account.subscription_status,
      )
    )
      throw new APIError(
        409,
        "Gerencie sua assinatura existente no portal de cobrança.",
      );
    const priceId = this.price(platform, plan)!;
    const checked = await this.stripe!.prices.retrieve(priceId, {
      expand: ["product"],
    });
    if (
      !checked.active ||
      (typeof checked.product !== "string" &&
        ("deleted" in checked.product || !checked.product.active)) ||
      checked.recurring?.interval_count !== 1 ||
      checked.recurring?.usage_type !== "licensed" ||
      checked.billing_scheme !== "per_unit" ||
      checked.type !== "recurring" ||
      checked.currency.toUpperCase() !==
        (selected.amount === null
          ? checked.currency.toUpperCase()
          : selected.currency) ||
      (selected.amount !== null &&
        (checked.unit_amount !== selected.amount ||
          checked.recurring.interval !== selected.interval))
    )
      throw new APIError(409, "O preço de cobrança não corresponde ao plano.");
    if (
      platform.catalog.get(plan).revision !== selected.revision ||
      !this.ready(plan, platform)
    )
      throw new APIError(
        409,
        "O plano foi atualizado. Recarregue a lista antes de contratar.",
      );
    const session = await this.stripe!.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      ...(existing.customer_id
        ? { customer: existing.customer_id }
        : { customer_email: p.email }),
      client_reference_id: p.tenantId,
      metadata: { tenant_id: p.tenantId, plan },
      subscription_data: { metadata: { tenant_id: p.tenantId, plan } },
      success_url: this.config.origin + "/?billing=success",
      cancel_url: this.config.origin + "/?billing=cancel",
    });
    platform.audit(p, "billing.checkout", plan);
    return { url: session.url };
  }
  async portal(platform: Platform, p: Principal) {
    platform.requireRole(p, ["owner"]);
    if (!this.stripe)
      throw new APIError(503, "Pagamentos ainda não configurados.");
    const account = platform.store.db
      .prepare("SELECT customer_id FROM tenants WHERE id=?")
      .get(p.tenantId) as { customer_id: string | null };
    if (!account.customer_id)
      throw new APIError(409, "Nenhuma assinatura vinculada à conta.");
    const session = await this.stripe.billingPortal.sessions.create({
      customer: account.customer_id,
      return_url: this.config.origin + "/?page=billing",
    });
    return { url: session.url };
  }
  async webhook(platform: Platform, raw: Buffer, signature: string) {
    if (!this.stripe || !this.config.webhookSecret)
      throw new APIError(503, "Webhook de cobrança não configurado.");
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        raw,
        signature,
        this.config.webhookSecret,
      );
    } catch {
      throw new APIError(400, "Assinatura do webhook inválida.");
    }
    if (
      platform.store.db
        .prepare("SELECT 1 FROM billing_events WHERE id=?")
        .get(event.id)
    )
      return;
    if (
      [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type)
    ) {
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = sub.metadata.tenant_id;
      platform.catalog.bindLegacy(this.config.prices ?? {});
      const plan = platform.catalog.pricePlan(
        sub.items.data[0]?.price.id ?? "",
      );
      if (tenantId && plan && platform.catalog.all()[plan]) {
        platform.transaction(() => {
          platform.store.db
            .prepare(
              `UPDATE tenants SET customer_id=?,subscription_id=?,plan=?,subscription_status=?,billing_event_at=?,billing_provider='stripe',billing_until=?
            WHERE id=? AND billing_event_at<=? AND (billing_provider!='mercadopago' OR coalesce(billing_until,0)<=? OR subscription_id=?)`,
            )
            .run(
              typeof sub.customer === "string" ? sub.customer : sub.customer.id,
              sub.id,
              plan,
              sub.status,
              event.created,
              sub.items.data[0]?.current_period_end ?? null,
              tenantId,
              event.created,
              Math.floor(Date.now() / 1000),
              sub.id,
            );
          platform.store.db
            .prepare("INSERT OR IGNORE INTO billing_events VALUES (?,?)")
            .run(event.id, event.created);
        });
      }
    } else {
      platform.store.db
        .prepare("INSERT OR IGNORE INTO billing_events VALUES (?,?)")
        .run(event.id, event.created);
    }
  }
}
