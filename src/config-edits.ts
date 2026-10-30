import { randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import { now } from "./platform.ts";
import type { Platform, Principal } from "./platform.ts";
import type { Operations } from "./operations.ts";
import { askAssistant } from "./assistant.ts";
import type { AIConfig } from "./assistant.ts";
import type { AISettings } from "./ai-settings.ts";

export const configFields = (
  service: string,
): Record<string, [number, number]> =>
  service === "nginx"
    ? { worker_processes: [1, 256] }
    : service === "apache2"
      ? { KeepAliveTimeout: [1, 300], Timeout: [1, 600] }
      : /^php\d{1,2}\.\d{1,2}-fpm$/.test(service)
        ? { "pm.max_children": [1, 1024], "pm.max_requests": [0, 100000] }
        : service === "mysql"
          ? { max_connections: [10, 2000] }
          : {};
type Snapshot = {
  id: string;
  server_id: string;
  tenant_id: string;
  created_at: number;
  revision: string;
  data: string;
};
export class ConfigEdits {
  platform: Platform;
  ops: Operations;
  constructor(platform: Platform, ops: Operations) {
    this.platform = platform;
    this.ops = ops;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS config_snapshots(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,tenant_id TEXT NOT NULL,created_at INTEGER NOT NULL,revision TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS config_changes(action_id TEXT PRIMARY KEY,summary TEXT NOT NULL);`);
  }
  authorize(p: Principal, id: string) {
    this.platform.requireRole(p, ["owner", "admin", "operator"]);
    this.platform.active(p);
    return this.platform.server(p, id);
  }
  snapshot(p: Principal, id: string, snapshotId: unknown) {
    this.authorize(p, id);
    const row = this.platform.store.db
      .prepare(
        "SELECT * FROM config_snapshots WHERE id=? AND server_id=? AND tenant_id=? AND created_at>?",
      )
      .get(String(snapshotId), id, p.tenantId, now() - 900) as
      Snapshot | undefined;
    if (!row || row.revision !== this.ops.configRevision(id))
      throw new APIError(
        409,
        "Leitura expirada ou conexÃ£o SSH alterada. Leia a configuraÃ§Ã£o novamente.",
      );
    return {
      ...row,
      parsed: JSON.parse(row.data) as {
        service: string;
        sha256: string;
        values: Record<string, number | string>;
        path: string;
        activation: string;
      },
    };
  }
  async browse(p: Principal, id: string, service: unknown) {
    const server = this.authorize(p, id);
    if (
      typeof service !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}$/.test(service) ||
      !Object.hasOwn(server.details?.services ?? {}, service)
    )
      throw new APIError(400, "Escolha um serviço descoberto neste servidor.");
    const result = await this.ops.executeConfig(p, id, {
      operation: "browse",
      service,
    });
    if (
      result.status !== "browsed" ||
      result.service !== service ||
      !Array.isArray(result.files)
    )
      throw new APIError(
        502,
        String(
          result.message ??
            "Atualize o agente para consultar os arquivos de configuração.",
        ),
      );
    this.platform.audit(p, "configuration.browsed", id);
    return result;
  }
  async inspect(p: Principal, id: string, service: unknown) {
    const server = this.authorize(p, id);
    if (
      typeof service !== "string" ||
      !Object.keys(configFields(service)).length ||
      !Object.keys(server.details?.services ?? {}).includes(service)
    )
      throw new APIError(
        400,
        "Escolha Nginx, Apache, PHP-FPM ou MySQL identificado neste servidor.",
      );
    const revision = this.ops.configRevision(id);
    const response = await this.ops.executeConfig(p, id, {
      operation: "inspect",
      service,
    });
    const values = response.values as Record<string, unknown>;
    if (
      response.status !== "inspected" ||
      response.service !== service ||
      !/^[a-f0-9]{64}$/.test(String(response.sha256)) ||
      !values ||
      Array.isArray(values)
    )
      throw new APIError(
        502,
        String(
          response.message ??
            "NÃ£o foi possÃ­vel ler o perfil. Atualize os auxiliares SSH no Ubuntu.",
        ),
      );
    const supported = configFields(service);
    if (
      Object.entries(values).some(
        ([k, v]) =>
          !Object.hasOwn(supported, k) ||
          !(
            Number.isInteger(v) ||
            (service === "nginx" && k === "worker_processes" && v === "auto")
          ),
      )
    )
      throw new APIError(502, "Resposta de configuraÃ§Ã£o invÃ¡lida.");
    const snapshotId = randomUUID();
    this.platform.store.db
      .prepare("DELETE FROM config_snapshots WHERE created_at<?")
      .run(now() - 86400);
    this.platform.store.db
      .prepare("INSERT INTO config_snapshots VALUES (?,?,?,?,?,?)")
      .run(
        snapshotId,
        id,
        p.tenantId,
        now(),
        revision,
        JSON.stringify(response),
      );
    this.platform.audit(p, "configuration.inspected", id);
    return {
      id: snapshotId,
      ...response,
      limits: Object.fromEntries(
        Object.keys(values).map((k) => [k, supported[k]]),
      ),
    };
  }
  validate(
    service: string,
    current: Record<string, number | string>,
    input: unknown,
  ) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !Object.keys(input).length
    )
      throw new APIError(400, "Informe valores para alterar.");
    const fields = configFields(service),
      values = input as Record<string, unknown>;
    if (
      Object.entries(values).some(
        ([k, v]) =>
          !Object.hasOwn(current, k) ||
          !Object.hasOwn(fields, k) ||
          !Number.isInteger(v) ||
          Number(v) < fields[k][0] ||
          Number(v) > fields[k][1],
      )
    )
      throw new APIError(
        400,
        "ParÃ¢metro ausente, nÃ£o suportado ou fora do intervalo permitido.",
      );
    return Object.fromEntries(
      Object.entries(values).filter(([k, v]) => v !== current[k]),
    ) as Record<string, number>;
  }
  propose(p: Principal, id: string, data: Record<string, unknown>) {
    const snapshot = this.snapshot(p, id, data.snapshot_id),
      s = snapshot.parsed,
      values = this.validate(s.service, s.values, data.values);
    if (!Object.keys(values).length)
      throw new APIError(400, "Nenhum valor foi alterado.");
    const actionId = randomUUID(),
      summary = {
        service: s.service,
        path: s.path,
        activation: s.activation,
        changes: Object.entries(values).map(([key, value]) => ({
          key,
          before: s.values[key],
          after: value,
        })),
        backup_directory: "/var/lib/foxops-config/backups",
      };
    const command = this.ops.configCommand(p, id, {
      operation: "apply",
      service: s.service,
      sha256: s.sha256,
      values,
    });
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          "INSERT INTO remediation_actions(id,server_id,tenant_id,user_id,service,action,commands,reason,status,connection_revision,created_at) VALUES (?,?,?,?,?,'configuration',?,?,'pending',?,?)",
        )
        .run(
          actionId,
          id,
          p.tenantId,
          p.userId,
          s.service,
          JSON.stringify([command]),
          String(
            data.reason ?? "Ajuste de configuraÃ§Ã£o preparado no painel.",
          ).slice(0, 1000),
          snapshot.revision,
          now(),
        );
      this.platform.store.db
        .prepare("INSERT INTO config_changes VALUES (?,?)")
        .run(actionId, JSON.stringify(summary));
    });
    this.platform.audit(p, "configuration.proposed", id);
    return { id: actionId, status: "pending", ...summary };
  }
  async suggest(
    p: Principal,
    id: string,
    data: Record<string, unknown>,
    config: AIConfig,
    settings: AISettings,
  ) {
    const snapshot = this.snapshot(p, id, data.snapshot_id),
      s = snapshot.parsed;
    if (
      typeof data.goal !== "string" ||
      data.goal.length < 5 ||
      data.goal.length > 700
    )
      throw new APIError(
        400,
        "Explique o problema ou objetivo (5 a 700 caracteres).",
      );
    const response = await askAssistant(
      this.platform,
      p,
      {
        organization: this.platform.server(p, id).organization,
        server_id: id,
        question: `Objetivo de ajuste: ${data.goal}. ConfiguraÃ§Ã£o lida: ${JSON.stringify(s.values)}. ParÃ¢metros e intervalos permitidos: ${JSON.stringify(configFields(s.service))}. Proponha ajuste numÃ©rico conservador apenas se houver evidÃªncia. NÃ£o invente capacidade de memÃ³ria, carga ou diagnÃ³stico do banco. Responda a justificativa e um bloco markdown foxops-config com JSON {"values":{"parametro":123}}; se nÃ£o hÃ¡ evidÃªncia suficiente, explique e nÃ£o inclua bloco. A proposta sÃ³ serÃ¡ preparada para aprovaÃ§Ã£o humana.`,
      },
      config,
      settings,
    );
    const match = response.answer.match(/```foxops-config\s*([\s\S]*?)```/);
    let values: Record<string, number> | null = null;
    if (match) {
      try {
        values = this.validate(
          s.service,
          s.values,
          JSON.parse(match[1]).values,
        );
      } catch {
        throw new APIError(
          502,
          "A IA nÃ£o retornou um ajuste vÃ¡lido. Revise os valores manualmente.",
        );
      }
    }
    return {
      answer: response.answer
        .replace(/```foxops-config\s*[\s\S]*?```/g, "")
        .trim(),
      values,
    };
  }
}
