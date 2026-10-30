export type PublicDashboardMode = "none" | "all" | "selected";
export type PublicDashboardConfig = {
  id: string;
  title: string;
  enabled: boolean;
  servers: PublicDashboardMode;
  server_ids: string[];
  urls: PublicDashboardMode;
  url_ids: string[];
  show_metrics: boolean;
  show_addresses: boolean;
  link: string;
};
export type PublicDashboardCard = {
  key: string;
  kind: "server" | "url";
  name: string;
  status: "up" | "down" | "pending" | "paused";
  updated_at: number | null;
  metrics?: { cpu: number | null; memory: number | null; disk: number | null };
  address?: string;
  latency_ms?: number | null;
  uptime_percent?: number | null;
  history?: { at: number; ok: boolean; latency_ms: number }[];
};
export type PublicDashboardSnapshot = {
  title: string;
  generated_at: number;
  refresh_seconds: number;
  total: number;
  page: number;
  pages: number;
  items: PublicDashboardCard[];
  summary: {
    up: number;
    down: number;
    pending: number;
    paused: number;
    servers: number;
    urls: number;
  };
};
