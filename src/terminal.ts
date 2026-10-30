import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Server, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import ssh2 from "ssh2";
import type { ClientChannel } from "ssh2";
import { APIError } from "./store.ts";
import { hash, now, type Platform, type Principal } from "./platform.ts";
import type { Operations } from "./operations.ts";
const { Client } = ssh2;
const cookie = (req: IncomingMessage) =>
  (req.headers.cookie ?? "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("foxops_session="))
    ?.slice(15) ?? "";
export class TerminalGateway {
  platform: Platform;
  ops: Operations;
  origin?: string;
  wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16384,
    perMessageDeflate: false,
  });
  live = new Map<
    string,
    { serverId: string; tenantId: string; userId: string; close: () => void }
  >();
  constructor(platform: Platform, ops: Operations, origin?: string) {
    this.platform = platform;
    this.ops = ops;
    this.origin = origin;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS terminal_access(server_id TEXT PRIMARY KEY,revision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS terminal_tickets(token_hash TEXT PRIMARY KEY,session_hash TEXT NOT NULL,user_id TEXT NOT NULL,tenant_id TEXT NOT NULL,server_id TEXT NOT NULL,revision TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  }
  metadata(p: Principal, id: string) {
    const metadata = this.ops.sshMetadata(p, id) as {
        configured: boolean;
        revision?: string;
        host?: string;
        port?: number;
        username?: string;
      },
      setting = this.platform.store.db
        .prepare("SELECT revision FROM terminal_access WHERE server_id=?")
        .get(id);
    return {
      configured: metadata.configured,
      enabled: !!setting && setting.revision === metadata.revision,
      host: metadata.host ?? null,
      port: metadata.port ?? null,
      username: metadata.username ?? null,
    };
  }
  enable(p: Principal, id: string, enabled: unknown) {
    this.platform.requireRole(p, ["owner"]);
    this.platform.server(p, id);
    if (typeof enabled !== "boolean")
      throw new APIError(400, "Escolha se o terminal deve estar habilitado.");
    if (enabled) {
      const c = this.ops.terminalConnection(p, id);
      this.platform.store.db
        .prepare(
          "INSERT INTO terminal_access VALUES (?,?) ON CONFLICT(server_id) DO UPDATE SET revision=excluded.revision",
        )
        .run(id, c.revision);
    } else {
      this.platform.store.db
        .prepare("DELETE FROM terminal_access WHERE server_id=?")
        .run(id);
      this.platform.store.db
        .prepare("DELETE FROM terminal_tickets WHERE server_id=?")
        .run(id);
      for (const item of this.live.values())
        if (item.serverId === id) item.close();
    }
    this.platform.audit(
      p,
      enabled ? "terminal.enabled" : "terminal.disabled",
      id,
    );
    return this.metadata(p, id);
  }
  private authorize(p: Principal, id: string) {
    const c = this.ops.terminalConnection(p, id),
      setting = this.platform.store.db
        .prepare("SELECT revision FROM terminal_access WHERE server_id=?")
        .get(id);
    if (!setting || setting.revision !== c.revision)
      throw new APIError(
        403,
        "O proprietário precisa habilitar o terminal para esta conexão SSH.",
      );
    return c;
  }
  ticket(p: Principal, id: string, session: string) {
    const c = this.authorize(p, id),
      token = randomBytes(32).toString("base64url");
    this.platform.store.db
      .prepare("DELETE FROM terminal_tickets WHERE expires_at<=?")
      .run(now());
    this.platform.store.db
      .prepare("INSERT INTO terminal_tickets VALUES (?,?,?,?,?,?,?)")
      .run(
        hash(token),
        hash(session),
        p.userId,
        p.tenantId,
        id,
        c.revision,
        now() + 60,
      );
    return { ticket: token, expires_at: now() + 60 };
  }
  attach(server: Server) {
    server.on("upgrade", (req, socket, head) => {
      try {
        const host = String(req.headers.host ?? ""),
          origin = this.origin ?? `http://${host}`,
          url = new URL(req.url ?? "/", origin);
        if (
          url.pathname !== "/api/v1/terminal/socket" ||
          req.headers.origin !== origin ||
          host !== new URL(origin).host ||
          (!this.origin &&
            !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))
        )
          throw new APIError(403, "origin");
        const session = cookie(req),
          p = this.platform.session(session),
          ticket = this.platform.store.db
            .prepare(
              "SELECT * FROM terminal_tickets WHERE token_hash=? AND expires_at>?",
            )
            .get(hash(url.searchParams.get("ticket") ?? ""), now());
        if (
          !ticket ||
          ticket.session_hash !== hash(session) ||
          ticket.user_id !== p.userId ||
          ticket.tenant_id !== p.tenantId
        )
          throw new APIError(401, "ticket");
        const id = String(ticket.server_id),
          connection = this.authorize(p, id);
        if (connection.revision !== ticket.revision)
          throw new APIError(403, "revision");
        if (
          [...this.live.values()].filter((s) => s.userId === p.userId).length >=
            2 ||
          [...this.live.values()].filter((s) => s.tenantId === p.tenantId)
            .length >= 8 ||
          [...this.live.values()].filter((s) => s.serverId === id).length >= 3
        )
          throw new APIError(429, "limit");
        if (
          !this.platform.store.db
            .prepare("DELETE FROM terminal_tickets WHERE token_hash=?")
            .run(ticket.token_hash).changes
        )
          throw new APIError(401, "used");
        this.wss.handleUpgrade(req, socket, head, (ws) =>
          this.open(ws, p, id, session, connection),
        );
      } catch (e) {
        const status = e instanceof APIError ? e.status : 403;
        socket.write(
          `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
        socket.destroy();
      }
    });
    server.on("close", () => {
      for (const item of [...this.live.values()]) item.close();
      this.wss.close();
    });
  }
  closeAll() {
    for (const session of [...this.live.values()]) session.close();
  }
  private open(
    ws: WebSocket,
    p: Principal,
    id: string,
    session: string,
    config: ReturnType<Operations["terminalConnection"]>,
  ) {
    const client = new Client(),
      key = randomUUID();
    let channel: ClientChannel | undefined,
      closed = false,
      cols = 100,
      rows = 28,
      lastInput = Date.now(),
      lastPong = Date.now(),
      inputBytes = 0,
      inputWindow = Date.now();
    const created = Date.now();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const status = (state: string, message?: string) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "status", state, message }));
    };
    const finish = (reason = "closed") => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      this.live.delete(key);
      channel?.close();
      client.end();
      status("closed", reason);
      if (ws.readyState === WebSocket.OPEN) ws.close(1000);
      else if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
      this.platform.audit(p, "terminal.closed", id);
    };
    this.live.set(key, {
      serverId: id,
      tenantId: p.tenantId,
      userId: p.userId,
      close: () => finish("disabled"),
    });
    this.platform.audit(p, "terminal.opened", id);
    status("connecting");
    heartbeat = setInterval(() => {
      if (Date.now() - lastInput > 10 * 60 * 1000) return finish("idle");
      if (Date.now() - created > 60 * 60 * 1000) return finish("timeout");
      if (Date.now() - lastPong > 45000) return finish("connection_lost");
      try {
        const current = this.platform.session(session),
          c = this.authorize(current, id);
        if (
          current.userId !== p.userId ||
          current.tenantId !== p.tenantId ||
          c.revision !== config.revision
        )
          return finish("access_changed");
      } catch {
        return finish("access_changed");
      }
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 15000);
    heartbeat.unref();
    ws.on("pong", () => {
      lastPong = Date.now();
    });
    ws.on("close", () => finish());
    ws.on("error", () => finish("connection_lost"));
    ws.on("message", (raw, isBinary) => {
      try {
        if (isBinary) throw Error();
        const message = JSON.parse(raw.toString());
        if (message.type === "resize") {
          if (
            !Number.isInteger(message.cols) ||
            message.cols < 20 ||
            message.cols > 300 ||
            !Number.isInteger(message.rows) ||
            message.rows < 5 ||
            message.rows > 120
          )
            throw Error();
          cols = message.cols;
          rows = message.rows;
          channel?.setWindow(rows, cols, 0, 0);
        } else if (message.type === "input") {
          if (
            typeof message.data !== "string" ||
            Buffer.byteLength(message.data) > 8192
          )
            throw Error();
          if (Date.now() - inputWindow >= 1000) {
            inputBytes = 0;
            inputWindow = Date.now();
          }
          inputBytes += Buffer.byteLength(message.data);
          if (inputBytes > 65536) throw Error();
          lastInput = Date.now();
          if (channel && !channel.write(message.data)) ws.pause();
        } else throw Error();
      } catch {
        finish("invalid_message");
      }
    });
    const output = (data: Buffer) => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 1024 * 1024) return finish("output_limit");
      channel?.pause();
      ws.send(data, { binary: true }, (error) => {
        if (error) finish("connection_lost");
        else channel?.resume();
      });
    };
    client.on("ready", () => {
      if (closed) return;
      client.shell({ term: "xterm-256color", cols, rows }, (error, stream) => {
        if (error || closed) {
          stream?.close();
          return finish("shell_unavailable");
        }
        channel = stream;
        stream.on("data", output);
        stream.stderr.on("data", output);
        stream.on("drain", () => ws.resume());
        stream.on("close", () => finish("remote_closed"));
        stream.on("error", () => finish("connection_lost"));
        status("ready");
      });
    });
    client.on("error", () => finish("ssh_failed"));
    client.on("close", () => finish("remote_closed"));
    try {
      client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        privateKey: config.privateKey,
        password: config.password,
        passphrase: config.passphrase,
        readyTimeout: 15000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostVerifier: (value: Buffer) =>
          "SHA256:" +
            createHash("sha256")
              .update(value)
              .digest("base64")
              .replace(/=+$/, "") ===
          config.fingerprint,
      });
    } catch {
      finish("ssh_failed");
    }
  }
}
