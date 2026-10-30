import { APIError } from "./store.ts";
import type { Platform } from "./platform.ts";
export function compatibleEndpoint(value: unknown) {
  if (typeof value !== "string" || value.length > 500)
    throw new APIError(400, "Informe o endereço base do endpoint de IA.");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new APIError(400, "Endereço do endpoint de IA inválido.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname ||
    /[\s\\]/.test(value) ||
    /^169\.254\./.test(url.hostname) ||
    /^\[fe80:/i.test(url.hostname)
  )
    throw new APIError(
      400,
      "Use HTTP ou HTTPS, sem credenciais, query string ou fragmento no endereço.",
    );
  return url.href.replace(/\/+$/, "");
}
export class AIEndpointPolicy {
  platform: Platform;
  constructor(platform: Platform) {
    this.platform = platform;
    platform.store.db.exec(
      "CREATE TABLE IF NOT EXISTS ai_endpoint_policy(id INTEGER PRIMARY KEY CHECK(id=1),origins TEXT NOT NULL)",
    );
  }
  origins(): string[] {
    const row = this.platform.store.db
      .prepare("SELECT origins FROM ai_endpoint_policy WHERE id=1")
      .get();
    return row ? JSON.parse(String(row.origins)) : [];
  }
  save(input: unknown) {
    if (
      !Array.isArray(input) ||
      input.length > 100 ||
      input.some((value) => typeof value !== "string")
    )
      throw new APIError(400, "Informe até 100 endereços permitidos.");
    const origins = [
      ...new Set(
        input.map((value) => new URL(compatibleEndpoint(value)).origin),
      ),
    ];
    this.platform.store.db
      .prepare(
        "INSERT INTO ai_endpoint_policy VALUES(1,?) ON CONFLICT(id) DO UPDATE SET origins=excluded.origins",
      )
      .run(JSON.stringify(origins));
    return { origins };
  }
  allowed(value: unknown) {
    const endpoint = compatibleEndpoint(value);
    if (!this.origins().includes(new URL(endpoint).origin))
      throw new APIError(
        403,
        "Este endpoint de IA precisa ser autorizado pelo administrador geral em Endpoints de IA.",
      );
    return endpoint;
  }
}
