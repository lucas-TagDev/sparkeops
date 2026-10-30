export type ProcessRule = {
  id: string;
  name: string;
  user: string;
  service: string;
  min_count: number;
  cpu_limit: number | null;
  memory_limit: number | null;
  duration: number;
  alert_restarts: number | boolean;
  ai_summary: number | boolean;
  enabled: number | boolean;
  revision: number;
  last_received: number | null;
  latest: string | null;
};
export type ProcessIncident = {
  id: string;
  rule_id: string;
  name: string;
  opened_at: number;
  resolved_at: number | null;
  message: string;
  summary: string | null;
  summary_mode: string;
};
export type ProcessMonitoringPage = {
  rules: ProcessRule[];
  incidents: ProcessIncident[];
};
