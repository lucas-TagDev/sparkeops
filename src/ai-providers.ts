import { compatibleEndpoint } from "./ai-endpoints.ts";
import { APIError } from "./store.ts";

export const PROVIDERS = {
  openai: {
    name: "OpenAI",
    description: "Modelos da OpenAI",
    docs: "https://platform.openai.com/api-keys",
  },
  claude: {
    name: "Claude",
    description: "Modelos da Anthropic",
    docs: "https://platform.claude.com/settings/keys",
  },
  grok: {
    name: "Grok",
    description: "Modelos da xAI",
    docs: "https://console.x.ai",
  },
  deepseek: {
    name: "DeepSeek",
    description: "Modelos da DeepSeek",
    docs: "https://platform.deepseek.com/api_keys",
  },
  gemini: {
    name: "Gemini",
    description: "Modelos do Google",
    docs: "https://aistudio.google.com/apikey",
  },
  compatible: {
    name: "API compatível / Local",
    description: "LM Studio e endpoints compatíveis com OpenAI",
    docs: "https://lmstudio.ai/docs/developer/openai-compat",
  },
} as const;
export type Provider = keyof typeof PROVIDERS;
export type Credentials = {
  provider: Provider;
  key: string;
  model: string;
  baseUrl?: string;
};
export function providerId(value: string): Provider {
  if (!Object.hasOwn(PROVIDERS, value))
    throw new APIError(400, "Provedor de IA inválido.");
  return value as Provider;
}

const headers = (c: Credentials): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(c.provider === "claude"
    ? { "x-api-key": c.key, "anthropic-version": "2023-06-01" }
    : c.provider === "gemini"
      ? { "x-goog-api-key": c.key }
      : c.key
        ? { Authorization: `Bearer ${c.key}` }
        : {}),
});
const hosts = {
  openai: "https://api.openai.com/v1",
  claude: "https://api.anthropic.com/v1",
  grok: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

function failure(status: number): never {
  const message = [401, 403].includes(status)
    ? "Chave inválida ou sem permissão neste provedor."
    : [402, 429].includes(status)
      ? "Verifique o saldo e os limites da conta no provedor."
      : status === 404
        ? "Modelo ou recurso indisponível. Confira o identificador do modelo."
        : status === 400
          ? "O provedor recusou a configuração. Confira o modelo e as permissões da chave."
          : "O provedor de IA está indisponível. Tente novamente mais tarde.";
  throw new APIError(502, message);
}
async function request(
  c: Credentials,
  path: string,
  body: unknown,
  fetcher: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetcher(
      (c.provider === "compatible"
        ? compatibleEndpoint(c.baseUrl)
        : hosts[c.provider]) + path,
      {
        method: body === undefined ? "GET" : "POST",
        headers: headers(c),
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(
          c.provider === "compatible" ? 120000 : 45000,
        ),
      },
    );
  } catch {
    throw new APIError(
      502,
      "Não foi possível conectar ao provedor de IA. Tente novamente.",
    );
  }
  if (!response.ok) failure(response.status);
  try {
    return await response.json();
  } catch {
    throw new APIError(502, "O provedor retornou uma resposta inválida.");
  }
}

export async function generate(
  c: Credentials,
  instructions: string,
  input: string,
  fetcher = fetch,
) {
  let result,
    answer = "",
    tokens = 0;
  if (c.provider === "openai") {
    result = await request(
      c,
      "/responses",
      {
        model: c.model,
        store: false,
        max_output_tokens: 1200,
        instructions,
        input,
      },
      fetcher,
    );
    answer = (result.output ?? [])
      .flatMap(
        (x: { content?: { type: string; text?: string }[] }) => x.content ?? [],
      )
      .filter((x: { type: string }) => x.type === "output_text")
      .map((x: { text: string }) => x.text)
      .join("\n");
    tokens = result.usage?.total_tokens ?? 0;
  } else if (c.provider === "claude") {
    result = await request(
      c,
      "/messages",
      {
        model: c.model,
        max_tokens: 1200,
        system: instructions,
        messages: [{ role: "user", content: input }],
      },
      fetcher,
    );
    answer = (result.content ?? [])
      .filter((x: { type: string }) => x.type === "text")
      .map((x: { text: string }) => x.text)
      .join("\n");
    tokens =
      (result.usage?.input_tokens ?? 0) +
      (result.usage?.output_tokens ?? 0) +
      (result.usage?.cache_creation_input_tokens ?? 0) +
      (result.usage?.cache_read_input_tokens ?? 0);
  } else if (c.provider === "gemini") {
    result = await request(
      c,
      `/models/${encodeURIComponent(c.model)}:generateContent`,
      {
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: "user", parts: [{ text: input }] }],
        generationConfig: { maxOutputTokens: 1200 },
      },
      fetcher,
    );
    answer = (result.candidates?.[0]?.content?.parts ?? [])
      .filter(
        (x: { thought?: boolean; text?: string }) =>
          !x.thought && typeof x.text === "string",
      )
      .map((x: { text: string }) => x.text)
      .join("\n");
    tokens = result.usageMetadata?.totalTokenCount ?? 0;
  } else {
    result = await request(
      c,
      "/chat/completions",
      {
        model: c.model,
        max_tokens: 1200,
        stream: false,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
      },
      fetcher,
    );
    answer = result.choices?.[0]?.message?.content ?? "";
    tokens = result.usage?.total_tokens ?? 0;
  }
  if (typeof answer !== "string" || !answer.trim())
    throw new APIError(
      502,
      "O modelo não retornou texto. Confira a disponibilidade do modelo ou tente novamente.",
    );
  return {
    answer: answer.slice(0, 30000),
    tokens: Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : 0,
  };
}

// Read-only authentication check. No server metrics or inference prompt are sent.
export async function testProvider(c: Credentials, fetcher = fetch) {
  const result = await request(c, "/models", undefined, fetcher);
  const models: string[] =
    c.provider === "gemini"
      ? (result.models ?? []).map((m: { name: string }) =>
          m.name.replace(/^models\//, ""),
        )
      : (result.data ?? []).map((m: { id: string }) => m.id);
  return {
    ok: true,
    model_listed: models.includes(c.model),
    models: models.filter((id) => typeof id === "string").slice(0, 200),
    message: models.includes(c.model)
      ? "Conexão confirmada. O modelo está listado na sua conta."
      : c.provider === "compatible"
        ? "Endpoint respondeu. O modelo informado não apareceu na listagem; confira o ID e carregue o modelo no servidor."
        : "Chave aceita. O modelo informado não apareceu na listagem; confirme o ID e a disponibilidade com o provedor.",
  };
}
