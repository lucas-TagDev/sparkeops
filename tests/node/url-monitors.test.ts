import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { URLMonitoring, type URLProbe } from "../../src/url-monitors.ts";
import {
  publicAddress,
  monitoringURL,
  probeURL,
  type ProbeResult,
} from "../../src/url-probe.ts";
import { createApp } from "../../src/app.ts";
import { Billing } from "../../src/billing.ts";
function setup(
  t: TestContext,
  probe: URLProbe = async () => ({
    status_code: 200,
    latency_ms: 42,
    error: null,
  }),
) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const a = platform.signup({
      name: "Alice",
      company: "A",
      email: "a@urls.test",
      password: "strong-password-123",
    }),
    b = platform.signup({
      name: "Bob",
      company: "B",
      email: "b@urls.test",
      password: "strong-password-456",
    });
  const urls = new URLMonitoring(platform, probe),
    org = platform.organizations(a.principal)[0].id;
  const data = {
    name: "Main site",
    url: "https://example.com/health",
    organization: org,
    method: "GET",
    interval_seconds: 60,
    timeout_seconds: 5,
    expected_status: 200,
    failure_threshold: 2,
    enabled: true,
  };
  const due = (id: string) =>
    store.db
      .prepare(
        "UPDATE url_monitors SET last_attempt=0,next_check=?,lease_until=0 WHERE id=?",
      )
      .run(now(), id);
  return { store, platform, a, b, urls, data, due };
}
test("URLs: bloqueia destinos internos, normalizações de IP e redirecionamentos privados", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.3.1",
    "172.16.0.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com",
    "http://localhost",
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://[::ffff:127.0.0.1]",
    "https://example.com:0",
    "https://example.com:65536",
    "http://user:pass@example.com",
  ])
    assert.throws(() => monitoringURL(url), url);
  for (const target of [
    "http://170.78.93.133:8096",
    "https://example.com:8443/health",
    "http://8.8.8.8:8080",
    "https://[2606:4700:4700::1111]:8443/",
  ])
    assert.ok(monitoringURL(target));
  const custom = await probeURL(
    "http://170.78.93.133:8096",
    "GET",
    5,
    async () => {
      throw new Error("IP literals do not need DNS");
    },
    async (url, pinned) => {
      assert.equal(url.port, "8096");
      assert.equal(pinned.address, "170.78.93.133");
      return { status: 200 };
    },
  );
  assert.equal(custom.status_code, 200);
  let calls = 0;
  const blocked = await probeURL(
    "https://example.com",
    "GET",
    5,
    async () => [{ address: "127.0.0.1", family: 4 }],
    async () => {
      calls++;
      return { status: 200 };
    },
  );
  assert.equal(calls, 0);
  assert.equal(blocked.error, "Destino não permitido.");
  const redirected = await probeURL(
    "https://example.com",
    "GET",
    5,
    async () => [{ address: "8.8.8.8", family: 4 }],
    async () => {
      calls++;
      return {
        status: 302,
        location: "http://169.254.169.254/latest/meta-data",
      };
    },
  );
  assert.equal(calls, 1);
  assert.equal(redirected.error, "Destino não permitido.");
  let lookups = 0;
  const success = await probeURL(
    "https://example.com",
    "HEAD",
    5,
    async () => {
      lookups++;
      return [{ address: "8.8.8.8", family: 4 }];
    },
    async (url, pinned, method) => {
      assert.equal(url.hostname, "example.com");
      assert.equal(pinned.address, "8.8.8.8");
      assert.equal(method, "HEAD");
      return { status: 204 };
    },
  );
  assert.equal(success.status_code, 204);
  assert.equal(lookups, 1);
  const mixed = await probeURL(
    "https://example.com",
    "GET",
    5,
    async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    async () => {
      throw new Error("Must not connect");
    },
  );
  assert.equal(mixed.error, "Destino não permitido.");
});
test("URLs: planos, busca, paginação, leitores e isolamento entre clientes", async (t) => {
  const { platform, a, b, urls, data, store } = setup(t);
  platform.catalog.save("trial", {
    ...platform.catalog.get("trial"),
    urlMonitors: 12,
  });
  for (let n = 0; n < 12; n++)
    urls.save(a.principal, undefined, {
      ...data,
      name: n === 0 ? "100% online" : "Site " + n,
    });
  assert.equal(urls.list(a.principal, {}).items.length, 10);
  assert.equal(urls.list(a.principal, { page: 2 }).items.length, 2);
  assert.equal(urls.list(a.principal, { q: "%" }).total, 1);
  assert.equal(urls.list(b.principal, {}).total, 0);
  assert.throws(() => urls.save(a.principal, undefined, data));
  const monitor = urls.list(a.principal, { q: "100%" }).items[0];
  assert.throws(() => urls.details(b.principal, monitor.id));
  assert.throws(() => urls.archive(b.principal, monitor.id));
  const reader = { ...a.principal, role: "reader" as const };
  assert.equal(urls.list(reader, {}).total, 0);
  store.db
    .prepare("INSERT INTO grants VALUES (?,?)")
    .run(reader.userId, data.organization);
  assert.equal(urls.list(reader, {}).total, 12);
  assert.throws(() => urls.save(reader, undefined, data));
  await assert.rejects(urls.check(reader, monitor.id));
  urls.archive(a.principal, monitor.id);
  assert.equal(urls.list(a.principal, {}).used, 11);
  urls.save(a.principal, undefined, data);
  platform.catalog.save("starter", {
    ...platform.catalog.get("starter"),
    urlMonitors: 0,
  });
  const billing = new Billing({
    origin: "http://localhost",
    key: "sk_test_fake",
    webhookSecret: "whsec_fake",
    prices: { starter: "price_fake" },
  });
  await assert.rejects(
    billing.checkout(
      platform,
      a.principal,
      "starter",
      platform.catalog.get("starter").revision,
    ),
    /uso atual/,
  );
});
test("URLs: coleta, indisponibilidade, deduplicação e recuperação de incidentes", async (t) => {
  let result: ProbeResult = { status_code: 500, latency_ms: 80, error: null },
    calls = 0;
  const { platform, a, urls, data, due, store } = setup(t, async () => {
    calls++;
    return result;
  });
  const monitor = urls.save(a.principal, undefined, data);
  let details = await urls.check(a.principal, monitor.id);
  assert.equal(details.monitor.status, "down");
  assert.equal(details.incidents.length, 0);
  await assert.rejects(urls.check(a.principal, monitor.id));
  due(monitor.id);
  await Promise.all([
    urls.tick(),
    new URLMonitoring(platform, async () => {
      throw new Error("Duplicate worker claim");
    }).tick(),
  ]);
  assert.equal(calls, 2);
  details = urls.details(a.principal, monitor.id);
  assert.equal(details.incidents.length, 1);
  assert.equal(details.incidents[0].resolved_at, null);
  due(monitor.id);
  await urls.tick();
  assert.equal(urls.details(a.principal, monitor.id).incidents.length, 1);
  result = { status_code: 200, latency_ms: 35, error: null };
  due(monitor.id);
  details = await urls.check(a.principal, monitor.id);
  assert.equal(details.monitor.status, "up");
  assert.equal(details.monitor.uptime_percent, 25);
  assert.ok(details.incidents[0].resolved_at);
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM outbox WHERE payload LIKE '%url.alert.opened%'",
      )
      .get()!.n,
    1,
  );
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM outbox WHERE payload LIKE '%url.alert.resolved%'",
      )
      .get()!.n,
    1,
  );
  let saved = urls.save(a.principal, monitor.id, {
    ...details.monitor,
    enabled: false,
  });
  assert.equal(urls.details(a.principal, monitor.id).checks.length, 4);
  await assert.rejects(urls.check(a.principal, monitor.id));
  saved = urls.save(a.principal, monitor.id, { ...saved, enabled: true });
  due(monitor.id);
  await urls.check(a.principal, monitor.id);
  assert.equal(urls.details(a.principal, monitor.id).checks.length, 5);
  urls.save(a.principal, monitor.id, {
    ...saved,
    url: "https://example.com/new",
    enabled: true,
  });
  assert.equal(urls.details(a.principal, monitor.id).checks.length, 0);
  assert.equal(
    urls.details(a.principal, monitor.id).monitor.last_checked,
    null,
  );
});
test("URLs: resultado em trânsito não altera monitor editado e conta expirada não coleta", async (t) => {
  let release!: (value: ProbeResult) => void;
  const waiting = new Promise<ProbeResult>((resolve) => {
    release = resolve;
  });
  const { platform, a, urls, data, store } = setup(t, () => waiting);
  const monitor = urls.save(a.principal, undefined, data);
  const checking = urls.check(a.principal, monitor.id);
  urls.save(a.principal, monitor.id, {
    ...monitor,
    url: "https://example.com/changed",
    enabled: true,
  });
  release({ status_code: 200, latency_ms: 20, error: null });
  await checking;
  assert.equal(urls.details(a.principal, monitor.id).checks.length, 0);
  store.db
    .prepare("UPDATE tenants SET trial_until=? WHERE id=?")
    .run(now() - 1, a.principal.tenantId);
  await urls.tick();
  assert.equal(urls.details(a.principal, monitor.id).checks.length, 0);
  await assert.rejects(urls.check(a.principal, monitor.id));
});
test("HTTP URLs: cadastro e verificação são autorizados e métricas não vazam entre contas", async (t) => {
  const { platform, store, a, b, data } = setup(t);
  const server = createApp(store, undefined, {
    urlProbe: async () => ({ status_code: 200, latency_ms: 17, error: null }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const req = (path: string, token: string, method = "GET", body?: unknown) =>
    fetch(base + "/api/v1/url-monitors" + path, {
      method,
      headers: {
        Cookie: "foxops_session=" + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const created = await req("", a.token, "POST", data);
  assert.equal(created.status, 201);
  const monitor = await created.json();
  assert.equal((await req("/" + monitor.id, b.token)).status, 404);
  assert.equal(
    (await req("/" + monitor.id + "/check", b.token, "POST", {})).status,
    404,
  );
  const checked = await req("/" + monitor.id + "/check", a.token, "POST", {});
  assert.equal(checked.status, 200);
  assert.equal((await checked.json()).monitor.latency_ms, 17);
  assert.equal(
    (await (await req("", a.token)).json()).items[0].uptime_percent,
    100,
  );
  assert.equal(platform.account(a.principal).url_monitor_count, 1);
});
