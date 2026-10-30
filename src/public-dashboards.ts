import { randomBytes, randomUUID } from "node:crypto";
import { APIError } from "./store.ts";
import { hash, now, type Platform, type Principal } from "./platform.ts";
import type { AISettings } from "./ai-settings.ts";
import type {
  PublicDashboardConfig,
  PublicDashboardMode,
  PublicDashboardSnapshot,
  PublicDashboardCard,
} from "../shared/public-dashboards.ts";
type Row = {
  id: string;
  tenant_id: string;
  title: string;
  token_hash: string;
  encrypted_token: string;
  enabled: number;
  servers: PublicDashboardMode;
  server_ids: string;
  urls: PublicDashboardMode;
  url_ids: string;
  show_metrics: number;
  show_addresses: number;
};
type Resource = {
  id: string;
  name: string;
  kind: "server" | "url";
  enabled: number;
  status?: string;
  last_seen?: number | null;
  offline?: number;
  metrics?: string | null;
  last_checked?: number | null;
  latency_ms?: number | null;
  url?: string;
  interval_seconds?: number;
  timeout_seconds?: number;
  history_version?: number;
};
export class PublicDashboards {
  platform: Platform;
  vault: AISettings;
  origin: string;
  constructor(platform: Platform, vault: AISettings, origin: string) {
    this.platform = platform;
    this.vault = vault;
    this.origin = new URL(origin).origin;
    platform.store.db.exec(
      `CREATE TABLE IF NOT EXISTS public_dashboards(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,title TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,encrypted_token TEXT NOT NULL,enabled INTEGER NOT NULL,servers TEXT NOT NULL,server_ids TEXT NOT NULL,urls TEXT NOT NULL,url_ids TEXT NOT NULL,show_metrics INTEGER NOT NULL,show_addresses INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS public_dashboards_tenant ON public_dashboards(tenant_id);`,
    );
  }
  private authorize(p: Principal) {
    this.platform.requireRole(p, ["owner", "admin"]);
    if (p.orgScope)
      throw new APIError(
        403,
        "Use o acesso administrativo do workspace para gerenciar painéis públicos.",
      );
  }
  private row(p: Principal, id: string) {
    this.authorize(p);
    const row = this.platform.store.db
      .prepare("SELECT * FROM public_dashboards WHERE id=? AND tenant_id=?")
      .get(id, p.tenantId) as Row | undefined;
    if (!row) throw new APIError(404, "Painel público não encontrado.");
    return row;
  }
  private metadata(row: Row): PublicDashboardConfig {
    const serverIds = new Set(
      this.platform.store.db
        .prepare(
          "SELECT s.id FROM servers s JOIN organizations o ON o.id=s.organization WHERE o.tenant_id=?",
        )
        .all(row.tenant_id)
        .map((item) => String(item.id)),
    );
    const urlIds = new Set(
      this.platform.store.db
        .prepare("SELECT id FROM url_monitors WHERE tenant_id=?")
        .all(row.tenant_id)
        .map((item) => String(item.id)),
    );
    return {
      id: row.id,
      title: row.title,
      enabled: !!row.enabled,
      servers: row.servers,
      server_ids: (JSON.parse(row.server_ids) as string[]).filter((id) =>
        serverIds.has(id),
      ),
      urls: row.urls,
      url_ids: (JSON.parse(row.url_ids) as string[]).filter((id) =>
        urlIds.has(id),
      ),
      show_metrics: !!row.show_metrics,
      show_addresses: !!row.show_addresses,
      link:
        this.origin +
        "/status#token=" +
        this.vault.reveal(
          row.tenant_id,
          "public-dashboard:" + row.id,
          row.encrypted_token,
        ),
    };
  }
  list(p: Principal) {
    this.authorize(p);
    return (
      this.platform.store.db
        .prepare(
          "SELECT * FROM public_dashboards WHERE tenant_id=? ORDER BY title",
        )
        .all(p.tenantId) as Row[]
    ).map((row) => this.metadata(row));
  }
  options(p: Principal) {
    this.authorize(p);
    return {
      servers: this.platform.store.db
        .prepare(
          "SELECT s.id,s.name FROM servers s JOIN organizations o ON o.id=s.organization LEFT JOIN server_config c ON c.server_id=s.id WHERE o.tenant_id=? AND coalesce(c.archived,0)=0 ORDER BY s.name",
        )
        .all(p.tenantId),
      urls: this.platform.store.db
        .prepare(
          "SELECT id,name FROM url_monitors WHERE tenant_id=? AND archived=0 ORDER BY name",
        )
        .all(p.tenantId),
    };
  }
  save(p: Principal, id: string | undefined, data: Record<string, unknown>) {
    this.authorize(p);
    const old = id ? this.row(p, id) : undefined;
    if (
      !old &&
      Number(
        this.platform.store.db
          .prepare(
            "SELECT count(*) AS n FROM public_dashboards WHERE tenant_id=?",
          )
          .get(p.tenantId)!.n,
      ) >= 10
    )
      throw new APIError(400, "Limite de 10 painéis públicos por workspace.");
    if (
      typeof data.title !== "string" ||
      !data.title.trim() ||
      data.title.trim().length > 100 ||
      /[\u0000-\u001f]/.test(data.title)
    )
      throw new APIError(400, "Informe um título de até 100 caracteres.");
    const title = data.title.trim();
    for (const field of ["enabled", "show_metrics", "show_addresses"])
      if (typeof data[field] !== "boolean")
        throw new APIError(400, "Configuração do painel público inválida.");
    for (const field of ["servers", "urls"])
      if (!["none", "all", "selected"].includes(String(data[field])))
        throw new APIError(400, "Seleção de recursos inválida.");
    const selected = (field: "server_ids" | "url_ids") => {
      const input = data[field];
      if (
        !Array.isArray(input) ||
        input.length > 2000 ||
        input.some((value) => typeof value !== "string" || value.length > 100)
      )
        throw new APIError(400, "Seleção de recursos inválida.");
      return [...new Set(input)] as string[];
    };
    const servers = selected("server_ids"),
      urls = selected("url_ids");
    for (const server of servers) {
      if (
        !this.platform.store.db
          .prepare(
            "SELECT 1 FROM servers s JOIN organizations o ON o.id=s.organization WHERE s.id=? AND o.tenant_id=?",
          )
          .get(server, p.tenantId)
      )
        throw new APIError(404, "Servidor não encontrado neste workspace.");
    }
    for (const url of urls) {
      if (
        !this.platform.store.db
          .prepare("SELECT 1 FROM url_monitors WHERE id=? AND tenant_id=?")
          .get(url, p.tenantId)
      )
        throw new APIError(404, "Monitor não encontrado neste workspace.");
    }
    if (
      data.enabled &&
      (data.servers === "none" ||
        (data.servers === "selected" && !servers.length)) &&
      (data.urls === "none" || (data.urls === "selected" && !urls.length))
    )
      throw new APIError(400, "Selecione servidores ou URLs para publicar.");
    if (data.enabled) this.platform.active(p);
    const boardId = id ?? randomUUID(),
      token = old ? undefined : randomBytes(32).toString("base64url");
    const encrypted =
      old?.encrypted_token ??
      this.vault.protect(p.tenantId, "public-dashboard:" + boardId, token!);
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          "INSERT INTO public_dashboards VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,enabled=excluded.enabled,servers=excluded.servers,server_ids=excluded.server_ids,urls=excluded.urls,url_ids=excluded.url_ids,show_metrics=excluded.show_metrics,show_addresses=excluded.show_addresses",
        )
        .run(
          boardId,
          p.tenantId,
          title,
          old?.token_hash ?? hash(token!),
          encrypted,
          data.enabled ? 1 : 0,
          String(data.servers),
          JSON.stringify(servers),
          String(data.urls),
          JSON.stringify(urls),
          data.show_metrics ? 1 : 0,
          data.show_addresses ? 1 : 0,
        );
      this.platform.audit(
        p,
        old ? "public.dashboard.updated" : "public.dashboard.created",
        boardId,
      );
    });
    return this.metadata(this.row(p, boardId));
  }
  rotate(p: Principal, id: string) {
    this.row(p, id);
    const token = randomBytes(32).toString("base64url");
    const encrypted = this.vault.protect(
      p.tenantId,
      "public-dashboard:" + id,
      token,
    );
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          "UPDATE public_dashboards SET token_hash=?,encrypted_token=? WHERE id=? AND tenant_id=?",
        )
        .run(hash(token), encrypted, id, p.tenantId);
      this.platform.audit(p, "public.dashboard.link.rotated", id);
    });
    return this.metadata(this.row(p, id));
  }
  remove(p: Principal, id: string) {
    this.row(p, id);
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare("DELETE FROM public_dashboards WHERE id=? AND tenant_id=?")
        .run(id, p.tenantId);
      this.platform.audit(p, "public.dashboard.deleted", id);
    });
    return { ok: true };
  }
  private status(row: Resource): PublicDashboardCard["status"] {
    if (row.kind === "server") {
      if (row.last_seen == null) return "pending";
      if (!row.enabled) return "paused";
      return now() - row.last_seen < (row.offline ?? 90) ? "up" : "down";
    }
    if (!row.enabled) return "paused";
    if (
      row.last_checked == null ||
      now() - row.last_checked >
        (row.interval_seconds ?? 300) * 3 + (row.timeout_seconds ?? 10)
    )
      return "pending";
    return row.status === "up"
      ? "up"
      : row.status === "down"
        ? "down"
        : "pending";
  }
  snapshot(
    token: unknown,
    input: Record<string, unknown> = {},
  ): PublicDashboardSnapshot {
    const unavailable = () => new APIError(404, "Painel público indisponível.");
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw unavailable();
    const board = this.platform.store.db
      .prepare(
        "SELECT * FROM public_dashboards WHERE token_hash=? AND enabled=1",
      )
      .get(hash(token)) as Row | undefined;
    if (!board) throw unavailable();
    try {
      this.platform.active({
        tenantId: board.tenant_id,
        userId: "",
        name: "",
        email: "",
        role: "owner",
      });
    } catch {
      throw unavailable();
    }
    const selectedServers = new Set<string>(JSON.parse(board.server_ids)),
      selectedURLs = new Set<string>(JSON.parse(board.url_ids));
    const rows: Resource[] = [];
    if (board.servers !== "none")
      rows.push(
        ...(
          this.platform.store.db
            .prepare(
              `SELECT s.id,s.name,'server' AS kind,coalesce(c.enabled,1) AS enabled,c.offline,(SELECT received_at FROM samples WHERE server_id=s.id ORDER BY received_at DESC LIMIT 1) AS last_seen,(SELECT metrics FROM samples WHERE server_id=s.id ORDER BY received_at DESC LIMIT 1) AS metrics FROM servers s JOIN organizations o ON o.id=s.organization LEFT JOIN server_config c ON c.server_id=s.id WHERE o.tenant_id=? AND coalesce(c.archived,0)=0 ORDER BY s.name`,
            )
            .all(board.tenant_id) as Resource[]
        ).filter(
          (row) => board.servers === "all" || selectedServers.has(row.id),
        ),
      );
    if (board.urls !== "none")
      rows.push(
        ...(
          this.platform.store.db
            .prepare(
              "SELECT id,name,'url' AS kind,enabled,status,last_checked,latency_ms,url,interval_seconds,timeout_seconds,history_version FROM url_monitors WHERE tenant_id=? AND archived=0 ORDER BY name",
            )
            .all(board.tenant_id) as Resource[]
        ).filter((row) => board.urls === "all" || selectedURLs.has(row.id)),
      );
    const summary = {
      up: 0,
      down: 0,
      pending: 0,
      paused: 0,
      servers: 0,
      urls: 0,
    };
    for (const row of rows) {
      summary[this.status(row)]++;
      summary[row.kind === "server" ? "servers" : "urls"]++;
    }
    const kind = String(input.kind ?? "all");
    if (!["all", "server", "url"].includes(kind))
      throw new APIError(400, "Filtro inválido.");
    const filtered = rows.filter((row) => kind === "all" || row.kind === kind),
      size = Number(input.page_size ?? 12),
      requested = Number(input.page ?? 1);
    if (
      ![12, 24].includes(size) ||
      !Number.isInteger(requested) ||
      requested < 1 ||
      requested > 100000
    )
      throw new APIError(400, "Página inválida.");
    const pages = Math.max(1, Math.ceil(filtered.length / size)),
      page = Math.min(requested, pages),
      finite = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? value : null;
    const items: PublicDashboardCard[] = filtered
      .slice((page - 1) * size, page * size)
      .map((row) => {
        const card: PublicDashboardCard = {
          key: hash(board.id + ":" + row.id).slice(0, 20),
          kind: row.kind,
          name: row.name,
          status: this.status(row),
          updated_at:
            row.kind === "server"
              ? (row.last_seen ?? null)
              : (row.last_checked ?? null),
        };
        if (row.kind === "server" && board.show_metrics) {
          let metrics: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(row.metrics ?? "{}");
            if (parsed && typeof parsed === "object") metrics = parsed;
          } catch {}
          card.metrics = {
            cpu: finite(metrics.cpu_percent),
            memory: finite(metrics.memory_percent),
            disk: finite(metrics.disk_percent),
          };
        }
        if (row.kind === "server" && board.show_metrics) {
          card.metric_history = (
            this.platform.store.db
              .prepare(
                "SELECT received_at,metrics FROM samples WHERE server_id=? AND received_at>=? AND received_at<=? ORDER BY received_at DESC LIMIT 60",
              )
              .all(row.id, now() - 3600, now()) as {
              received_at: number;
              metrics: string;
            }[]
          )
            .reverse()
            .map((sample) => {
              let values: Record<string, unknown> = {};
              try {
                const parsed = JSON.parse(sample.metrics);
                if (parsed && typeof parsed === "object") values = parsed;
              } catch {}
              return {
                at: sample.received_at,
                cpu: finite(values.cpu_percent),
                memory: finite(values.memory_percent),
                disk: finite(values.disk_percent),
              };
            });
        }
        if (row.kind === "url") {
          card.latency_ms = finite(row.latency_ms);
          const stats = this.platform.store.db
            .prepare(
              "SELECT avg(ok)*100 AS uptime FROM url_checks WHERE monitor_id=? AND monitor_version=? AND checked_at>=? AND checked_at<=?",
            )
            .get(row.id, row.history_version ?? 1, now() - 86400, now());
          card.uptime_percent = finite(stats?.uptime);
          card.history = (
            this.platform.store.db
              .prepare(
                "SELECT checked_at AS at,ok,latency_ms FROM url_checks WHERE monitor_id=? AND monitor_version=? AND checked_at>=? AND checked_at<=? ORDER BY checked_at DESC LIMIT 24",
              )
              .all(row.id, row.history_version ?? 1, now() - 86400, now()) as {
              at: number;
              ok: number;
              latency_ms: number;
            }[]
          )
            .reverse()
            .map((check) => ({ ...check, ok: !!check.ok }));
          if (board.show_addresses) {
            try {
              card.address = new URL(row.url!).origin;
            } catch {}
          }
        }
        return card;
      });
    return {
      title: board.title,
      generated_at: now(),
      refresh_seconds: 15,
      total: filtered.length,
      page,
      pages,
      items,
      summary,
    };
  }
}
