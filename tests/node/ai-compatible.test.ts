import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/app.ts";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { generate } from "../../src/ai-providers.ts";
import { compatibleEndpoint } from "../../src/ai-endpoints.ts";
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const a = platform.signup({
    name: "Owner",
    company: "A",
    email: "a@local.test",
    password: "strong-password-123",
  }).principal;
  const b = platform.signup({
    name: "Other",
    company: "B",
    email: "b@local.test",
    password: "strong-password-456",
  }).principal;
  const calls: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }[] = [];
  const fetcher = (async (url, options) => {
    calls.push({
      url: String(url),
      headers: options?.headers as Record<string, string>,
      body: options?.body ? JSON.parse(String(options.body)) : undefined,
    });
    return new Response(
      JSON.stringify(
        options?.method === "GET"
          ? { data: [{ id: "local-model" }] }
          : {
              choices: [{ message: { content: "Resposta local" } }],
              usage: { total_tokens: 7 },
            },
      ),
    );
  }) as typeof fetch;
  const settings = new AISettings(platform, {
    masterKey: Buffer.alloc(32, 7),
    fetch: fetcher,
  });
  return { store, platform, a, b, settings, calls, fetcher };
}
test("Local LLM: explicit destination authorization, optional key, model discovery and chat completions", async (t) => {
  const { settings, a, b, calls, fetcher } = fixture(t);
  const config = {
    model: "local-model",
    base_url: "http://127.0.0.1:1234/v1",
    no_key: true,
    enabled: true,
  };
  assert.throws(
    () => settings.save(a, "compatible", config),
    /administrador geral/,
  );
  settings.endpoints.save(["http://127.0.0.1:1234"]);
  assert.throws(
    () => settings.save(a, "compatible", { ...config, no_key: false }),
    /chave/,
  );
  settings.save(a, "compatible", config);
  settings.select(a, { mode: "own", provider: "compatible" }, false);
  assert.equal(
    settings.metadata(a, false).providers.find((p) => p.id === "compatible")
      ?.no_key,
    true,
  );
  assert.equal(settings.resolve(b, {}), null);
  const testResult = await settings.test(a, "compatible");
  assert.equal(testResult.model_listed, true);
  assert.equal(calls[0].url, "http://127.0.0.1:1234/v1/models");
  assert.equal(calls[0].headers.Authorization, undefined);
  const credential = settings.resolveChoice(a, {}, "compatible")!;
  assert.deepEqual(
    await generate(credential, "system", "authorized tenant input", fetcher),
    { answer: "Resposta local", tokens: 7 },
  );
  assert.equal(calls[1].url, "http://127.0.0.1:1234/v1/chat/completions");
  assert.equal((calls[1].body as { model: string }).model, "local-model");
  settings.endpoints.save([]);
  assert.throws(() => settings.resolve(a, {}), /administrador geral/);
  assert.throws(
    () => settings.resolveChoice(a, {}, "compatible"),
    /administrador geral/,
  );
});
test("Compatible API: keys stay encrypted and are only sent in the authorization header", async (t) => {
  const { store, settings, a, calls, fetcher } = fixture(t);
  const secret = "example-compatible-key";
  settings.endpoints.save(["https://llm.example.test"]);
  settings.save(a, "compatible", {
    model: "local-model",
    base_url: "https://llm.example.test/api/v1/",
    key: secret,
    no_key: false,
    enabled: true,
  });
  const metadata = JSON.stringify(settings.metadata(a, false));
  assert.ok(!metadata.includes(secret));
  assert.notEqual(
    store.db
      .prepare(
        "SELECT encrypted_key FROM ai_credentials WHERE provider='compatible'",
      )
      .get()?.encrypted_key,
    secret,
  );
  await generate(
    settings.resolveChoice(a, {}, "compatible")!,
    "system",
    "input",
    fetcher,
  );
  assert.equal(calls[0].headers.Authorization, "Bearer " + secret);
  assert.ok(!JSON.stringify(calls[0].body).includes(secret));
  settings.save(a, "compatible", {
    model: "local-model",
    base_url: "https://llm.example.test/api/v1",
    no_key: true,
    enabled: true,
  });
  assert.equal(settings.resolveChoice(a, {}, "compatible")!.key, "");
});
test("Custom endpoint rejects credentials, unsafe schemes, link-local metadata and query strings", () => {
  for (const url of [
    "file:///etc/passwd",
    "http://user:password@localhost:1234/v1",
    "http://169.254.169.254/latest",
    "http://localhost:1234/v1?key=secret",
    "http://localhost:1234/v1#x",
    "http://[fe80::1]:1234/v1",
  ])
    assert.throws(() => compatibleEndpoint(url), url);
  assert.equal(
    compatibleEndpoint("http://localhost:1234/v1/"),
    "http://localhost:1234/v1",
  );
});

test("Custom LLM origins can only be authorized by a global platform administrator", async (t) => {
  const { store, platform, a, b, fetcher } = fixture(t);
  const server = createApp(store, undefined, {
    platformAdmins: [a.email],
    aiVault: { masterKey: Buffer.alloc(32, 7), fetch: fetcher },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const cookieA = "foxops_session=" + platform.newSession(a).token,
    cookieB = "foxops_session=" + platform.newSession(b).token;
  const call = (path: string, cookie: string, data?: unknown) =>
    fetch(base + "/api/v1" + path, {
      method: data ? "PUT" : "GET",
      headers: {
        Cookie: cookie,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  assert.equal((await call("/platform/ai/endpoints", cookieB)).status, 403);
  assert.equal(
    (
      await call("/platform/ai/endpoints", cookieB, {
        origins: ["http://127.0.0.1:1234"],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/platform/ai/endpoints", cookieA, {
        origins: ["http://127.0.0.1:1234"],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/ai/providers/compatible", cookieB, {
        model: "local-model",
        base_url: "http://unapproved.local:5678/v1",
        no_key: true,
        enabled: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/ai/providers/compatible", cookieB, {
        model: "local-model",
        base_url: "http://127.0.0.1:1234/v1",
        no_key: true,
        enabled: true,
      })
    ).status,
    200,
  );
});
