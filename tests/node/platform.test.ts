import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform, now, hash } from "../../src/platform.ts";
import { query } from "../../src/queries.ts";
import { askAssistant } from "../../src/assistant.ts";
import { Billing } from "../../src/billing.ts";

function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const a = platform.signup({
    name: "Alice",
    company: "Empresa A",
    email: "alice@example.test",
    password: "strong-password-123",
  }).principal;
  const b = platform.signup({
    name: "Bob",
    company: "Empresa B",
    email: "bob@example.test",
    password: "strong-password-456",
  }).principal;
  const orgA = platform.organizations(a)[0].id,
    orgB = platform.organizations(b)[0].id;
  return { store, platform, a, b, orgA, orgB };
}
const metrics = { cpu_percent: 10, memory_percent: 20, disk_percent: 30 };

test("histórico respeita datas e horários, preserva mínimos/máximos e cobre períodos longos", (t) => {
  const { platform, store, a, b, orgA } = fixture(t);
  const server = platform.createServer(a, orgA, "history-test");
  const base = Math.floor(now() / 60) * 60 - 86400;
  const insert = store.db.prepare("INSERT INTO samples VALUES (?,?,?,?)");
  insert.run(server.server_id, "before", base - 1, JSON.stringify(metrics));
  insert.run(
    server.server_id,
    "first",
    base + 10,
    JSON.stringify({ ...metrics, cpu_percent: 0.5 }),
  );
  insert.run(
    server.server_id,
    "second",
    base + 40,
    JSON.stringify({ ...metrics, cpu_percent: 1.5 }),
  );
  insert.run(server.server_id, "after", base + 80, JSON.stringify(metrics));
  const filtered = platform.history(a, server.server_id, 6, {
    from: base,
    to: base + 59,
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].samples, 2);
  assert.equal(filtered[0].cpu_percent, 1);
  assert.equal(filtered[0].cpu_min, 0.5);
  assert.equal(filtered[0].cpu_max, 1.5);
  assert.equal(filtered[0].timestamp, base + 10);
  assert.throws(() =>
    platform.history(a, server.server_id, 6, { from: base + 1, to: base }),
  );
  assert.throws(() =>
    platform.history(a, server.server_id, 6, { from: NaN, to: base }),
  );
  assert.throws(() =>
    platform.history(a, server.server_id, 6, {
      from: base,
      to: base + 91 * 86400,
    }),
  );
  assert.throws(() =>
    platform.history(b, server.server_id, 6, { from: base, to: base + 59 }),
  );
  store.db
    .prepare("DELETE FROM samples WHERE server_id=?")
    .run(server.server_id);
  const start = base - 7 * 86400;
  for (let i = 0; i < 1200; i++)
    insert.run(
      server.server_id,
      "long-" + i,
      start + i * 300,
      JSON.stringify(metrics),
    );
  const long = platform.history(a, server.server_id, 6, {
    from: start,
    to: start + 1200 * 300,
  });
  assert.ok(long.length <= 1000);
  assert.equal(
    long.reduce((n, p) => n + Number(p.samples), 0),
    1200,
  );
  assert.equal(long[0].timestamp, start);
  assert.ok(
    Number(long.at(-1)!.timestamp) > start + 1190 * 300,
    "a janela deve incluir o fim e o início",
  );
});

test("contas e organizações não vazam pelo inventário nem por IDs diretos", (t) => {
  const { platform, a, b, orgA, orgB } = fixture(t);
  const server = platform.createServer(a, orgA, "production-a");
  assert.equal(platform.servers(b).length, 0);
  assert.throws(() => platform.servers(b, orgA));
  assert.throws(() => platform.server(b, server.server_id));
  assert.throws(() => platform.history(b, server.server_id));
  assert.throws(() => platform.createServer(a, orgB, "attack"));
  assert.throws(() =>
    query(platform, b, "get_service_status", { server_id: server.server_id }),
  );
  assert.equal(platform.servers(a)[0].name, "production-a");
});

test("registro usa token temporário de uso único e a credencial é revogável", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  const server = platform.createServer(a, orgA, "web");
  assert.throws(() => store.ingest(server.enrollment_token, "one", metrics));
  const agent = platform.enroll(server.enrollment_token);
  assert.throws(() => platform.enroll(server.enrollment_token));
  assert.equal(store.ingest(agent.agent_token, "one", metrics).accepted, true);
  platform.revokeAgent(a, server.server_id);
  assert.throws(() => store.ingest(agent.agent_token, "two", metrics));
  const next = platform.renewEnrollment(a, server.server_id);
  const newAgent = platform.enroll(next.enrollment_token);
  assert.equal(
    store.ingest(newAgent.agent_token, "three", metrics).accepted,
    true,
  );
});

test("token de instalação expirado é recusado", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  const s = platform.createServer(a, orgA, "web");
  store.db.prepare("UPDATE enrollments SET expires_at=?").run(now() - 1);
  assert.throws(() => platform.enroll(s.enrollment_token));
});

test("convite de leitor limita clientes e remoção revoga sessão e MCP", (t) => {
  const { platform, a, orgA } = fixture(t);
  const other = platform.createOrganization(a, "Outro cliente").id;
  const invite = platform.invite(a, {
    email: "reader@example.test",
    role: "reader",
    organizations: [orgA],
  });
  const reader = platform.acceptInvite({
    token: invite.token,
    name: "Leitor",
    password: "reader-password-123",
  });
  assert.equal(reader.principal.role, "reader");
  assert.deepEqual(
    platform.organizations(reader.principal).map((o) => o.id),
    [orgA],
  );
  assert.throws(() => platform.authorizeOrg(reader.principal, other));
  assert.throws(() =>
    platform.createServer(reader.principal, orgA, "forbidden"),
  );
  assert.throws(() =>
    platform.createOrganization(reader.principal, "forbidden"),
  );
  assert.throws(() =>
    platform.acceptInvite({
      token: invite.token,
      name: "Again",
      password: "reader-password-123",
    }),
  );
  const token = platform.createToken(reader.principal, {
    name: "Reader client",
    organization: orgA,
  });
  platform.removeMember(a, reader.principal.userId);
  assert.throws(() => platform.session(reader.token));
  assert.throws(() => platform.tokenPrincipal(token.token));
});

test("tokens MCP respeitam escopo, validade, expiração e revogação", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  const other = platform.createOrganization(a, "Outro cliente").id;
  const token = platform.createToken(a, {
    name: "Restrito",
    organization: orgA,
    days: 7,
  });
  const p = platform.tokenPrincipal(token.token);
  assert.deepEqual(
    platform.organizations(p).map((o) => o.id),
    [orgA],
  );
  assert.throws(() =>
    query(platform, p, "list_servers", { organization_id: other }),
  );
  platform.revokeToken(a, token.id);
  assert.throws(() => platform.tokenPrincipal(token.token));
  const expired = platform.createToken(a, { name: "Expirado" });
  store.db
    .prepare("UPDATE api_tokens SET expires_at=? WHERE id=?")
    .run(now() - 1, expired.id);
  assert.throws(() => platform.tokenPrincipal(expired.token));
});

test("senhas e sessões não são persistidas em texto simples; logout invalida acesso", (t) => {
  const { platform, store } = fixture(t);
  const login = platform.login({
    email: "alice@example.test",
    password: "strong-password-123",
  });
  const row = store.db
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .get(login.principal.userId)!;
  assert.notEqual(row.password_hash, "strong-password-123");
  assert.equal(platform.session(login.token).email, "alice@example.test");
  assert.throws(() =>
    platform.login({ email: "alice@example.test", password: "wrong" }),
  );
  assert.throws(() =>
    platform.login({ email: "missing@example.test", password: "wrong" }),
  );
  platform.logout(login.token);
  assert.throws(() => platform.session(login.token));
});

test("franquias de clientes e servidores são aplicadas no backend", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  for (let i = 0; i < 5; i++) platform.createServer(a, orgA, "web-" + i);
  assert.throws(() => platform.createServer(a, orgA, "sixth"), /Limite/);
  platform.createOrganization(a, "2");
  platform.createOrganization(a, "3");
  assert.throws(() => platform.createOrganization(a, "4"), /Limite/);
  store.db
    .prepare("UPDATE tenants SET trial_until=? WHERE id=?")
    .run(now() - 1, a.tenantId);
  assert.throws(() => platform.createOrganization(a, "expired"), /período/);
});

test("arquivar revoga o agente, preserva métricas e libera a franquia", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  const s = platform.createServer(a, orgA, "web");
  const agent = platform.enroll(s.enrollment_token);
  store.ingest(agent.agent_token, "one", metrics);
  assert.equal(platform.account(a).server_count, 1);
  platform.archiveServer(a, s.server_id);
  assert.equal(platform.account(a).server_count, 0);
  assert.equal(platform.servers(a).length, 0);
  assert.throws(() => platform.server(a, s.server_id));
  assert.throws(() => store.ingest(agent.agent_token, "two", metrics));
  assert.equal(
    Number(
      store.db
        .prepare("SELECT count(*) AS n FROM samples WHERE server_id=?")
        .get(s.server_id)!.n,
    ),
    1,
  );
});

test("assinatura expirada bloqueia ingestão e consultas MCP", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  const s = platform.createServer(a, orgA, "web");
  const agent = platform.enroll(s.enrollment_token);
  store.db
    .prepare("UPDATE tenants SET trial_until=? WHERE id=?")
    .run(now() - 1, a.tenantId);
  assert.throws(
    () => platform.validateAgentSubscription(agent.agent_token),
    /Assinatura inativa/,
  );
  assert.throws(() => query(platform, a, "list_servers"), /período/);
  assert.equal(platform.servers(a).length, 1, "inventário permanece acessível");
});

test("alertas exigem duração, deduplicam e recuperam com telemetria nova", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  const s = platform.createServer(a, orgA, "web"),
    agent = platform.enroll(s.enrollment_token);
  store.ingest(agent.agent_token, "high", { ...metrics, cpu_percent: 95 });
  const at = now();
  platform.evaluate(at);
  assert.equal(platform.alerts(a).length, 0);
  platform.evaluate(at + 61);
  platform.evaluate(at + 62);
  assert.equal(
    platform.alerts(a).filter((x) => !x.resolved_at && x.kind === "cpu").length,
    1,
  );
  platform.evaluate(at + 130);
  assert.equal(
    platform.alerts(a).filter((x) => !x.resolved_at && x.kind === "offline")
      .length,
    1,
  );
  assert.equal(
    platform.alerts(a).filter((x) => !x.resolved_at && x.kind === "cpu").length,
    1,
    "offline não comprova recuperação de CPU",
  );
  store.ingest(agent.agent_token, "recovered", metrics);
  platform.evaluate(at + 1);
  assert.equal(platform.alerts(a).filter((x) => !x.resolved_at).length, 0);
  assert.equal(
    Number(store.db.prepare("SELECT count(*) AS n FROM outbox").get()!.n),
    4,
  );
});

test("serviços configurados geram alertas e recuperações", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  const s = platform.createServer(a, orgA, "web"),
    agent = platform.enroll(s.enrollment_token);
  platform.updateRules(a, s.server_id, {
    cpu: 85,
    memory: 90,
    disk: 90,
    offline: 120,
    duration: 0,
  });
  store.ingest(agent.agent_token, "one", metrics);
  platform.recordDetails(agent.agent_token, { services: { nginx: "failed" } });
  platform.evaluate();
  assert.equal(platform.alerts(a)[0].kind, "service:nginx");
  platform.recordDetails(agent.agent_token, { services: { nginx: "active" } });
  platform.evaluate();
  assert.ok(platform.alerts(a)[0].resolved_at);
});

test("inventário amplo preserva versão e mais de 5 KB de serviços", (t) => {
  const { platform, a, orgA } = fixture(t);
  const server = platform.createServer(a, orgA, "inventory"),
    agent = platform.enroll(server.enrollment_token);
  const services = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [
      `custom-application-service-${i}`,
      "active",
    ]),
  );
  const details = {
    agent_version: "0.6.0",
    services,
    discovered_services: Object.keys(services),
  };
  assert.ok(JSON.stringify(details).length > 5000);
  platform.recordDetails(agent.agent_token, details);
  const stored = platform.server(a, server.server_id).details!;
  assert.equal(stored.agent_version, "0.6.0");
  assert.equal(Object.keys(stored.services as object).length, 300);
});

test("descoberta ampla não transforma unidades inativas em incidentes", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  const s = platform.createServer(a, orgA, "systemd"),
    agent = platform.enroll(s.enrollment_token);
  platform.updateRules(a, s.server_id, {
    cpu: 85,
    memory: 90,
    disk: 90,
    offline: 120,
    duration: 0,
  });
  store.ingest(agent.agent_token, "services", metrics);
  platform.recordDetails(agent.agent_token, {
    service_alert_mode: "failed_only",
    services: { oneshot: "inactive", disabled: "not_loaded", broken: "failed" },
  });
  platform.evaluate();
  assert.deepEqual(
    platform.alerts(a).map((r) => r.kind),
    ["service:broken"],
  );
  platform.recordDetails(agent.agent_token, {
    service_alert_mode: "failed_only",
    services: { oneshot: "inactive", disabled: "not_loaded", broken: "active" },
  });
  platform.evaluate();
  assert.ok(platform.alerts(a)[0].resolved_at);
});

test("diagnóstico básico persiste histórico por usuário e cliente", async (t) => {
  const { platform, a, b, orgA } = fixture(t);
  const result = await askAssistant(
    platform,
    a,
    { organization: orgA, question: "Como está o ambiente?" },
    {},
  );
  assert.equal(result.mode, "diagnostic");
  assert.match(result.answer, /sem modelo de IA/);
  assert.equal(platform.chatHistory(a, orgA).length, 1);
  await assert.rejects(
    askAssistant(platform, b, { organization: orgA, question: "vazar" }, {}),
  );
});

test("limpar e desfazer conversa isola usuário e servidor sem apagar auditoria", async (t) => {
  const { platform, a, b, orgA } = fixture(t);
  const first = platform.createServer(a, orgA, "one"),
    second = platform.createServer(a, orgA, "two");
  await askAssistant(
    platform,
    a,
    {
      organization: orgA,
      server_id: first.server_id,
      question: "Servidor um",
      mode: "diagnostic",
    },
    {},
  );
  await askAssistant(
    platform,
    a,
    {
      organization: orgA,
      server_id: second.server_id,
      question: "Servidor dois",
      mode: "diagnostic",
    },
    {},
  );
  const cleared = platform.clearChat(a, orgA, first.server_id);
  assert.equal(platform.chatHistory(a, orgA, first.server_id).length, 0);
  assert.equal(platform.chatHistory(a, orgA, second.server_id).length, 1);
  assert.throws(() => platform.clearChat(b, orgA, first.server_id));
  platform.restoreChat(a, orgA, second.server_id, cleared.clear_id);
  assert.equal(platform.chatHistory(a, orgA, first.server_id).length, 0);
  platform.restoreChat(a, orgA, first.server_id, cleared.clear_id);
  assert.equal(platform.chatHistory(a, orgA, first.server_id).length, 1);
  assert.ok(platform.auditLog(a).some((r) => r.action === "chat.cleared"));
});

test("limite adicional de IA é exclusivo do ambiente development", (t) => {
  const { platform, a } = fixture(t);
  const beforeMode = process.env.NODE_ENV,
    beforeLimit = process.env.FOXOPS_DEV_AI_DAILY_LIMIT;
  try {
    process.env.NODE_ENV = "development";
    process.env.FOXOPS_DEV_AI_DAILY_LIMIT = "200";
    assert.equal(platform.account(a).limits.aiDaily, 200);
    process.env.NODE_ENV = "production";
    assert.equal(platform.account(a).limits.aiDaily, 20);
  } finally {
    if (beforeMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = beforeMode;
    if (beforeLimit === undefined) delete process.env.FOXOPS_DEV_AI_DAILY_LIMIT;
    else process.env.FOXOPS_DEV_AI_DAILY_LIMIT = beforeLimit;
  }
});

test("assistente restringe métricas, alertas e histórico ao servidor escolhido", async (t) => {
  const { platform, store, a, orgA, orgB, b } = fixture(t);
  const one = platform.createServer(a, orgA, "selected-web");
  const two = platform.createServer(a, orgA, "OTHER-SERVER-SECRET");
  const foreign = platform.createServer(b, orgB, "foreign");
  const input = {
    organization: orgA,
    server_id: one.server_id,
    question: "Como está?",
  };
  await askAssistant(
    platform,
    a,
    {
      organization: orgA,
      server_id: two.server_id,
      question: "OTHER-CHAT-SECRET",
    },
    {},
  );
  await askAssistant(
    platform,
    a,
    { organization: orgA, question: "ALL-CHAT-SECRET" },
    {},
  );
  store.db
    .prepare(
      "INSERT INTO alerts(id,server_id,kind,severity,message,opened_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      "other-alert",
      two.server_id,
      "cpu",
      "warning",
      "OTHER-ALERT-SECRET",
      now(),
    );
  const first = await askAssistant(platform, a, input, {});
  assert.match(first.answer, /selected-web/);
  assert.doesNotMatch(first.answer, /OTHER-SERVER-SECRET/);
  const mock = (async (_url, options) => {
    const body = JSON.parse(String(options!.body));
    assert.match(body.input, /selected-web/);
    assert.match(body.input, /Como está/);
    assert.doesNotMatch(
      body.input,
      /OTHER-SERVER-SECRET|OTHER-CHAT-SECRET|ALL-CHAT-SECRET|OTHER-ALERT-SECRET/,
    );
    const context = JSON.parse(body.input);
    assert.equal(context.snapshot.servers.length, 1);
    assert.equal(context.conversation.length, 1);
    return new Response(
      JSON.stringify({
        output: [
          { content: [{ type: "output_text", text: "Resposta focada." }] },
        ],
        usage: { total_tokens: 5 },
      }),
    );
  }) as typeof fetch;
  await askAssistant(
    platform,
    a,
    { ...input, question: "E agora?" },
    { key: "fake", model: "test-model", fetch: mock },
  );
  assert.equal(platform.chatHistory(a, orgA, one.server_id).length, 2);
  assert.equal(platform.chatHistory(a, orgA, two.server_id).length, 1);
  assert.equal(platform.chatHistory(a, orgA).length, 1);
  await assert.rejects(
    askAssistant(platform, a, { ...input, server_id: foreign.server_id }, {}),
  );
  await assert.rejects(
    askAssistant(platform, a, { ...input, organization: orgB }, {}),
  );
  assert.throws(() => platform.chatHistory(a, orgA, foreign.server_id));
});

test("IA recebe apenas snapshot autorizado, contabiliza uso e reembolsa falha", async (t) => {
  const { platform, store, a, b, orgA, orgB } = fixture(t);
  platform.createServer(a, orgA, "allowed-web");
  platform.createServer(b, orgB, "SECRET-OTHER-TENANT");
  const mocked = (async (_url, options) => {
    const sent = JSON.parse(String(options!.body));
    assert.equal(sent.store, false);
    assert.match(sent.input, /allowed-web/);
    assert.doesNotMatch(sent.input, /SECRET-OTHER-TENANT/);
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Resposta de teste." }],
          },
        ],
        usage: { total_tokens: 12 },
      }),
    );
  }) as typeof fetch;
  const result = await askAssistant(
    platform,
    a,
    { organization: orgA, question: "Saúde?" },
    { key: "fake", model: "test-model", fetch: mocked },
  );
  assert.equal(result.mode, "ai");
  assert.equal(platform.account(a).ai_usage.calls, 1);
  assert.equal(platform.account(a).ai_usage.tokens, 12);
  const fail = (async () => new Response("", { status: 500 })) as typeof fetch;
  await assert.rejects(
    askAssistant(
      platform,
      a,
      { organization: orgA, question: "Saúde?" },
      { key: "fake", model: "test-model", fetch: fail },
    ),
  );
  assert.equal(platform.account(a).ai_usage.calls, 1);
});

test("webhook Stripe assinado atualiza plano uma vez e rejeita assinatura falsa", async (t) => {
  const { platform, a } = fixture(t);
  const billing = new Billing({
    origin: "http://localhost",
    key: "sk_test_fake",
    webhookSecret: "whsec_fake",
    prices: { growth: "price_growth" },
  });
  const payload = JSON.stringify({
    id: "evt_test",
    type: "customer.subscription.updated",
    created: now(),
    data: {
      object: {
        id: "sub_test",
        customer: "cus_test",
        status: "active",
        metadata: { tenant_id: a.tenantId, plan: "growth" },
        items: { data: [{ price: { id: "price_growth" } }] },
      },
    },
  });
  const signature = billing.stripe!.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_fake",
  });
  await billing.webhook(platform, Buffer.from(payload), signature);
  await billing.webhook(platform, Buffer.from(payload), signature);
  assert.equal(platform.account(a).plan, "growth");
  assert.equal(platform.account(a).subscription_status, "active");
  await assert.rejects(billing.webhook(platform, Buffer.from(payload), "fake"));
});

test("workspace rename: owner only, isolated, audited and available after expiration", (t) => {
  const { platform, store, a, b } = fixture(t);
  const originalB = platform.account(b).name;
  assert.throws(
    () => platform.renameWorkspace({ ...a, role: "admin" }, "New"),
    /perfil/,
  );
  assert.throws(
    () => platform.renameWorkspace({ ...a, orgScope: "restricted" }, "New"),
    /proprietário/,
  );
  for (const invalid of ["", "  ", "x".repeat(121), "a\nb", null])
    assert.throws(() => platform.renameWorkspace(a, invalid));
  store.db
    .prepare("UPDATE tenants SET subscription_status='past_due' WHERE id=?")
    .run(a.tenantId);
  assert.throws(() => platform.active(a), /período/);
  const result = platform.renameWorkspace(a, "  Novo workspace  ");
  assert.equal(result.name, "Novo workspace");
  assert.equal(platform.account(a).name, "Novo workspace");
  assert.equal(platform.account(b).name, originalB);
  const audit = store.db
    .prepare(
      "SELECT user_id,target FROM audit WHERE action='workspace.name.updated'",
    )
    .get();
  assert.equal(audit?.user_id, a.userId);
  assert.equal(audit?.target, a.tenantId);
});

test("expired subscription preserves account and server while normal retention still removes old samples", (t) => {
  const { platform, store, a, orgA } = fixture(t);
  const server = platform.createServer(a, orgA, "retention-expired");
  const retention = platform.account(a).limits.retentionDays;
  const insert = store.db.prepare("INSERT INTO samples VALUES (?,?,?,?)");
  insert.run(
    server.server_id,
    "old",
    now() - retention * 86400 - 100,
    JSON.stringify(metrics),
  );
  insert.run(server.server_id, "recent", now(), JSON.stringify(metrics));
  store.db
    .prepare("UPDATE tenants SET subscription_status='past_due' WHERE id=?")
    .run(a.tenantId);
  platform.cleanup();
  assert.equal(platform.principal(a.userId, a.tenantId).userId, a.userId);
  assert.equal(platform.server(a, server.server_id).id, server.server_id);
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM samples WHERE server_id=?")
      .get(server.server_id)?.n,
    1,
  );
  assert.throws(() => platform.active(a), /período/);
});
