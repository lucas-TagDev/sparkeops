import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../../src/store.ts";

const metrics = { cpu_percent: 10, memory_percent: 20, disk_percent: 30 };

test("credencial vincula métricas ao servidor e à organização", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const a = store.register("a", "web");
  store.register("b", "db");
  assert.equal(store.ingest(a.agent_token, "one", metrics).accepted, true);
  assert.deepEqual(store.listServers("a")[0].metrics, metrics);
  assert.equal(store.listServers("b")[0].metrics, null);
  assert.equal(store.listServers("a")[0].status, "online");
  assert.equal(
    store.listServers("a", Date.now() / 1000 + 100)[0].status,
    "offline",
  );
});

test("eventos repetidos não alteram métricas nem última comunicação", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const a = store.register("a", "web");
  store.ingest(a.agent_token, "one", metrics);
  const before = store.listServers("a");
  assert.equal(
    store.ingest(a.agent_token, "one", { ...metrics, cpu_percent: 99 })
      .accepted,
    false,
  );
  assert.deepEqual(store.listServers("a"), before);
});

test("rejeita credenciais e métricas inválidas", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const a = store.register("a", "web");
  assert.throws(() => store.ingest("invalid", "one", metrics), /Credencial/);
  for (const cpu_percent of [NaN, Infinity, -1, 101, true, "20"]) {
    assert.throws(() =>
      store.ingest(a.agent_token, "bad", { ...metrics, cpu_percent }),
    );
  }
  for (const value of [null, [], {}, { ...metrics, extra: 1 }]) {
    assert.throws(() => store.ingest(a.agent_token, "bad", value));
  }
  assert.throws(() => store.register("", "web"));
  assert.throws(() => store.register("a", null));
});

test("reabre banco preservando servidores, credenciais e métricas", (t) => {
  const dir = mkdtempSync(join(process.cwd(), "tests", "node", "db-"));
  const path = join(dir, "test.sqlite3");
  const first = new Store(path);
  const a = first.register("a", "web");
  first.ingest(a.agent_token, "one", metrics);
  first.close();
  const second = new Store(path);
  t.after(() => {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.deepEqual(second.listServers("a")[0].metrics, metrics);
  assert.equal(second.ingest(a.agent_token, "two", metrics).accepted, true);
  const row = second.db.prepare("SELECT token_hash FROM servers").get()!;
  assert.notEqual(row.token_hash, a.agent_token);
});
