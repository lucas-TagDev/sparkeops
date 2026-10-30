import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Store } from "../../src/store.ts";
import { Platform, now, hash } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { BrandingSettings } from "../../src/branding.ts";
import { PlatformEmail } from "../../src/platform-email.ts";
import { createApp } from "../../src/app.ts";
const masterKey = Buffer.alloc(32, 4),
  password = "strong-password-123";
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store),
    admin = platform.signup({
      name: "Admin",
      company: "Platform",
      email: "admin@confirmation.test",
      password,
    });
  const messages: { to: string; subject: string; text: string }[] = [];
  const mail = new PlatformEmail(
    platform,
    new AISettings(platform, { masterKey }),
    new BrandingSettings(platform, [admin.principal.email]),
    "https://platform.example",
    async (_c, m) => {
      messages.push(m);
    },
  );
  const config = {
    enabled: true,
    host: "smtp.example.com",
    port: 587,
    user: "mailer",
    password: "TEST_ONLY_SMTP_PASSWORD",
    from: "noreply@example.com",
    require_account_confirmation: true,
  };
  return { store, platform, admin, mail, messages, config };
}
test("Account confirmation: prospective opt-in policy, pending login blocked, single-use email activation", async (t) => {
  const f = fixture(t);
  f.mail.save(f.admin.principal, f.config);
  assert.ok(
    f.platform.login({ email: f.admin.principal.email, password }).token,
  );
  const user = f.platform.signup(
    { name: "New", company: "New", email: "new@confirmation.test", password },
    (p) => f.mail.queueAccountConfirmation(p.userId),
  );
  assert.equal(user.token, "");
  assert.throws(
    () => f.platform.login({ email: user.principal.email, password }),
    /Confirme seu e-mail/,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT count(*) AS n FROM sessions WHERE user_id=?")
      .get(user.principal.userId)?.n,
    0,
  );
  await f.mail.tick();
  const token = f.messages[0].text.match(/confirm-account=([a-f0-9]{64})/)![1];
  assert.ok(
    !JSON.stringify(
      f.store.db.prepare("SELECT * FROM account_email_tokens").all(),
    ).includes(token),
  );
  f.mail.confirmAccount(token);
  assert.ok(f.platform.login({ email: user.principal.email, password }).token);
  assert.throws(() => f.mail.confirmAccount(token), /inválido|expirado/);
});
test("Confirmation settings require SMTP, resend is generic, replaces old links and respects disabled users", async (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.mail.save(f.admin.principal, { ...f.config, enabled: false }),
    /SMTP/,
  );
  assert.throws(() =>
    f.mail.save({ ...f.admin.principal, role: "reader" }, f.config),
  );
  f.mail.save(f.admin.principal, f.config);
  const user = f.platform.signup(
    { name: "New", company: "New", email: "new@confirmation.test", password },
    (p) => f.mail.queueAccountConfirmation(p.userId),
  );
  await f.mail.tick();
  const first = f.messages[0].text.match(/confirm-account=([a-f0-9]{64})/)![1];
  assert.deepEqual(
    f.mail.resendAccountConfirmation("unknown@confirmation.test"),
    f.mail.resendAccountConfirmation(user.principal.email),
  );
  await f.mail.tick();
  const second = f.messages[1].text.match(/confirm-account=([a-f0-9]{64})/)![1];
  assert.throws(() => f.mail.confirmAccount(first));
  f.store.db
    .prepare("UPDATE account_email_tokens SET expires_at=? WHERE token_hash=?")
    .run(now() - 1, hash(second));
  assert.throws(() => f.mail.confirmAccount(second));
  f.mail.resendAccountConfirmation(user.principal.email);
  await f.mail.tick();
  const third = f.messages[2].text.match(/confirm-account=([a-f0-9]{64})/)![1];
  f.store.db
    .prepare("INSERT INTO user_access(user_id,disabled) VALUES (?,1)")
    .run(user.principal.userId);
  assert.throws(() => f.mail.confirmAccount(third));
  f.store.db
    .prepare("UPDATE user_access SET disabled=0 WHERE user_id=?")
    .run(user.principal.userId);
  f.mail.save(f.admin.principal, {
    ...f.config,
    require_account_confirmation: false,
  });
  assert.ok(f.platform.login({ email: user.principal.email, password }).token);
  f.mail.save(f.admin.principal, f.config);
  assert.throws(() =>
    f.platform.login({ email: user.principal.email, password }),
  );
});
test("HTTP registration with confirmation enabled never returns a session before email validation", async (t) => {
  const f = fixture(t);
  f.mail.save(f.admin.principal, f.config);
  const server = createApp(f.store, undefined, {
    platformAdmins: [f.admin.principal.email],
    aiVault: { masterKey },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const call = (path: string, data: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const response = await call("/api/auth/signup", {
    name: "New",
    company: "New",
    email: "new@confirmation.test",
    password,
  });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await response.json()).verification_required, true);
  const login = await call("/api/auth/login", {
    email: "new@confirmation.test",
    password,
  });
  assert.equal(login.status, 202);
  assert.equal(login.headers.get("set-cookie"), null);
  assert.equal(
    (
      await call("/api/auth/login", {
        email: "new@confirmation.test",
        password: "incorrect-password",
      })
    ).status,
    401,
  );
});

test("Invited users also require confirmation and a failed email preparation rolls registration back", (t) => {
  const f = fixture(t);
  f.mail.save(f.admin.principal, f.config);
  const invitation = f.platform.invite(f.admin.principal, {
    email: "invited@confirmation.test",
    role: "reader",
    organizations: [f.platform.organizations(f.admin.principal)[0].id],
  });
  const invited = f.platform.acceptInvite(
    { token: invitation.token, name: "Invited", password },
    (p) => f.mail.queueAccountConfirmation(p.userId),
  );
  assert.equal(invited.token, "");
  assert.equal(
    f.platform.pendingAccountConfirmation(invited.principal.userId),
    true,
  );
  assert.throws(() =>
    f.platform.signup(
      {
        name: "Failure",
        company: "Failure",
        email: "failure@confirmation.test",
        password,
      },
      () => {
        throw new Error("simulated queue failure");
      },
    ),
  );
  assert.equal(
    f.store.db
      .prepare("SELECT 1 FROM users WHERE email='failure@confirmation.test'")
      .get(),
    undefined,
  );
});
