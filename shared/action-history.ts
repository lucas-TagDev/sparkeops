export type RemediationAction = {
  id: string;
  service: string;
  action: string;
  reason: string;
  status: string;
  created_at: number;
  finished_at: number | null;
  operator_command?: string | null;
  configuration?: string | null;
  commands?: string;
  output?: string | null;
};
export type ActionHistoryPage = {
  items: RemediationAction[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  pending: number;
};
export const actionStatuses: Record<string, string> = {
  canceled: "Cancelada",
  replaced: "Substituída por edição",
  pending: "Aguardando aprovação",
  expired: "Expirada",
  executing: "Executando",
  succeeded: "Concluído",
  failed: "Falhou",
  unknown: "Resultado indeterminado",
  rejected: "Rejeitado",
  rolled_back: "Restaurado após falha",
  rollback_failed: "Verifique a restauração e o serviço",
};
