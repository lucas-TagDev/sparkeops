import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { ServiceMonitoring } from "../../src/service-monitoring.ts";
import { Operations } from "../../src/operations.ts";
import { Notifications } from "../../src/notifications.ts";
import { notificationDefaults } from "../../shared/notifications.ts";
function setup(t: TestContext, fetcher?: typeof fetch) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store),
    vault = new AISettings(platform, { masterKey: Buffer.alloc(32, 10) }),
    services = new ServiceMonitoring(
      platform,
      vault,
      fetcher ? { key: "fake", model: "test", fetch: fetcher } : {},
    ),
    ops = new Operations(platform, vault);
  const a = platform.signup({
      name: "Alice",
      company: "A",
      email: "a@service.test",
      password: "strong-password-123",
    }).principal,
    b = platform.signup({
      name: "Bob",
      company: "B",
      email: "b@service.test",
      password: "strong-password-456",
    }).principal;
  const org = platform.organizations(a)[0].id,
    s = platform.createServer(a, org, "web"),
    agent = platform.enroll(s.enrollment_token),
    id = s.server_id;
  store.ingest(agent.agent_token, randomUUID(), {
    cpu_percent: 1,
    memory_percent: 2,
    disk_percent: 3,
  });
  store.db
    .prepare("UPDATE server_config SET duration=0 WHERE server_id=?")
    .run(id);
  const state = (status: string) => {
    platform.recordDetails(agent.agent_token, {
      services: { nginx: status },
      discovered_services: ["nginx"],
      service_alert_mode: "failed_only",
    });
    platform.evaluate();
  };
  state("active");
  return { store, platform, vault, services, ops, a, b, org, id, agent, state };
}
test("services: bulk selection is atomic, scoped, supports the full discovered inventory and preserves AI preferences", (t) => {
  const { services, platform, a, b, id, agent } = setup(t);
  const names = Array.from({ length: 248 }, (_, index) => "custom-" + index);
  platform.recordDetails(agent.agent_token, {
    services: Object.fromEntries(names.map((name) => [name, "active"])),
    discovered_services: names,
  });
  services.save(a, id, names[0], { enabled: true, ai_summary: false });
  assert.throws(() => services.bulk(b, id, { services: names, enabled: true }));
  assert.throws(() =>
    services.bulk({ ...a, role: "reader" }, id, {
      services: names,
      enabled: true,
    }),
  );
  assert.throws(() =>
    services.bulk(a, id, {
      services: [...names, "unknown-unit"],
      enabled: true,
    }),
  );
  assert.equal(services.list(a, id).watches.length, 1);
  services.bulk(a, id, { services: names, enabled: true });
  assert.equal(
    services.list(a, id).watches.filter((row) => row.enabled).length,
    248,
  );
  assert.equal(
    services.list(a, id).watches.find((row) => row.service === names[0])
      ?.ai_summary,
    0,
  );
  services.bulk(a, id, { services: names.slice(0, 20), enabled: false });
  assert.equal(
    services.list(a, id).watches.filter((row) => row.enabled).length,
    228,
  );
  services.bulk(a, id, { services: names, enabled: false });
  assert.equal(
    services.list(a, id).watches.filter((row) => row.enabled).length,
    0,
  );
});
test("services: selected inactive units alert, unknown does not recover and pause suppresses new incidents", async (t) => {
  const { platform, services, a, b, id, state, ops, agent } = setup(t);
  state("inactive");
  assert.equal(platform.alerts(a).length, 0);
  assert.throws(() => services.list(b, id));
  assert.throws(() =>
    services.save({ ...a, role: "reader" }, id, "nginx", {
      enabled: true,
      ai_summary: true,
    }),
  );
  assert.throws(() =>
    services.save(a, id, "nginx;id", { enabled: true, ai_summary: true }),
  );
  services.save(a, id, "nginx", { enabled: true, ai_summary: true });
  assert.deepEqual(ops.agentConfig(agent.agent_token).required_services, [
    "nginx",
  ]);
  state("inactive");
  state("inactive");
  assert.equal(platform.alerts(a).length, 1);
  assert.equal(platform.alerts(a)[0].resolved_at, null);
  state("unknown");
  assert.equal(platform.alerts(a)[0].resolved_at, null);
  state("active");
  assert.ok(platform.alerts(a)[0].resolved_at);
  services.save(a, id, "nginx", { enabled: false, ai_summary: false });
  state("failed");
  assert.equal(platform.alerts(a).length, 1);
  assert.deepEqual(ops.agentConfig(agent.agent_token).required_services, []);
});
test("services: local log summaries feed one AI report and organization channels", async (t) => {
  let calls = 0,
    input: Record<string, unknown> = {};
  const { store, platform, vault, services, a, org, id, state } = setup(
    t,
    (async (_url, options) => {
      calls++;
      input = JSON.parse(JSON.parse(String(options!.body)).input);
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: "Fato: nginx entrou em falha. A leitura local encontrou erros de configuração; a causa precisa ser validada. password=hidden",
              },
            ],
          },
        ],
        usage: { total_tokens: 12 },
      });
    }) as typeof fetch,
  );
  const sent: string[] = [],
    notifications = new Notifications(
      platform,
      vault,
      async (_channel, _config, text) => {
        sent.push(text);
      },
    );
  notifications.save(a, org, "telegram", {
    ...notificationDefaults(),
    enabled: true,
    kinds: ["service"],
    token: "123456:test_token",
    chatId: "-123",
  });
  services.save(a, id, "nginx", { enabled: true, ai_summary: true });
  state("failed");
  await notifications.tick();
  assert.equal(sent.length, 1);
  await services.summaries();
  assert.equal(calls, 0);
  assert.equal(services.list(a, id).reports.length, 1);
  const report = store.db
    .prepare("SELECT log_check_id FROM service_reports WHERE server_id=?")
    .get(id) as { log_check_id: string };
  store.db
    .prepare(
      "UPDATE local_log_checks SET status='completed',result=? WHERE id=?",
    )
    .run(
      JSON.stringify({
        read_status: "ok",
        counts: { configuration_error: 2 },
        scanned: 10,
      }),
      report.log_check_id,
    );
  store.db.prepare("UPDATE service_reports SET report_after=0").run();
  await services.summaries();
  await services.summaries();
  assert.equal(calls, 1);
  assert.equal((input.local_logs as { scanned: number }).scanned, 10);
  assert.equal(services.list(a, id).reports[0].status, "ai");
  await notifications.tick();
  assert.equal(sent.length, 2);
  assert.ok(sent[1].includes("RESUMO IA"));
  assert.ok(!sent[1].includes("password=hidden"));
  state("active");
  await notifications.tick();
  assert.equal(sent.length, 3);
  assert.ok(sent[2].includes("RECUPERADO"));
});
test("services: no historical replay, AI opt out, fallback and cancellation", async (t) => {
  const { store, services, a, id, state } = setup(t);
  state("failed");
  services.save(a, id, "nginx", { enabled: true, ai_summary: true });
  await services.summaries();
  assert.equal(services.list(a, id).reports.length, 0);
  state("active");
  services.save(a, id, "nginx", { enabled: true, ai_summary: false });
  state("failed");
  await services.summaries();
  assert.equal(services.list(a, id).reports.length, 0);
  state("active");
  services.save(a, id, "nginx", { enabled: true, ai_summary: true });
  state("failed");
  await services.summaries();
  store.db.prepare("UPDATE service_reports SET report_after=0").run();
  await services.summaries();
  assert.equal(services.list(a, id).reports[0].status, "basic");
  state("active");
  state("failed");
  await services.summaries();
  services.save(a, id, "nginx", { enabled: false, ai_summary: false });
  assert.equal(services.list(a, id).reports[0].status, "canceled");
});
