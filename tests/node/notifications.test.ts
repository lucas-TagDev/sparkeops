import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { Notifications } from "../../src/notifications.ts";
import { URLMonitoring } from "../../src/url-monitors.ts";
import {
  notificationDefaults,
  type NotificationChannel,
  type NotificationConfig,
} from "../../shared/notifications.ts";
function setup(
  t: TestContext,
  sender?: (
    channel: NotificationChannel,
    config: NotificationConfig,
    message: string,
  ) => Promise<void>,
) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store),
    vault = new AISettings(platform, { masterKey: Buffer.alloc(32, 7) });
  const a = platform.signup({
    name: "Alice",
    company: "A",
    email: "alice@notify.test",
    password: "strong-password-123",
  }).principal;
  const b = platform.signup({
    name: "Bob",
    company: "B",
    email: "bob@notify.test",
    password: "strong-password-456",
  }).principal;
  const org = platform.organizations(a)[0].id;
  const notifications = new Notifications(platform, vault, sender);
  const config = {
    ...notificationDefaults(),
    enabled: true,
    token: "123456:very_secret_test_token",
    chatId: "-123456",
  };
  return { store, platform, vault, a, b, org, notifications, config };
}
test("notifications: tenant scope, roles, encrypted secrets, blank preservation and validation", (t) => {
  const { store, platform, notifications, org, a, b, config } = setup(t);
  notifications.save(a, org, "telegram", config);
  assert.equal(
    notifications.settings(a, org).channels.telegram.hasSecret,
    true,
  );
  assert.ok(
    !JSON.stringify(notifications.settings(a, org)).includes(config.token),
  );
  assert.ok(
    !JSON.stringify(
      store.db.prepare("SELECT * FROM notification_channels").all(),
    ).includes(config.token),
  );
  notifications.save(a, org, "telegram", { ...config, token: "" });
  assert.equal(
    notifications.settings(a, org).channels.telegram.hasSecret,
    true,
  );
  assert.throws(
    () => notifications.settings(b, org),
    /não encontrado|permissão/,
  );
  assert.throws(
    () => notifications.settings({ ...a, role: "operator" }, org),
    /perfil/,
  );
  assert.throws(
    () =>
      notifications.save({ ...a, orgScope: "other" }, org, "telegram", config),
    /não encontrado|permissão/,
  );
  assert.throws(() => notifications.save(a, org, "invalid", config), /Canal/);
  assert.throws(
    () =>
      notifications.save(a, org, "telegram", {
        ...config,
        chatId: "hello\nInjected",
      }),
    /Campo/,
  );
  assert.throws(
    () =>
      notifications.save(a, org, "telegram", {
        ...config,
        kinds: ["passwords"],
      }),
    /Tipos/,
  );
  assert.throws(
    () =>
      notifications.save(a, org, "telegram", {
        ...config,
        opening: false,
        recovery: false,
      }),
    /Selecione/,
  );
  assert.throws(
    () =>
      notifications.save(a, org, "email", {
        ...config,
        host: "smtp.example.com",
        port: "25",
        user: "admin",
        password: "smtp-secret",
        from: "a@example.com",
        to: "b@example.com",
      }),
    /SMTP/,
  );
  const audit = store.db
    .prepare(
      "SELECT actor_name,actor_email FROM audit WHERE action='notification.settings.updated'",
    )
    .get() as { actor_name: string; actor_email: string };
  assert.equal(audit.actor_name, "Alice");
  assert.equal(audit.actor_email, a.email);
  assert.ok(platform.organizations(a).length);
});
test("notifications: independent channel retries, authoritative routing and no duplicate fanout", async (t) => {
  const sent: { channel: string; message: string }[] = [];
  let fail = true;
  const { store, platform, notifications, org, a, b, config } = setup(
    t,
    async (channel, _config, message) => {
      if (channel === "telegram" && fail)
        throw new Error("secret provider error");
      sent.push({ channel, message });
    },
  );
  notifications.save(a, org, "telegram", config);
  notifications.save(a, org, "email", {
    ...notificationDefaults(),
    enabled: true,
    host: "smtp.example.com",
    port: "587",
    user: "sender",
    password: "smtp-secret",
    from: "a@example.com",
    to: "b@example.com",
  });
  const otherOrg = platform.organizations(b)[0].id;
  notifications.save(b, otherOrg, "telegram", { ...config, chatId: "-999" });
  const server = store.register(org, "Server A");
  const serverId = server.server_id;
  store.db
    .prepare(
      "INSERT INTO alerts(id,server_id,kind,severity,message,opened_at) VALUES (?,?,?,?,?,?)",
    )
    .run("alert-a", serverId, "disk", "critical", "Disk full", now());
  platform.enqueue({
    event: "alert.opened",
    alert_id: "alert-a",
    organization: otherOrg,
    kind: "disk",
    message: "Disk full",
    at: now(),
  });
  await notifications.tick();
  assert.deepEqual(
    sent.map((s) => s.channel),
    ["email"],
  );
  let rows = notifications.settings(a, org).deliveries;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.channel === "telegram")?.status, "pending");
  assert.equal(notifications.settings(b, otherOrg).deliveries.length, 0);
  assert.ok(!JSON.stringify(rows).includes("secret provider error"));
  await notifications.tick();
  assert.equal(sent.length, 1);
  fail = false;
  store.db.prepare("UPDATE notification_deliveries SET next_at=0").run();
  await notifications.tick();
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => s.message.includes("Server A")));
  rows = notifications.settings(a, org).deliveries;
  assert.ok(rows.every((r) => r.status === "sent"));
  await notifications.tick();
  assert.equal(sent.length, 2);
  platform.enqueue({
    event: "alert.resolved",
    alert_id: "alert-a",
    kind: "disk",
    at: now(),
  });
  await notifications.tick();
  assert.equal(sent.length, 4);
  assert.ok(sent.slice(2).every((s) => s.message.includes("RECUPERADO")));
});
test("notifications: disabled channels and kind/event filters skip delivery; tests use saved credentials", async (t) => {
  const sent: string[] = [];
  const { store, platform, notifications, org, a, config } = setup(
    t,
    async (_channel, c, message) => {
      sent.push(`${c.token}:${message}`);
    },
  );
  notifications.save(a, org, "telegram", {
    ...config,
    kinds: ["cpu"],
    recovery: false,
  });
  const server = store.register(org, "Server A");
  store.db
    .prepare(
      "INSERT INTO alerts(id,server_id,kind,severity,message,opened_at) VALUES (?,?,?,?,?,?)",
    )
    .run("alert-b", server.server_id, "disk", "critical", "Disk", now());
  platform.enqueue({
    event: "alert.opened",
    alert_id: "alert-b",
    kind: "disk",
    at: now(),
  });
  await notifications.tick();
  assert.equal(sent.length, 0);
  platform.enqueue({
    event: "alert.resolved",
    alert_id: "alert-b",
    kind: "cpu",
    at: now(),
  });
  await notifications.tick();
  assert.equal(sent.length, 0);
  await notifications.test(a, org, "telegram");
  assert.ok(sent[0].includes(config.token));
  notifications.save(a, org, "telegram", { ...config, enabled: false });
  await assert.rejects(notifications.test(a, org, "telegram"), /habilite/);
});
test("notifications: official Telegram and WhatsApp payloads; provider errors never reveal credentials", async (t) => {
  const { platform, vault, notifications, org, a, config } = setup(t);
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, options: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(options.body)) });
      return Response.json(
        String(url).includes("telegram")
          ? { ok: true }
          : { messages: [{ id: "accepted" }] },
      );
    },
  );
  notifications.save(a, org, "telegram", config);
  await notifications.test(a, org, "telegram");
  notifications.save(a, org, "whatsapp", {
    ...notificationDefaults(),
    enabled: true,
    token: "meta-secret",
    phoneId: "123456",
    recipient: "5511999999999",
    template: "alerta",
    language: "pt_BR",
    apiVersion: "v26.0",
  });
  await notifications.test(a, org, "whatsapp");
  assert.equal(calls[0].body.chat_id, config.chatId);
  assert.ok(calls[0].url.startsWith("https://api.telegram.org/bot"));
  assert.equal(
    calls[1].url,
    "https://graph.facebook.com/v26.0/123456/messages",
  );
  assert.deepEqual(calls[1].body.template, {
    name: "alerta",
    language: { code: "pt_BR" },
    components: [
      {
        type: "body",
        parameters: [
          {
            type: "text",
            text: "Teste de notificação — A. O canal está configurado.",
          },
        ],
      },
    ],
  });
  const failed = new Notifications(platform, vault, async () => {
    throw new Error(config.token);
  });
  await assert.rejects(
    failed.test(a, org, "telegram"),
    (error) =>
      !String(error).includes(config.token) &&
      String(error).includes("provedor"),
  );
});

test("notifications: URL incident routing, bounded retries and immediate cancellation", async (t) => {
  const sent: string[] = [];
  let reject = true;
  const { store, platform, vault, notifications, org, a, config } = setup(
    t,
    async (_channel, _config, message) => {
      if (reject) throw Error("offline");
      sent.push(message);
    },
  );
  notifications.save(a, org, "telegram", config);
  const urls = new URLMonitoring(platform, async () => ({
    status_code: 500,
    latency_ms: 10,
    error: null,
  }));
  const monitor = urls.save(a, undefined, {
    organization: org,
    name: "Website",
    url: "https://example.com",
    method: "GET",
    interval_seconds: 60,
    timeout_seconds: 5,
    expected_status: 200,
    failure_threshold: 1,
    enabled: true,
  });
  await urls.check(a, monitor.id);
  await notifications.tick();
  assert.equal(notifications.settings(a, org).deliveries[0].status, "pending");
  for (let i = 1; i < 8; i++) {
    store.db.prepare("UPDATE notification_deliveries SET next_at=0").run();
    await notifications.tick();
  }
  assert.equal(notifications.settings(a, org).deliveries[0].status, "failed");
  assert.equal(notifications.settings(a, org).deliveries[0].attempts, 8);
  reject = false;
  await notifications.tick();
  assert.equal(sent.length, 0);
  const incident = store.db
    .prepare("SELECT id FROM url_incidents WHERE monitor_id=?")
    .get(monitor.id) as { id: string };
  platform.enqueue({
    event: "url.alert.resolved",
    alert_id: incident.id,
    kind: "url",
    at: now(),
  });
  await notifications.tick();
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("Website"));
  reject = true;
  platform.enqueue({
    event: "url.alert.opened",
    alert_id: incident.id,
    kind: "url",
    at: now(),
  });
  await notifications.tick();
  notifications.save(a, org, "telegram", { ...config, enabled: false });
  assert.ok(
    !notifications
      .settings(a, org)
      .deliveries.some((d) => d.status === "pending"),
  );
  const second = new Notifications(platform, vault);
  assert.equal(second.settings(a, org).channels.telegram.hasSecret, true);
});
