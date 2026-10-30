import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { randomBytes } from "node:crypto";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import type { Principal } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { generate, testProvider, PROVIDERS } from "../../src/ai-providers.ts";
import type { Provider } from "../../src/ai-providers.ts";
import { askAssistant } from "../../src/assistant.ts";
import { createApp } from "../../src/app.ts";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store),
    masterKey = randomBytes(32);
  const a = platform.signup({
    name: "A",
    company: "A",
    email: "a@example.test",
    password: "strong-password-123",
  });
  const b = platform.signup({
    name: "B",
    company: "B",
    email: "b@example.test",
    password: "strong-password-456",
  });
  const settings = new AISettings(platform, { masterKey });
  return { store, platform, settings, a, b, masterKey };
}
const fakeKey = "test-only-not-a-real-provider-key";

test("arquivo mestre persiste entre instâncias e não é recriado se desaparecer", (t) => {
  const { platform, a } = fixture(t);
  const dir = mkdtempSync(join(process.cwd(), "tests", "node", "vault-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, ".secrets", "ai-master.key");
  const settings = new AISettings(platform, { keyFile });
  settings.save(a.principal, "openai", {
    key: fakeKey,
    model: "test-model",
    enabled: true,
  });
  assert.equal(readFileSync(keyFile).length, 32);
  assert.equal(
    new AISettings(platform, { keyFile }).resolve(a.principal, {})!.key,
    fakeKey,
  );
  unlinkSync(keyFile);
  assert.throws(() => settings.resolve(a.principal, {}), /proteção/);
  assert.throws(
    () =>
      settings.save(a.principal, "claude", {
        key: fakeKey,
        model: "test-model",
        enabled: true,
      }),
    /Restaure/,
  );
});

test("chaves são cifradas, não aparecem nos metadados e são isoladas por conta", (t) => {
  const { store, platform, settings, a, b, masterKey } = fixture(t);
  settings.save(a.principal, "openai", {
    key: fakeKey,
    model: "test-model",
    enabled: true,
  });
  const row = store.db.prepare("SELECT * FROM ai_credentials").get()!;
  assert.doesNotMatch(JSON.stringify(row), new RegExp(fakeKey));
  assert.doesNotMatch(
    JSON.stringify(settings.metadata(a.principal, false)),
    /encrypted_key|test-only-not/,
  );
  assert.equal(
    settings.metadata(b.principal, false).providers.every((p) => !p.configured),
    true,
  );
  assert.equal(settings.resolve(b.principal, {}), null);
  assert.equal(settings.resolve(a.principal, {})!.key, fakeKey);
  const restarted = new AISettings(platform, { masterKey });
  assert.equal(restarted.resolve(a.principal, {})!.key, fakeKey);
  settings.save(a.principal, "openai", {
    model: "another-model",
    enabled: true,
  });
  assert.equal(settings.resolve(a.principal, {})!.key, fakeKey);
  assert.equal(settings.resolve(a.principal, {})!.model, "another-model");
});

test("somente proprietário pode escrever, testar e remover chaves", async (t) => {
  const { settings, a } = fixture(t);
  for (const role of ["reader", "operator", "admin"] as const) {
    const p: Principal = { ...a.principal, role };
    assert.throws(() =>
      settings.save(p, "openai", {
        key: fakeKey,
        model: "test",
        enabled: true,
      }),
    );
    assert.throws(() => settings.select(p, { mode: "off" }, false));
    assert.throws(() => settings.remove(p, "openai"));
    await assert.rejects(settings.test(p, "openai"));
  }
  assert.throws(() =>
    settings.metadata({ ...a.principal, role: "reader" }, false),
  );
});

test("desabilitação, exclusão e troca de provedor não fazem fallback silencioso", (t) => {
  const { settings, a } = fixture(t);
  const p = a.principal,
    fallback = { key: "platform-secret", model: "platform-model" };
  settings.save(p, "claude", {
    key: fakeKey,
    model: "claude-test",
    enabled: true,
  });
  settings.save(p, "gemini", {
    key: "other-fake-key",
    model: "models/gemini-test",
    enabled: true,
  });
  assert.equal(settings.resolve(p, fallback)!.provider, "claude");
  settings.select(p, { mode: "own", provider: "gemini" }, true);
  assert.equal(settings.resolve(p, fallback)!.model, "gemini-test");
  settings.save(p, "gemini", { model: "gemini-test", enabled: false });
  assert.equal(settings.resolve(p, fallback), null);
  settings.remove(p, "gemini");
  assert.equal(settings.resolve(p, fallback), null);
  settings.select(p, { mode: "platform" }, true);
  assert.equal(settings.resolve(p, fallback)!.key, "platform-secret");
  settings.select(p, { mode: "off" }, true);
  settings.save(p, "deepseek", {
    key: fakeKey,
    model: "deepseek-test",
    enabled: true,
  });
  assert.equal(
    settings.resolve(p, fallback),
    null,
    "Salvar não muda um modo explicitamente escolhido",
  );
});

test("cifra recusa chave mestre errada e troca de ciphertext entre contas", (t) => {
  const { store, platform, settings, a, b } = fixture(t);
  settings.save(a.principal, "openai", {
    key: fakeKey,
    model: "test",
    enabled: true,
  });
  assert.throws(() =>
    new AISettings(platform, { masterKey: randomBytes(32) }).resolve(
      a.principal,
      {},
    ),
  );
  settings.save(b.principal, "openai", {
    key: "different-fake-key",
    model: "test",
    enabled: true,
  });
  const row = store.db
    .prepare("SELECT encrypted_key FROM ai_credentials WHERE tenant_id=?")
    .get(a.principal.tenantId)!;
  store.db
    .prepare("UPDATE ai_credentials SET encrypted_key=? WHERE tenant_id=?")
    .run(row.encrypted_key!, b.principal.tenantId);
  assert.throws(() => settings.resolve(b.principal, {}));
});

test("campos inválidos não são persistidos e tokens não entram na auditoria", (t) => {
  const { settings, platform, a } = fixture(t);
  assert.throws(() =>
    settings.save(a.principal, "__proto__", {
      key: fakeKey,
      model: "x",
      enabled: true,
    }),
  );
  assert.throws(() =>
    settings.save(a.principal, "openai", {
      key: "short",
      model: "x",
      enabled: true,
    }),
  );
  assert.throws(() =>
    settings.save(a.principal, "openai", {
      key: fakeKey,
      model: "",
      enabled: true,
    }),
  );
  assert.throws(() =>
    settings.select(a.principal, { mode: "platform" }, false),
  );
  settings.save(a.principal, "openai", {
    key: fakeKey,
    model: "x",
    enabled: true,
  });
  assert.doesNotMatch(
    JSON.stringify(platform.auditLog(a.principal)),
    new RegExp(fakeKey),
  );
});

for (const provider of Object.keys(PROVIDERS) as Provider[]) {
  test(`${provider}: adaptador usa URL fixa, autenticação correta e extrai resposta e consumo`, async () => {
    const responses = {
      openai: {
        output: [{ content: [{ type: "output_text", text: "Resposta" }] }],
        usage: { total_tokens: 12 },
      },
      claude: {
        content: [{ type: "text", text: "Resposta" }],
        usage: { input_tokens: 5, output_tokens: 7 },
      },
      grok: {
        choices: [{ message: { content: "Resposta" } }],
        usage: { total_tokens: 12 },
      },
      deepseek: {
        choices: [{ message: { content: "Resposta" } }],
        usage: { total_tokens: 12 },
      },
      gemini: {
        candidates: [
          {
            content: {
              parts: [{ text: "hidden", thought: true }, { text: "Resposta" }],
            },
          },
        ],
        usageMetadata: { totalTokenCount: 12 },
      },
    };
    const hosts = {
      openai: "api.openai.com",
      claude: "api.anthropic.com",
      grok: "api.x.ai",
      deepseek: "api.deepseek.com",
      gemini: "generativelanguage.googleapis.com",
    };
    const fetcher = (async (url, options) => {
      assert.equal(new URL(String(url)).hostname, hosts[provider]);
      assert.equal(options!.redirect, "error");
      const headers = options!.headers as Record<string, string>;
      assert.equal(
        headers[
          provider === "claude"
            ? "x-api-key"
            : provider === "gemini"
              ? "x-goog-api-key"
              : "Authorization"
        ],
        ["claude", "gemini"].includes(provider) ? fakeKey : "Bearer " + fakeKey,
      );
      const body = JSON.parse(String(options!.body));
      assert.doesNotMatch(String(options!.body), new RegExp(fakeKey));
      assert.match(String(options!.body), /authorized-snapshot/);
      if (provider !== "gemini") assert.equal(body.model, "test-model");
      if (provider === "openai") assert.equal(body.store, false);
      return new Response(JSON.stringify(responses[provider]));
    }) as typeof fetch;
    assert.deepEqual(
      await generate(
        { provider, key: fakeKey, model: "test-model" },
        "system",
        "authorized-snapshot",
        fetcher,
      ),
      { answer: "Resposta", tokens: 12 },
    );
  });
  test(`${provider}: teste de conexão não gera texto nem envia dados do servidor`, async () => {
    const fetcher = (async (url, options) => {
      assert.match(String(url), /\/models$/);
      assert.equal(options!.method, "GET");
      assert.equal(options!.body, undefined);
      return new Response(
        JSON.stringify(
          provider === "gemini"
            ? { models: [{ name: "models/test-model" }] }
            : { data: [{ id: "test-model" }] },
        ),
      );
    }) as typeof fetch;
    const result = await testProvider(
      { provider, key: fakeKey, model: "test-model" },
      fetcher,
    );
    assert.equal(result.ok, true);
    assert.equal(result.model_listed, true);
  });
}

test("falhas do provedor não revelam chaves retornadas no corpo remoto", async () => {
  const fail = (async () =>
    new Response(JSON.stringify({ error: fakeKey }), {
      status: 401,
    })) as typeof fetch;
  await assert.rejects(
    generate(
      { provider: "openai", key: fakeKey, model: "test" },
      "system",
      "prompt",
      fail,
    ),
    (e) => {
      assert.doesNotMatch(String(e), new RegExp(fakeKey));
      assert.match(String(e), /Chave inválida/);
      return true;
    },
  );
});

test("assistente usa chave e provedor próprios da conta, não a chave global", async (t) => {
  const { settings, platform, a } = fixture(t);
  settings.save(a.principal, "claude", {
    key: fakeKey,
    model: "claude-test",
    enabled: true,
  });
  const mocked = (async (url, options) => {
    assert.match(String(url), /api.anthropic.com/);
    assert.equal(
      (options!.headers as Record<string, string>)["x-api-key"],
      fakeKey,
    );
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "Usando Claude." }],
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    );
  }) as typeof fetch;
  const result = await askAssistant(
    platform,
    a.principal,
    {
      organization: platform.organizations(a.principal)[0].id,
      question: "Saúde?",
    },
    { key: "global-not-used", model: "global-test", fetch: mocked },
    settings,
  );
  assert.equal(result.provider, "claude");
  assert.equal(result.mode, "ai");
  assert.equal(platform.account(a.principal).ai_usage.tokens, 12);
});

test("HTTP: metadados seguros, isolamento de conta, substituição e remoção", async (t) => {
  const { store, platform, a, b, masterKey } = fixture(t);
  const server = createApp(store, undefined, { aiVault: { masterKey } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (
    path: string,
    token: string,
    data?: unknown,
    method = data === undefined ? "GET" : "PUT",
  ) => {
    const response = await fetch(base + "/api/v1" + path, {
      method,
      headers: {
        Cookie: `foxops_session=${token}`,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, text: await response.text() };
  };
  assert.equal((await request("/ai/settings", "")).status, 401);
  const saved = await request("/ai/providers/grok", a.token, {
    key: fakeKey,
    model: "grok-test",
    enabled: true,
  });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(saved.text, /encrypted_key|test-only-not/);
  assert.equal(
    JSON.parse((await request("/ai/status", a.token)).text).provider,
    "grok",
  );
  assert.equal(
    JSON.parse((await request("/ai/status", b.token)).text).enabled,
    false,
  );
  const reader = platform.newSession({ ...a.principal });
  store.db
    .prepare(
      "UPDATE memberships SET role='reader' WHERE user_id=? AND tenant_id=?",
    )
    .run(a.principal.userId, a.principal.tenantId);
  assert.equal(
    (
      await request("/ai/providers/grok", reader.token, {
        key: fakeKey,
        model: "grok-test",
        enabled: true,
      })
    ).status,
    403,
  );
  store.db
    .prepare(
      "UPDATE memberships SET role='owner' WHERE user_id=? AND tenant_id=?",
    )
    .run(a.principal.userId, a.principal.tenantId);
  assert.equal(
    (await request("/ai/providers/grok", a.token, undefined, "DELETE")).status,
    200,
  );
  assert.equal(
    JSON.parse((await request("/ai/status", a.token)).text).enabled,
    false,
  );
});

test("chat AI selection: enabled tenant providers only, explicit choice independent of default and no silent fallback", (t) => {
  const { platform, a, b, settings } = fixture(t);
  settings.save(a.principal, "openai", {
    model: "model-one",
    key: "secret-openai-1234567890",
    enabled: true,
  });
  settings.save(a.principal, "gemini", {
    model: "model-two",
    key: "secret-gemini-1234567890",
    enabled: true,
  });
  settings.save(b.principal, "claude", {
    model: "model-three",
    key: "secret-claude-1234567890",
    enabled: true,
  });
  const before = JSON.stringify(settings.status(a.principal, false));
  const choices = settings.choices(a.principal, false);
  assert.deepEqual(
    choices.providers.map((p) => p.id),
    ["openai", "gemini"],
  );
  assert.doesNotMatch(JSON.stringify(choices), /secret-|encrypted_key/);
  assert.equal(
    settings.resolveChoice(a.principal, {}, "gemini")!.provider,
    "gemini",
  );
  assert.equal(JSON.stringify(settings.status(a.principal, false)), before);
  assert.throws(() => settings.resolveChoice(a.principal, {}, "claude"));
  assert.throws(() => settings.resolveChoice(a.principal, {}, "platform"));
  assert.equal(settings.resolveChoice(a.principal, {}, "diagnostic"), null);
  settings.save(a.principal, "gemini", { model: "model-two", enabled: false });
  assert.throws(() => settings.resolveChoice(a.principal, {}, "gemini"));
});
