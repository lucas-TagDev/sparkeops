import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { createApp } from "../../src/app.ts";
import type { AppOptions } from "../../src/app.ts";

async function fixture(t: TestContext, options: AppOptions = {}) {
  const store = new Store(":memory:"),
    platform = new Platform(store),
    server = createApp(store, undefined, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(
    path: string,
    data?: unknown,
    cookie?: string,
    method?: string,
    headers?: Record<string, string>,
  ) {
    const response = await fetch(url + path, {
      method: method ?? (data === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  return { store, platform, url, request };
}

test("HTTP: instalação autoriza SSH e MCP/agente realiza verificação local sem enviar mensagens", async (t) => {
  const { request } = await fixture(t);
  const signup = await request("/api/auth/signup", {
    name: "Owner",
    company: "Local checks",
    email: "checks@example.test",
    password: "strong-password-123",
  });
  const cookie = signup.cookie;
  const me = await request("/api/v1/me", undefined, cookie);
  const server = await request(
    "/api/v1/servers",
    { organization: me.data.organizations[0].id, name: "web" },
    cookie,
  );
  const id = server.data.server_id;
  const enrollment = await request("/api/agent/enroll", {
    token: server.data.enrollment_token,
    setup_ssh: true,
  });
  assert.equal(enrollment.status, 200);
  assert.ok(enrollment.data.ssh_bootstrap.ticket);
  const headers = { Authorization: "Bearer " + enrollment.data.agent_token };
  const metrics = {
    event_id: "first",
    metrics: { cpu_percent: 2, memory_percent: 20, disk_percent: 30 },
    details: { services: { nginx: "active" }, agent_version: "0.7.0" },
  };
  assert.equal(
    (await request("/api/metrics", metrics, undefined, "POST", headers)).status,
    200,
  );
  const job = await request(
    `/api/v1/servers/${id}/log-checks`,
    { service: "nginx" },
    cookie,
  );
  assert.equal(job.status, 201);
  const delivery = await request(
    "/api/metrics",
    { ...metrics, event_id: "second" },
    undefined,
    "POST",
    headers,
  );
  assert.equal(delivery.data.log_checks[0].id, job.data.id);
  assert.equal(
    (
      await request(
        `/api/agent/log-checks/${job.data.id}`,
        {
          counts: { configuration_error: 1 },
          scanned: 1,
          read_status: "ok",
          sources: ["journalctl"],
          message: "RAW-PRIVATE",
        },
        undefined,
        "POST",
        headers,
      )
    ).status,
    200,
  );
  const result = await request(
    `/api/v1/servers/${id}/log-checks`,
    undefined,
    cookie,
  );
  assert.equal(result.data[0].status, "completed");
  assert.doesNotMatch(JSON.stringify(result.data), /RAW-PRIVATE/);
  const processJob = await request(
    `/api/v1/servers/${id}/processes`,
    {},
    cookie,
  );
  assert.equal(processJob.status, 201);
  const processDelivery = await request(
    "/api/metrics",
    { ...metrics, event_id: "third" },
    undefined,
    "POST",
    headers,
  );
  assert.equal(processDelivery.data.process_checks[0].id, processJob.data.id);
  const processResult = {
    processes: [
      {
        pid: 42,
        name: "nginx",
        user: "www-data",
        state: "R",
        cpu_percent: 5,
        memory_percent: 2,
        rss_bytes: 1048576,
        elapsed_seconds: 60,
        service: "nginx",
        cmdline: "PRIVATE-ARG",
      },
    ],
    visible: 2,
    skipped: 0,
    sample_seconds: 1,
    collected_at: Math.floor(Date.now() / 1000),
    read_status: "ok",
  };
  assert.equal(
    (
      await request(
        `/api/agent/processes/${processJob.data.id}`,
        processResult,
        undefined,
        "POST",
        headers,
      )
    ).status,
    200,
  );
  const processList = await request(
    `/api/v1/servers/${id}/processes`,
    undefined,
    cookie,
  );
  assert.equal(processList.data[0].status, "completed");
  assert.doesNotMatch(JSON.stringify(processList.data), /PRIVATE-ARG|cmdline/);
  const liveQuestion = "Verifique o túnel cloudflare";
  const live = await request(
    "/api/v1/assistant/checks",
    {
      organization: me.data.organizations[0].id,
      server_id: id,
      question: liveQuestion,
    },
    cookie,
  );
  assert.equal(live.status, 201);
  const liveDelivery = await request(
    "/api/metrics",
    { ...metrics, event_id: "live" },
    undefined,
    "POST",
    headers,
  );
  assert.equal(liveDelivery.data.live_checks[0].id, live.data.id);
  assert.equal(
    (
      await request(
        `/api/agent/live-checks/${live.data.id}`,
        {
          checked_at: Math.floor(Date.now() / 1000),
          metrics: metrics.metrics,
          services: { cloudflared: "failed" },
          logs: {},
          limitations: ["Origem não configurada"],
        },
        undefined,
        "POST",
        headers,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/v1/assistant/checks/${live.data.id}`,
        undefined,
        cookie,
      )
    ).data.status,
    "completed",
  );
  const liveAnswer = await request(
    "/api/v1/assistant",
    {
      organization: me.data.organizations[0].id,
      server_id: id,
      question: liveQuestion,
      live_check_id: live.data.id,
      mode: "diagnostic",
    },
    cookie,
  );
  assert.equal(liveAnswer.status, 200);
  assert.match(liveAnswer.data.answer, /Verificação no servidor concluída/);
  assert.equal(
    (
      await request(
        "/api/agent/ssh-bootstrap",
        { ticket: "wrong" },
        undefined,
        "POST",
        headers,
      )
    ).status,
    403,
  );
});

test("fluxo HTTP completo: conta, sessão, instalação, métricas, diagnóstico e logout", async (t) => {
  const { request } = await fixture(t);
  const signup = await request("/api/auth/signup", {
    name: "Alice",
    company: "ACME",
    email: "alice@example.test",
    password: "strong-password-123",
  });
  assert.equal(signup.status, 201);
  assert.match(signup.cookie!, /foxops_session=/);
  const me = await request("/api/v1/me", undefined, signup.cookie);
  const organization = me.data.organizations[0].id;
  const server = await request(
    "/api/v1/servers",
    { organization, name: "linux-web" },
    signup.cookie,
  );
  assert.equal(server.status, 201);
  assert.ok(server.data.enrollment_token);
  assert.equal(server.data.agent_token, undefined);
  const enrollment = await request("/api/agent/enroll", {
    token: server.data.enrollment_token,
  });
  assert.equal(enrollment.status, 200);
  const sent = await request(
    "/api/metrics",
    {
      event_id: "one",
      metrics: { cpu_percent: 5, memory_percent: 20, disk_percent: 40 },
    },
    undefined,
    "POST",
    { Authorization: "Bearer " + enrollment.data.agent_token },
  );
  assert.equal(sent.status, 200);
  const list = await request("/api/v1/servers", undefined, signup.cookie);
  assert.equal(list.data[0].status, "online");
  const chat = await request(
    "/api/v1/assistant",
    { organization, question: "Saúde?" },
    signup.cookie,
  );
  assert.equal(chat.data.mode, "diagnostic");
  await request("/api/auth/logout", {}, signup.cookie);
  assert.equal(
    (await request("/api/v1/me", undefined, signup.cookie)).status,
    401,
  );
});

test("HTTP: idioma persiste no perfil e traduz erros de autorização", async (t) => {
  const { request } = await fixture(t);
  const signup = await request("/api/auth/signup", {
    name: "Locale",
    company: "Locales",
    email: "locale@example.test",
    password: "strong-password-123",
  });
  const cookie = signup.cookie;
  assert.equal(
    (await request("/api/v1/me/language", { language: "es" }, cookie, "PUT"))
      .status,
    200,
  );
  assert.equal(
    (await request("/api/v1/me", undefined, cookie)).data.user.language,
    "es",
  );
  const error = await request(
    "/api/v1/servers/00000000-0000-0000-0000-000000000000",
    undefined,
    cookie,
  );
  assert.equal(error.status, 404);
  assert.match(error.data.error, /Servidor no encontrado/);
  assert.equal(
    (await request("/api/v1/me/language", { language: "fr" }, cookie, "PUT"))
      .status,
    400,
  );
  assert.equal(
    (await request("/api/v1/me/language", { language: "en" }, undefined, "PUT"))
      .status,
    401,
  );
});

test("HTTP: marca pública e alteração global isolada dos proprietários de clientes", async (t) => {
  const { request, url } = await fixture(t, {
    platformAdmins: ["platform@example.test"],
  });
  assert.equal((await request("/api/branding")).data.name, "SparkeOPS");
  const admin = await request("/api/auth/signup", {
    name: "Global admin",
    company: "Platform",
    email: "platform@example.test",
    password: "strong-password-123",
  });
  const customer = await request("/api/auth/signup", {
    name: "Customer owner",
    company: "Customer",
    email: "customer@example.test",
    password: "strong-password-456",
  });
  assert.equal(
    (await request("/api/v1/me", undefined, admin.cookie)).data.platform_admin,
    true,
  );
  assert.equal(
    (await request("/api/v1/me", undefined, customer.cookie)).data
      .platform_admin,
    false,
  );
  const data = {
    name: "Brand Test",
    primaryColor: "#123abc",
    logo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHhoAAAAASUVORK5CYII=",
  };
  assert.equal(
    (await request("/api/v1/platform/branding", data, customer.cookie, "PUT"))
      .status,
    403,
  );
  assert.equal(
    (await request("/api/v1/platform/branding", data, undefined, "PUT")).status,
    401,
  );
  const saved = await request(
    "/api/v1/platform/branding",
    data,
    admin.cookie,
    "PUT",
  );
  assert.equal(saved.status, 200);
  const publicConfig = await request("/api/branding");
  assert.equal(publicConfig.data.name, "Brand Test");
  const image = await fetch(url + publicConfig.data.logo);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.ok((await image.arrayBuffer()).byteLength > 0);
  assert.equal(
    (
      await request(
        "/api/v1/platform/branding",
        undefined,
        customer.cookie,
        "DELETE",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/v1/platform/branding",
        undefined,
        admin.cookie,
        "DELETE",
      )
    ).data.name,
    "SparkeOPS",
  );
});

test("HTTP bloqueia origem indevida e desativa acesso administrativo legado", async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (
      await request("/api/auth/signup", {}, undefined, "POST", {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await request("/api/servers")).status, 404);
  assert.equal((await request("/api/v1/servers")).status, 401);
});

test("cliente MCP oficial inicializa, consulta ferramentas e respeita cliente e revogação", async (t) => {
  const { platform, url } = await fixture(t);
  const p = platform.signup({
    name: "Alice",
    company: "ACME",
    email: "alice@example.test",
    password: "strong-password-123",
  }).principal;
  const org = platform.organizations(p)[0].id,
    second = platform.createOrganization(p, "Secret").id;
  platform.createServer(p, org, "allowed-web");
  platform.createServer(p, second, "restricted-db");
  const token = platform.createToken(p, {
    name: "test-client",
    organization: org,
  });
  const client = new Client({ name: "foxops-tests", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
      requestInit: { headers: { Authorization: "Bearer " + token.token } },
    }),
  );
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 15);
  assert.ok(
    tools.tools.some((tool) => tool.name === "get_observability_context"),
  );
  assert.ok(tools.tools.some((tool) => tool.name === "request_runbook"));
  const result = await client.callTool({
    name: "list_servers",
    arguments: { organization_id: org },
  });
  assert.match(JSON.stringify(result), /allowed-web/);
  assert.doesNotMatch(JSON.stringify(result), /restricted-db/);
  const denied = await client.callTool({
    name: "list_servers",
    arguments: { organization_id: second },
  });
  assert.equal(denied.isError, true);
  platform.revokeToken(p, token.id);
  await assert.rejects(client.listTools());
});
