export const notificationChannels = ["telegram", "whatsapp", "email"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];
export const notificationKinds = [
  "process",
  "predictive",
  "offline",
  "cpu",
  "memory",
  "disk",
  "service",
  "url",
] as const;
export type NotificationConfig = {
  enabled: boolean;
  opening: boolean;
  recovery: boolean;
  kinds: string[];
  token?: string;
  chatId?: string;
  phoneId?: string;
  recipient?: string;
  template?: string;
  language?: string;
  apiVersion?: string;
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  from?: string;
  to?: string;
};
export type NotificationSettings = {
  channels: Record<
    NotificationChannel,
    NotificationConfig & { hasSecret: boolean }
  >;
  deliveries: {
    id: string;
    channel: string;
    status: string;
    attempts: number;
    created_at: number;
    last_error: string | null;
  }[];
};
export const notificationDefaults = (): NotificationConfig => ({
  enabled: false,
  opening: true,
  recovery: true,
  kinds: [...notificationKinds],
});
