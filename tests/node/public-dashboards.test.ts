import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { URLMonitoring } from "../../src/url-monitors.ts";
import { PublicDashboards } from "../../src/public-dashboards.ts";
function setup(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const a = platform.signup({
      name: "Alice",
      company: "A",
      email: "a@public.test",
      password: "strong-password-123",
    }),
    b = platform.signup({
      name: "Bob",
      company: "B",
      email: "b@public.test",
      password: "strong-password-456",
    });
  const urls = new URLMonitoring(platform),
    vault = new AISettings(platform, { masterKey: Buffer.alloc(32, 7) }),
    boards = new PublicDashboards(
      platform,
      vault,
      "https://monitor.example.com",
    );
  const org = platform.organizations(a.principal)[0].id,
    orgB = platform.organizations(b.principal)[0].id;
  const server = platform.createServer(a.principal, org, "Ubuntu"),
    other = platform.createServer(b.principal, orgB, "Private tenant");
  const url = urls.save(a.principal, undefined, {
    organization: org,
    name: "Website",
    url: "https://example.com/private?secret=hidden",
    enabled: true,
  });
  const config = {
    title: "Operations TV",
    enabled: true,
    servers: "selected",
    server_ids: [server.server_id],
    urls: "selected",
    url_ids: [url.id],
    show_metrics: false,
    show_addresses: false,
  };
  return { store, platform, a, b, boards, server, other, config, org, url };
}
const token = (link: string) =>
  new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
test("public dashboards: explicit selection, no sensitive data and tenant isolation", (t) => {
  const f = setup(t),
    board = f.boards.save(f.a.principal, undefined, f.config),
    secret = token(board.link);
  const snapshot = f.boards.snapshot(secret, {});
  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.summary.servers, 1);
  const serialized = JSON.stringify(snapshot);
  for (const hidden of [
    "Private tenant",
    "private?",
    "hidden",
    secret,
    f.server.server_id,
    f.a.principal.tenantId,
  ])
    assert.ok(!serialized.includes(hidden));
  assert.ok(snapshot.items.every((item) => !item.address && !item.metrics));
  assert.throws(() =>
    f.boards.save(f.a.principal, undefined, {
      ...f.config,
      server_ids: [f.other.server_id],
    }),
  );
  assert.throws(() => f.boards.rotate(f.b.principal, board.id));
  assert.throws(() => f.boards.list({ ...f.a.principal, role: "reader" }));
  const row = f.store.db
    .prepare("SELECT * FROM public_dashboards WHERE id=?")
    .get(board.id)!;
  assert.notEqual(row.encrypted_token, secret);
  assert.notEqual(row.token_hash, secret);
});
test("public dashboards: rotation, disabling and deletion revoke public access", (t) => {
  const f = setup(t),
    first = f.boards.save(f.a.principal, undefined, f.config),
    old = token(first.link),
    rotated = f.boards.rotate(f.a.principal, first.id),
    fresh = token(rotated.link);
  assert.throws(() => f.boards.snapshot(old, {}));
  assert.equal(f.boards.snapshot(fresh, {}).total, 2);
  f.boards.save(f.a.principal, first.id, { ...f.config, enabled: false });
  assert.throws(() => f.boards.snapshot(fresh, {}));
  f.boards.save(f.a.principal, first.id, f.config);
  assert.equal(f.boards.snapshot(fresh, {}).total, 2);
  f.boards.remove(f.a.principal, first.id);
  assert.throws(() => f.boards.snapshot(fresh, {}));
});
test("public dashboards: all includes future resources; selected and kind never broaden scope", (t) => {
  const f = setup(t),
    selected = f.boards.save(f.a.principal, undefined, f.config),
    all = f.boards.save(f.a.principal, undefined, {
      ...f.config,
      servers: "all",
    });
  f.platform.createServer(f.a.principal, f.org, "New server");
  assert.equal(f.boards.snapshot(token(selected.link), {}).summary.servers, 1);
  assert.equal(f.boards.snapshot(token(all.link), {}).summary.servers, 2);
  const urls = f.boards.snapshot(token(all.link), { kind: "url" });
  assert.equal(urls.total, 1);
  assert.ok(urls.items.every((i) => i.kind === "url"));
});
test("public dashboards: explicitly published metrics and sanitized origins", (t) => {
  const f = setup(t);
  f.store.db
    .prepare("UPDATE server_config SET enabled=1 WHERE server_id=?")
    .run(f.server.server_id);
  f.store.db
    .prepare(
      "INSERT INTO samples(server_id,event_id,received_at,metrics) VALUES(?,?,?,?)",
    )
    .run(
      f.server.server_id,
      "sample",
      now(),
      JSON.stringify({
        cpu_percent: 12,
        memory_percent: 40,
        disk_percent: 55,
        secret: "never public",
      }),
    );
  const board = f.boards.save(f.a.principal, undefined, {
    ...f.config,
    show_metrics: true,
    show_addresses: true,
  });
  const items = f.boards.snapshot(token(board.link), {}).items;
  assert.deepEqual(items.find((i) => i.kind === "server")?.metrics, {
    cpu: 12,
    memory: 40,
    disk: 55,
  });
  assert.equal(items.find((i) => i.kind === "server")?.status, "up");
  assert.equal(
    items.find((i) => i.kind === "url")?.address,
    "https://example.com",
  );
  assert.ok(!JSON.stringify(items).includes("never public"));
});
import { createApp } from "../../src/app.ts";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
test("public dashboards: HTTP read-only link works without session; management requires login", async (t) => {
  const f = setup(t),
    board = f.boards.save(f.a.principal, undefined, f.config);
  const server = createApp(f.store, undefined, {
    aiVault: { masterKey: Buffer.alloc(32, 7) },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  );
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const visible = await fetch(base + "/api/public/dashboard", {
    headers: { Authorization: "Bearer " + token(board.link) },
  });
  assert.equal(visible.status, 200);
  assert.match(visible.headers.get("Cache-Control")!, /no-store/);
  assert.equal((await visible.json()).total, 2);
  assert.equal((await fetch(base + "/api/public/dashboard")).status, 404);
  assert.equal((await fetch(base + "/api/v1/public-dashboards")).status, 401);
});
test("public dashboards: pagination and expired subscriptions do not expose stale public data", (t) => {
  const f = setup(t);
  for (let i = 0; i < 14; i++)
    f.store.register(f.org, "Extra " + String(i).padStart(2, "0"));
  const board = f.boards.save(f.a.principal, undefined, {
      ...f.config,
      servers: "all",
    }),
    secret = token(board.link);
  const first = f.boards.snapshot(secret, { page: 1 }),
    second = f.boards.snapshot(secret, { page: 2 });
  assert.equal(first.items.length, 12);
  assert.equal(second.items.length, 4);
  assert.equal(first.pages, 2);
  assert.ok(
    first.items.every((a) => !second.items.some((b) => b.key === a.key)),
  );
  f.store.db
    .prepare("UPDATE tenants SET trial_until=? WHERE id=?")
    .run(now() - 60, f.a.principal.tenantId);
  assert.throws(() => f.boards.snapshot(secret, {}));
});
