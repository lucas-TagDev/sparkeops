import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { HistoricalInvestigation } from "../../src/historical-investigation.ts";
import { historicalWindow } from "../../shared/historical-time.ts";
import { askAssistant } from "../../src/assistant.ts";
import { AISettings } from "../../src/ai-settings.ts";
test("historical time: Brazilian date, browser timezone, day boundaries and invalid dates", () => {
  const w = historicalWindow("às 22:00 do dia 27/10/2026", "America/Sao_Paulo");
  assert.equal(
    new Date(w.target * 1000).toISOString(),
    "2026-10-28T01:00:00.000Z",
  );
  assert.equal(
    new Date(w.day_from * 1000).toISOString(),
    "2026-10-27T03:00:00.000Z",
  );
  assert.equal(w.to - w.from, 3600);
  assert.equal(
    historicalWindow("on 2026-10-27", "UTC").to -
      historicalWindow("on 2026-10-27", "UTC").from,
    86400,
  );
  assert.throws(() => historicalWindow("31/02/2026 às 22:00", "UTC"));
  assert.throws(() => historicalWindow("27/10/2026 25:99", "UTC"));
  assert.throws(() => historicalWindow("27/10/2026", "Invalid/Zone"));
});
test("historical investigation: metrics and alerts from the entire day, scoped jobs and AI evidence", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store),
    history = new HistoricalInvestigation(platform);
  const a = platform.signup({
      name: "Alice",
      company: "A",
      email: "a@history.test",
      password: "strong-password-123",
    }).principal,
    b = platform.signup({
      name: "Bob",
      company: "B",
      email: "b@history.test",
      password: "strong-password-456",
    }).principal;
  const org = platform.organizations(a)[0].id,
    s = platform.createServer(a, org, "web"),
    agent = platform.enroll(s.enrollment_token),
    id = s.server_id;
  platform.recordDetails(agent.agent_token, {
    agent_version: "0.10.0",
    services: { nginx: "active" },
  });
  const date = new Date((now() - 2 * 86400) * 1000),
    text = `${date.getUTCDate()}/${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`,
    question = `Pico de memória ${text} às 22:00. Verifique os alertas desse dia.`,
    w = historicalWindow(question, "UTC");
  for (let i = 0; i < 60; i++)
    store.db.prepare("INSERT INTO samples VALUES (?,?,?,?)").run(
      id,
      randomUUID(),
      w.from + i * 60,
      JSON.stringify({
        cpu_percent: 1,
        memory_percent: i === 30 ? 98 : 30,
        disk_percent: 40,
      }),
    );
  const insert = store.db.prepare(
    "INSERT INTO alerts(id,server_id,kind,severity,message,opened_at,resolved_at) VALUES (?,?,?,?,?,?,?)",
  );
  insert.run(
    "day-alert",
    id,
    "service:nginx",
    "warning",
    "service issue",
    w.day_from + 3600,
    w.day_from + 4000,
  );
  insert.run(
    "prior-open",
    id,
    "disk",
    "critical",
    "ongoing disk",
    w.day_from - 1000,
    w.day_from + 1000,
  );
  insert.run(
    "outside",
    id,
    "cpu",
    "warning",
    "outside day",
    w.day_from - 2000,
    w.day_from - 1500,
  );
  const request = history.request(a, {
    organization: org,
    server_id: id,
    question,
    time_zone: "UTC",
  });
  assert.equal(request.status, "pending");
  assert.ok(request.logs.some((log) => log.service === "system_journal"));
  assert.throws(() => history.get(b, request.id));
  assert.throws(() => history.context(a, request.id, "other question", id));
  store.db
    .prepare(
      "UPDATE local_log_checks SET status='completed',result=? WHERE server_id=?",
    )
    .run(
      JSON.stringify({
        counts: { out_of_memory: 1 },
        scanned: 3,
        read_status: "ok",
        truncated: false,
      }),
      id,
    );
  const context = history.context(a, request.id, question, id);
  assert.equal(context.status, "completed");
  assert.equal(context.alert_total, 2);
  assert.equal(context.process_snapshots.length, 0);
  assert.equal(
    Math.max(...context.metrics.map((point) => point.memory_max)),
    98,
  );
  let captured: Record<string, unknown> = {};
  const answer = await askAssistant(
    platform,
    a,
    { organization: org, server_id: id, question, historical_id: request.id },
    {
      key: "fake",
      model: "test",
      fetch: (async (_url, options) => {
        captured = JSON.parse(JSON.parse(String(options!.body)).input);
        return Response.json({
          output: [
            { content: [{ type: "output_text", text: "Historical report" }] },
          ],
          usage: { total_tokens: 1 },
        });
      }) as typeof fetch,
    },
    new AISettings(platform, { masterKey: Buffer.alloc(32, 12) }),
  );
  assert.equal(answer.answer, "Historical report");
  assert.equal(
    (captured.historical_investigation as { alert_total: number }).alert_total,
    2,
  );
  const basic = await askAssistant(
    platform,
    a,
    {
      organization: org,
      server_id: id,
      question,
      historical_id: request.id,
      mode: "diagnostic",
    },
    {},
  );
  assert.ok(basic.answer.includes("98%"));
  assert.ok(basic.answer.includes("service issue"));
  platform.recordDetails(agent.agent_token, { agent_version: "0.9.1" });
  const old = history.request(a, {
    organization: org,
    server_id: id,
    question,
    time_zone: "UTC",
  });
  assert.equal(old.status, "completed");
  assert.equal(old.logs.length, 0);
});
