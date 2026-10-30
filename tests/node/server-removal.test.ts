import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { createApp } from "../../src/app.ts";
import { SERVER_REMOVAL_WORD } from "../../shared/server-actions.ts";
test("server removal requires the exact confirmation word and tenant permissions before revoking access", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const a = platform.signup({
      name: "Alice",
      company: "A",
      email: "a@removal.test",
      password: "strong-password-123",
    }),
    b = platform.signup({
      name: "Bob",
      company: "B",
      email: "b@removal.test",
      password: "strong-password-456",
    });
  const org = platform.organizations(a.principal)[0].id,
    entry = platform.createServer(a.principal, org, "web", "debian"),
    agent = platform.enroll(entry.enrollment_token);
  for (const word of [undefined, "", "remover", "REMOVER ", "DELETE"])
    assert.throws(
      () => platform.removeServer(a.principal, entry.server_id, word),
      /REMOVER/,
    );
  assert.equal(platform.server(a.principal, entry.server_id).icon, "debian");
  platform.validateAgentSubscription(agent.agent_token);
  assert.throws(() =>
    platform.removeServer(b.principal, entry.server_id, SERVER_REMOVAL_WORD),
  );
  assert.throws(() =>
    platform.removeServer(
      { ...a.principal, role: "reader" },
      entry.server_id,
      SERVER_REMOVAL_WORD,
    ),
  );
  const server = createApp(store);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const url =
    "http://127.0.0.1:" +
    (server.address() as AddressInfo).port +
    `/api/v1/servers/${entry.server_id}/archive`;
  const request = (body: unknown) =>
    fetch(url, {
      method: "POST",
      headers: {
        Cookie: "foxops_session=" + a.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  assert.equal((await request({})).status, 400);
  assert.equal(platform.servers(a.principal).length, 1);
  assert.equal(
    (await request({ confirmation: SERVER_REMOVAL_WORD })).status,
    200,
  );
  assert.equal(platform.servers(a.principal).length, 0);
  assert.throws(() => store.ingest(agent.agent_token,'after-removal',{cpu_percent:1,memory_percent:2,disk_percent:3}),/Credencial/);
  assert.equal(store.listServers(org).length, 1);
});
