export const auditActions: Record<string, string> = {
  "assistant.history.requested": "Investigação histórica solicitada",
  "service.monitors.bulk.enabled":
    "Monitoramento de serviços habilitado em lote",
  "service.monitors.bulk.disabled":
    "Monitoramento de serviços desabilitado em lote",
  "terminal.enabled": "Terminal SSH habilitado",
  "terminal.disabled": "Terminal SSH desabilitado",
  "terminal.opened": "Sessão de terminal SSH iniciada",
  "terminal.closed": "Sessão de terminal SSH encerrada",
  "server.icon.updated": "Ícone do servidor alterado",
  "service.monitor.saved": "Seleção de monitoramento de serviço alterada",
  "service.incident.summarized": "Incidente de serviço resumido pela IA",
  "process.monitor.saved": "Monitor de processo cadastrado ou alterado",
  "process.monitor.paused": "Monitor de processo pausado",
  "process.incident.summarized": "Incidente de processo resumido pela IA",
  "command.edited": "Comando editado antes da aprovação",
  "command.canceled": "Proposta de comando cancelada",
  "runbook.manually.reviewed": "Resultado de runbook verificado manualmente",
  "runbook.saved": "Runbook cadastrado ou alterado",
  "runbook.archived": "Runbook arquivado",
  "runbook.requested": "Execução de runbook preparada",
  "runbook.approved": "Execução de runbook aprovada",
  "runbook.rejected": "Execução de runbook rejeitada",
  "runbook.finished": "Execução de runbook encerrada",
  "runbook.automatic.started": "Runbook automático iniciado",
  "observability.key.rotated": "Chave de traces gerada ou rotacionada",
  "observability.key.revoked": "Chave de traces revogada",
  "notification.settings.updated": "Configuração de notificações alterada",
  "notification.test.sent": "Teste de notificação enviado",
  "url.monitor.created": "Monitor de URL criado",
  "url.monitor.updated": "Monitor de URL alterado",
  "url.monitor.archived": "Monitor de URL arquivado",
  "url.monitor.checked": "URL verificada sob demanda",
  "platform.payment.updated": "Configuração de pagamento alterada",
  "platform.payment.tested": "Credencial de pagamento verificada",
  "billing.subscription.canceled": "Assinatura cancelada",
  "platform.plan.created": "Plano criado",
  "platform.plan.updated": "Plano atualizado",
  "platform.plan.published": "Preço publicado para novas assinaturas",
  "platform.workspace.updated": "Workspace alterado pelo administrador geral",
  "platform.organization.created": "Cliente criado pelo administrador geral",
  "platform.organization.updated": "Cliente alterado pelo administrador geral",
  "platform.member.invited": "Usuário convidado pelo administrador geral",
  "platform.member.updated": "Acesso alterado pelo administrador geral",
  "platform.member.removed": "Acesso removido pelo administrador geral",
  "team.invited": "Membro convidado",
  "team.removed": "Membro removido",
  "alert.acknowledged": "Alerta reconhecido",
  "platform.branding.updated": "Identidade visual alterada",
  "platform.branding.reset": "Identidade visual restaurada",
  "user.language.updated": "Idioma alterado",
  "account.created": "Conta criada",
  "access.denied": "Acesso negado",
  "chat.cleared": "Conversa limpa",
  "chat.restored": "Conversa restaurada",
  "assistant.command.plan": "Comando preparado pela IA",
  "assistant.live.requested": "Verificação no servidor solicitada",
  "assistant.live.used": "Verificação analisada pelo assistente",
  "assistant.ai": "Resposta da IA gerada",
  "assistant.diagnostic": "Diagnóstico básico gerado",
  "assistant.logs.included": "Resumo de logs incluído na análise",
  "assistant.processes.included": "Processos incluídos na análise",
  "action.proposed": "Ação preparada",
  "action.approved": "Execução aprovada",
  "action.rejected": "Ação rejeitada",
  "action.finished": "Execução encerrada",
  "configuration.inspected": "Configuração consultada",
  "configuration.proposed": "Alteração de configuração preparada",
  "ssh.configured": "Conexão SSH configurada",
  "ssh.removed": "Conexão SSH removida",
  "ssh.tested": "Conexão SSH testada",
  "ssh.bootstrap.authorized": "Cadastro automático SSH autorizado",
  "ssh.bootstrap.completed": "Cadastro automático SSH concluído",
  "command.proposed": "Comando preparado",
  "processes.local.requested": "Consulta de processos solicitada",
  "logs.local.requested": "Verificação local de logs solicitada",
  "logs.read": "Logs consultados",
  "monitor.updated": "Monitoramento alterado",
  "rules.updated": "Regras de alerta alteradas",
  "agent.revoked": "Acesso do agente revogado",
  "agent.enrollment.renewed": "Token de instalação renovado",
  "server.created": "Servidor cadastrado",
  "server.archived": "Servidor arquivado",
  "organization.created": "Cliente cadastrado",
  "member.removed": "Membro removido",
  "invite.created": "Convite criado",
  "invite.accepted": "Convite aceito",
  "mcp.token.created": "Token MCP criado",
  "mcp.token.revoked": "Token MCP revogado",
  "ai.provider.saved": "Provedor de IA configurado",
  "ai.provider.removed": "Chave de IA removida",
  "ai.provider.tested": "Conexão do provedor testada",
  "ai.preference.updated": "Preferência de IA alterada",
  "billing.checkout": "Checkout iniciado",
  "billing.portal": "Portal de cobrança acessado",
  "query.list_organizations": "Clientes consultados",
  "query.list_servers": "Servidores consultados",
  "query.get_server_health": "Saúde do servidor consultada",
  "query.query_metrics": "Histórico de métricas consultado",
  "query.list_alerts": "Alertas consultados",
  "query.get_service_status": "Estado dos serviços consultado",
  "query.get_service_logs": "Resumos de logs consultados",
  "query.get_local_log_checks": "Verificações de logs consultadas",
  "query.get_process_snapshots": "Coletas de processos consultadas",
  "query.request_process_snapshot": "Consulta de processos solicitada via MCP",
  "query.request_local_log_check": "Verificação de logs solicitada via MCP",
  "query.propose_service_action": "Ação preparada via MCP",
};
export type AuditCategory = "changes" | "checks" | "access";
export const auditCategory = (action: string): AuditCategory =>
  action === "access.denied" ||
  action.startsWith("ssh.") ||
  action.startsWith("mcp.") ||
  action.startsWith("team.") ||
  action.startsWith("member.") ||
  action.startsWith("invite.")
    ? "access"
    : action.startsWith("query.") ||
        action.startsWith("assistant.") ||
        action.startsWith("logs.") ||
        action.startsWith("processes.") ||
        action === "configuration.inspected"
      ? "checks"
      : "changes";
export type AuditEvent = {
  id: string;
  action: string;
  target: string | null;
  created_at: number;
  user_id: string;
  actor_name: string | null;
  actor_email: string | null;
  resource_name: string | null;
  category: AuditCategory;
};
export type AuditPage = {
  events: AuditEvent[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  actors: { id: string; name: string; email: string }[];
};
