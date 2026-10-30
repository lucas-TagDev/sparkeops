export type URLMonitor = {
  id: string;
  organization: string;
  organization_name: string;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  interval_seconds: number;
  timeout_seconds: number;
  expected_status: number;
  failure_threshold: number;
  enabled: number;
  status: "pending" | "up" | "down" | "paused";
  last_checked: number | null;
  last_status: number | null;
  latency_ms: number | null;
  last_error: string | null;
  next_check: number;
  version: number;
  uptime_percent: number | null;
  checks: number;
};
export type URLCheck = {
  id: string;
  checked_at: number;
  ok: number;
  status_code: number | null;
  latency_ms: number;
  error: string | null;
};
export type URLIncident = {
  id: string;
  opened_at: number;
  resolved_at: number | null;
  message: string;
  resolution?: string | null;
};
export type URLPage = {
  items: URLMonitor[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  used: number;
};
export type URLDetails = {
  monitor: URLMonitor;
  checks: URLCheck[];
  incidents: URLIncident[];
  range_hours: number;
};
