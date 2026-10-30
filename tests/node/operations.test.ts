import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { generateKeyPairSync, createHash, randomBytes } from "node:crypto";
import ssh2 from "ssh2";
const { Server: SSHServer, utils } = ssh2;
import type { AddressInfo } from "node:net";
import { Store } from "../../src/store.ts";
import { Platform, now } from "../../src/platform.ts";
import { AISettings } from "../../src/ai-settings.ts";
import {
  Operations,
  actionCommands,
  sshExecute,
  redact,
} from "../../src/operations.ts";
import type { SSHExecutor } from "../../src/operations.ts";
import { askAssistant } from "../../src/assistant.ts";
import { AgentTasks } from "../../src/agent-tasks.ts";
import { query } from "../../src/queries.ts";
import { ConfigEdits } from "../../src/config-edits.ts";
import { CommandAgent } from "../../src/command-agent.ts";
import { conversationContext } from "../../src/conversation-context.ts";

const fingerprint = "SHA256:" + "A".repeat(43);
test("chat contextual: nova pergunta recebe histórico autorizado e a opção permanece na investigação", async (t) => {
  const { platform, ops, vault, a, id, org } = fixture(t);
  configure(ops, a, id);
  const inputs: Record<string, unknown>[] = [];
  const operator = new CommandAgent(platform, ops, vault, {
    key: "fake",
    model: "test",
    fetch: (async (_url, options) => {
      const input = JSON.parse(JSON.parse(String(options!.body)).input);
      inputs.push(input);
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  answer:
                    "Podemos inspecionar a configuração do túnel sem ler o arquivo de token.",
                  command: null,
                  reason: "Aguardar a próxima pergunta.",
                }),
              },
            ],
          },
        ],
        usage: { total_tokens: 1 },
      });
    }) as typeof fetch,
  });
  await operator.start(a, {
    organization: org,
    server_id: id,
    question: "Qual domínio do túnel?",
  });
  assert.deepEqual(inputs[0].conversation, []);
  const contextual = await operator.start(a, {
    organization: org,
    server_id: id,
    question: "pode fazer isso",
    use_context: true,
  });
  assert.equal(
    (inputs[1].conversation as { question: string }[])[0].question,
    "Qual domínio do túnel?",
  );
  await operator.step(a, contextual.session_id);
  assert.deepEqual(inputs[2].conversation, inputs[1].conversation);
  const independent = await operator.start(a, {
    organization: org,
    server_id: id,
    question: "pode fazer isso",
    use_context: false,
  });
  assert.deepEqual(inputs[3].conversation, []);
  await operator.step(a, independent.session_id);
  assert.deepEqual(inputs[4].conversation, []);
  await assert.rejects(
    operator.start(a, {
      organization: org,
      server_id: id,
      question: "verificar",
      use_context: "false",
    }),
  );
});
test("contexto: limita mensagens e tamanho, respeita usuário/servidor e ignora conversa limpa", (t) => {
  const { platform, store, a, b, id, org } = fixture(t);
  const other = platform.createServer(a, org, "other-server");
  const insert = store.db.prepare(
    "INSERT INTO chat(id,tenant_id,user_id,organization,question,answer,mode,created_at,scope) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  for (let index = 0; index < 10; index++)
    insert.run(
      "own-" + index,
      a.tenantId,
      a.userId,
      org,
      "Pergunta " + index,
      "password=do-not-send " + "a".repeat(1600),
      "ai",
      now() + index,
      id,
    );
  insert.run(
    "other-user",
    a.tenantId,
    b.userId,
    org,
    "OTHER USER SECRET",
    "private",
    "ai",
    now() + 20,
    id,
  );
  insert.run(
    "other-server",
    a.tenantId,
    a.userId,
    org,
    "OTHER SERVER SECRET",
    "private",
    "ai",
    now() + 21,
    other.server_id,
  );
  const context = conversationContext(platform, a, org, id, true),
    serialized = JSON.stringify(context);
  assert.ok(context.length <= 6);
  assert.ok(serialized.length <= 12010);
  assert.ok(!serialized.includes("OTHER USER"));
  assert.ok(!serialized.includes("OTHER SERVER"));
  assert.ok(!serialized.includes("do-not-send"));
  assert.ok(serialized.includes("REDACTED"));
  assert.deepEqual(conversationContext(platform, a, org, id, false), []);
  platform.clearChat(a, org, id);
  assert.deepEqual(conversationContext(platform, a, org, id, true), []);
});
test("chat: edição invalida a aprovação anterior e cancelamento interrompe a investigação sem executar", async (t) => {
  let executions = 0,
    providerCalls = 0,
    actualCommand = "";
  const { platform, ops, vault, a, b, id, org, store } = fixture(
    t,
    async (_ssh, commands) => {
      executions++;
      const encoded = commands[0].match(/'([A-Za-z0-9+/=]+)'$/)![1];
      actualCommand = JSON.parse(
        Buffer.from(encoded, "base64").toString(),
      ).command;
      return {
        code: 0,
        output: 'FOXOPS_COMMAND:{"status":"completed","exit_code":0}',
      };
    },
  );
  configure(ops, a, id);
  const operator = new CommandAgent(platform, ops, vault, {
    key: "fake",
    model: "test",
    fetch: (async () => {
      providerCalls++;
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  answer: "Verificar discos",
                  command: "df -h",
                  reason: "Consultar uso dos discos.",
                }),
              },
            ],
          },
        ],
        usage: { total_tokens: 1 },
      });
    }) as typeof fetch,
  });
  const plan = await operator.start(a, {
    organization: org,
    server_id: id,
    question: "Qual disco está cheio?",
  });
  assert.equal(executions, 0);
  assert.throws(() =>
    operator.edit(b, plan.session_id, plan.action_id!, { command: "df -hT" }),
  );
  assert.throws(() =>
    operator.edit(
      { ...a, role: "operator" },
      plan.session_id,
      plan.action_id!,
      { command: "df -hT" },
    ),
  );
  assert.throws(() =>
    operator.edit(a, plan.session_id, plan.action_id!, {
      command: "x".repeat(2001),
    }),
  );
  assert.equal(ops.actionDetail(a, id, plan.action_id!).status, "pending");
  const updated = operator.edit(a, plan.session_id, plan.action_id!, {
    command: "df -hT",
  });
  assert.notEqual(updated.action_id, plan.action_id);
  assert.equal(executions, 0);
  assert.equal(providerCalls, 1);
  assert.equal(ops.actionDetail(a, id, plan.action_id!).status, "replaced");
  await assert.rejects(ops.approve(a, id, plan.action_id!));
  assert.equal(executions, 0);
  const message = operator.decorate(platform.chatHistory(a, org, id))[0];
  assert.equal(message.command, "df -hT");
  assert.equal(message.action_id, updated.action_id);
  assert.equal(message.edited, 1);
  await ops.approve(a, id, updated.action_id);
  assert.equal(executions, 1);
  assert.equal(actualCommand, "df -hT");
  assert.throws(() =>
    operator.edit(a, plan.session_id, updated.action_id, { command: "df" }),
  );
  const next = await operator.start(a, {
    organization: org,
    server_id: id,
    question: "Verifique novamente",
  });
  assert.throws(() => operator.cancel(b, next.session_id, next.action_id!));
  operator.cancel(a, next.session_id, next.action_id!);
  assert.equal(executions, 1);
  assert.equal(ops.actionDetail(a, id, next.action_id!).status, "canceled");
  await assert.rejects(ops.approve(a, id, next.action_id!));
  await assert.rejects(operator.step(a, next.session_id), /cancelada/);
  assert.equal(providerCalls, 2);
  const canceled = operator
    .decorate(platform.chatHistory(a, org, id))
    .find((row) => row.action_id === next.action_id)!;
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.executed, true);
  assert.equal(
    (
      store.db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action IN ('command.edited','command.canceled') AND actor_name='Owner'",
        )
        .get() as { n: number }
    ).n,
    2,
  );
});
test("histórico de ações pagina todos os registros, filtra, isola contas e só retorna saída nos detalhes", (t) => {
  const { platform, store, ops, a, b, id } = fixture(t);
  configure(ops, a, id);
  const ids: string[] = [];
  for (let index = 0; index < 45; index++) {
    const result = ops.propose(a, id, {
      service: "nginx",
      action: "status",
      reason: index === 44 ? "Literal 100%" : "Action " + index,
    });
    ids.push(result.id);
    store.db
      .prepare(
        "UPDATE remediation_actions SET status=?,created_at=?,output=? WHERE id=?",
      )
      .run(
        ["pending", "succeeded", "failed"][index % 3],
        now() - (index === 0 ? 1000 : index),
        "full output " + index,
        result.id,
      );
  }
  const first = ops.actionHistory(a, id, { page: 1, limit: 5 });
  assert.equal(first.total, 45);
  assert.equal(first.items.length, 5);
  assert.equal(first.pages, 9);
  assert.equal(first.pending, 14);
  assert.ok(
    first.items.every((row) => !("output" in row) && !("commands" in row)),
  );
  const last = ops.actionHistory(a, id, { page: 999, limit: 5 });
  assert.equal(last.page, 9);
  assert.ok(last.items.some((row) => row.id === ids[0]));
  assert.equal(ops.actionHistory(a, id, { q: "100%" }).total, 1);
  assert.equal(ops.actionHistory(a, id, { status: "pending" }).total, 14);
  assert.equal(ops.actionHistory(a, id, { status: "expired" }).total, 1);
  assert.equal(ops.actionDetail(a, id, ids[0]).status, "expired");
  assert.equal(ops.actionDetail(a, id, ids[44]).output, "full output 44");
  assert.throws(() => ops.actionHistory(b, id, {}));
  assert.throws(() => ops.actionDetail(b, id, ids[44]));
  assert.throws(() => ops.actionHistory(a, id, { status: "invalid" }));
  assert.equal(platform.server(a, id).id, id);
});
test("operador: prepara comando genérico, só executa com aprovação e analisa a saída", async (t) => {
  let executions = 0,
    calls = 0;
  const { platform, ops, vault, a, b, id, org } = fixture(
    t,
    async (_ssh, commands) => {
      executions++;
      const payload = JSON.parse(
        Buffer.from(
          commands[0].match(/'([A-Za-z0-9+/=]+)'$/)![1],
          "base64",
        ).toString(),
      );
      assert.equal(payload.command, "ss -lntup");
      return {
        code: 0,
        output:
          'FOXOPS_COMMAND:{"status":"completed","exit_code":0}\nLISTEN 127.0.0.1:3306 mysqld',
      };
    },
  );
  configure(ops, a, id);
  const mock = (async (_url, options) => {
    calls++;
    const input = JSON.parse(JSON.parse(String(options!.body)).input);
    if (calls === 2) assert.match(input.steps[0].output, /3306/);
    const answer =
      calls === 1
        ? {
            answer: "Vou listar as portas em escuta.",
            command: "ss -lntup",
            reason: "Consulta de rede; não altera configurações.",
          }
        : {
            answer: "A saída mostra MySQL escutando em 127.0.0.1:3306.",
            command: null,
            reason: "Dados suficientes.",
          };
    return new Response(
      JSON.stringify({
        output: [
          { content: [{ type: "output_text", text: JSON.stringify(answer) }] },
        ],
        usage: { total_tokens: 8 },
      }),
    );
  }) as typeof fetch;
  const operator = new CommandAgent(platform, ops, vault, {
    key: "fake",
    model: "test",
    fetch: mock,
  });
  const plan = await operator.start(a, {
    organization: org,
    server_id: id,
    question: "Liste as portas abertas",
  });
  assert.equal(executions, 0);
  assert.equal(plan.command, "ss -lntup");
  assert.equal(
    operator.decorate(platform.chatHistory(a, org, id))[0].action_id,
    plan.action_id,
  );
  await assert.rejects(operator.step(b, plan.session_id));
  await assert.rejects(operator.step(a, plan.session_id));
  assert.equal(ops.actions(a, id)[0].operator_command, "ss -lntup");
  await ops.approve(a, id, plan.action_id!);
  assert.equal(executions, 1);
  const answer = await operator.step(a, plan.session_id);
  assert.equal(answer.command, null);
  assert.match(answer.answer, /3306/);
  await assert.rejects(ops.approve(a, id, plan.action_id!));
});

test("operador: saída indeterminada interrompe investigação sem repetição automática", async (t) => {
  const { platform, ops, vault, a, id, org } = fixture(t, async () => ({
    code: 1,
    output: 'FOXOPS_COMMAND:{"status":"timed_out","exit_code":-9}\nparcial',
  }));
  configure(ops, a, id);
  const mock = (async () =>
    new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  answer: "Ler discos.",
                  command: "lsblk",
                  reason: "Diagnóstico somente leitura.",
                }),
              },
            ],
          },
        ],
        usage: { total_tokens: 1 },
      }),
    )) as typeof fetch;
  const operator = new CommandAgent(platform, ops, vault, {
    key: "fake",
    model: "test",
    fetch: mock,
  });
  const plan = await operator.start(a, {
    organization: org,
    server_id: id,
    question: "Verifique os discos",
  });
  assert.equal((await ops.approve(a, id, plan.action_id!))!.status, "unknown");
  await assert.rejects(operator.step(a, plan.session_id));
});
test("chat ao vivo: exige agente compatível, vincula pergunta/servidor e aguarda dados novos", async (t) => {
  const { platform, ops, vault, a, b, id, token, org, store } = fixture(t),
    tasks = new AgentTasks(platform, ops);
  const question = "Pode verificar o túnel da Cloudflare? Meu site não abre.";
  assert.throws(() =>
    tasks.live.request(a, { organization: org, server_id: id, question }),
  );
  platform.recordDetails(token, {
    agent_version: "0.7.0",
    services: { cloudflared: "active", nginx: "active" },
  });
  assert.throws(() =>
    tasks.live.request(b, { organization: org, server_id: id, question }),
  );
  const job = tasks.live.request(a, {
    organization: org,
    server_id: id,
    question,
  });
  assert.deepEqual(job.plan.services, ["cloudflared"]);
  assert.equal(job.plan.logs, true);
  assert.equal(job.plan.origin, true);
  assert.throws(() =>
    tasks.live.request(a, { organization: org, server_id: id, question }),
  );
  assert.equal(tasks.live.pending(token)[0].id, job.id);
  await assert.rejects(
    askAssistant(
      platform,
      a,
      { organization: org, server_id: id, question, live_check_id: job.id },
      {},
      vault,
    ),
  );
  assert.throws(() => tasks.live.get(b, job.id));
  const result = {
    checked_at: now(),
    metrics: { cpu_percent: 1, memory_percent: 40, disk_percent: 30 },
    services: { cloudflared: "failed" },
    logs: {
      cloudflared: {
        counts: { connection_refused: 1 },
        scanned: 2,
        read_status: "ok",
      },
    },
    origin: { status: "not_configured" },
    cmdline: "NEVER-SEND-THIS",
    limitations: ["Origem não configurada."],
  };
  assert.throws(() =>
    tasks.live.complete(token, job.id, { ...result, checked_at: NaN }),
  );
  tasks.live.complete(token, job.id, result);
  assert.doesNotMatch(
    String(tasks.live.get(a, job.id).result),
    /NEVER-SEND-THIS/,
  );
  const mock = (async (_url, options) => {
    const input = JSON.parse(JSON.parse(String(options!.body)).input);
    assert.equal(input.live_diagnostic.services.cloudflared, "failed");
    assert.equal(input.live_diagnostic.origin.status, "not_configured");
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: "A verificação nova identificou cloudflared com falha. A origem não foi testada.",
              },
            ],
          },
        ],
        usage: { total_tokens: 5 },
      }),
    );
  }) as typeof fetch;
  const answer = await askAssistant(
    platform,
    a,
    { organization: org, server_id: id, question, live_check_id: job.id },
    { key: "fake", model: "test", fetch: mock },
    vault,
  );
  assert.match(answer.answer, /Verificação no servidor concluída/);
  assert.equal(ops.actions(a, id).length, 0);
  await assert.rejects(
    askAssistant(
      platform,
      a,
      {
        organization: org,
        server_id: id,
        question: "Outra pergunta",
        live_check_id: job.id,
      },
      {},
      vault,
    ),
  );
  assert.throws(() => tasks.live.complete(token, job.id, result));
  store.db.prepare("UPDATE live_checks SET created_at=?").run(now() - 121);
  await assert.rejects(
    askAssistant(
      platform,
      a,
      { organization: org, server_id: id, question, live_check_id: job.id },
      {},
      vault,
    ),
  );
});
test("configuração: sugestão de IA é validada e não cria execução ou proposta automaticamente", async (t) => {
  const { platform, ops, vault, a, id } = fixture(t, async () => ({
    code: 0,
    output:
      "FOXOPS_CONFIG:" +
      JSON.stringify({
        status: "inspected",
        service: "nginx",
        path: "/etc/nginx/nginx.conf",
        sha256: "b".repeat(64),
        activation: "reload",
        values: { worker_processes: 1 },
      }),
  }));
  configure(ops, a, id);
  const edits = new ConfigEdits(platform, ops);
  const snapshot = await edits.inspect(a, id, "nginx");
  const mock = (async (_url, options) => {
    assert.doesNotMatch(String(options!.body), /fake-test-password/);
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: 'Verifique capacidade antes de aplicar.\n```foxops-config\n{"values":{"worker_processes":2}}\n```',
              },
            ],
          },
        ],
        usage: { total_tokens: 5 },
      }),
    );
  }) as typeof fetch;
  const result = await edits.suggest(
    a,
    id,
    {
      snapshot_id: snapshot.id,
      goal: "Ajustar o número de workers após análise da capacidade.",
    },
    { key: "fake", model: "test", fetch: mock },
    vault,
  );
  assert.deepEqual(result.values, { worker_processes: 2 });
  assert.equal(ops.actions(a, id).length, 0);
});
test("configuração: leitura reduzida, diferença revisável, aprovação e restauração registrada", async (t) => {
  let executions = 0,
    applyStatus = "applied";
  const { platform, ops, a, b, id } = fixture(t, async (_ssh, commands) => {
    executions++;
    const encoded = commands[0].match(/'([A-Za-z0-9+/=]+)'$/)![1];
    const data = JSON.parse(Buffer.from(encoded, "base64").toString());
    return {
      code: data.operation === "inspect" || applyStatus === "applied" ? 0 : 1,
      output:
        "FOXOPS_CONFIG:" +
        JSON.stringify(
          data.operation === "inspect"
            ? {
                status: "inspected",
                service: "nginx",
                path: "/etc/nginx/nginx.conf",
                sha256: "a".repeat(64),
                activation: "reload",
                values: { worker_processes: "auto" },
              }
            : { status: applyStatus, backup: "test-backup.bak" },
        ),
    };
  });
  configure(ops, a, id);
  const edits = new ConfigEdits(platform, ops);
  await assert.rejects(edits.inspect(b, id, "nginx"));
  await assert.rejects(edits.inspect({ ...a, role: "reader" }, id, "nginx"));
  const snapshot = await edits.inspect(a, id, "nginx");
  assert.equal("values" in snapshot, true);
  assert.throws(() =>
    edits.propose(a, id, {
      snapshot_id: snapshot.id,
      values: { worker_processes: "1;id" },
    }),
  );
  assert.throws(() =>
    edits.propose(a, id, { snapshot_id: snapshot.id, values: { include: 1 } }),
  );
  const proposed = edits.propose(a, id, {
    snapshot_id: snapshot.id,
    values: { worker_processes: 2 },
  });
  assert.equal(executions, 1);
  const review = ops.actions(a, id)[0];
  assert.match(String(review.configuration), /"before":"auto"/);
  await assert.rejects(
    ops.approve({ ...a, role: "operator" }, id, proposed.id),
  );
  assert.equal((await ops.approve(a, id, proposed.id))!.status, "succeeded");
  await assert.rejects(ops.approve(a, id, proposed.id));
  applyStatus = "rolled_back";
  const next = edits.propose(a, id, {
    snapshot_id: snapshot.id,
    values: { worker_processes: 3 },
  });
  assert.equal((await ops.approve(a, id, next.id))!.status, "rolled_back");
  configure(ops, a, id);
  assert.throws(() =>
    edits.propose(a, id, {
      snapshot_id: snapshot.id,
      values: { worker_processes: 4 },
    }),
  );
});
const processResult = () => ({
  processes: [
    {
      pid: 42,
      name: "php-fpm",
      user: "www-data",
      state: "R",
      cpu_percent: 25,
      memory_percent: 3,
      rss_bytes: 1024000,
      elapsed_seconds: 60,
      service: "php8.3-fpm",
      cmdline: "SECRET-ARGUMENT",
      environ: "PRIVATE-ENV",
    },
  ],
  visible: 10,
  skipped: 1,
  sample_seconds: 1.1,
  collected_at: now(),
  read_status: "ok",
});

test("processos: fila só lê o servidor autorizado, valida campos e descarta argumentos", (t) => {
  const { platform, ops, a, b, id, token } = fixture(t);
  const tasks = new AgentTasks(platform, ops),
    checks = tasks.processes;
  assert.throws(() => checks.request(b, id));
  const job = checks.request(a, id)!;
  assert.throws(() => checks.request(a, id));
  assert.equal(checks.pending(token)[0].id, job.id);
  const result = processResult();
  assert.throws(() =>
    checks.complete(token, String(job.id), {
      ...result,
      processes: [{ ...result.processes[0], cpu_percent: NaN }],
    }),
  );
  assert.throws(() =>
    checks.complete(token, String(job.id), {
      ...result,
      processes: [result.processes[0], result.processes[0]],
    }),
  );
  assert.throws(() =>
    checks.complete(token, String(job.id), {
      ...result,
      processes: [{ ...result.processes[0], service: "nginx;id" }],
    }),
  );
  assert.throws(() => checks.complete(token, "another-job", result));
  checks.complete(token, String(job.id), result);
  assert.equal(checks.list(a, id)[0].status, "completed");
  assert.doesNotMatch(
    String(checks.list(a, id)[0].result),
    /SECRET-ARGUMENT|PRIVATE-ENV|cmdline|environ/,
  );
  assert.throws(() => checks.list(b, id));
  assert.throws(() => checks.complete(token, String(job.id), result));
});

test("processos: expiração e consultas MCP preservam somente leitura e escopo", (t) => {
  const { platform, ops, a, b, id, token, store } = fixture(t);
  const tasks = new AgentTasks(platform, ops);
  assert.throws(() =>
    query(
      platform,
      b,
      "request_process_snapshot",
      { server_id: id },
      ops,
      tasks,
    ),
  );
  const job = query(
    platform,
    a,
    "request_process_snapshot",
    { server_id: id },
    ops,
    tasks,
  ) as { id: string };
  assert.equal(tasks.processes.pending(token)[0].id, job.id);
  store.db.prepare("UPDATE process_checks SET created_at=?").run(now() - 601);
  assert.equal(tasks.processes.pending(token).length, 0);
  assert.throws(() => tasks.processes.complete(token, job.id, processResult()));
  const rows = query(
    platform,
    a,
    "get_process_snapshots",
    { server_id: id },
    ops,
    tasks,
  ) as { status: string }[];
  assert.equal(rows[0].status, "expired");
  assert.equal(ops.actions(a, id).length, 0);
});

test("processos: assistente usa a coleta selecionada, rejeita escopo global e amostra antiga", async (t) => {
  const { platform, ops, vault, a, id, token, org, store } = fixture(t);
  const tasks = new AgentTasks(platform, ops),
    job = tasks.processes.request(a, id)!;
  tasks.processes.complete(token, String(job.id), processResult());
  const data = {
    organization: org,
    server_id: id,
    question: "Quais processos consomem CPU?",
    include_processes: true,
    process_check_id: job.id,
  };
  const mock = (async (_url, options) => {
    const input = JSON.parse(JSON.parse(String(options!.body)).input);
    assert.equal(input.process_snapshot.result.processes[0].pid, 42);
    assert.doesNotMatch(JSON.stringify(input), /SECRET-ARGUMENT|PRIVATE-ENV/);
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: "Processo php-fpm consome 25% da CPU. Investigue o serviço antes de alterar.",
              },
            ],
          },
        ],
        usage: { total_tokens: 5 },
      }),
    );
  }) as typeof fetch;
  const result = await askAssistant(
    platform,
    a,
    data,
    { key: "fake", model: "test", fetch: mock },
    vault,
  );
  assert.match(result.answer, /php-fpm/);
  assert.equal(ops.actions(a, id).length, 0);
  await assert.rejects(
    askAssistant(platform, a, { ...data, server_id: undefined }, {}, vault),
  );
  store.db.prepare("UPDATE process_checks SET created_at=?").run(now() - 601);
  await assert.rejects(askAssistant(platform, a, data, {}, vault));
});
function fixture(
  t: TestContext,
  execute: SSHExecutor = async () => ({ code: 0, output: "active" }),
) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store),
    vault = new AISettings(platform, { masterKey: randomBytes(32) }),
    ops = new Operations(platform, vault, execute);
  const a = platform.signup({
    name: "Owner",
    company: "ACME",
    email: "owner@example.test",
    password: "long-password-123",
  }).principal;
  const b = platform.signup({
    name: "Other",
    company: "OTHER",
    email: "other@example.test",
    password: "long-password-456",
  }).principal;
  const org = platform.organizations(a)[0].id,
    s = platform.createServer(a, org, "web"),
    agent = platform.enroll(s.enrollment_token);
  ops.save(a, s.server_id, {
    auto_discover: false,
    services: ["nginx", "php8.3-fpm"],
    logs_enabled: true,
  });
  platform.recordDetails(agent.agent_token, {
    services: { nginx: "failed", "php8.3-fpm": "active" },
    discovered_services: ["nginx", "php8.3-fpm"],
  });
  return {
    store,
    platform,
    vault,
    ops,
    a,
    b,
    id: s.server_id,
    token: agent.agent_token,
    org,
  };
}
function configure(
  ops: Operations,
  p: Parameters<Operations["saveSSH"]>[0],
  id: string,
) {
  ops.saveSSH(p, id, {
    host: "192.168.3.50",
    port: 22,
    username: "foxops",
    fingerprint,
    password: "fake-test-password",
  });
}

test("cadastro SSH automático é temporário, vinculado ao agente e não substitui conexão", (t) => {
  const { platform, ops, a, b, id, token, store } = fixture(t);
  const tasks = new AgentTasks(platform, ops);
  assert.throws(() => tasks.issue(id, b));
  assert.throws(() => tasks.issue(id, { ...a, role: "admin" }));
  const ticket = tasks.issue(id, a).ticket;
  const data = {
    ticket,
    host: "192.168.3.50",
    port: 22,
    username: "foxops-ssh",
    fingerprint,
    privateKey:
      "-----BEGIN OPENSSH PRIVATE KEY-----\nTEST-SECRET\n-----END OPENSSH PRIVATE KEY-----",
  };
  assert.throws(() => tasks.bootstrap(token, { ...data, ticket: "wrong" }));
  assert.throws(() => tasks.bootstrap(token, { ...data, username: "root" }));
  tasks.bootstrap(token, data);
  assert.equal(ops.sshMetadata(a, id).configured, true);
  const row = store.db
    .prepare("SELECT encrypted FROM ssh_connections WHERE server_id=?")
    .get(id)!;
  assert.doesNotMatch(String(row.encrypted), /TEST-SECRET/);
  assert.throws(() => tasks.bootstrap(token, data));
  assert.throws(() => tasks.issue(id, a));
});

test("autorização SSH expirada e troca de credencial do agente invalidam cadastro", (t) => {
  const { platform, ops, a, id, token, store } = fixture(t);
  const tasks = new AgentTasks(platform, ops);
  const ticket = tasks.issue(id, a).ticket;
  store.db.prepare("UPDATE ssh_bootstrap SET expires_at=?").run(now() - 1);
  assert.throws(() => tasks.bootstrap(token, { ticket }));
  tasks.issue(id, a);
  const replacement = platform.enroll(
    platform.renewEnrollment(a, id).enrollment_token,
  );
  assert.throws(() => tasks.bootstrap(replacement.agent_token, { ticket }));
});

test("fila de verificação local isola servidores, expira e persiste somente resumo validado", (t) => {
  const { platform, ops, a, b, id, token, store } = fixture(t);
  const tasks = new AgentTasks(platform, ops);
  assert.throws(() => tasks.request(b, id, { service: "nginx" }));
  assert.throws(() => tasks.request(a, id, { service: "nginx;id" }));
  assert.throws(() => tasks.request(a, id, { service: "sshd" }));
  assert.throws(() =>
    tasks.request(a, id, { service: "nginx", since: now() - 90000 }),
  );
  const job = tasks.request(a, id, { service: "nginx" })!;
  assert.throws(() => tasks.request(a, id, { service: "nginx" }));
  assert.equal(tasks.pending(token)[0].id, job.id);
  assert.equal(tasks.pending(token)[0].id, job.id);
  assert.throws(() =>
    tasks.complete(token, String(job.id), {
      counts: { arbitrary_command: 1 },
      scanned: 1,
      read_status: "ok",
    }),
  );
  tasks.complete(token, String(job.id), {
    counts: { permission_denied: 2 },
    scanned: 3,
    read_status: "ok",
    message: "RAW-SECRET-NEVER-STORED",
    sources: ["journalctl", "bad-source"],
  });
  const result = tasks.list(a, id)[0];
  assert.equal(result.status, "completed");
  assert.doesNotMatch(String(result.result), /RAW-SECRET|bad-source/);
  assert.throws(() =>
    tasks.complete(token, String(job.id), {
      counts: {},
      scanned: 0,
      read_status: "ok",
    }),
  );
  tasks.request(a, id, { service: "nginx" });
  store.db
    .prepare("UPDATE local_log_checks SET created_at=? WHERE status='pending'")
    .run(now() - 601);
  assert.equal(tasks.pending(token).length, 0);
});

test("monitoramento e logs respeitam conta, deduplicam eventos e removem segredos comuns", (t) => {
  const { ops, a, b, id, token } = fixture(t);
  assert.equal(ops.agentConfig(token).logs_enabled, true);
  const event = {
    event_id: "one",
    service: "nginx",
    timestamp: now(),
    message: "password=secret token=abc authorization: Bearer sensitive",
    priority: "3",
  };
  ops.ingestLogs(token, [event]);
  ops.ingestLogs(token, [event]);
  const logs = ops.logs(a, id);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(String(logs[0].message), /secret|sensitive|abc/);
  assert.throws(() => ops.logs(b, id));
  assert.throws(() => ops.ingestLogs("bad", [event]));
  ops.save(a, id, { auto_discover: true, services: [], logs_enabled: false });
  assert.throws(() => ops.ingestLogs(token, [event]));
  assert.throws(() =>
    ops.save(a, id, {
      auto_discover: false,
      services: ["nginx;reboot"],
      logs_enabled: true,
    }),
  );
});

test("credenciais SSH são cifradas e somente proprietário pode alterá-las", (t) => {
  const { ops, store, a, b, id } = fixture(t);
  configure(ops, a, id);
  const data = store.db.prepare("SELECT * FROM ssh_connections").get();
  assert.doesNotMatch(JSON.stringify(data), /fake-test-password/);
  assert.doesNotMatch(
    JSON.stringify(ops.sshMetadata(a, id)),
    /encrypted|password/,
  );
  assert.throws(() => ops.sshMetadata(b, id));
  assert.throws(() =>
    ops.saveSSH({ ...a, role: "operator" }, id, { host: "x" }),
  );
  assert.throws(() =>
    ops.saveSSH(a, id, {
      host: "x",
      port: 22,
      username: "root",
      fingerprint: "invalid",
      password: "x",
    }),
  );
});

test("ações são templates fixos e reinícios validam configuração antes de executar", () => {
  assert.throws(() => actionCommands("nginx; reboot", "restart", "root"));
  assert.throws(() => actionCommands("nginx", "rm -rf", "root"));
  assert.throws(() => actionCommands("mysql", "configtest", "root"));
  assert.deepEqual(actionCommands("php8.3-fpm", "configtest", "root"), [
    "/usr/sbin/php-fpm8.3 -t",
  ]);
  const commands = actionCommands("nginx", "restart", "foxops");
  assert.match(commands[0], /sudo -n.*nginx -t/);
  assert.match(commands[1], /systemctl restart/);
  assert.match(commands[2], /is-active/);
});

test("preparar ação não executa SSH; aprovação é única e requer perfil privilegiado", async (t) => {
  let count = 0;
  const { ops, a, b, id } = fixture(t, async (_config, commands) => {
    count++;
    assert.match(commands[0], /nginx -t/);
    return { code: 0, output: "active" };
  });
  configure(ops, a, id);
  const proposal = ops.propose(a, id, {
    service: "nginx",
    action: "restart",
    reason: "Serviço falhou.",
  });
  assert.equal(count, 0);
  await assert.rejects(
    ops.approve({ ...a, role: "operator" }, id, proposal.id),
  );
  await assert.rejects(ops.approve(b, id, proposal.id));
  const result = await ops.approve(a, id, proposal.id);
  assert.equal(result?.status, "succeeded");
  assert.equal(count, 1);
  await assert.rejects(ops.approve(a, id, proposal.id));
  assert.equal(count, 1);
});

test("conexão alterada e ação expirada não podem ser executadas; falha deixa resultado indeterminado", async (t) => {
  const { ops, a, id, store } = fixture(t, async () => {
    throw new Error("timeout");
  });
  configure(ops, a, id);
  const old = ops.propose(a, id, { service: "nginx", action: "reload" });
  configure(ops, a, id);
  await assert.rejects(ops.approve(a, id, old.id));
  const expired = ops.propose(a, id, { service: "nginx", action: "status" });
  store.db
    .prepare("UPDATE remediation_actions SET created_at=? WHERE id=?")
    .run(now() - 901, expired.id);
  await assert.rejects(ops.approve(a, id, expired.id));
  const failed = ops.propose(a, id, { service: "nginx", action: "status" });
  assert.equal((await ops.approve(a, id, failed.id))?.status, "unknown");
});

test("apenas uma ação SSH pode executar por servidor", async (t) => {
  let release: () => void = () => {};
  const { ops, a, id } = fixture(
    t,
    () =>
      new Promise((resolve) => {
        release = () => resolve({ code: 0, output: "active" });
      }),
  );
  configure(ops, a, id);
  const one = ops.propose(a, id, { service: "nginx", action: "status" }),
    two = ops.propose(a, id, { service: "nginx", action: "restart" });
  const pending = ops.approve(a, id, one.id);
  await assert.rejects(ops.approve(a, id, two.id));
  release();
  await pending;
});

test("IA recebe apenas resumo da verificação local e sugestões não executam comandos", async (t) => {
  const { ops, platform, vault, a, id, org, token } = fixture(t);
  ops.ingestLogs(token, [
    {
      event_id: "e",
      service: "nginx",
      timestamp: now(),
      message: "UNIQUE-NGINX-ERROR",
      priority: "3",
    },
  ]);
  const tasks = new AgentTasks(platform, ops);
  const job = tasks.request(a, id, { service: "nginx" })!;
  tasks.complete(token, String(job.id), {
    counts: { configuration_error: 1 },
    scanned: 1,
    read_status: "ok",
  });
  const mock = (async (_url, options) => {
    const body = JSON.parse(String(options!.body));
    const context = JSON.parse(body.input);
    assert.doesNotMatch(body.input, /UNIQUE-NGINX-ERROR/);
    assert.equal(context.logs.length, 0);
    assert.equal(context.local_log_check.result.counts.configuration_error, 1);
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: 'Falha de configuração.\n```foxops-action\n{"service":"nginx","action":"configtest","reason":"Verificar sintaxe"}\n```',
              },
            ],
          },
        ],
        usage: { total_tokens: 4 },
      }),
    );
  }) as typeof fetch;
  const result = await askAssistant(
    platform,
    a,
    {
      organization: org,
      server_id: id,
      question: "Analise",
      include_logs: true,
    },
    { key: "fake", model: "test", fetch: mock },
    vault,
  );
  assert.equal(result.suggestions[0].action, "configtest");
  assert.equal(ops.actions(a, id).length, 0);
  assert.doesNotMatch(result.answer, /foxops-action/);
  await assert.rejects(
    askAssistant(
      platform,
      a,
      { organization: org, question: "Todos", include_logs: true },
      {},
      vault,
    ),
  );
});

test("cliente SSH real verifica fingerprint e encerra sequência quando um comando falha", async (t) => {
  const hostKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  const parsed = utils.parseKey(hostKey);
  if (parsed instanceof Error || Array.isArray(parsed))
    throw new Error("host key");
  const expected =
    "SHA256:" +
    createHash("sha256")
      .update(parsed.getPublicSSH())
      .digest("base64")
      .replace(/=+$/, "");
  let executed: string[] = [];
  const ssh = new SSHServer({ hostKeys: [hostKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (ctx) =>
      ctx.method === "password" && ctx.password === "test-password"
        ? ctx.accept()
        : ctx.reject(),
    );
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (accept, _reject, info) => {
          executed.push(info.command);
          const stream = accept();
          stream.write(info.command === "bad" ? "failed" : "ok");
          stream.exit(info.command === "bad" ? 1 : 0);
          stream.end();
        });
      }),
    );
  });
  await new Promise<void>((resolve) => ssh.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => ssh.close(() => resolve())));
  const config = {
    host: "127.0.0.1",
    port: (ssh.address() as AddressInfo).port,
    username: "foxops",
    fingerprint: expected,
    password: "test-password",
    encrypted: "",
    revision: "test",
  };
  const result = await sshExecute(config, ["first", "bad", "never"]);
  assert.equal(result.code, 1);
  assert.deepEqual(executed, ["first", "bad"]);
  await assert.rejects(sshExecute({ ...config, fingerprint }, ["never"]));
  assert.equal(executed.length, 2);
});
