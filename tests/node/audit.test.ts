import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";

test("auditoria pagina todo o histórico, filtra e preserva autor sem expor outra conta", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const a = platform.signup({
    name: "Alice",
    company: "A",
    email: "alice@audit.test",
    password: "strong-password-123",
  }).principal;
  const b = platform.signup({
    name: "Bob",
    company: "B",
    email: "bob@audit.test",
    password: "strong-password-456",
  }).principal;
  for (let i = 0; i < 112; i++)
    platform.audit(a, "platform.branding.updated", "item-" + i);
  platform.audit(b, "platform.branding.updated", "private");
  const first = platform.auditPage(a, { page_size: 10 });
  assert.equal(first.events.length, 10);
  assert.equal(first.total, 113);
  assert.equal(first.pages, 12);
  const last = platform.auditPage(a, { page: 999, page_size: 10 });
  assert.equal(last.page, 12);
  assert.equal(last.events.length, 3);
  const second = platform.auditPage(a, { page: 2, page_size: 10 });
  assert.ok(
    !second.events.some((e) => first.events.some((f) => f.id === e.id)),
  );
  assert.equal(first.events[0].actor_name, "Alice");
  assert.equal(first.events[0].actor_email, "alice@audit.test");
  assert.ok(first.actors.every((u) => u.id === a.userId));
  store.db
    .prepare("UPDATE users SET name=? WHERE id=?")
    .run("Changed", a.userId);
  assert.equal(platform.auditPage(a, {}).events[0].actor_name, "Alice");
  assert.equal(platform.auditPage(a, { q: "Alice" }).total, 113);
  assert.equal(platform.auditPage(a, { q: "Identidade visual" }).total, 112);
  assert.equal(
    platform.auditPage({ ...a, language: "en" }, { q: "Branding updated" })
      .total,
    112,
  );
  assert.equal(platform.auditPage(a, { actor: b.userId }).total, 0);
  assert.equal(platform.auditPage(a, { q: "private" }).total, 0);
  platform.audit(a, "custom.future.action", "100% complete");
  platform.audit(a, "ssh.tested");
  platform.audit(a, "query.future");
  assert.equal(platform.auditPage(a, { q: "%" }).total, 1);
  assert.equal(platform.auditPage(a, { q: "_" }).total, 0);
  assert.ok(
    platform.auditPage(a, { category: "changes", q: "custom.future.action" })
      .total === 1,
  );
  assert.equal(platform.auditPage(a, { category: "access" }).total, 1);
  assert.equal(platform.auditPage(a, { category: "checks" }).total, 1);
  for (const bad of [
    { page: 0 },
    { page_size: 1000 },
    { category: "wrong" },
    { q: "a".repeat(151) },
  ])
    assert.throws(() => platform.auditPage(a, bad));
  assert.throws(() => platform.auditPage({ ...a, role: "reader" }, {}));
  // Existing records without actor snapshots retain the available historical user link.
  store.db
    .prepare(
      "INSERT INTO audit(id,tenant_id,user_id,action,created_at) VALUES(?,?,?,?,?)",
    )
    .run("legacy", a.tenantId, a.userId, "legacy", 1);
  assert.equal(
    platform.auditPage(a, { q: "legacy" }).events[0].actor_name,
    "Changed",
  );
});
