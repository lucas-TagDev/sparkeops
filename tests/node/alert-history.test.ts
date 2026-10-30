import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { alertHistory } from "../../src/alert-history.ts";
test("alert history: paginates beyond 200, combines filters and protects organization scope", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const p = new Platform(store);
  const a = p.signup({
      name: "Alice",
      company: "A",
      email: "a@alert.test",
      password: "strong-password-123",
    }).principal,
    b = p.signup({
      name: "Bob",
      company: "B",
      email: "b@alert.test",
      password: "strong-password-456",
    }).principal;
  const org = p.organizations(a)[0].id,
    id = p.createServer(a, org, "web").server_id,
    other = p.createServer(b, p.organizations(b)[0].id, "private").server_id;
  for (let i = 0; i < 235; i++)
    store.db
      .prepare(
        "INSERT INTO alerts(id,server_id,kind,severity,message,opened_at,resolved_at,acknowledged_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        "a" + i,
        id,
        i % 2 ? "cpu" : "service:nginx",
        i % 2 ? "warning" : "critical",
        i === 10 ? "literal 100%" : "event " + i,
        now() - i,
        i<2 ? null : now(),
        i % 5 ? null : now(),
      );
  store.db
    .prepare(
      "INSERT INTO alerts(id,server_id,kind,severity,message,opened_at) VALUES (?,?,?,?,?,?)",
    )
    .run("private", other, "cpu", "warning", "SECRET", now());
  const first = alertHistory(p, a, { status: "all", limit: 10 });
  assert.equal(first.total, 235);
  assert.equal(first.items.length, 10);
  assert.equal(first.pages, 24);
  const last = alertHistory(p, a, { status: "all", page: 999 });
  assert.equal(last.page, 24);
  assert.equal(last.items.length, 5);
  assert.equal(alertHistory(p, a, { status: "all", q: "100%" }).total, 1);
  const filtered = alertHistory(p, a, {
    status: "active",
    kind: "service",
    severity: "critical",
  });
  assert.ok(
    filtered.items.every(
      (row) =>
        row.kind === "service:nginx" &&
        row.severity === "critical" &&
        !row.resolved_at,
    ),
  );
  assert.equal(
    alertHistory(p, a, { status: "all", from: now() - 20, to: now() }).total,
    21,
  );
  assert.equal(alertHistory(p, a, { status: "all", q: "SECRET" }).total, 0);
  assert.throws(() => alertHistory(p, a, { server: other }));
  assert.throws(() => alertHistory(p, b, { organization: org }));
  assert.throws(() => alertHistory(p, a, { from: 20, to: 10 }));
  assert.ok(
    alertHistory(p, a, { status: "unacknowledged" }).items.every(
      (row) => !row.resolved_at && !row.acknowledged_at,
    ),
  );
});
