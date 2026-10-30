import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import nodemailer from "nodemailer";
import { APIError } from "./store.ts";
import { now, type Platform, type Principal } from "./platform.ts";
import { AISettings } from "./ai-settings.ts";
import { publicAddress } from "./url-probe.ts";
import {
  notificationChannels,
  notificationKinds,
  notificationDefaults,
  type NotificationChannel,
  type NotificationConfig,
  type NotificationSettings,
} from "../shared/notifications.ts";

type Sender = (
  channel: NotificationChannel,
  config: NotificationConfig,
  message: string,
) => Promise<void>;
export class Notifications {
  platform: Platform;
  vault: AISettings;
  sender: Sender;
  constructor(
    platform: Platform,
    vault = new AISettings(platform),
    sender?: Sender,
  ) {
    this.platform = platform;
    this.vault = vault;
    this.sender =
      sender ??
      ((channel, config, message) => this.send(channel, config, message));
    const db = platform.store.db;
    db.exec(`CREATE TABLE IF NOT EXISTS notification_channels(organization TEXT NOT NULL REFERENCES organizations(id),channel TEXT NOT NULL,config TEXT NOT NULL, PRIMARY KEY(organization,channel));
      CREATE TABLE IF NOT EXISTS notification_deliveries(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,organization TEXT NOT NULL,channel TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,last_error TEXT, UNIQUE(event_id,organization,channel));
      CREATE INDEX IF NOT EXISTS notification_due ON notification_deliveries(status,next_at);`);
    if (
      !(
        db.prepare("PRAGMA table_info(outbox)").all() as { name: string }[]
      ).some((c) => c.name === "notifications_scanned")
    ) {
      db.exec(
        "ALTER TABLE outbox ADD COLUMN notifications_scanned INTEGER NOT NULL DEFAULT 0; UPDATE outbox SET notifications_scanned=1;",
      );
    }
  }
  private authorize(p: Principal, org: string) {
    this.platform.requireRole(p, ["owner", "admin"]);
    this.platform.authorizeOrg(p, org);
  }
  private read(org: string, channel: NotificationChannel): NotificationConfig {
    const row = this.platform.store.db
      .prepare(
        "SELECT config FROM notification_channels WHERE organization=? AND channel=?",
      )
      .get(org, channel) as { config: string } | undefined;
    return row
      ? JSON.parse(
          this.vault.reveal(org, `notification:${channel}`, row.config),
        )
      : notificationDefaults();
  }
  settings(p: Principal, org: string): NotificationSettings {
    this.authorize(p, org);
    const channels = {} as NotificationSettings["channels"];
    for (const channel of notificationChannels) {
      const config = this.read(org, channel);
      const { token, password, ...safe } = config;
      channels[channel] = { ...safe, hasSecret: !!(token || password) };
    }
    return {
      channels,
      deliveries: this.platform.store.db
        .prepare(
          "SELECT id,channel,status,attempts,created_at,last_error FROM notification_deliveries WHERE organization=? ORDER BY created_at DESC,rowid DESC LIMIT 20",
        )
        .all(org) as NotificationSettings["deliveries"],
    };
  }
  save(
    p: Principal,
    org: string,
    channel: string,
    input: Record<string, unknown>,
  ) {
    this.authorize(p, org);
    if (!notificationChannels.includes(channel as NotificationChannel))
      throw new APIError(400, "Canal inválido.");
    const kind = channel as NotificationChannel;
    const old = this.read(org, kind),
      config = notificationDefaults();
    for (const key of ["enabled", "opening", "recovery"] as const) {
      if (typeof input[key] !== "boolean")
        throw new APIError(400, "Configuração de notificações inválida.");
      config[key] = input[key];
    }
    if (
      !Array.isArray(input.kinds) ||
      input.kinds.some((k) => !notificationKinds.includes(k))
    )
      throw new APIError(400, "Tipos de alerta inválidos.");
    config.kinds = [...new Set(input.kinds)] as string[];
    const fields =
      kind === "telegram"
        ? ["token", "chatId"]
        : kind === "whatsapp"
          ? [
              "token",
              "phoneId",
              "recipient",
              "template",
              "language",
              "apiVersion",
            ]
          : ["host", "port", "user", "password", "from", "to"];
    for (const key of fields) {
      const value = input[key];
      if (
        value != null &&
        (typeof value !== "string" ||
          value.length > 2000 ||
          /[\r\n\0]/.test(value))
      )
        throw new APIError(400, "Campo de notificação inválido.");
      const text = typeof value === "string" ? value.trim() : "";
      Object.assign(config, {
        [key]:
          (key === "token" || key === "password") && !text
            ? (old[key] ?? "")
            : text,
      });
    }
    if (config.enabled) {
      if (!config.kinds.length || (!config.opening && !config.recovery))
        throw new APIError(400, "Selecione os alertas que deseja receber.");
      if (
        kind === "telegram" &&
        (!/^\d+:[A-Za-z0-9_-]+$/.test(config.token ?? "") ||
          !/^(-?\d+|@[A-Za-z0-9_]+)$/.test(config.chatId ?? ""))
      )
        throw new APIError(400, "Informe o token do bot e o ID do chat.");
      if (
        kind === "whatsapp" &&
        (!config.token ||
          !/^\d+$/.test(config.phoneId ?? "") ||
          !/^\d{8,15}$/.test(config.recipient ?? "") ||
          !/^[a-z0-9_]+$/.test(config.template ?? "") ||
          !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(config.language ?? "") ||
          !/^v\d{2}\.0$/.test(config.apiVersion ?? ""))
      )
        throw new APIError(400, "Confira os dados do WhatsApp Business.");
      const email = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;
      if (
        kind === "email" &&
        (!/^[a-zA-Z0-9.-]+$/.test(config.host ?? "") ||
          !["465", "587"].includes(config.port ?? "") ||
          !config.user ||
          !config.password ||
          !email.test(config.from ?? "") ||
          !config.to ||
          config.to.split(",").length > 10 ||
          config.to.split(",").some((e) => !email.test(e.trim())))
      )
        throw new APIError(400, "Confira o SMTP e os endereços de e-mail.");
    }
    const encrypted = this.vault.protect(
      org,
      `notification:${kind}`,
      JSON.stringify(config),
    );
    this.platform.store.db
      .prepare(
        "INSERT INTO notification_channels VALUES (?,?,?) ON CONFLICT(organization,channel) DO UPDATE SET config=excluded.config",
      )
      .run(org, kind, encrypted);
    if (!config.enabled)
      this.platform.store.db
        .prepare(
          "UPDATE notification_deliveries SET status='canceled',lease_until=0 WHERE organization=? AND channel=? AND status='pending'",
        )
        .run(org, kind);
    this.platform.audit(p, "notification.settings.updated", `${org}:${kind}`);
    return this.settings(p, org);
  }
  async test(p: Principal, org: string, channel: string) {
    this.authorize(p, org);
    if (!notificationChannels.includes(channel as NotificationChannel))
      throw new APIError(400, "Canal inválido.");
    const config = this.read(org, channel as NotificationChannel);
    if (!config.enabled)
      throw new APIError(400, "Salve e habilite o canal antes de testar.");
    const name = this.platform.organizations(p).find((o) => o.id === org)!.name;
    try {
      await this.sender(
        channel as NotificationChannel,
        config,
        `Teste de notificação — ${name}. O canal está configurado.`,
      );
    } catch {
      throw new APIError(
        502,
        "O provedor recusou o envio ou não respondeu. Confira as credenciais e o destinatário.",
      );
    }
    this.platform.audit(p, "notification.test.sent", `${org}:${channel}`);
    return { ok: true };
  }
  private async send(
    channel: NotificationChannel,
    c: NotificationConfig,
    message: string,
  ) {
    if (channel === "email") {
      const addresses = await lookup(c.host!, { all: true });
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw new Error("smtp-host");
      const transport = nodemailer.createTransport({
        host: addresses[0].address,
        port: Number(c.port),
        secure: c.port === "465",
        requireTLS: true,
        tls: { servername: c.host, rejectUnauthorized: true },
        auth: { user: c.user!, pass: c.password! },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      try {
        await transport.sendMail({
          from: c.from,
          to: c.to,
          subject: "Monitoramento: notificação",
          text: message,
        });
      } finally {
        transport.close();
      }
      return;
    }
    const url =
      channel === "telegram"
        ? `https://api.telegram.org/bot${c.token}/sendMessage`
        : `https://graph.facebook.com/${c.apiVersion}/${c.phoneId}/messages`;
    const body =
      channel === "telegram"
        ? { chat_id: c.chatId, text: message }
        : {
            messaging_product: "whatsapp",
            to: c.recipient,
            type: "template",
            template: {
              name: c.template,
              language: { code: c.language },
              components: [
                { type: "body", parameters: [{ type: "text", text: message }] },
              ],
            },
          };
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        ...(channel === "whatsapp"
          ? { Authorization: `Bearer ${c.token}` }
          : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("provider");
    }
    const result = (await response.json()) as {
      ok?: boolean;
      messages?: unknown[];
    };
    if (channel === "telegram" ? result.ok !== true : !result.messages?.length)
      throw new Error("provider");
  }
  async tick() {
    const db = this.platform.store.db;
    for (const row of db
      .prepare(
        "SELECT id,payload FROM outbox WHERE notifications_scanned=0 LIMIT 100",
      )
      .all() as { id: string; payload: string }[]) {
      const event = JSON.parse(row.payload) as Record<string, unknown>;
      // Derive organization from authoritative records, never a recipient or organization supplied in an event.
      const url = String(event.event).startsWith("url.alert.");
      const predictive = String(event.event).startsWith("predictive.alert.");
      const process = String(event.event).startsWith("process.");
      const target = (
        process
          ? db.prepare(
              "SELECT s.organization,s.name FROM process_incidents a JOIN servers s ON s.id=a.server_id WHERE a.id=?",
            )
          : predictive
            ? db.prepare(
                "SELECT s.organization,s.name FROM predictive_findings a JOIN servers s ON s.id=a.server_id WHERE a.id=?",
              )
            : url
              ? db.prepare(
                  "SELECT m.organization,m.name FROM url_incidents a JOIN url_monitors m ON m.id=a.monitor_id WHERE a.id=?",
                )
              : db.prepare(
                  "SELECT s.organization,s.name FROM alerts a JOIN servers s ON s.id=a.server_id WHERE a.id=?",
                )
      ).get(String(event.alert_id ?? "")) as
        { organization: string; name: string } | undefined;
      if (
        target &&
        [
          "alert.opened",
          "alert.resolved",
          "url.alert.opened",
          "url.alert.resolved",
          "predictive.alert.opened",
          "predictive.alert.resolved",
          "process.alert.opened",
          "process.alert.resolved",
          "process.summary.ready",
          "service.summary.ready",
        ].includes(String(event.event))
      ) {
        const recovery = String(event.event).endsWith(".resolved"),
          kind = process
            ? "process"
            : predictive
              ? "predictive"
              : url
                ? "url"
                : String(event.kind).startsWith("service:")
                  ? "service"
                  : String(event.kind);
        const org = db
          .prepare("SELECT name FROM organizations WHERE id=?")
          .get(target.organization) as { name: string };
        const summaryEvent = String(event.event).endsWith(".summary.ready");
        const message = `${summaryEvent ? (event.source === "basic" ? "RESUMO TÉCNICO" : "RESUMO IA") : recovery ? "RECUPERADO" : "ALERTA"} — ${org.name}\n${target.name}\n${kind}${event.message ? ": " + String(event.message).slice(0, summaryEvent ? 2200 : 1000) : ""}\n${new Date(Number(event.at) * 1000).toISOString()}`;
        for (const channel of notificationChannels) {
          const c = this.read(target.organization, channel);
          if (
            c.enabled &&
            c.kinds.includes(kind) &&
            (recovery ? c.recovery : c.opening)
          )
            db.prepare(
              "INSERT OR IGNORE INTO notification_deliveries(id,event_id,organization,channel,message,next_at,created_at) VALUES (?,?,?,?,?,?,?)",
            ).run(
              randomUUID(),
              row.id,
              target.organization,
              channel,
              message,
              now(),
              now(),
            );
        }
      }
      db.prepare("UPDATE outbox SET notifications_scanned=1 WHERE id=?").run(
        row.id,
      );
    }
    const rows = db
      .prepare(
        "SELECT * FROM notification_deliveries WHERE status='pending' AND next_at<=? AND lease_until<=? AND attempts<8 LIMIT 20",
      )
      .all(now(), now()) as {
      id: string;
      organization: string;
      channel: NotificationChannel;
      message: string;
      attempts: number;
    }[];
    await Promise.all(
      rows.map(async (row) => {
        if (
          !db
            .prepare(
              "UPDATE notification_deliveries SET lease_until=? WHERE id=? AND lease_until<=? AND status='pending'",
            )
            .run(now() + 120, row.id, now()).changes
        )
          return;
        try {
          const c = this.read(row.organization, row.channel);
          if (!c.enabled) {
            db.prepare(
              "UPDATE notification_deliveries SET status='canceled',lease_until=0 WHERE id=?",
            ).run(row.id);
            return;
          }
          await this.sender(row.channel, c, row.message);
          db.prepare(
            "UPDATE notification_deliveries SET status='sent',attempts=attempts+1,lease_until=0,last_error=NULL WHERE id=?",
          ).run(row.id);
        } catch {
          db.prepare(
            "UPDATE notification_deliveries SET status=?,attempts=attempts+1,next_at=?,lease_until=0,last_error=? WHERE id=?",
          ).run(
            row.attempts >= 7 ? "failed" : "pending",
            now() + Math.min(3600, 30 * 2 ** row.attempts),
            "Falha no envio. Confira o canal e o destinatário.",
            row.id,
          );
        }
      }),
    );
    db.prepare(
      "DELETE FROM notification_deliveries WHERE created_at<? AND status!='pending'",
    ).run(now() - 30 * 86400);
  }
}
