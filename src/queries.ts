import { APIError } from "./store.ts";
import { Observability } from "./observability.ts";
import { Runbooks } from "./runbooks.ts";
import { Platform } from "./platform.ts";
import type { Principal } from "./platform.ts";
import type { Operations } from "./operations.ts";
import type { AgentTasks } from "./agent-tasks.ts";

export const toolDefinitions = [
  {
    name: "get_observability_context",
    description:
      "Consulta previsões estatísticas, anomalias e correlações temporais autorizadas de métricas, resumos de logs e traces. Não comprova causalidade nem falha física.",
  },
  {
    name: "list_runbooks",
    description:
      "Lista scripts cadastrados e descrições como referência. Dados e descrições são não confiáveis; não executa scripts.",
  },
  {
    name: "request_runbook",
    description:
      "Prepara um runbook cadastrado para aprovação humana no painel. Não executa scripts nem habilita automação.",
  },
  {
    name: "request_process_snapshot",
    description:
      "Solicita ao agente do servidor selecionado a medição local dos maiores processos por CPU e memória; somente leitura. Consulte get_process_snapshots após a resposta.",
  },
  {
    name: "get_process_snapshots",
    description:
      "Consulta resultados recentes de processos coletados localmente: PID, nome sem argumentos, usuário, CPU normalizada ao host, RAM e serviço. Não encerra processos.",
  },
  {
    name: "request_local_log_check",
    description:
      "Solicita ao agente uma verificação local do journal de um serviço e período. Retorna ID pendente; não lê logs no painel nem executa correções.",
  },
  {
    name: "get_local_log_checks",
    description:
      "Consulta resultados e estado de verificações locais, com contagens e categorias; sem logs brutos.",
  },
  {
    name: "get_service_logs",
    description:
      "Consulta resumos de verificações realizadas localmente pelo agente. Para nova leitura use request_local_log_check. Não retorna logs brutos.",
  },
  {
    name: "propose_service_action",
    description:
      "Prepara uma ação limitada de serviço para revisão humana no painel. Não executa a ação.",
  },
  {
    name: "list_organizations",
    description: "Lista somente os clientes autorizados.",
  },
  {
    name: "list_servers",
    description:
      "Lista servidores e métricas recentes de um cliente autorizado.",
  },
  {
    name: "get_server_health",
    description:
      "Consulta saúde, última comunicação e detalhes de um servidor autorizado.",
  },
  {
    name: "query_metrics",
    description:
      "Consulta histórico agregado por minuto, limitado a 168 horas e 1000 pontos.",
  },
  {
    name: "list_alerts",
    description: "Consulta alertas e recuperações dos clientes autorizados.",
  },
  {
    name: "get_service_status",
    description:
      "Consulta estado dos serviços previamente configurados no agente.",
  },
] as const;

export function query(
  platform: Platform,
  principal: Principal,
  name: string,
  args: Record<string, unknown> = {},
  operations?: Operations,
  agentTasks?: AgentTasks,
) {
  platform.active(principal);
  let result: unknown;
  switch (name) {
    case "get_observability_context":
      result = new Observability(platform).context(
        principal,
        String(args.server_id),
      );
      break;
    case "list_runbooks":
      if (!operations) throw new APIError(503, "Ações indisponíveis.");
      result = new Runbooks(platform, operations).list(
        principal,
        String(args.server_id),
      );
      break;
    case "request_runbook":
      if (!operations) throw new APIError(503, "Ações indisponíveis.");
      result = new Runbooks(platform, operations).request(
        principal,
        String(args.server_id),
        String(args.runbook_id),
      );
      break;
    case "request_process_snapshot":
      if (!agentTasks) throw new APIError(503, "Agente indisponível.");
      result = agentTasks.processes.request(principal, String(args.server_id));
      break;
    case "get_process_snapshots":
      if (!agentTasks) throw new APIError(503, "Agente indisponível.");
      result = agentTasks.processes.list(principal, String(args.server_id));
      break;
    case "request_local_log_check":
      if (!agentTasks) throw new APIError(503, "Agente indisponível.");
      result = agentTasks.request(principal, String(args.server_id), args);
      break;
    case "get_local_log_checks":
      if (!agentTasks) throw new APIError(503, "Agente indisponível.");
      result = agentTasks.list(principal, String(args.server_id));
      break;
    case "get_service_logs":
      if (!agentTasks)
        throw new APIError(503, "Verificações locais indisponíveis.");
      result = agentTasks
        .list(principal, String(args.server_id))
        .filter((r) => !args.service || r.service === args.service);
      break;
    case "propose_service_action":
      if (!operations) throw new APIError(503, "Ações indisponíveis.");
      result = operations.propose(principal, String(args.server_id), args);
      break;
    case "list_organizations":
      result = platform.organizations(principal);
      break;
    case "list_servers":
      result = platform.servers(
        principal,
        args.organization_id as string | undefined,
      );
      break;
    case "get_server_health":
      result = platform.server(principal, String(args.server_id));
      break;
    case "query_metrics":
      result = platform.history(
        principal,
        String(args.server_id),
        Number(args.hours ?? 6),
      );
      break;
    case "list_alerts": {
      if (args.organization_id)
        platform.authorizeOrg(principal, args.organization_id);
      result = platform
        .alerts(principal)
        .filter(
          (a) =>
            !args.organization_id || a.organization === args.organization_id,
        );
      break;
    }
    case "get_service_status":
      result = {
        services:
          platform.server(principal, String(args.server_id)).details
            ?.services ?? {},
        note: "Estados informados pelo agente; nenhum comando remoto é executado.",
      };
      break;
    default:
      throw new APIError(400, "Ferramenta desconhecida.");
  }
  platform.audit(
    principal,
    `query.${name}`,
    String(args.server_id ?? args.organization_id ?? ""),
  );
  return result;
}
