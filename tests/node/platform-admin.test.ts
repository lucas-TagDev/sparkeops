import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { BrandingSettings } from "../../src/branding.ts";
import { PlatformAdministration } from "../../src/platform-admin.ts";
import { createApp } from "../../src/app.ts";

test("administração global: autorização explícita, escopo, metadados e auditoria", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const make = (name: string) =>
    platform.signup({
      name,
      company: name,
      email: name + "@admin.test",
      password: "strong-password-123",
    }).principal;
  const admin = make("root"),
    a = make("Alice"),
    b = make("Bob");
  const access = new BrandingSettings(platform, [admin.email]),
    global = new PlatformAdministration(platform, access);
  assert.throws(() => global.list(a, {}));
  assert.throws(() => global.details(a, b.tenantId));
  assert.throws(() => global.list({ ...admin, orgScope: "scope" }, {}));
  assert.throws(() => global.list({ ...admin, role: "reader" }, {}));
  assert.equal(global.list(admin, {}).total, 3);
  assert.equal(global.list(admin, { q: a.email }).items[0].id, a.tenantId);
  assert.equal(global.list(admin, { q: "%" }).total, 0);
  assert.throws(() => global.list(admin, { page_size: 999 }));
  const detail = global.details(admin, a.tenantId);
  assert.equal(detail.members[0].email, a.email);
  assert.doesNotMatch(
    JSON.stringify(detail),
    /password_hash|agent_token|api_key/,
  );
  global.rename(admin, a.tenantId, "New company");
  assert.equal(global.details(admin, a.tenantId).workspace.name, "New company");
  const audit = platform.auditPage(a, { q: "platform.workspace.updated" });
  assert.equal(audit.events[0].actor_email, admin.email);
  assert.equal(
    platform.auditPage(admin, { q: "platform.workspace.updated" }).total,
    1,
  );
  const org = detail.organizations[0].id,
    other = global.details(admin, b.tenantId).organizations[0].id;
  assert.throws(() =>
    global.organization(admin, a.tenantId, other, "Intrusion"),
  );
  assert.equal(global.details(admin, b.tenantId).organizations[0].name, "Bob");
  global.organization(admin, a.tenantId, org, "Customer renamed");
  assert.equal(
    global.details(admin, a.tenantId).organizations[0].name,
    "Customer renamed",
  );
  assert.throws(() =>
    global.member(admin, a.tenantId, a.userId, {
      role: "reader",
      organizations: [org],
    }),
  );
  assert.throws(() => global.remove(admin, a.tenantId, a.userId));
  const invited = global.invite(admin, a.tenantId, {
    email: "Bob@admin.test",
    role: "admin",
    organizations: [],
  });
  const accepted = platform.acceptInvite({
    token: invited.token,
    password: "strong-password-123",
  });
  assert.equal(accepted.principal.userId, b.userId);
  assert.throws(() =>
    global.member(admin, a.tenantId, b.userId, {
      role: "operator",
      organizations: [other],
    }),
  );
  assert.equal(
    global.details(admin, a.tenantId).members.find((m) => m.id === b.userId)!
      .role,
    "admin",
  );
  global.member(admin, a.tenantId, b.userId, {
    role: "operator",
    organizations: [org],
  });
  assert.throws(() => platform.session(accepted.token));
  assert.equal(platform.principal(b.userId, a.tenantId).role, "operator");
  assert.deepEqual(
    platform
      .organizations(platform.principal(b.userId, a.tenantId))
      .map((o) => o.id),
    [org],
  );
  global.remove(admin, a.tenantId, b.userId);
  assert.throws(() => platform.principal(b.userId, a.tenantId));
  assert.equal(platform.principal(b.userId, b.tenantId).role, "owner");
  assert.throws(() =>
    global.member(admin, admin.tenantId, admin.userId, {
      role: "admin",
      organizations: [],
    }),
  );
});

test("HTTP: proprietário de empresa não acessa administração global; administrador gerencia outro workspace", async (t) => {
  const store = new Store(":memory:");
  const platform = new Platform(store);
  const root = platform.signup({
    name: "Root",
    company: "Platform",
    email: "root@global.test",
    password: "strong-password-123",
  });
  const customer = platform.signup({
    name: "Owner",
    company: "Customer",
    email: "owner@global.test",
    password: "strong-password-456",
  });
  const server = createApp(store, undefined, {
    platformAdmins: ["root@global.test"],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const cookieName = (
    await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "root@global.test",
        password: "strong-password-123",
      }),
    })
  ).headers
    .get("set-cookie")!
    .split("=")[0];
  const req = (token: string, path: string, method = "GET", data?: unknown) =>
    fetch(base + "/api/v1/platform" + path, {
      method,
      headers: {
        Cookie: cookieName + "=" + token,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  assert.equal((await req(customer.token, "/workspaces")).status, 403);
  assert.equal(
    (
      await req(
        customer.token,
        "/workspaces/" + root.principal.tenantId,
        "PATCH",
        { name: "Intrusion" },
      )
    ).status,
    403,
  );
  assert.equal((await req(root.token, "/workspaces")).status, 200);
  assert.equal(
    (
      await req(
        root.token,
        "/workspaces/" + customer.principal.tenantId,
        "PATCH",
        { name: "Updated customer" },
      )
    ).status,
    200,
  );
  const detail = await (
    await req(root.token, "/workspaces/" + customer.principal.tenantId)
  ).json();
  assert.equal(detail.workspace.name, "Updated customer");
  assert.equal(detail.members[0].email, "owner@global.test");
  assert.equal((await req(customer.token, "/plans")).status, 403);
  const plans = (await (await req(root.token, "/plans")).json()).plans;
  const starter = plans.find((p: { id: string }) => p.id === "starter");
  assert.equal(
    (
      await req(customer.token, "/plans/starter", "PUT", {
        ...starter,
        amount: 1,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req(customer.token, "/plans/starter/publish", "POST", {
        revision: starter.revision,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req(root.token, "/plans", "POST", {
        ...starter,
        id: "premium",
        name: "Premium",
        amount: 9990,
      })
    ).status,
    201,
  );
  const changed = await req(root.token, "/plans/starter", "PUT", {
    ...starter,
    amount: 4990,
    name: "Essencial Plus",
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (
      await req(root.token, "/plans/starter", "PUT", {
        ...starter,
        amount: 5990,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await req(root.token, "/plans/starter/publish", "POST", {
        revision: starter.revision + 1,
      })
    ).status,
    503,
  );
  const catalog = await (
    await fetch(base + "/api/v1/billing", {
      headers: { Cookie: cookieName + "=" + customer.token },
    })
  ).json();
  assert.equal(catalog.plans.starter.amount, 4990);
  assert.equal(catalog.plans.premium.amount, 9990);
  assert.equal(catalog.available.includes("starter"), false);
  assert.doesNotMatch(
    JSON.stringify(catalog.plans),
    /priceId|productId|legacyPriceAllowed/,
  );
  assert.equal(
    platform.auditPage(root.principal, { q: "platform.plan.updated" }).total,
    1,
  );
});
