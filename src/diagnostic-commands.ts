import { APIError } from "./store.ts";

const commands = [
  "df",
  "df -h",
  "df -hT",
  "df -i",
  "lsblk",
  "lsblk -f",
  "free -m",
  "free -h",
  "uptime",
  "uname -a",
  "ss -lntup",
  "ss -lntu",
  "ip -s link",
  "ps -eo pid,comm,pcpu,pmem",
  "who",
];

const serviceQuery =
  /^(?:systemctl (?:is-active|is-enabled) --|journalctl -n 50 --no-pager -u) [a-zA-Z0-9][a-zA-Z0-9_.@-]{0,119}\.service$/;

export const diagnosticCommandPrompt =
  "Regra obrigat\u00f3ria: apenas consultas de leitura. Nunca sugira comandos destrutivos ou que alterem o sistema. " +
  "Para o campo command use exatamente uma destas consultas: " +
  commands.join(", ") +
  ". Consultas adicionais: systemctl is-active -- nome.service, systemctl is-enabled -- nome.service ou journalctl -n 50 --no-pager -u nome.service. Substitua nome pelo servi\u00e7o real. Se nenhuma servir, use null e explique a limita\u00e7\u00e3o.";

export function requireDiagnosticCommand(command: unknown) {
  if (
    typeof command !== "string" ||
    (!commands.includes(command.trim()) && !serviceQuery.test(command.trim()))
  )
    throw new APIError(
      400,
      "Comando bloqueado. O Assistente SSH permite apenas consultas de leitura autorizadas.",
    );
}

export function validateDiagnosticWrapper(wrapper: unknown) {
  const match =
    typeof wrapper === "string" &&
    /^(?:sudo -n )?\/usr\/local\/sbin\/foxops-command '([A-Za-z0-9+/=]+)'$/.exec(
      wrapper,
    );
  if (!match) return requireDiagnosticCommand(null);
  let command: unknown;
  try {
    command = JSON.parse(
      Buffer.from(match[1], "base64").toString("utf8"),
    ).command;
  } catch {
    return requireDiagnosticCommand(null);
  }
  requireDiagnosticCommand(command);
}
