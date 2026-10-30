import type { Platform, Principal } from "./platform.ts";
import { APIError } from "./store.ts";
import { redact } from "./operations.ts";
export function contextEnabled(value: unknown) {
  if (value !== undefined && typeof value !== "boolean")
    throw new APIError(
      400,
      "A opção de contexto deve ser verdadeira ou falsa.",
    );
  return value !== false;
}
export function conversationContext(
  platform: Platform,
  p: Principal,
  org: string,
  serverId: string | undefined,
  enabled: boolean,
) {
  if (!enabled) return [];
  const db = platform.store.db;
  const commands = !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE name='command_messages'")
    .get();
  const turns: Record<string, unknown>[] = [];
  let remaining = 12000;
  for (const row of platform
    .chatHistory(p, org, serverId)
    .slice(-6)
    .reverse()) {
    const turn: Record<string, unknown> = {
      question: redact(String(row.question)).slice(0, 900),
      answer: redact(String(row.answer)).slice(0, 1600),
      created_at: row.created_at,
    };
    const command = commands
      ? db
          .prepare(
            "SELECT m.command,a.status,a.output FROM command_messages m LEFT JOIN remediation_actions a ON a.id=m.action_id WHERE m.message_id=?",
          )
          .get(String(row.id))
      : null;
    if (command?.command) {
      turn.command = redact(String(command.command)).slice(0, 800);
      turn.command_status = command.status;
      if (command.output)
        turn.command_output = redact(String(command.output)).slice(0, 1000);
    }
    const size = JSON.stringify(turn).length;
    if (size > remaining) break;
    remaining -= size;
    turns.push(turn);
  }
  return turns.reverse();
}
