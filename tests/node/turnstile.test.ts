import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { BrandingSettings } from "../../src/branding.ts";
import { PlatformAdministration } from "../../src/platform-admin.ts";
import { Turnstile } from "../../src/turnstile.ts";
import { createApp } from "../../src/app.ts";
const secret = "TEST_ONLY_SECRET_12345",
  siteKey = "TEST_ONLY_SITE_KEY_12345",
  origin = "https://platform.example";
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const root = platform.signup({
    name: "Root",
    company: "Platform",
    email: "root@captcha.test",
    password: "strong-password-123",
  });
  const buyer = platform.signup({
    name: "Buyer",
    company: "Buyer",
    email: "buyer@captcha.test",
    password: "strong-password-123",
  });
  const masterKey = Buffer.alloc(32, 8),
    vault = new AISettings(platform, { masterKey }),
    access = new PlatformAdministration(
      platform,
      new BrandingSettings(platform, [root.principal.email]),
    );
  let failure = false,
    custom: Record<string, unknown> = {};
  const fetcher = (async (url, options) => {
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    const body = JSON.parse(String(options?.body));
    assert.equal(body.secret, secret);
    if (failure) throw new Error("private network details");
    return new Response(
      JSON.stringify({
        success: !body.response.startsWith("invalid"),
        hostname: "platform.example",
        action: body.response.split(":")[0],
        challenge_ts: new Date().toISOString(),
        ...custom,
      }),
    );
  }) as typeof fetch;
  const captcha = new Turnstile(platform, vault, access, origin, fetcher);
  const save = (extra: Record<string, unknown> = {}) =>
    captcha.save(root.principal, {
      siteKey,
      secret,
      enabled: true,
      login: true,
      registration: true,
      password_reset: true,
      ...extra,
    });
  return {
    store,
    platform,
    root,
    buyer,
    captcha,
    save,
    fetcher,
    masterKey,
    fail: () => {
      failure = true;
    },
    override: (value: Record<string, unknown>) => {
      custom = value;
    },
  };
}
test("Turnstile configuration is platform-admin only and secret remains encrypted", (t) => {
  const f = fixture(t);
  assert.throws(() => f.captcha.metadata(f.buyer.principal));
  assert.throws(() => f.captcha.save(f.buyer.principal, {}));
  f.save();
  const output =
    JSON.stringify(f.captcha.metadata(f.root.principal)) +
    JSON.stringify(f.captcha.publicSettings());
  assert.ok(!output.includes(secret));
  assert.notEqual(
    f.store.db.prepare("SELECT secret FROM turnstile_settings").get()?.secret,
    secret,
  );
  assert.throws(
    () =>
      f.captcha.save(f.root.principal, {
        siteKey: "changed-site-key",
        enabled: true,
        login: true,
        registration: true,
        password_reset: true,
      }),
    /Secret Key/,
  );
});
test("CAPTCHA enforces required tokens, action, hostname, expiry and single use", async (t) => {
  const f = fixture(t);
  await f.captcha.verify("login", undefined); // Disabled by default.
  f.save();
  await assert.rejects(f.captcha.verify("login", undefined));
  await assert.rejects(f.captcha.verify("login", "x".repeat(2049)));
  await assert.rejects(f.captcha.verify("login", "signup:wrong-action"));
  f.override({ hostname: "attacker.example" });
  await assert.rejects(f.captcha.verify("login", "login:wrong-host"));
  f.override({ challenge_ts: new Date((now() - 301) * 1000).toISOString() });
  await assert.rejects(f.captcha.verify("login", "login:expired"));
  f.override({});
  await f.captcha.verify("login", "login:valid");
  await assert.rejects(
    f.captcha.verify("login", "login:valid"),
    /já utilizada/,
  );
  const parallel = await Promise.allSettled([
    f.captcha.verify("login", "login:parallel"),
    f.captcha.verify("login", "login:parallel"),
  ]);
  assert.equal(
    parallel.filter((result) => result.status === "fulfilled").length,
    1,
  );
  f.save({ login: false });
  await f.captcha.verify("login", undefined);
  await assert.rejects(f.captcha.verify("forgot_password", undefined));
  f.fail();
  await assert.rejects(
    f.captcha.verify("signup", "signup:network"),
    /Não foi possível validar/,
  );
});
test("HTTP: direct auth requests cannot bypass CAPTCHA and public settings never reveal secret", async (t) => {
  const f = fixture(t);
  const server = createApp(f.store, undefined, {
    platformAdmins: [f.root.principal.email],
    aiVault: { masterKey: f.masterKey },
    turnstileFetch: f.fetcher,
  });
  f.override({ hostname: "localhost" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const request = (
    path: string,
    data?: unknown,
    cookie?: string,
    method?: string,
  ) =>
    fetch(base + path, {
      method: method ?? (data ? "POST" : "GET"),
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  const rootCookie = "foxops_session=" + f.root.token;
  const saved = await request(
    "/api/v1/platform/security/turnstile",
    {
      siteKey,
      secret,
      enabled: true,
      login: true,
      registration: true,
      password_reset: true,
    },
    rootCookie,
    "PUT",
  );
  assert.equal(saved.status, 200);
  const publicResponse = await request("/api/auth/captcha");
  assert.ok(!(await publicResponse.text()).includes(secret));
  for (const [path, data] of [
    [
      "/api/auth/login",
      { email: f.root.principal.email, password: "strong-password-123" },
    ],
    [
      "/api/auth/signup",
      {
        name: "New",
        company: "New",
        email: "new@captcha.test",
        password: "strong-password-123",
      },
    ],
    ["/api/auth/forgot-password", { email: f.root.principal.email }],
    [
      "/api/auth/reset-password",
      { token: "invalid-reset", password: "strong-password-456" },
    ],
    [
      "/api/auth/accept-invite",
      { token: "invalid-invite", password: "strong-password-123" },
    ],
  ] as const) {
    const response = await request(path, data);
    assert.equal(response.status, 400, path);
    assert.match((await response.json()).error, /verificação de segurança/);
  }
  const login = await request("/api/auth/login", {
    email: f.root.principal.email,
    password: "strong-password-123",
    captcha_token: "login:http-valid",
  });
  assert.equal(login.status, 200);
  const response = await request(
    "/api/v1/platform/security/turnstile",
    undefined,
    "foxops_session=" + f.buyer.token,
  );
  assert.equal(response.status, 403);
});
