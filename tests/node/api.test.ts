import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { createApp } from "../../src/app.ts";
import { Store } from "../../src/store.ts";

const admin = "development-test-token-" + "x".repeat(32);
const metrics = { cpu_percent: 25, memory_percent: 50, disk_percent: 75 };
async function fixture(t: TestContext) {
  const store = new Store(":memory:");
  const server = createApp(store, admin);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (path: string, token = "", data?: unknown) => {
    const response = await fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, data: await response.json() };
  };
}

test("HTTP: cadastro, ingestão e consulta com o contrato do agente Python", async (t) => {
  const request = await fixture(t);
  const registered = await request("/api/servers", admin, {
    organization: "acme",
    name: "web",
  });
  assert.equal(registered.status, 201);
  const token = registered.data.agent_token;
  assert.equal(
    (await request("/api/metrics", token, { event_id: "first", metrics })).data
      .accepted,
    true,
  );
  assert.equal(
    (await request("/api/metrics", token, { event_id: "first", metrics })).data
      .accepted,
    false,
  );
  const read = await request("/api/servers?organization=acme", admin);
  assert.equal(read.status, 200);
  assert.deepEqual(read.data.servers[0].metrics, metrics);
  assert.equal(read.data.servers[0].status, "online");
  assert.deepEqual(
    (await request("/api/servers?organization=other", admin)).data.servers,
    [],
  );
});

test("HTTP: agente não pode cadastrar nem consultar inventário", async (t) => {
  const request = await fixture(t);
  const registered = await request("/api/servers", admin, {
    organization: "acme",
    name: "web",
  });
  assert.equal(
    (
      await request(
        "/api/servers?organization=acme",
        registered.data.agent_token,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/servers", registered.data.agent_token, {
        organization: "other",
        name: "db",
      })
    ).status,
    401,
  );
  assert.equal(
    (await request("/api/metrics", admin, { event_id: "bad", metrics })).status,
    401,
  );
});

test("HTTP: erros de entrada, rotas e limite de tamanho", async (t) => {
  const request = await fixture(t);
  assert.equal((await request("/health")).data.status, "ok");
  assert.equal((await request("/unknown")).status, 404);
  assert.equal((await request("/api/servers", admin)).status, 400);
  assert.equal((await request("/api/servers", admin, [])).status, 400);
  assert.equal(
    (await request("/api/servers", admin, { name: "x".repeat(17000) })).status,
    413,
  );
  assert.equal(
    (await request("/api/servers", admin, { organization: "acme" })).status,
    400,
  );
});

test("recusa credencial administrativa curta na inicialização", () => {
  const store = new Store(":memory:");
  try {
    assert.throws(() => createApp(store, "short"), /32/);
  } finally {
    store.close();
  }
});
