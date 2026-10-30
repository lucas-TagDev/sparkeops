import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { Operations, type SSHExecutor } from "../../src/operations.ts";
import { ServiceMonitoring } from "../../src/service-monitoring.ts";
import { ServiceRecovery } from "../../src/service-recovery.ts";
import { alertHistory } from "../../src/alert-history.ts";
function setup(t: TestContext, executor: SSHExecutor) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const p = new Platform(store),
    v = new AISettings(p, { masterKey: Buffer.alloc(32, 8) }),
    ops = new Operations(p, v, executor),
    monitor = new ServiceMonitoring(p, v),
    recovery = new ServiceRecovery(p, ops, v);
  const user = p.signup({
    name: "Alice",
    company: "A",
    email: "a@recovery.test",
    password: "strong-password-123",
  }).principal;
  const org = p.organizations(user)[0].id,
    s = p.createServer(user, org, "web"),
    agent = p.enroll(s.enrollment_token),
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
    p.recordDetails(agent.agent_token, {
      services: { nginx: status },
      discovered_services: ["nginx"],
      service_alert_mode: "failed_only",
    });
    p.evaluate();
  };
  state("active");
  monitor.save(user, id, "nginx", { enabled: true, ai_summary: true });
  ops.saveSSH(user, id, {
    host: "server.example",
    port: 22,
    username: "root",
    fingerprint: "SHA256:" + "A".repeat(43),
    password: "ssh-test-password",
  });
  return { store, p, v, ops, monitor, recovery, user, id, state, agent };
}
test("immediate correction: explicit consent, bounded sequence per incident, report and alert history", async (t) => {
  const commands: string[][] = [];
  const f = setup(t, async (_c, c) => {
    commands.push(c);
    return c.length === 1
      ? { code: 3, output: "inactive" }
      : { code: 0, output: "active" };
  });
  const { recovery, user, id, state, store } = f;
  assert.throws(() =>
    recovery.save({ ...user, role: "operator" }, id, "nginx", {
      enabled: true,
      confirm: true,
    }),
  );
  assert.throws(() => recovery.save(user, id, "nginx", { enabled: true }));
  assert.throws(() =>
    recovery.save(user, id, "bad;id", { enabled: true, confirm: true }),
  );
  recovery.save(user, id, "nginx", { enabled: true, confirm: true });
  state("failed");
  await recovery.tick();
  await recovery.tick();
  assert.equal(commands.length, 2);
  assert.ok(commands[1].some((c) => c.includes("restart")));
  let run = store.db.prepare("SELECT * FROM service_recovery_runs").get()!;
  assert.equal(run.status, "recovered");
  assert.ok(run.action_id);
  store.db.prepare("UPDATE service_recovery_runs SET report_after=0").run();
  await recovery.tick();
  run = store.db.prepare("SELECT * FROM service_recovery_runs").get()!;
  assert.equal(run.report_status, "completed");
  assert.ok(String(run.summary).includes("serviço ativo"));
  assert.ok(
    alertHistory(f.p, user, { status: "all" }).items[0].recovery?.summary,
  );
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM outbox WHERE json_extract(payload,'$.event')='service.summary.ready'",
      )
      .get()!.n,
    1,
  );
  state("active");
  state("failed");
  await recovery.tick();
  assert.equal(commands.length, 4);
  assert.ok(
    store.db
      .prepare("SELECT 1 FROM service_recovery_runs WHERE status='recovered'")
      .get(),
  );
});
test("immediate correction: no historical replay; disabling monitoring revokes automation", async (t) => {
  let calls = 0;
  const f = setup(t, async () => {
    calls++;
    return { code: 0, output: "active" };
  });
  f.state("failed");
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  await f.recovery.tick();
  assert.equal(calls, 0);
  f.state("active");
  f.state("failed");
  f.monitor.save(f.user, f.id, "nginx", { enabled: false, ai_summary: false });
  await f.recovery.tick();
  assert.equal(calls, 0);
  assert.equal(f.recovery.list(f.user, f.id)[0].enabled, 0);
});
test("immediate correction: unknown SSH result blocks restart and config changes revoke pending execution", async (t) => {
  let calls = 0;
  const f = setup(t, async () => {
    calls++;
    throw new Error("connection timeout");
  });
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 1);
  assert.equal(
    f.store.db.prepare("SELECT status FROM service_recovery_runs").get()!
      .status,
    "unknown",
  );
  await f.recovery.tick();
  assert.equal(calls, 1);
});
test("immediate correction: authorization is checked again after the SSH probe", async (t) => {
  let calls = 0;
  let revoke: () => void = () => {};
  const f = setup(t, async () => {
    calls++;
    revoke();
    return { code: 3, output: "inactive" };
  });
  revoke = () => {
    f.recovery.save(f.user, f.id, "nginx", { enabled: false });
  };
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 1);
  assert.equal(
    f.store.db.prepare("SELECT status FROM service_recovery_runs").get()!
      .status,
    "skipped",
  );
});

test("immediate correction: AI analyzes local logs after failure and notifies once with redaction", async (t) => {
  const f = setup(t, async (_c, commands) => ({
    code: commands.length === 1 ? 3 : 1,
    output: "configuration error",
  }));
  const { Notifications } = await import("../../src/notifications.ts");
  const { notificationDefaults } =
    await import("../../shared/notifications.ts");
  let calls = 0;
  let evidence: any;
  const sent: string[] = [];
  const notifications = new Notifications(
    f.p,
    f.v,
    async (_channel, _config, message) => {
      sent.push(message);
    },
  );
  notifications.save(f.user, f.p.organizations(f.user)[0].id, "telegram", {
    ...notificationDefaults(),
    enabled: true,
    kinds: ["service"],
    token: "123456:test_token",
    chatId: "-123",
  });
  f.recovery.ai = {
    key: "test-only",
    model: "test-model",
    fetch: (async (_url, init) => {
      calls++;
      evidence = JSON.parse(JSON.parse(String(init?.body)).input);
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: "Falhou: há evidências de erro de configuração. Valide nginx -t. password=hidden",
              },
            ],
          },
        ],
        usage: { total_tokens: 10 },
      });
    }) as typeof fetch,
  };
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  await f.monitor.summaries();
  assert.equal(f.monitor.list(f.user, f.id).reports.length, 0);
  const row = f.store.db.prepare("SELECT * FROM service_recovery_runs").get()!;
  assert.equal(row.status, "blocked");
  f.store.db
    .prepare(
      "UPDATE local_log_checks SET status='completed',result=? WHERE id=?",
    )
    .run(
      JSON.stringify({ counts: { configuration_error: 2 }, scanned: 10 }),
      row.log_check_id,
    );
  f.store.db.prepare("UPDATE service_recovery_runs SET report_after=0").run();
  await f.recovery.tick();
  await f.recovery.tick();
  await notifications.tick();
  assert.equal(calls, 1);
  assert.equal(evidence.local_logs.scanned, 10);
  assert.ok(sent.some((text) => text.includes("Valide nginx")));
  assert.ok(sent.every((text) => !text.includes("password=hidden")));
});

test("recovery ledger: records probe and restart, preserves gateway rejection and does not charge rejected restarts to the limit", async (t) => {
  let calls = 0;
  const f = setup(t, async (_c, commands) => {
    calls++;
    return commands.length === 1
      ? { code: 3, output: "inactive" }
      : { code: 126, output: "FoxOps: comando não autorizado." };
  });
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  let history = f.recovery.history(f.user, f.id, {});
  assert.equal(history.items[0].status, "blocked");
  assert.equal(history.items[0].steps.length, 2);
  assert.deepEqual(
    history.items[0].steps.map((step) => step.stage),
    ["status", "restart"],
  );
  assert.ok(
    String(history.items[0].steps[1].output).includes("comando não autorizado"),
  );
  assert.equal(
    f.recovery.history(f.user, f.id, { status: "blocked", q: "nginx" }).total,
    1,
  );
  f.state("active");
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 4, "gateway rejection must not consume cooldown");
  assert.equal(f.recovery.history(f.user, f.id, {}).total, 2);
  const other = f.p.signup({
    name: "B",
    company: "B",
    email: "b@history.test",
    password: "strong-password-456",
  }).principal;
  assert.throws(() => f.recovery.history(other, f.id, {}));
  assert.throws(() => f.recovery.history(f.user, f.id, { limit: 999 }));
});
test("recovery ledger: legacy restart remains visible without inventing unlinked probe details", async (t) => {
  const f = setup(t, async (_c, commands) =>
    commands.length === 1
      ? { code: 3, output: "inactive" }
      : { code: 0, output: "active" },
  );
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  f.store.db.prepare("DELETE FROM service_recovery_steps").run();
  const item = f.recovery.history(f.user, f.id, {}).items[0];
  assert.equal(item.legacy, true);
  assert.equal(item.steps.length, 1);
  assert.equal(item.steps[0].stage, "restart");
});

test("recovery sequence: five failed restart attempts are recorded, no daily cooldown, and a final notification is queued", async (t) => {
  let calls = 0;
  const f = setup(t, async (_c, commands) => {
    calls++;
    return {
      code: commands.length === 1 ? 3 : 1,
      output: "service still inactive",
    };
  });
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 6);
  const history = f.recovery.history(f.user, f.id, {});
  assert.equal(
    history.items[0].steps.filter((s) => s.stage === "restart").length,
    5,
  );
  assert.equal(history.items[0].status, "failed");
  assert.equal(f.recovery.budget(f.id, "nginx").used, 5);
  f.store.db.prepare("UPDATE service_recovery_runs SET report_after=0").run();
  await f.recovery.tick();
  assert.equal(calls, 6);
  assert.equal(
    f.store.db
      .prepare(
        "SELECT count(*) AS n FROM outbox WHERE json_extract(payload,'$.event')='service.summary.ready'",
      )
      .get()!.n,
    1,
  );
  f.state("active");
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 12);
});
test("recovery sequence: stop as soon as a restart succeeds", async (t) => {
  let calls = 0;
  const f = setup(t, async (_c, commands) => {
    calls++;
    return commands.length === 1
      ? { code: 3, output: "inactive" }
      : {
          code: calls === 4 ? 0 : 1,
          output: calls === 4 ? "active" : "failed",
        };
  });
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 4);
  assert.equal(
    f.recovery
      .history(f.user, f.id, {})
      .items[0].steps.filter((s) => s.stage === "restart").length,
    3,
  );
  assert.equal(
    f.store.db.prepare("SELECT status FROM service_recovery_runs").get()!
      .status,
    "recovered",
  );
});

test("recovery sequence: missing SSH gateway is reported as blocked rather than five fictitious service restarts", async (t) => {
  let calls = 0;
  const f = setup(t, async () => {
    calls++;
    return {
      code: 127,
      output: "sh: 1: /usr/local/sbin/foxops-ssh-gateway: not found",
    };
  });
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 1);
  const row = f.recovery.history(f.user, f.id, {}).items[0];
  assert.equal(row.status, "blocked");
  assert.equal(row.steps.filter((s) => s.stage === "restart").length, 0);
  f.store.db.prepare("UPDATE service_recovery_runs SET report_after=0").run();
  await f.recovery.tick();
  assert.equal(
    f.store.db
      .prepare(
        "SELECT count(*) AS n FROM outbox WHERE json_extract(payload,'$.event')='service.summary.ready'",
      )
      .get()!.n,
    1,
  );
});

test("recovery policy: owner only, tenant scope, validation, configured attempt count and captured historical limit", async (t) => {
  let calls = 0;
  const f = setup(t, async () => {
    calls++;
    return { code: 1, output: "inactive" };
  });
  assert.equal(f.recovery.policy(f.user).max_attempts, 5);
  assert.throws(() =>
    f.recovery.savePolicy({ ...f.user, role: "admin" }, { max_attempts: 2 }),
  );
  assert.throws(() =>
    f.recovery.savePolicy(
      { ...f.user, orgScope: "scoped" },
      { max_attempts: 2 },
    ),
  );
  for (const max_attempts of [0, 21, 1.5, "3", null])
    assert.throws(() => f.recovery.savePolicy(f.user, { max_attempts }));
  f.recovery.savePolicy(f.user, { max_attempts: 2 });
  const other = f.p.signup({
    name: "Other",
    company: "Other",
    email: "other@policy.test",
    password: "strong-password-123",
  }).principal;
  assert.equal(f.recovery.policy(other).max_attempts, 5);
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 3);
  const item = f.recovery.history(f.user, f.id, {}).items[0];
  assert.equal(
    f.store.db
      .prepare(
        "SELECT attempt_limit FROM service_recovery_runs WHERE alert_id=?",
      )
      .get(item.alert_id)!.attempt_limit,
    2,
  );
  assert.equal(item.steps.filter((s) => s.stage === "restart").length, 2);
  f.recovery.savePolicy(f.user, { max_attempts: 7 });
  f.state("active");
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 11);
  assert.equal(f.recovery.history(f.user, f.id, {}).configured_limit, 7);
});
test("recovery policy: reduction takes effect before the next restart in an active sequence", async (t) => {
  let calls = 0,
    reduce: () => void = () => {};
  const f = setup(t, async () => {
    calls++;
    if (calls === 2) reduce();
    return { code: 1, output: "inactive" };
  });
  reduce = () => {
    f.recovery.savePolicy(f.user, { max_attempts: 1 });
  };
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 2);
  assert.equal(
    f.recovery
      .history(f.user, f.id, {})
      .items[0].steps.filter((s) => s.stage === "restart").length,
    1,
  );
});

test("recovery interval: owner opt-in spaces attempts, preserves their history and stops at the configured maximum", async (t) => {
  let calls = 0;
  const f = setup(t, async () => {
    calls++;
    return { code: 1, output: "inactive" };
  });
  f.recovery.savePolicy(f.user, {
    max_attempts: 3,
    repeat_enabled: true,
    repeat_minutes: 2,
  });
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 2);
  let item = f.store.db.prepare("SELECT * FROM service_recovery_runs").get()!;
  assert.equal(item.status, "waiting");
  assert.ok(Number(item.next_attempt_at) >= now() + 119);
  await f.recovery.tick();
  assert.equal(calls, 2);
  for (let i = 0; i < 2; i++) {
    f.store.db
      .prepare(
        "UPDATE service_recovery_runs SET next_attempt_at=? WHERE status='waiting'",
      )
      .run(now() - 1);
    await f.recovery.tick();
  }
  assert.equal(calls, 6);
  item = f.store.db.prepare("SELECT * FROM service_recovery_runs").get()!;
  assert.equal(item.status, "failed");
  assert.equal(
    f.recovery
      .history(f.user, f.id, {})
      .items[0].steps.filter((s) => s.stage === "restart").length,
    3,
  );
  await f.recovery.tick();
  assert.equal(calls, 6);
});
test("recovery interval: validation, disabling wait resumes sequence, and resolved alerts cancel it", async (t) => {
  let calls = 0;
  const f = setup(t, async () => {
    calls++;
    return { code: 1, output: "inactive" };
  });
  for (const repeat_minutes of [0, 1441, 1.5, "5"])
    assert.throws(() =>
      f.recovery.savePolicy(f.user, {
        max_attempts: 3,
        repeat_enabled: true,
        repeat_minutes,
      }),
    );
  assert.throws(() =>
    f.recovery.savePolicy(f.user, { max_attempts: 3, repeat_enabled: "yes" }),
  );
  f.recovery.savePolicy(f.user, {
    max_attempts: 3,
    repeat_enabled: true,
    repeat_minutes: 10,
  });
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(calls, 2);
  f.recovery.savePolicy(f.user, { max_attempts: 3, repeat_enabled: false });
  await f.recovery.tick();
  assert.equal(calls, 5);
  assert.equal(
    f.store.db.prepare("SELECT status FROM service_recovery_runs").get()!
      .status,
    "failed",
  );
  f.state("active");
  f.state("failed");
  f.recovery.savePolicy(f.user, {
    max_attempts: 3,
    repeat_enabled: true,
    repeat_minutes: 5,
  });
  await f.recovery.tick();
  assert.equal(calls, 7);
  f.state("active");
  await f.recovery.tick();
  assert.equal(calls, 7);
  assert.equal(
    f.recovery.history(f.user, f.id, { status: "waiting" }).total,
    0,
  );
});

test("AI service repair: fresh diagnosis drives reset-failed then start, with verification and cause ledger", async (t) => {
  let active = false,
    reset = false,
    plans = 0;
  const f = setup(t, async (_c, commands) => {
    const c = commands.join("\n");
    if (c.includes("--diagnose-service"))
      return {
        code: 0,
        output:
          "FOXOPS_DIAGNOSE:" +
          JSON.stringify({
            service: "nginx",
            runtime: {
              Result: reset ? "success" : "start-limit-hit",
              ActiveState: "inactive",
            },
            logs: { counts: { other_errors: 1 } },
            error_samples: ["Start request repeated too quickly"],
          }),
      };
    if (c.includes("reset-failed")) {
      reset = true;
      return { code: 0, output: "reset" };
    }
    if (c.includes("systemctl start ")) {
      active = true;
      return { code: 0, output: "active" };
    }
    return { code: active ? 0 : 3, output: active ? "active" : "inactive" };
  });
  f.recovery.ai = {
    key: "fake",
    model: "test",
    fetch: (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.input);
      assert.equal(input.diagnosis.service, "nginx");
      plans++;
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  cause: "Limite de partidas atingido",
                  evidence: ["Result=start-limit-hit"],
                  action: plans === 1 ? "reset-failed" : "start",
                  reason:
                    plans === 1
                      ? "Liberar bloqueio observado"
                      : "Iniciar após liberar bloqueio",
                }),
              },
            ],
          },
        ],
        usage: { total_tokens: 10 },
      });
    }) as typeof fetch,
  };
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(plans, 2);
  const history = f.recovery.history(f.user, f.id, {}).items[0];
  assert.equal(history.status, "recovered");
  assert.equal(history.decisions.length, 2);
  assert.deepEqual(
    history.steps
      .filter((s) =>
        ["reset-failed", "start", "restart"].includes(String(s.stage)),
      )
      .map((s) => s.stage),
    ["reset-failed", "start"],
  );
  assert.ok(history.steps.some((s) => s.stage === "verify"));
  assert.equal(f.recovery.budget(f.id, "nginx").used, 2);
});
test("AI service repair: unsupported shell command is rejected rather than executed", async (t) => {
  const commands: string[] = [];
  const f = setup(t, async (_c, cs) => {
    commands.push(...cs);
    return cs.join("").includes("--diagnose-service")
      ? {
          code: 0,
          output:
            "FOXOPS_DIAGNOSE:" +
            JSON.stringify({
              service: "nginx",
              runtime: { ActiveState: "inactive" },
              logs: {},
            }),
        }
      : { code: 3, output: "inactive" };
  });
  f.recovery.ai = {
    key: "fake",
    model: "test",
    fetch: (async () =>
      Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  cause: "injetada",
                  evidence: [],
                  action: "shell",
                  command: "rm -rf /",
                  reason: "bad",
                }),
              },
            ],
          },
        ],
        usage: { total_tokens: 1 },
      })) as typeof fetch,
  };
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(f.recovery.history(f.user, f.id, {}).items[0].status, "blocked");
  assert.ok(commands.every((c) => !c.includes("rm -rf")));
});

test("AI service repair: configuration requires owner opt-in even if the AI requests it", async (t) => {
  const calls: string[] = [];
  const f = setup(t, async (_c, commands) => {
    calls.push(...commands);
    return commands.join("").includes("--diagnose-service")
      ? {
          code: 0,
          output:
            "FOXOPS_DIAGNOSE:" +
            JSON.stringify({
              service: "nginx",
              runtime: { Result: "exit-code" },
              logs: { counts: { configuration_error: 1 } },
            }),
        }
      : { code: 3, output: "inactive" };
  });
  f.recovery.ai = {
    key: "fake",
    model: "test",
    fetch: (async () =>
      Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  cause: "Parâmetro inválido",
                  evidence: ["configuration_error=1"],
                  action: "configure",
                  values: { worker_processes: 2 },
                  reason: "Ajustar parâmetro suportado",
                }),
              },
            ],
          },
        ],
        usage: { total_tokens: 1 },
      })) as typeof fetch,
  };
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(f.recovery.history(f.user, f.id, {}).items[0].status, "blocked");
  assert.ok(calls.every((c) => !c.includes("foxops-config")));
  assert.equal(f.recovery.policy(f.user).allow_config_repairs, false);
  assert.throws(() =>
    f.recovery.savePolicy(
      { ...f.user, role: "operator" },
      { max_attempts: 5, allow_config_repairs: true },
    ),
  );
});

test("AI service repair: opted-in supported configuration uses snapshot, validated changes and post-repair status", async (t) => {
  let active = false,
    applied: any;
  const f = setup(t, async (_c, commands) => {
    const command = commands.join("\n");
    if (command.includes("--diagnose-service"))
      return {
        code: 0,
        output:
          "FOXOPS_DIAGNOSE:" +
          JSON.stringify({
            service: "nginx",
            runtime: { Result: "exit-code" },
            logs: { counts: { configuration_error: 1 } },
          }),
      };
    if (command.includes("foxops-config")) {
      const encoded = command.match(/foxops-config '([^']+)'/)![1],
        data = JSON.parse(Buffer.from(encoded, "base64").toString());
      if (data.operation === "inspect")
        return {
          code: 0,
          output:
            "FOXOPS_CONFIG:" +
            JSON.stringify({
              status: "inspected",
              service: "nginx",
              path: "/etc/nginx/nginx.conf",
              sha256: "a".repeat(64),
              activation: "reload",
              values: { worker_processes: 1 },
            }),
        };
      applied = data;
      active = true;
      return {
        code: 0,
        output:
          "FOXOPS_CONFIG:" +
          JSON.stringify({
            status: "applied",
            message: "Backup criado e configuração validada.",
          }),
      };
    }
    return { code: active ? 0 : 3, output: active ? "active" : "inactive" };
  });
  f.recovery.ai = {
    key: "fake",
    model: "test",
    fetch: (async (_url, init) => {
      const data = JSON.parse(JSON.parse(String(init?.body)).input);
      assert.equal(data.allow_config, true);
      assert.deepEqual(data.snapshot.values, { worker_processes: 1 });
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  cause: "Ajuste indicado pela configuração e pelo teste",
                  evidence: ["configuration_error=1"],
                  action: "configure",
                  values: { worker_processes: 2 },
                  reason: "Corrigir parâmetro suportado",
                }),
              },
            ],
          },
        ],
        usage: { total_tokens: 1 },
      });
    }) as typeof fetch,
  };
  f.recovery.savePolicy(f.user, {
    max_attempts: 5,
    allow_config_repairs: true,
  });
  f.recovery.save(f.user, f.id, "nginx", { enabled: true, confirm: true });
  f.state("failed");
  await f.recovery.tick();
  assert.equal(applied.service, "nginx");
  assert.equal(applied.sha256, "a".repeat(64));
  assert.deepEqual(applied.values, { worker_processes: 2 });
  const history = f.recovery.history(f.user, f.id, {}).items[0];
  assert.equal(history.status, "recovered");
  assert.ok(history.steps.some((s) => s.stage === "configuration"));
  assert.ok(history.steps.some((s) => s.stage === "verify"));
});
