import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { BrandingSettings } from "../../src/branding.ts";
import { PlatformAdministration } from "../../src/platform-admin.ts";
import { Billing } from "../../src/billing.ts";
import { StripeSettings } from "../../src/stripe-settings.ts";
const key = "sk_test_0123456789abcdefghijklmn",
  secret = "whsec_0123456789abcdefghijklmn";
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const root = platform.signup({
    name: "Admin",
    company: "Platform",
    email: "root@stripe.test",
    password: "strong-password-123",
  }).principal;
  const buyer = platform.signup({
    name: "Buyer",
    company: "Buyer",
    email: "buyer@stripe.test",
    password: "strong-password-123",
  }).principal;
  const vault = new AISettings(platform, { masterKey: Buffer.alloc(32, 7) }),
    access = new PlatformAdministration(
      platform,
      new BrandingSettings(platform, [root.email]),
    );
  const billing = new Billing({ origin: "https://platform.example" });
  let success = true;
  const fetcher = (async (url, options) => {
    assert.equal(url, "https://api.stripe.com/v1/account");
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      "Bearer " + key,
    );
    return new Response(
      JSON.stringify(
        success
          ? { id: "acct_TEST123" }
          : { error: { message: "private provider error" } },
      ),
      { status: success ? 200 : 401 },
    );
  }) as typeof fetch;
  const settings = new StripeSettings(
    platform,
    vault,
    access,
    billing,
    fetcher,
  );
  return {
    store,
    platform,
    root,
    buyer,
    vault,
    access,
    billing,
    settings,
    fetcher,
    fail: () => {
      success = false;
    },
  };
}
test("Stripe panel protects credentials, restricts admins, tests and reloads live billing config", async (t) => {
  const f = fixture(t);
  assert.throws(() => f.settings.metadata(f.buyer));
  assert.throws(() =>
    f.settings.save(f.buyer, { token: key, secret, enabled: true }),
  );
  const saved = f.settings.save(f.root, { token: key, secret, enabled: true });
  assert.equal(saved.ready, false);
  assert.equal(saved.hasToken, true);
  assert.ok(!JSON.stringify(saved).includes(key));
  const row = f.store.db
    .prepare(
      "SELECT token,secret FROM payment_credentials WHERE provider='stripe'",
    )
    .get();
  assert.notEqual(row?.token, key);
  assert.notEqual(row?.secret, secret);
  const tested = await f.settings.test(f.root);
  assert.equal(tested.tested, true);
  assert.equal(f.billing.configured(), true);
  assert.equal(f.billing.config.key, key);
  const reload = new Billing({ origin: "https://platform.example" });
  new StripeSettings(f.platform, f.vault, f.access, reload, f.fetcher);
  assert.equal(reload.configured(), true);
  assert.equal(reload.config.key, key);
  f.settings.save(f.root, { enabled: false });
  assert.equal(f.billing.configured(), false);
  assert.ok(f.billing.stripe);
  assert.equal(f.billing.config.webhookSecret, secret);
  assert.equal(f.settings.metadata(f.root).hasToken, true);
});
test("Stripe invalid input and failed verification do not enable checkout or expose provider errors", async (t) => {
  const f = fixture(t);
  assert.throws(() =>
    f.settings.save(f.root, { enabled: true, token: "pk_test_bad", secret }),
  );
  f.settings.save(f.root, { enabled: true, token: key, secret });
  await f.settings.test(f.root);
  f.fail();
  await assert.rejects(f.settings.test(f.root), /Não foi possível/);
  assert.equal(f.billing.configured(), false);
  assert.equal(f.settings.metadata(f.root).tested, false);
  const audit = JSON.stringify(f.store.db.prepare("SELECT * FROM audit").all());
  assert.ok(!audit.includes(key));
  assert.ok(!audit.includes(secret));
});
