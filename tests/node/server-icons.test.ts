import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { isServerIcon, serverIcons } from "../../shared/server-icons.ts";
test("server icons: allowlist, persisted selection, fallback and scoped editing", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const a = platform.signup({
      name: "Alice",
      company: "A",
      email: "a@icons.test",
      password: "strong-password-123",
    }).principal,
    b = platform.signup({
      name: "Bob",
      company: "B",
      email: "b@icons.test",
      password: "strong-password-456",
    }).principal;
  const org = platform.organizations(a)[0].id;
  const old = platform.createServer(a, org, "default");
  assert.equal(platform.server(a, old.server_id).icon, "server");
  const selected = platform.createServer(a, org, "web", "ubuntu");
  assert.equal(platform.server(a, selected.server_id).icon, "ubuntu");
  assert.equal(
    new Platform(store).server(a, selected.server_id).icon,
    "ubuntu",
  );
  assert.throws(() =>
    platform.updateServerIcon(b, selected.server_id, "debian"),
  );
  assert.throws(() =>
    platform.updateServerIcon(
      { ...a, role: "reader" },
      selected.server_id,
      "debian",
    ),
  );
  platform.updateServerIcon(a, selected.server_id, "cloud");
  assert.equal(platform.server(a, selected.server_id).icon, "cloud");
  for (const bad of [
    "https://external.test/icon.svg",
    "<svg onload=alert(1)>",
    "../ubuntu",
    ["ubuntu"],
    null,
  ]) {
    assert.equal(isServerIcon(bad), false);
    assert.throws(() => platform.createServer(a, org, "bad", bad));
  }
  assert.equal(platform.servers(a).length, 2);
  assert.ok(serverIcons.filter((icon) => icon.group === "system").length >= 10);
  assert.ok(serverIcons.filter((icon) => icon.group === "generic").length >= 8);
  const audit = store.db
    .prepare("SELECT actor_name FROM audit WHERE action='server.icon.updated'")
    .get() as { actor_name: string };
  assert.equal(audit.actor_name, "Alice");
});
