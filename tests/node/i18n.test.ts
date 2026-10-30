import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog } from "../../web/locales/catalog.ts";
import { translate } from "../../shared/translate.ts";
import {
  detectLanguage,
  languageOf,
  languageInstruction,
} from "../../shared/language.ts";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { askAssistant } from "../../src/assistant.ts";

test("idiomas: português padrão, detecção regional e fallback explícito", () => {
  assert.equal(detectLanguage("en-GB"), "en");
  assert.equal(detectLanguage("es-AR"), "es");
  assert.equal(detectLanguage("pt-PT"), "pt-BR");
  assert.equal(detectLanguage("fr-FR"), "pt-BR");
  assert.equal(languageOf("invalid"), "pt-BR");
  assert.match(languageInstruction("es"), /Spanish/);
});
test("catálogos: menus, erros e valores interpolados preservam comandos e identificadores", () => {
  assert.equal(translate("Visão geral", "en"), "Overview");
  assert.equal(translate("Configurações", "es"), "Configuración");
  assert.equal(
    translate("Seu perfil não permite esta ação.", "en"),
    "Your role does not allow this action.",
  );
  assert.equal(
    translate("1–20 de 248 serviço(s)", "en"),
    "1–20 of 248 service(s)",
  );
  assert.equal(translate("Ir para página 13", "es"), "Ir a la página 13");
  assert.equal(translate("ss -lntup", "es"), "ss -lntup");
  assert.equal(translate("/etc/mysql/my.cnf", "en"), "/etc/mysql/my.cnf");
  assert.equal(translate("cloudflared", "en"), "cloudflared");
  assert.equal(
    translate("Texto novo sem tradução", "en"),
    "Texto novo sem tradução",
  );
});
test("catálogos: traduções completas e placeholders equivalentes nos dois idiomas", () => {
  assert.ok(Object.keys(catalog).length > 600);
  const params = (s: string) =>
    [...s.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]).sort();
  for (const [source, translations] of Object.entries(catalog))
    for (const locale of ["en", "es"] as const) {
      assert.ok(translations[locale]?.trim(), `${locale}: ${source}`);
      assert.deepEqual(
        params(translations[locale]),
        params(source),
        `${locale}: ${source}`,
      );
    }
});
test("preferência de idioma é salva por usuário sem alterar outro usuário ou o escopo", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const a = platform.signup({
    name: "A",
    company: "A",
    email: "language-a@example.test",
    password: "test-password-123",
  }).principal;
  const b = platform.signup({
    name: "B",
    company: "B",
    email: "language-b@example.test",
    password: "test-password-456",
  }).principal;
  platform.setLanguage(a, "es");
  assert.equal(platform.principal(a.userId, a.tenantId).language, "es");
  assert.equal(platform.principal(b.userId, b.tenantId).language, undefined);
  assert.throws(() => platform.setLanguage(a, "fr"));
  const pa = platform.principal(a.userId, a.tenantId),
    org = platform.organizations(pa)[0].id;
  const basic = await askAssistant(
    platform,
    pa,
    { organization: org, question: "Estado", mode: "diagnostic" },
    {},
  );
  assert.match(basic.answer, /sin modelo de IA/);
  let language = "";
  const fetcher = (async (_url, options) => {
    const body = JSON.parse(String(options!.body));
    language = body.instructions;
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: "El servidor no tiene alertas registradas.",
              },
            ],
          },
        ],
        usage: { total_tokens: 2 },
      }),
    );
  }) as typeof fetch;
  const result = await askAssistant(
    platform,
    pa,
    { organization: org, question: "Estado" },
    { key: "fake", model: "test", fetch: fetcher },
  );
  assert.match(language, /Respond in Spanish/);
  assert.match(result.answer, /El servidor/);
});
