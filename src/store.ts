import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export class APIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Metrics = {
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
};
type ServerRow = {
  id: string;
  name: string;
  last_seen: number | null;
  metrics: string | null;
};
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY, organization TEXT NOT NULL,
        name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS samples (
        server_id TEXT NOT NULL REFERENCES servers(id),
        event_id TEXT NOT NULL, received_at REAL NOT NULL,
        metrics TEXT NOT NULL, PRIMARY KEY(server_id, event_id));
      CREATE INDEX IF NOT EXISTS latest_sample ON samples(server_id, received_at DESC);`);
  }

  close() {
    this.db.close();
  }

  register(organization: unknown, name: unknown) {
    if (
      typeof organization !== "string" ||
      typeof name !== "string" ||
      [organization, name].some((x) => !x.trim() || [...x.trim()].length > 120)
    ) {
      throw new APIError(
        400,
        "Organização e nome são obrigatórios (até 120 caracteres).",
      );
    }
    const agent_token = randomBytes(32).toString("base64url");
    const server_id = randomUUID();
    this.db
      .prepare("INSERT INTO servers VALUES (?, ?, ?, ?)")
      .run(server_id, organization.trim(), name.trim(), digest(agent_token));
    return { server_id, agent_token };
  }

  ingest(token: string, eventId: unknown, metrics: unknown) {
    const server = this.db
      .prepare("SELECT id FROM servers WHERE token_hash=?")
      .get(digest(token)) as { id: string } | undefined;
    if (!server) throw new APIError(401, "Credencial de agente inválida.");
    if (
      typeof eventId !== "string" ||
      !eventId.length ||
      eventId.length > 128
    ) {
      throw new APIError(400, "event_id inválido.");
    }
    if (
      !metrics ||
      typeof metrics !== "object" ||
      Array.isArray(metrics) ||
      Object.keys(metrics).sort().join(",") !==
        "cpu_percent,disk_percent,memory_percent" ||
      Object.values(metrics).some(
        (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100,
      )
    ) {
      throw new APIError(
        400,
        "Informe cpu_percent, memory_percent e disk_percent entre 0 e 100.",
      );
    }
    const result = this.db
      .prepare("INSERT OR IGNORE INTO samples VALUES (?, ?, ?, ?)")
      .run(server.id, eventId, Date.now() / 1000, JSON.stringify(metrics));
    return { accepted: Number(result.changes) === 1 };
  }

  listServers(organization: string, now = Date.now() / 1000) {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.name,
      (SELECT received_at FROM samples WHERE server_id=s.id ORDER BY received_at DESC LIMIT 1) AS last_seen,
      (SELECT metrics FROM samples WHERE server_id=s.id ORDER BY received_at DESC LIMIT 1) AS metrics
      FROM servers s WHERE organization=? ORDER BY s.name`,
      )
      .all(organization) as ServerRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      last_seen: row.last_seen,
      status:
        row.last_seen === null
          ? "awaiting"
          : now - row.last_seen < 90
            ? "online"
            : "offline",
      metrics:
        row.metrics === null ? null : (JSON.parse(row.metrics) as Metrics),
    }));
  }
}
