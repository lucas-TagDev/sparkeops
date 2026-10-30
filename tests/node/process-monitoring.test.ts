import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { ProcessMonitoring } from "../../src/process-monitoring.ts";
import { Notifications } from "../../src/notifications.ts";
import { notificationDefaults } from "../../shared/notifications.ts";
import { createApp } from "../../src/app.ts";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
function setup(t: TestContext, fetcher?: typeof fetch) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store),
    vault = new AISettings(platform, { masterKey: Buffer.alloc(32, 9) }),
    monitor = new ProcessMonitoring(
      platform,
      vault,
      fetcher ? { key: "fake", model: "test", fetch: fetcher } : {},
    );
  const a = platform.signup({
      name: "Alice",
      company: "A",
      email: "a@watch.test",
      password: "strong-password-123",
    }).principal,
    b = platform.signup({
      name: "Bob",
      company: "B",
      email: "b@watch.test",
      password: "strong-password-456",
    }).principal;
  const org = platform.organizations(a)[0].id,
    server = platform.createServer(a, org, "worker"),
    agent = platform.enroll(server.enrollment_token),
    id = server.server_id;
  const data = {
    name: "node",
    user: "worker",
    service: "",
    min_count: 1,
    cpu_limit: 80,
    memory_limit: 50,
    duration: 60,
    alert_restarts: true,
    ai_summary: true,
    enabled: true,
  };
  monitor.save(a, id, undefined, data);
  const rule = monitor.list(a, id).rules[0];
  let tick = now() - 20;
  const payload = (overrides: Record<string, unknown> = {}) => ({
    event_id: randomUUID(),
    collected_at: ++tick,
    results: [
      {
        id: rule.id,
        revision: rule.revision,
        read_status: "ok",
        count: 1,
        cpu_percent: 10,
        memory_percent: 10,
        identities: ["10:100"],
        ...overrides,
      },
    ],
  });
  const record = (overrides: Record<string, unknown> = {}) =>
    monitor.record(agent.agent_token, payload(overrides));
  return {
    store,
    platform,
    vault,
    monitor,
    a,
    b,
    org,
    id,
    agent,
    data,
    rule,
    payload,
    record,
  };
}
test("process monitoring: rules are scoped, revisioned and never infer a crash from missing telemetry", (t) => {
  const { store, monitor, a, b, id, agent, rule, payload, record, data } =
    setup(t);
  assert.throws(() => monitor.list(b, id));
  assert.throws(() =>
    monitor.save({ ...a, role: "reader" }, id, undefined, data),
  );
  assert.throws(() => monitor.save(a, id, undefined, data), /mesmos filtros/);
  assert.equal(monitor.config(agent.agent_token).length, 1);
  record({ count: 0, cpu_percent: 0, memory_percent: 0, identities: [] });
  assert.equal(monitor.list(a, id).incidents.length, 0);
  store.db
    .prepare("UPDATE process_rules SET state=? WHERE id=?")
    .run(JSON.stringify({ missing: now() - 80 }), rule.id);
  record({
    read_status: "partial",
    count: 0,
    cpu_percent: null,
    memory_percent: null,
    identities: [],
  });
  assert.equal(monitor.list(a, id).incidents.length, 0);
  record({ count: 0, cpu_percent: 0, memory_percent: 0, identities: [] });
  assert.equal(monitor.list(a, id).incidents.length, 0);
  store.db
    .prepare("UPDATE process_rules SET state=? WHERE id=?")
    .run(JSON.stringify({ missing: now() - 80 }), rule.id);
  const event = payload({
    count: 0,
    cpu_percent: 0,
    memory_percent: 0,
    identities: [],
  });
  monitor.record(agent.agent_token, event);
  monitor.record(agent.agent_token, event);
  assert.equal(monitor.list(a, id).incidents.length, 1);
  record({
    read_status: "unavailable",
    count: 0,
    cpu_percent: null,
    memory_percent: null,
    identities: [],
  });
  assert.equal(monitor.list(a, id).incidents[0].resolved_at, null);
  record();
  assert.ok(monitor.list(a, id).incidents[0].resolved_at);
  monitor.save(a, id, String(rule.id), { ...data, revision: rule.revision });
  record({ count: 0, identities: [] });
  assert.equal(monitor.list(a, id).rules[0].last_received, null);
});
test("process monitoring: sustained resources, identity replacement and read gaps deduplicate incidents", (t) => {
  const { store, monitor, a, id, rule, record } = setup(t);
  record();
  record({ cpu_percent: 90 });
  assert.equal(monitor.list(a, id).incidents.length, 0);
  store.db
    .prepare("UPDATE process_rules SET state=? WHERE id=?")
    .run(JSON.stringify({ cpu: now() - 90 }), rule.id);
  record({ cpu_percent: 90 });
  record({ cpu_percent: 95 });
  assert.equal(monitor.list(a, id).incidents.length, 1);
  record();
  assert.ok(monitor.list(a, id).incidents[0].resolved_at);
  record({ identities: ["20:200"] });
  assert.equal(monitor.list(a, id).incidents.length, 2);
  record({ identities: ["20:200"] });
  assert.ok(monitor.list(a, id).incidents[0].resolved_at);
  store.db
    .prepare("UPDATE process_rules SET last_received=? WHERE id=?")
    .run(now() - 200, rule.id);
  record({ identities: ["30:300"] });
  assert.equal(monitor.list(a, id).incidents.length, 2);
});
test("process monitoring: one AI summary per incident, provider usage and organization notifications", async (t) => {
  let calls = 0;
  const fixture = setup(t, (async () => {
    calls++;
    return Response.json({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: "Fato: node não foi encontrado nas coletas. Hipótese: parada planejada ou falha; causa não confirmada. Próximo passo: verificar o serviço. password=hidden",
            },
          ],
        },
      ],
      usage: { total_tokens: 23 },
    });
  }) as typeof fetch);
  const { store, monitor, a, id, rule, record, platform, vault, org } = fixture,
    sent: string[] = [];
  const notifications = new Notifications(
    platform,
    vault,
    async (_channel, _config, text) => {
      sent.push(text);
    },
  );
  notifications.save(a, org, "telegram", {
    ...notificationDefaults(),
    enabled: true,
    kinds: ["process"],
    token: "123456:test_token",
    chatId: "-123",
  });
  record({ count: 0, cpu_percent: 0, memory_percent: 0, identities: [] });
  store.db
    .prepare("UPDATE process_rules SET state=? WHERE id=?")
    .run(JSON.stringify({ missing: now() - 70 }), rule.id);
  record({ count: 0, cpu_percent: 0, memory_percent: 0, identities: [] });
  await notifications.tick();
  assert.equal(sent.length, 1);
  await monitor.summaries();
  await monitor.summaries();
  assert.equal(calls, 1);
  await notifications.tick();
  assert.equal(sent.length, 2);
  assert.ok(sent[1].includes("RESUMO IA"));
  assert.ok(!sent[1].includes("password=hidden"));
  assert.equal(monitor.list(a, id).incidents[0].summary_mode, "ai");
  const usage = store.db
    .prepare("SELECT calls,tokens FROM ai_usage WHERE tenant_id=?")
    .get(a.tenantId) as { calls: number; tokens: number };
  assert.equal(usage.calls, 1);
  assert.equal(usage.tokens, 23);
  record();
  await notifications.tick();
  assert.equal(sent.length, 3);
  assert.ok(sent[2].includes("RECUPERADO"));
});
test("process monitoring: no AI sends technical alert, service logs are local jobs and pause prevents stale reporting", async (t) => {
  const { store, monitor, a, id, rule, record, data } = setup(t);
  record({ count: 0, cpu_percent: 0, memory_percent: 0, identities: [] });
  store.db
    .prepare("UPDATE process_rules SET state=? WHERE id=?")
    .run(JSON.stringify({ missing: now() - 70 }), rule.id);
  record({ count: 0, cpu_percent: 0, memory_percent: 0, identities: [] });
  await monitor.summaries();
  assert.equal(monitor.list(a, id).incidents[0].summary_mode, "basic");
  assert.ok(
    String(monitor.list(a, id).incidents[0].summary).includes(
      "Causa não confirmada",
    ),
  );
  monitor.save(a, id, String(rule.id), {
    ...data,
    service: "queue",
    revision: 1,
  });
  const latest = monitor.list(a, id).rules[0];
  assert.equal(latest.revision, 2);
  record({
    revision: 2,
    count: 0,
    cpu_percent: 0,
    memory_percent: 0,
    identities: [],
  });
  store.db
    .prepare("UPDATE process_rules SET state=? WHERE id=?")
    .run(JSON.stringify({ missing: now() - 70 }), rule.id);
  record({
    revision: 2,
    count: 0,
    cpu_percent: 0,
    memory_percent: 0,
    identities: [],
  });
  const check = store.db
    .prepare(
      "SELECT l.service,l.status FROM local_log_checks l JOIN process_incidents i ON i.log_check_id=l.id WHERE i.rule_id=? AND i.resolved_at IS NULL",
    )
    .get(rule.id) as { service: string; status: string };
  assert.equal(check.service, "queue");
  assert.equal(check.status, "pending");
  monitor.remove(a, id, String(rule.id));
  assert.equal(monitor.list(a, id).rules[0].enabled, 0);
  assert.equal(monitor.list(a, id).incidents[0].summary_mode, "canceled");
  await monitor.summaries();
});
test("HTTP process monitoring: agent gets rule configuration and reports without a user session", async (t) => {
  const { store, platform, a, b, id, agent, payload, rule } = setup(t),
    server = createApp(store, undefined, {
      aiVault: { masterKey: Buffer.alloc(32, 9) },
    });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const result = await fetch(base + "/api/metrics", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + agent.agent_token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_id: randomUUID(),
      metrics: { cpu_percent: 1, memory_percent: 2, disk_percent: 3 },
    }),
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).process_monitors[0].id, rule.id);
  assert.equal(
    (
      await fetch(base + "/api/agent/process-watch", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + agent.agent_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload()),
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(base + `/api/v1/servers/${id}/process-monitors`)).status,
    401,
  );
  const bToken = platform.login({
    email: b.email,
    password: "strong-password-456",
  }).token;
  assert.equal(
    (
      await fetch(base + `/api/v1/servers/${id}/process-monitors`, {
        headers: { Cookie: "foxops_session=" + bToken },
      })
    ).status,
    404,
  );
  const aToken = platform.login({
    email: a.email,
    password: "strong-password-123",
  }).token;
  assert.equal(
    (
      await fetch(base + `/api/v1/servers/${id}/process-monitors`, {
        headers: { Cookie: "foxops_session=" + aToken },
      })
    ).status,
    200,
  );
});
