import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { BrandingSettings } from "../../src/branding.ts";
import { PlatformAdministration } from "../../src/platform-admin.ts";
import { MercadoPagoBilling, periodEnd } from "../../src/mercadopago.ts";
import { Billing } from "../../src/billing.ts";
import { createApp } from "../../src/app.ts";
const token = "APP_USR_TEST_ONLY_NOT_A_REAL_TOKEN",
  secret = "fake-signing-secret-for-unit-tests";
const signing = (id: string) => {
  const ts = now();
  return (
    "ts=" +
    ts +
    ",v1=" +
    createHmac("sha256", secret)
      .update(`id:${id};request-id:test-request;ts:${ts};`)
      .digest("hex")
  );
};

function setup(t: TestContext, origin = "https://foxops.example") {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const root = platform.signup({
    name: "Root",
    company: "Platform",
    email: "root@mp.test",
    password: "strong-password-123",
  });
  const buyer = platform.signup({
    name: "Buyer",
    company: "Customer",
    email: "buyer@mp.test",
    password: "strong-password-123",
  });
  const vault = new AISettings(platform, { masterKey: Buffer.alloc(32, 8) }),
    access = new PlatformAdministration(
      platform,
      new BrandingSettings(platform, [root.principal.email]),
    );
  const state = {
    reference: "",
    status: "authorized",
    payment: "approved",
    amount: 49.9,
    calls: 0,
    creates: 0,
    merchant: 123,
  };
  const fetcher = (async (input, options) => {
    state.calls++;
    assert.ok(String(input).startsWith("https://api.mercadopago.com/"));
    assert.equal(
      new Headers(options?.headers).get("Authorization"),
      "Bearer " + token,
    );
    const path = new URL(String(input)).pathname;
    if (path === "/users/me")
      return Response.json({ id: state.merchant, site_id: "MLB" });
    if (path === "/preapproval" && options?.method === "POST") {
      const body = JSON.parse(String(options.body));
      state.reference = body.external_reference;
      state.creates++;
      assert.equal(body.status, "pending");
      assert.equal(body.auto_recurring.transaction_amount, 49.9);
      assert.equal(body.auto_recurring.frequency, 1);
      assert.ok(new Headers(options.headers).get("X-Idempotency-Key"));
      return Response.json({
        id: "mp_sub_1",
        init_point:
          "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=mp_sub_1",
      });
    }
    if (path === "/preapproval/mp_sub_1") {
      if (options?.method === "PUT") state.status = "cancelled";
      return Response.json({
        id: "mp_sub_1",
        external_reference: state.reference,
        collector_id: 123,
        status: state.status,
        auto_recurring: {
          currency_id: "BRL",
          transaction_amount: state.amount,
          frequency: 1,
          frequency_type: "months",
        },
      });
    }
    if (path === "/authorized_payments/101")
      return Response.json({
        id: 101,
        preapproval_id: "mp_sub_1",
        currency_id: "BRL",
        transaction_amount: state.amount,
        debit_date: new Date(now() * 1000).toISOString(),
        payment: { id: 201 },
      });
    if (path === "/authorized_payments/search")
      return Response.json({ results: [{ id: 101, payment: { id: 201 } }] });
    if (path === "/v1/payments/201")
      return Response.json({
        id: 201,
        collector_id: 123,
        currency_id: "BRL",
        transaction_amount: state.amount,
        status: state.payment,
      });
    throw new Error("Unexpected mocked endpoint " + path);
  }) as typeof fetch;
  const mp = new MercadoPagoBilling(platform, vault, access, origin, fetcher);
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    amount: 4990,
  });
  return { store, platform, root, buyer, vault, mp, state, fetcher };
}
test("Mercado Pago: credenciais cifradas, acesso global e HTTPS obrigatório", async (t) => {
  const { mp, root, buyer, store, state } = setup(t, "http://localhost:8080");
  assert.throws(() =>
    mp.save(buyer.principal, { token, secret, enabled: true }),
  );
  assert.throws(() => mp.metadata(buyer.principal));
  let data = mp.save(root.principal, { token, secret, enabled: true });
  assert.equal(data.hasToken, true);
  assert.equal(data.ready, false);
  assert.doesNotMatch(JSON.stringify(data), new RegExp(token + "|" + secret));
  assert.doesNotMatch(
    JSON.stringify(store.db.prepare("SELECT * FROM payment_credentials").all()),
    new RegExp(token + "|" + secret),
  );
  data = await mp.test(root.principal);
  assert.equal(data.tested, true);
  assert.equal(data.ready, false);
  assert.equal(state.calls, 1);
  assert.equal(mp.ready("starter"), false);
  state.merchant = 456;
  await assert.rejects(mp.test(root.principal));
});
test("Mercado Pago: checkout, confirmação real, duplicatas, cancelamento e estorno", async (t) => {
  const { mp, platform, root, buyer, state, store } = setup(t);
  mp.save(root.principal, { token, secret, enabled: true });
  await mp.test(root.principal);
  assert.equal(mp.ready("starter"), true);
  const revision = platform.catalog.get("starter").revision;
  await assert.rejects(
    mp.checkout({ ...buyer.principal, role: "reader" }, "starter", revision),
  );
  const checkout = await mp.checkout(buyer.principal, "starter", revision);
  assert.match(checkout.url, /mercadopago.com.br/);
  assert.equal(state.creates, 1);
  await mp.checkout(buyer.principal, "starter", revision);
  assert.equal(state.creates, 1);
  assert.equal(platform.account(buyer.principal).plan, "trial");
  const webhook = (id: string, type: string) =>
    mp.webhook(id, "test-request", signing(id), { type, data: { id } });
  const previous = state.calls;
  await assert.rejects(
    mp.webhook("101", "test-request", "ts=123,v1=bad", {
      type: "subscription_authorized_payment",
      data: { id: 101 },
    }),
  );
  assert.equal(state.calls, previous);
  await webhook("mp_sub_1", "subscription_preapproval");
  assert.equal(platform.account(buyer.principal).plan, "trial");
  state.amount = 1;
  await assert.rejects(webhook("101", "subscription_authorized_payment"));
  assert.equal(platform.account(buyer.principal).plan, "trial");
  state.amount = 49.9;
  state.payment = "pending";
  await webhook("101", "subscription_authorized_payment");
  assert.equal(platform.account(buyer.principal).plan, "trial");
  state.payment = "approved";
  await webhook("101", "subscription_authorized_payment");
  let account = platform.account(buyer.principal);
  assert.equal(account.plan, "starter");
  assert.equal(account.billing_provider, "mercadopago");
  assert.equal(account.subscription_status, "active");
  assert.ok(account.billing_until! > now());
  platform.active(buyer.principal);
  const stripe = new Billing({
    origin: "https://foxops.example",
    key: "sk_test_fake",
    webhookSecret: "whsec_fake",
    prices: { starter: "price_legacy" },
  });
  const payload = JSON.stringify({
    id: "evt_late_stripe",
    type: "customer.subscription.deleted",
    created: now() + 1,
    data: {
      object: {
        id: "sub_old_stripe",
        customer: "cus_old",
        metadata: { tenant_id: buyer.principal.tenantId },
        status: "canceled",
        items: { data: [{ price: { id: "price_legacy" } }] },
      },
    },
  });
  await stripe.webhook(
    platform,
    Buffer.from(payload),
    stripe.stripe!.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_fake",
    }),
  );
  assert.equal(
    platform.account(buyer.principal).billing_provider,
    "mercadopago",
  );
  assert.equal(platform.account(buyer.principal).subscription_status, "active");
  const until = account.billing_until;
  await webhook("101", "subscription_authorized_payment");
  assert.equal(platform.account(buyer.principal).billing_until, until);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM mp_invoices").get()!.n,
    1,
  );
  await assert.rejects(mp.cancel(root.principal));
  await mp.cancel(buyer.principal);
  assert.equal(
    platform.account(buyer.principal).subscription_status,
    "canceled",
  );
  platform.active(buyer.principal);
  mp.save(root.principal, { enabled: false });
  assert.equal(mp.ready("starter"), false);
  state.payment = "refunded";
  await webhook("201", "payment");
  account = platform.account(buyer.principal);
  assert.equal(account.subscription_status, "past_due");
  assert.throws(() => platform.active(buyer.principal));
});
test("Mercado Pago: calendário mensal e anual respeita fim do mês", () => {
  assert.equal(
    new Date(periodEnd("2026-01-31T12:00:00Z", 1) * 1000).toISOString(),
    "2026-02-28T12:00:00.000Z",
  );
  assert.equal(
    new Date(periodEnd("2024-02-29T12:00:00Z", 12) * 1000).toISOString(),
    "2025-02-28T12:00:00.000Z",
  );
});
test("HTTP Mercado Pago: configuração exclusiva do administrador e webhook sem sessão, com assinatura", async (t) => {
  const context = setup(t),
    { store, platform, root, buyer, fetcher, state } = context;
  const server = createApp(store, undefined, {
    platformAdmins: [root.principal.email],
    aiVault: { masterKey: Buffer.alloc(32, 8) },
    billing: { origin: "https://foxops.example" },
    mercadoPagoFetch: fetcher,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const req = (
    path: string,
    session = "",
    method = "GET",
    data?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        Cookie: "foxops_session=" + session,
        "Content-Type": "application/json",
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const settings = "/api/v1/platform/payments/mercadopago";
  assert.equal((await req(settings, buyer.token)).status, 403);
  assert.equal(
    (await req(settings, buyer.token, "PUT", { token, secret, enabled: true }))
      .status,
    403,
  );
  assert.equal(
    (await req(settings, root.token, "PUT", { token, secret, enabled: true }))
      .status,
    200,
  );
  assert.equal(
    (await req(settings + "/test", root.token, "POST", {})).status,
    200,
  );
  const catalog = await (await req("/api/v1/billing", buyer.token)).json();
  assert.ok(catalog.providers.starter.includes("mercadopago"));
  assert.equal(
    (
      await req("/api/v1/billing/checkout", buyer.token, "POST", {
        provider: "mercadopago",
        plan: "starter",
        revision: platform.catalog.get("starter").revision,
      })
    ).status,
    200,
  );
  assert.equal(state.creates, 1);
  const endpoint = "/api/billing/mercadopago/webhook?data.id=101";
  assert.equal(
    (
      await req(endpoint, "", "POST", {
        type: "subscription_authorized_payment",
        data: { id: 101 },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await req(
        endpoint,
        "",
        "POST",
        { type: "subscription_authorized_payment", data: { id: 101 } },
        { "x-request-id": "test-request", "x-signature": signing("101") },
      )
    ).status,
    200,
  );
  assert.equal(platform.account(buyer.principal).plan, "starter");
});
