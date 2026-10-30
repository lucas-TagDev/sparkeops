import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { BrandingSettings } from "../../src/branding.ts";
import { PlatformAdministration } from "../../src/platform-admin.ts";
test("global accounts: lifecycle, passwords, disabled sessions and last active owner", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const p = new Platform(store);
  const make = (name: string) =>
    p.signup({
      name,
      company: name,
      email: name + "@access.test",
      password: "original-password-123",
    });
  const root = make("root"),
    a = make("alice"),
    b = make("bob");
  const admin = new PlatformAdministration(
    p,
    new BrandingSettings(p, [root.principal.email]),
  );
  assert.throws(() => admin.accounts(a.principal, {}));
  assert.equal(admin.accounts(root.principal, {}).total, 3);
  assert.equal(
    admin.accounts(root.principal, { q: a.principal.email, status: "trialing" })
      .total,
    1,
  );
  assert.throws(() =>
    admin.userAccess(root.principal, root.principal.userId, { disabled: true }),
  );
  assert.throws(() =>
    admin.userAccess(root.principal, a.principal.userId, { disabled: true }),
  );
  const invite = p.invite(a.principal, {
    email: b.principal.email,
    role: "admin",
    organizations: [],
  });
  p.acceptInvite({ token: invite.token, password: "original-password-123" });
  admin.member(root.principal, a.principal.tenantId, b.principal.userId, {
    role: "owner",
    organizations: [],
  });
  admin.userAccess(root.principal, a.principal.userId, { disabled: true });
  assert.throws(() => p.session(a.token));
  assert.throws(() =>
    p.login({ email: a.principal.email, password: "original-password-123" }),
  );
  assert.throws(() => p.newSession(a.principal));
  assert.throws(() =>
    admin.member(root.principal, a.principal.tenantId, b.principal.userId, {
      role: "admin",
      organizations: [],
    }),
  );
  admin.userAccess(root.principal, a.principal.userId, { disabled: false });
  admin.userAccess(root.principal, a.principal.userId, {
    password: "new-strong-password-123",
  });
  assert.throws(() =>
    p.login({ email: a.principal.email, password: "original-password-123" }),
  );
  assert.equal(
    p.login({ email: a.principal.email, password: "new-strong-password-123" })
      .principal.userId,
    a.principal.userId,
  );
  assert.doesNotMatch(
    JSON.stringify(admin.accounts(root.principal, {})),
    /password_hash|new-strong-password/,
  );
});
