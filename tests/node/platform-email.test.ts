import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { BrandingSettings } from "../../src/branding.ts";
import { PlatformEmail } from "../../src/platform-email.ts";
function fixture() {
  const store = new Store(":memory:"),
    platform = new Platform(store);
  const make = (name: string) =>
    platform.signup({
      name,
      company: name,
      email: name + "@email.test",
      password: "original-password-123",
    });
  const admin = make("admin"),
    user = make("client");
  const vault = new AISettings(platform, { masterKey: Buffer.alloc(32, 7) });
  const messages: { to: string; subject: string; text: string }[] = [];
  const mail = new PlatformEmail(
    platform,
    vault,
    new BrandingSettings(platform, [admin.principal.email]),
    "https://monitor.example",
    async (_c, m) => {
      messages.push(m);
    },
  );
  const config = {
    enabled: true,
    host: "smtp.example.com",
    port: 587,
    user: "mailer",
    password: "smtp-secret-123",
    from: "no-reply@example.com",
  };
  return { store, platform, admin, user, vault, mail, messages, config };
}
test("platform email: admin authorization, encrypted SMTP, test, reset once, disabled accounts and retries", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const { mail, admin, user, platform, store, messages, config } = f;
  assert.throws(() => mail.save(user.principal, config));
  assert.throws(() => mail.save({ ...admin.principal, orgScope: "x" }, config));
  mail.save(admin.principal, config);
  assert.doesNotMatch(
    JSON.stringify(mail.settings(admin.principal)),
    /smtp-secret/,
  );
  assert.doesNotMatch(
    String(
      store.db.prepare("SELECT value FROM platform_email_config").get()!.value,
    ),
    /smtp-secret/,
  );
  await mail.test(admin.principal);
  assert.equal(messages[0].to, admin.principal.email);
  assert.deepEqual(
    mail.forgot("absent@email.test"),
    mail.forgot(user.principal.email),
  );
  await mail.tick();
  const reset = messages.find((m) => m.to === user.principal.email)!;
  const token = reset.text.match(/#reset=([a-f0-9]{64})/)![1];
  assert.ok(reset.text.includes("https://monitor.example/"));
  assert.doesNotMatch(
    JSON.stringify(
      store.db.prepare("SELECT * FROM account_email_tokens").all(),
    ),
    new RegExp(token),
  );
  mail.reset({ token, password: "replacement-password-123" });
  assert.throws(() => platform.session(user.token));
  assert.throws(() => mail.reset({ token, password: "another-password-123" }));
  assert.equal(
    platform.login({
      email: user.principal.email,
      password: "replacement-password-123",
    }).principal.userId,
    user.principal.userId,
  );
  mail.forgot(user.principal.email);
  await mail.tick();
  const second = messages
    .filter((m) => m.text.includes("#reset="))
    .at(-1)!
    .text.match(/#reset=([a-f0-9]{64})/)![1];
  store.db.prepare("UPDATE account_email_tokens SET expires_at=1").run();
  assert.throws(() =>
    mail.reset({ token: second, password: "replacement-password-123" }),
  );
  store.db
    .prepare("INSERT INTO user_access VALUES (?,1)")
    .run(user.principal.userId);
  const count = store.db
    .prepare("SELECT count(*) AS n FROM account_email_tokens")
    .get()!.n;
  mail.forgot(user.principal.email);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM account_email_tokens").get()!.n,
    count,
  );
});
test("platform email: current password, confirm new address, notify previous address, collision and revocation", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const { mail, admin, user, platform, messages, config, store } = f;
  mail.save(admin.principal, config);
  assert.throws(() =>
    mail.changeEmail(user.principal, {
      email: "new@email.test",
      password: "wrong",
    }),
  );
  assert.throws(() =>
    mail.changeEmail(user.principal, {
      email: admin.principal.email,
      password: "original-password-123",
    }),
  );
  mail.changeEmail(user.principal, {
    email: "new@email.test",
    password: "original-password-123",
  });
  assert.equal(
    platform.principal(user.principal.userId, user.principal.tenantId).email,
    user.principal.email,
  );
  await mail.tick();
  const token = messages[0].text.match(/#confirm-email=([a-f0-9]{64})/)![1];
  mail.confirmEmail(token);
  assert.throws(() => platform.session(user.token));
  assert.throws(() => mail.confirmEmail(token));
  assert.equal(
    platform.login({
      email: "new@email.test",
      password: "original-password-123",
    }).principal.userId,
    user.principal.userId,
  );
  await mail.tick();
  assert.ok(
    messages.some(
      (m) =>
        m.to === user.principal.email &&
        m.subject === "E-mail da conta alterado",
    ),
  );
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM audit WHERE action='user.email.changed'",
      )
      .get()!.n,
    1,
  );
});
test("platform email: SMTP failures retry without exposing message or credentials", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.mail.save(f.admin.principal, f.config);
  f.mail.sender = async () => {
    throw new Error("secret smtp response");
  };
  f.mail.forgot(f.user.principal.email);
  await f.mail.tick();
  const row = f.store.db.prepare("SELECT * FROM platform_email_queue").get()!;
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, "smtp_delivery_failed");
  assert.doesNotMatch(String(row.payload), /reset=|client@email.test/);
  f.mail.sender = async (_c, m) => {
    f.messages.push(m);
  };
  f.store.db.prepare("UPDATE platform_email_queue SET next_at=0").run();
  await f.mail.tick();
  assert.equal(
    f.store.db.prepare("SELECT payload FROM platform_email_queue").get()!
      .payload,
    "",
  );
});

test("self password change: verifies current password, validates confirmation and invalidates sessions and recovery links without SMTP", (t) => {
  const { store, platform, user, admin, mail } = fixture();
  t.after(() => store.close());
  assert.throws(() =>
    mail.changePassword(user.principal, {
      current_password: "wrong",
      password: "replacement-password-123",
      confirm_password: "replacement-password-123",
    }),
  );
  assert.throws(() =>
    mail.changePassword(user.principal, {
      current_password: "original-password-123",
      password: "replacement-password-123",
      confirm_password: "mismatch",
    }),
  );
  assert.throws(() =>
    mail.changePassword(
      { ...user.principal, orgScope: "scope" },
      {
        current_password: "original-password-123",
        password: "replacement-password-123",
        confirm_password: "replacement-password-123",
      },
    ),
  );
  assert.throws(() =>
    mail.changePassword(user.principal, {
      current_password: "original-password-123",
      password: "original-password-123",
      confirm_password: "original-password-123",
    }),
  );
  assert.ok(platform.session(user.token));
  const token = mail.createToken(
    {
      id: user.principal.userId,
      email: user.principal.email,
      password_hash: String(
        store.db
          .prepare("SELECT password_hash FROM users WHERE id=?")
          .get(user.principal.userId)!.password_hash,
      ),
    },
    "reset",
  );
  mail.changePassword(user.principal, {
    current_password: "original-password-123",
    password: "replacement-password-123",
    confirm_password: "replacement-password-123",
  });
  assert.throws(() => platform.session(user.token));
  assert.throws(() => mail.consume(token, "reset"));
  assert.throws(() =>
    platform.login({
      email: user.principal.email,
      password: "original-password-123",
    }),
  );
  assert.equal(
    platform.login({
      email: user.principal.email,
      password: "replacement-password-123",
    }).principal.userId,
    user.principal.userId,
  );
  assert.ok(platform.session(admin.token));
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM audit WHERE action='user.password.changed'",
      )
      .get()!.n,
    1,
  );
});
