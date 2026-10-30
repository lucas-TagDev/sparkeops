import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import ssh2 from "ssh2";
import type { Connection } from "ssh2";
import { WebSocket } from "ws";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import { Operations } from "../../src/operations.ts";
import { TerminalGateway } from "../../src/terminal.ts";
async function setup(t: TestContext) {
  const store = new Store(":memory:"),
    platform = new Platform(store),
    vault = new AISettings(platform, { masterKey: Buffer.alloc(32, 11) }),
    ops = new Operations(platform, vault);
  const a = platform.signup({
      name: "Alice",
      company: "A",
      email: "a@terminal.test",
      password: "strong-password-123",
    }),
    b = platform.signup({
      name: "Bob",
      company: "B",
      email: "b@terminal.test",
      password: "strong-password-456",
    });
  const org = platform.organizations(a.principal)[0].id,
    entry = platform.createServer(a.principal, org, "vm");
  platform.enroll(entry.enrollment_token);
  const hostKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  const parsed = ssh2.utils.parseKey(hostKey);
  if (parsed instanceof Error || Array.isArray(parsed)) throw Error("key");
  const fingerprint =
    "SHA256:" +
    createHash("sha256")
      .update(parsed.getPublicSSH())
      .digest("base64")
      .replace(/=+$/, "");
  const clients: Connection[] = [],
    sockets: WebSocket[] = [],
    sizes: { cols: number; rows: number }[] = [];
  const ssh = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    clients.push(client);
    client.on("error", () => {});
    client.on("authentication", (context) => {
      if (context.method === "password" && context.password === "test-password")
        context.accept();
      else context.reject();
    });
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (accept, _reject, info) => {
          sizes.push({ cols: info.cols, rows: info.rows });
          accept?.();
        });
        session.on("window-change", (accept, _reject, info) => {
          sizes.push({ cols: info.cols, rows: info.rows });
          accept?.();
        });
        session.on("shell", (accept) => {
          const stream = accept();
          stream.write("VM READY\r\n$ ");
          stream.on("data", (data: Buffer) =>
            stream.write("ECHO:" + data.toString()),
          );
          stream.on("error", () => {});
        });
      }),
    );
  });
  await new Promise<void>((resolve) => ssh.listen(0, "127.0.0.1", resolve));
  const config = {
    host: "127.0.0.1",
    port: (ssh.address() as AddressInfo).port,
    username: "foxops",
    fingerprint,
    password: "test-password",
  };
  ops.saveSSH(a.principal, entry.server_id, config);
  const gateway = new TerminalGateway(platform, ops),
    http = createServer((_req, res) => res.end("ok"));
  gateway.attach(http);
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const origin = "http://127.0.0.1:" + (http.address() as AddressInfo).port;
  const connect = (ticket: string, session = a.token, from = origin) => {
    const ws = new WebSocket(
      origin.replace("http:", "ws:") +
        "/api/v1/terminal/socket?ticket=" +
        encodeURIComponent(ticket),
      { headers: { Origin: from, Cookie: "foxops_session=" + session } },
    );
    sockets.push(ws);
    return ws;
  };
  t.after(async () => {
    for (const session of [...gateway.live.values()]) session.close();
    for (const ws of sockets) ws.terminate();
    for (const client of clients) client.end();
    await Promise.all([
      new Promise<void>((resolve) => http.close(() => resolve())),
      new Promise<void>((resolve) => ssh.close(() => resolve())),
    ]);
    store.close();
  });
  return {
    store,
    platform,
    ops,
    gateway,
    a,
    b,
    id: entry.server_id,
    connect,
    config,
    sizes,
  };
}
function message(
  ws: WebSocket,
  predicate: (data: string, binary: boolean) => boolean,
) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", listener);
      reject(Error("message timeout"));
    }, 7000);
    const listener = (data: Buffer, binary: boolean) => {
      const text = data.toString();
      if (predicate(text, binary)) {
        clearTimeout(timer);
        ws.off("message", listener);
        resolve(text);
      }
    };
    ws.on("message", listener);
  });
}
async function rejected(ws: WebSocket) {
  const error = once(ws, "error");
  await error;
  ws.terminate();
}
test("terminal: owner opt-in, scoped tickets, secret protection and SSH revision binding", async (t) => {
  const { store, ops, gateway, a, b, id, config } = await setup(t);
  assert.equal(gateway.metadata(a.principal, id).enabled, false);
  assert.throws(() => gateway.ticket(a.principal, id, a.token));
  assert.throws(() => gateway.enable(b.principal, id, true));
  assert.throws(() =>
    gateway.enable({ ...a.principal, role: "admin" }, id, true),
  );
  assert.throws(() => gateway.metadata({ ...a.principal, role: "reader" }, id));
  gateway.enable(a.principal, id, true);
  const ticket = gateway.ticket(a.principal, id, a.token);
  assert.ok(
    !JSON.stringify(gateway.metadata(a.principal, id)).includes(
      "test-password",
    ),
  );
  assert.ok(
    !JSON.stringify(
      store.db.prepare("SELECT * FROM terminal_tickets").all(),
    ).includes(ticket.ticket),
  );
  ops.saveSSH(a.principal, id, config);
  assert.equal(gateway.metadata(a.principal, id).enabled, false);
  assert.throws(() => gateway.ticket(a.principal, id, a.token));
});
test("terminal: real SSH PTY streams input/output, resizes and owner disable closes the socket", async (t) => {
  const { gateway, a, id, connect, sizes, store } = await setup(t);
  gateway.enable(a.principal, id, true);
  const ticket = gateway.ticket(a.principal, id, a.token),
    ws = connect(ticket.ticket),
    ready = message(ws, (data, binary) => !binary && data.includes('"ready"'));
  await once(ws, "open");
  await ready;
  const echo = message(
    ws,
    (data, binary) => binary && data.includes("ECHO:hello"),
  );
  ws.send(JSON.stringify({ type: "input", data: "hello\r" }));
  assert.ok((await echo).includes("hello"));
  ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
  const echoed = message(
    ws,
    (data, binary) => binary && data.includes("ECHO:resized"),
  );
  ws.send(JSON.stringify({ type: "input", data: "resized" }));
  await echoed;
  assert.ok(sizes.some((size) => size.cols === 120 && size.rows === 40));
  const closed = once(ws, "close");
  gateway.enable(a.principal, id, false);
  await closed;
  assert.equal(gateway.live.size, 0);
  const audit = store.db
    .prepare(
      "SELECT action,actor_name FROM audit WHERE action LIKE 'terminal.%'",
    )
    .all();
  assert.ok(
    audit.some(
      (row) => row.action === "terminal.opened" && row.actor_name === "Alice",
    ),
  );
  assert.ok(audit.some((row) => row.action === "terminal.closed"));
  assert.ok(!JSON.stringify(audit).includes("hello"));
});
test("terminal: origin, session binding, ticket expiration and replay are rejected", async (t) => {
  const { gateway, store, a, b, id, connect } = await setup(t);
  gateway.enable(a.principal, id, true);
  let ticket = gateway.ticket(a.principal, id, a.token);
  await rejected(connect(ticket.ticket, a.token, "https://outside.example"));
  await rejected(connect(ticket.ticket, b.token));
  store.db.prepare("UPDATE terminal_tickets SET expires_at=?").run(now() - 1);
  await rejected(connect(ticket.ticket));
  ticket = gateway.ticket(a.principal, id, a.token);
  const ws = connect(ticket.ticket),
    ready = message(ws, (data, binary) => !binary && data.includes('"ready"'));
  await once(ws, "open");
  await ready;
  await rejected(connect(ticket.ticket));
  const closed = once(ws, "close");
  ws.close();
  await closed;
});
test("terminal: fingerprint mismatch never opens an SSH shell", async (t) => {
  const { ops, gateway, a, id, connect, config, sizes } = await setup(t);
  ops.saveSSH(a.principal, id, {
    ...config,
    fingerprint: "SHA256:" + "A".repeat(43),
  });
  gateway.enable(a.principal, id, true);
  const ws = connect(gateway.ticket(a.principal, id, a.token).ticket),
    failed = message(
      ws,
      (data, binary) => !binary && data.includes("ssh_failed"),
    );
  await once(ws, "open");
  await failed;
  assert.equal(sizes.length, 0);
});
