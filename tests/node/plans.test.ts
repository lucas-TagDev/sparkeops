import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { Billing } from "../../src/billing.ts";
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const p = platform.signup({
    name: "Admin",
    company: "Test",
    email: "plans@test.example",
    password: "strong-password-123",
  }).principal;
  return { platform, p, store };
}
function price(
  id: string,
  amount: number,
  currency = "brl",
  interval = "month",
) {
  return {
    id,
    product: { id: "prod_test", active: true },
    unit_amount: amount,
    currency,
    recurring: { interval, interval_count: 1, usage_type: "licensed" },
    active: true,
    billing_scheme: "per_unit",
    type: "recurring",
  } as unknown as Stripe.Price;
}
function fakeBilling() {
  return new Billing({
    key: "sk_test_fake",
    webhookSecret: "whsec_fake",
    origin: "http://localhost",
  });
}

test("catálogo: limites dinâmicos, planos personalizados, validação e persistência", (t) => {
  const { platform, p, store } = fixture(t);
  const original = platform.catalog.get("trial");
  platform.catalog.save("trial", {
    ...original,
    servers: 1,
    aiDaily: 3,
    trialDays: 21,
  });
  assert.equal(platform.account(p).limits.servers, 1);
  assert.equal(platform.account(p).limits.aiDaily, 3);
  const newUser = platform.signup({
    name: "New",
    company: "New",
    email: "new@plans.example",
    password: "strong-password-123",
  });
  assert.ok(
    platform.account(newUser.principal).trial_until >= now() + 21 * 86400 - 1,
  );
  platform.catalog.save(
    "premium",
    {
      ...platform.catalog.get("starter"),
      name: "Premium",
      amount: 12990,
      servers: 50,
    },
    true,
  );
  store.db
    .prepare(
      "UPDATE tenants SET plan='premium',subscription_status='active' WHERE id=?",
    )
    .run(p.tenantId);
  assert.equal(platform.account(p).limits.servers, 50);
  assert.equal(platform.account(p).limits.name, "Premium");
  assert.throws(() => platform.catalog.save("premium", { ...original }, true));
  assert.throws(() => platform.catalog.save("wrong id", { ...original }, true));
  assert.throws(() =>
    platform.catalog.save("trial", { ...original, enabled: false }),
  );
  const valid = platform.catalog.get("premium");
  for (const invalid of [
    { amount: -10 },
    { amount: 1.5 },
    { servers: 0 },
    { currency: "JPY" },
    { interval: "week" },
    { retentionDays: 5000 },
    { enabled: "yes" },
    { aiDaily: -1 },
  ])
    assert.throws(() =>
      platform.catalog.save("premium", { ...valid, ...invalid }),
    );
  assert.throws(() =>
    platform.catalog.save("premium", { ...valid, revision: 0 }),
  );
  const dir = mkdtempSync(join(tmpdir(), "foxops-plans-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "catalog.sqlite3");
  let disk = new Store(path);
  let persisted = new Platform(disk);
  persisted.catalog.save("starter", {
    ...persisted.catalog.get("starter"),
    amount: 9990,
    name: "Custom",
  });
  disk.close();
  disk = new Store(path);
  persisted = new Platform(disk);
  assert.equal(persisted.catalog.get("starter").amount, 9990);
  assert.equal(persisted.catalog.get("starter").name, "Custom");
  disk.close();
});

test("preços: publicação versionada, histórico antigo, checkout e desativação", async (t) => {
  const { platform, p, store } = fixture(t),
    billing = fakeBilling();
  let created = 0,
    checkouts = 0;
  const prices = new Map<string, Stripe.Price>();
  billing.stripe!.prices.create = (async (
    params: Stripe.PriceCreateParams,
    options: Stripe.RequestOptions,
  ) => {
    created++;
    assert.match(options.idempotencyKey!, /foxops-/);
    const result = price(
      "price_" + created,
      params.unit_amount!,
      params.currency!,
      params.recurring!.interval,
    );
    prices.set(result.id, result);
    return result;
  }) as unknown as Stripe["prices"]["create"];
  billing.stripe!.prices.retrieve = (async (id: string) =>
    prices.get(id)!) as unknown as Stripe["prices"]["retrieve"];
  billing.stripe!.checkout.sessions.create = (async (
    params: Stripe.Checkout.SessionCreateParams,
  ) => {
    checkouts++;
    assert.equal(params.line_items![0].price, "price_2");
    return { url: "https://checkout.stripe.test/example" };
  }) as unknown as Stripe["checkout"]["sessions"]["create"];
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    amount: 4990,
  });
  let revision = platform.catalog.get("starter").revision;
  assert.equal(billing.ready("starter", platform), false);
  await billing.publish(platform, p, "starter", revision);
  assert.equal(billing.ready("starter", platform), true);
  await billing.publish(platform, p, "starter", revision);
  assert.equal(created, 1);
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    amount: 5990,
  });
  revision = platform.catalog.get("starter").revision;
  assert.equal(billing.ready("starter", platform), false);
  await assert.rejects(billing.checkout(platform, p, "starter", revision));
  await billing.publish(platform, p, "starter", revision);
  assert.equal(created, 2);
  assert.equal(platform.catalog.pricePlan("price_1"), "starter");
  assert.equal(platform.catalog.pricePlan("price_2"), "starter");
  await assert.rejects(billing.checkout(platform, p, "starter", revision - 1));
  assert.equal(checkouts, 0);
  assert.equal(
    (await billing.checkout(platform, p, "starter", revision)).url,
    "https://checkout.stripe.test/example",
  );
  assert.equal(checkouts, 1);
  prices.set("price_2", price("price_2", 6990));
  await assert.rejects(billing.checkout(platform, p, "starter", revision));
  assert.equal(checkouts, 1);
  prices.set("price_2", price("price_2", 5990));
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    enabled: false,
  });
  assert.equal(billing.ready("starter", platform), false);
  await assert.rejects(
    billing.checkout(
      platform,
      p,
      "starter",
      platform.catalog.get("starter").revision,
    ),
  );
  // A signed update at the old price still resolves after the plan is repriced or disabled.
  const payload = JSON.stringify({
    id: "evt_old_price",
    type: "customer.subscription.updated",
    created: now(),
    data: {
      object: {
        id: "sub_old",
        customer: "cus_old",
        metadata: { tenant_id: p.tenantId },
        status: "active",
        items: { data: [{ price: { id: "price_1" } }] },
      },
    },
  });
  const signature = billing.stripe!.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_fake",
  });
  await billing.webhook(platform, Buffer.from(payload), signature);
  assert.equal(platform.account(p).plan, "starter");
  assert.equal(platform.account(p).subscription_status, "active");
  assert.equal(
    store.db
      .prepare("SELECT subscription_id FROM tenants WHERE id=?")
      .get(p.tenantId)!.subscription_id,
    "sub_old",
  );
  assert.doesNotMatch(
    JSON.stringify(platform.catalog.public()),
    /price_1|price_2|prod_test|publishedAmount/,
  );
});

test("publicação: falha ou edição simultânea não libera preço inconsistente", async (t) => {
  const { platform, p } = fixture(t),
    billing = fakeBilling();
  platform.catalog.save("growth", {
    ...platform.catalog.get("growth"),
    amount: 20000,
  });
  const revision = platform.catalog.get("growth").revision;
  billing.stripe!.prices.create = (async () => {
    throw new Error("mock failure");
  }) as unknown as Stripe["prices"]["create"];
  await assert.rejects(billing.publish(platform, p, "growth", revision));
  assert.equal(billing.ready("growth", platform), false);
  billing.stripe!.prices.create = (async () => {
    platform.catalog.save("growth", {
      ...platform.catalog.get("growth"),
      amount: 21000,
    });
    return price("price_stale", 20000);
  }) as unknown as Stripe["prices"]["create"];
  await assert.rejects(billing.publish(platform, p, "growth", revision));
  assert.equal(billing.ready("growth", platform), false);
  assert.equal(platform.catalog.pricePlan("price_stale"), undefined);
  await assert.rejects(
    new Billing({ origin: "http://localhost" }).publish(
      platform,
      p,
      "growth",
      platform.catalog.get("growth").revision,
    ),
  );
});

test("catálogo: preços legados persistem e não são reutilizados após edição de preço", (t) => {
  const { platform } = fixture(t),
    billing = fakeBilling();
  billing.config.prices = { starter: "price_legacy" };
  platform.catalog.bindLegacy(billing.config.prices);
  assert.equal(billing.ready("starter", platform), true);
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    description: "New description",
  });
  assert.equal(billing.ready("starter", platform), true);
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    amount: 10000,
  });
  assert.equal(billing.ready("starter", platform), false);
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    amount: null,
  });
  assert.equal(billing.ready("starter", platform), false);
  assert.equal(platform.catalog.pricePlan("price_legacy"), "starter");
});

test("publicação sincroniza o nome do produto após renomear o plano", async (t) => {
  const { platform, p } = fixture(t),
    billing = fakeBilling();
  let n = 0,
    renamed = "";
  billing.stripe!.prices.create = (async (params: Stripe.PriceCreateParams) =>
    price(
      "price_name_" + ++n,
      params.unit_amount!,
    )) as unknown as Stripe["prices"]["create"];
  billing.stripe!.products.update = (async (
    _id: string,
    data: Stripe.ProductUpdateParams,
  ) => {
    renamed = data.name!;
    return { id: "prod_test", name: data.name };
  }) as unknown as Stripe["products"]["update"];
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    amount: 4990,
  });
  await billing.publish(
    platform,
    p,
    "starter",
    platform.catalog.get("starter").revision,
  );
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    name: "New product name",
  });
  assert.equal(billing.ready("starter", platform), false);
  await billing.publish(
    platform,
    p,
    "starter",
    platform.catalog.get("starter").revision,
  );
  assert.equal(renamed, "New product name");
  assert.equal(billing.ready("starter", platform), true);
});
