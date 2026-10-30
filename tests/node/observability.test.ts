import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { Operations, type SSHExecutor } from "../../src/operations.ts";
import { Observability } from "../../src/observability.ts";
import { Runbooks } from "../../src/runbooks.ts";
import { analyzeSeries } from "../../shared/observability.ts";
import { Notifications } from "../../src/notifications.ts";
import { notificationDefaults } from "../../shared/notifications.ts";
import { createApp } from "../../src/app.ts";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
function fixture(
  t: TestContext,
  exec: SSHExecutor = async () => ({
    code: 0,
    output: 'FOXOPS_RUNBOOK:{"status":"completed","exit_code":0,"output":"ok"}',
  }),
) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store),
    vault = new AISettings(platform, { masterKey: Buffer.alloc(32, 8) }),
    ops = new Operations(platform, vault, exec);
  const a = platform.signup({
      name: "Alice",
      company: "A",
      email: "a@obs.test",
      password: "strong-password-123",
    }).principal,
    b = platform.signup({
      name: "Bob",
      company: "B",
      email: "b@obs.test",
      password: "strong-password-456",
    }).principal;
  const org = platform.organizations(a)[0].id,
    s = platform.createServer(a, org, "web"),
    agent = platform.enroll(s.enrollment_token),
    id = s.server_id;
  store.ingest(agent.agent_token, randomUUID(), {
    cpu_percent: 10,
    memory_percent: 30,
    disk_percent: 40,
  });
  ops.saveSSH(a, id, {
    host: "192.168.3.50",
    port: 22,
    username: "foxops",
    fingerprint: "SHA256:" + "A".repeat(43),
    password: "test-only",
  });
  const obs = new Observability(platform),
    books = new Runbooks(platform, ops);
  const data = {
    name: "Recover nginx",
    description: "Restart nginx only when its health check fails.",
    path: "/opt/foxops-runbooks/nginx.sh",
    sha256: "a".repeat(64),
    trigger_kind: "service:nginx",
    mode: "manual",
    enabled: true,
    cooldown: 300,
    daily_limit: 2,
  };
  return {
    store,
    platform,
    vault,
    ops,
    a,
    b,
    org,
    id,
    agent,
    obs,
    books,
    data,
  };
}
test("AIOps: cold start, robust anomaly, isolated spikes, disk projection and stale data", () => {
  const at = now(),
    points = Array.from({ length: 80 }, (_, i) => ({
      at: at - (80 - i) * 3600,
      value: 40,
    }));
  assert.ok(analyzeSeries("cpu_percent", points.slice(-10), at).learning);
  assert.equal(analyzeSeries("cpu_percent", points, at).finding, null);
  points[79].value = 99;
  assert.equal(analyzeSeries("cpu_percent", points, at).finding, null);
  points[78].value = 96;
  points[77].value = 97;
  assert.equal(
    analyzeSeries("cpu_percent", points, at).finding?.type,
    "anomaly",
  );
  const disk = Array.from({ length: 80 }, (_, i) => ({
    at: at - (80 - i) * 3600,
    value: 40 + i * 0.4,
  }));
  const forecast = analyzeSeries("disk_percent", disk, at).finding;
  assert.equal(forecast?.type, "forecast");
  assert.ok(forecast!.eta_hours! > 40 && forecast!.eta_hours! < 50);
  assert.equal(
    analyzeSeries(
      "disk_percent",
      disk.map((p) => ({ ...p, value: 90 - p.value })),
      at,
    ).finding,
    null,
  );
  assert.ok(analyzeSeries("disk_percent", disk, at + 4 * 3600).learning);
});
test("AIOps: historical metrics create deduplicated predictive incidents and tenant notifications", async (t) => {
  const { store, platform, a, b, id, org, obs, vault } = fixture(t),
    sent: string[] = [];
  const notifications = new Notifications(
    platform,
    vault,
    async (_c, _cfg, message) => {
      sent.push(message);
    },
  );
  notifications.save(a, org, "telegram", {
    ...notificationDefaults(),
    enabled: true,
    token: "123456:test_token",
    chatId: "-123",
    kinds: ["predictive"],
  });
  const hour = Math.floor(now() / 3600) * 3600;
  for (let i = 80; i >= 1; i--)
    store.db.prepare("INSERT INTO samples VALUES (?,?,?,?)").run(
      id,
      randomUUID(),
      hour - i * 3600 + 10,
      JSON.stringify({
        cpu_percent: i <= 3 ? 96 : 10,
        memory_percent: 30,
        disk_percent: 40,
      }),
    );
  assert.ok(
    obs.context(a, id).findings.some((f) => f.metric === "cpu_percent"),
  );
  assert.throws(() => obs.context(b, id));
  obs.evaluate();
  obs.evaluate();
  assert.equal(
    (
      store.db
        .prepare(
          "SELECT count(*) n FROM predictive_findings WHERE resolved_at IS NULL",
        )
        .get() as { n: number }
    ).n,
    1,
  );
  await notifications.tick();
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("cpu_percent"));
  store.db
    .prepare("UPDATE samples SET metrics=? WHERE server_id=?")
    .run(
      JSON.stringify({ cpu_percent: 10, memory_percent: 30, disk_percent: 40 }),
      id,
    );
  obs.evaluate();
  await notifications.tick();
  assert.equal(sent.length, 2);
  assert.ok(sent[1].includes("RECUPERADO"));
  obs.record(id, {
    telemetry: { temperature_max_c: 70, disk_await_ms: -1, secret: 123 },
  });
  const row = store.db
    .prepare("SELECT data FROM hardware_samples WHERE server_id=?")
    .get(id) as { data: string };
  assert.deepEqual(JSON.parse(row.data), { temperature_max_c: 70 });
});
function traceInput(at = now() - 10) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "api" } }],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: "a".repeat(32),
                spanId: "b".repeat(16),
                name: "SELECT users",
                startTimeUnixNano: String(
                  BigInt(Math.floor(at * 1000)) * 1000000n,
                ),
                endTimeUnixNano: String(
                  BigInt(Math.floor(at * 1000 + 500)) * 1000000n,
                ),
                status: { code: 2 },
                attributes: [
                  {
                    key: "db.operation.name",
                    value: { stringValue: "SELECT" },
                  },
                  {
                    key: "db.statement",
                    value: { stringValue: "SELECT password FROM users" },
                  },
                  {
                    key: "authorization",
                    value: { stringValue: "secret_token" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
test("OTLP JSON: scoped key rotation, deduplication, safe attributes and authorized trace relations", (t) => {
  const { store, obs, a, b, id, platform, org } = fixture(t),
    token = obs.issueKey(a, id).token;
  assert.throws(() => obs.issueKey({ ...a, role: "reader" }, id));
  assert.throws(() => obs.issueKey(b, id));
  obs.ingest(token, traceInput());
  obs.ingest(token, traceInput());
  const rows = obs.trace(a, id, "a".repeat(32));
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes("secret_token"));
  assert.ok(!JSON.stringify(rows).includes("SELECT password"));
  assert.ok(JSON.stringify(rows).includes("db.operation.name"));
  assert.throws(() => obs.trace(b, id, "a".repeat(32)));
  const other = platform.createServer(a, org, "worker");
  platform.enroll(other.enrollment_token);
  const second = obs.issueKey(a, other.server_id).token;
  obs.ingest(second, traceInput());
  assert.equal(obs.trace(a, id, "a".repeat(32)).length, 2);
  assert.equal(
    (
      store.db.prepare("SELECT count(*) n FROM trace_spans").get() as {
        n: number;
      }
    ).n,
    2,
  );
  obs.issueKey(a, id);
  assert.throws(() => obs.ingest(token, traceInput()), /Chave/);
  const invalid = traceInput();
  invalid.resourceSpans[0].scopeSpans[0].spans[0].traceId = "bad";
  assert.throws(() => obs.ingest(second, invalid), /Identificadores/);
  assert.throws(
    () => obs.ingest(second, traceInput(now() - 2 * 86400)),
    /janela/,
  );
  obs.revokeKey(a, other.server_id);
  assert.throws(() => obs.ingest(second, traceInput()), /Chave/);
});
test("runbooks: references, paths, authorizations, pending approval, revision and cooldown", async (t) => {
  let calls = 0;
  const { store, books, a, b, id, data } = fixture(t, async () => {
    calls++;
    return {
      code: 0,
      output: 'FOXOPS_RUNBOOK:{"status":"completed","exit_code":0}',
    };
  });
  assert.throws(() =>
    books.save({ ...a, role: "operator" }, id, undefined, data),
  );
  assert.throws(
    () => books.save(a, id, undefined, { ...data, path: "/tmp/evil.sh" }),
    /caminho/,
  );
  assert.throws(
    () => books.save(a, id, undefined, { ...data, mode: "automatic" }),
    /Confirme/,
  );
  const saved = books.save(a, id, undefined, data),
    book = String(saved.items[0].id);
  assert.throws(() => books.list(b, id));
  assert.equal(calls, 0);
  const run = books.request(a, id, book);
  assert.equal(calls, 0);
  await assert.rejects(books.execute({ ...a, role: "operator" }, id, run.id));
  await books.execute(a, id, run.id);
  assert.equal(calls, 1);
  await assert.rejects(books.execute(a, id, run.id));
  const next = books.request(a, id, book);
  await assert.rejects(books.execute(a, id, next.id), /Intervalo/);
  books.save(a, id, book, { ...data, revision: 1, name: "Updated script" });
  assert.equal(
    books.list(a, id).runs.find((r) => r.id === next.id)?.status,
    "canceled",
  );
  const audit = store.db
    .prepare("SELECT actor_name FROM audit WHERE action='runbook.approved'")
    .get() as { actor_name: string };
  assert.equal(audit.actor_name, "Alice");
});
test("runbooks: explicit automatic trigger, deduplication and recovery prevents execution", async (t) => {
  let calls = 0;
  const { store, books, a, id, data, platform } = fixture(t, async () => {
    calls++;
    return {
      code: 0,
      output: 'FOXOPS_RUNBOOK:{"status":"completed","exit_code":0}',
    };
  });
  store.db
    .prepare(
      "INSERT INTO alerts(id,server_id,kind,severity,message,opened_at) VALUES (?,?,?,?,?,?)",
    )
    .run("incident", id, "service:nginx", "critical", "failed", now());
  platform.enqueue({
    event: "alert.opened",
    alert_id: "incident",
    kind: "service:nginx",
    at: now(),
  });
  const saved = books.save(a, id, undefined, {
    ...data,
    mode: "automatic",
    authorize_automatic: true,
  });
  await books.tick();
  assert.equal(calls, 0);
  platform.enqueue({
    event: "alert.opened",
    alert_id: "incident",
    kind: "service:nginx",
    at: now(),
  });
  await books.tick();
  await books.tick();
  assert.equal(calls, 1);
  assert.equal(books.list(a, id).runs.length, 1);
  const book = String(saved.items[0].id);
  books.save(a, id, book, {
    ...data,
    mode: "automatic",
    authorize_automatic: true,
    revision: 1,
  });
  platform.enqueue({
    event: "alert.opened",
    alert_id: "incident",
    kind: "service:nginx",
    at: now(),
  });
  store.db
    .prepare("UPDATE alerts SET resolved_at=? WHERE id=?")
    .run(now(), "incident");
  await books.tick();
  assert.equal(calls, 1);
});
test("runbooks: uncertain execution blocks repeats until manual review, revoked SSH invalidates approval", async (t) => {
  const { books, a, id, data, ops } = fixture(t, async () => {
    throw Error("network");
  });
  const book = String(books.save(a, id, undefined, data).items[0].id),
    run = books.request(a, id, book);
  await books.execute(a, id, run.id);
  assert.equal(books.list(a, id).runs[0].status, "unknown");
  const again = books.request(a, id, book);
  await assert.rejects(books.execute(a, id, again.id), /indeterminada/);
  books.reviewed(a, id, run.id);
  assert.equal(
    books.list(a, id).runs.find((r) => r.id === run.id)?.status,
    "reviewed",
  );
  ops.saveSSH(a, id, {
    host: "192.168.3.51",
    port: 22,
    username: "foxops",
    fingerprint: "SHA256:" + "A".repeat(43),
    password: "test-only",
  });
  await assert.rejects(books.execute(a, id, again.id), /configuração alterada/);
});

test("HTTP observability: authenticated configuration and OTLP reception without a browser session", async (t) => {
  const { store, platform, a, id } = fixture(t),
    server = createApp(store, undefined, {
      aiVault: { masterKey: Buffer.alloc(32, 8) },
    });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const token = platform.login({
    email: a.email,
    password: "strong-password-123",
  }).token;
  const headers = {
    "Content-Type": "application/json",
    Cookie: "foxops_session=" + token,
  };
  assert.equal(
    (await fetch(base + `/api/v1/servers/${id}/observability`)).status,
    401,
  );
  assert.equal(
    (await fetch(base + `/api/v1/servers/${id}/observability`, { headers }))
      .status,
    200,
  );
  const key = await (
    await fetch(base + `/api/v1/servers/${id}/trace-key`, {
      method: "POST",
      headers,
      body: "{}",
    })
  ).json();
  const response = await fetch(base + "/api/telemetry/v1/traces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key.token,
    },
    body: JSON.stringify(traceInput()),
  });
  assert.equal(response.status, 200);
  const context = await (
    await fetch(base + `/api/v1/servers/${id}/observability`, { headers })
  ).json();
  assert.equal(context.coverage.spans, 1);
  assert.equal(
    (
      await fetch(base + "/api/telemetry/v1/traces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid",
        },
        body: JSON.stringify(traceInput()),
      })
    ).status,
    401,
  );
});
