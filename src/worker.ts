import { ServiceRecovery } from "./service-recovery.ts";
import { PlatformEmail } from "./platform-email.ts";
import { BrandingSettings } from "./branding.ts";
import { URLMonitoring } from "./url-monitors.ts";
import { Notifications } from "./notifications.ts";
import { Observability } from "./observability.ts";
import { Runbooks } from "./runbooks.ts";
import { Operations } from "./operations.ts";
import { ProcessMonitoring } from "./process-monitoring.ts";
import { ServiceMonitoring } from "./service-monitoring.ts";
import type { AIConfig } from "./assistant.ts";
import { AISettings, type VaultOptions } from "./ai-settings.ts";
import { now } from "./platform.ts";
import type { Platform } from "./platform.ts";

export function startWorker(
  platform: Platform,
  webhook?: string,
  vaultOptions?: VaultOptions,
  aiConfig: AIConfig = {},
) {
  const urls = new URLMonitoring(platform);
  const vault = new AISettings(platform, vaultOptions);
  const platformEmail = new PlatformEmail(
    platform,
    vault,
    new BrandingSettings(platform),
    process.env.PUBLIC_URL ?? "http://localhost:8080",
  );
  const processes = new ProcessMonitoring(platform, vault, aiConfig);
  const services = new ServiceMonitoring(platform, vault, aiConfig);
  let summaryRunning = false;
  const observability = new Observability(platform);
  const runbooks = new Runbooks(platform, new Operations(platform, vault));
  const serviceRecovery = new ServiceRecovery(
    platform,
    new Operations(platform, vault),
    vault,
    aiConfig,
  );
  let runbooksRunning = false;
  const notifications = new Notifications(
    platform,
    new AISettings(platform, vaultOptions),
  );
  let notificationRunning = false;
  let urlRunning = false;
  let running = false,
    cycles = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      platform.evaluate();
      void serviceRecovery
        .tick(false)
        .catch(() =>
          console.error("Falha no ciclo de correção imediata de serviços."),
        );
      void serviceRecovery
        .reports()
        .catch(() => console.error("Falha no resumo de correção imediata."));
      void platformEmail
        .tick()
        .catch(() =>
          console.error("Falha no envio dos e-mails da plataforma."),
        );
      if (!summaryRunning) {
        summaryRunning = true;
        void Promise.all([processes.summaries(), services.summaries()])
          .catch(() =>
            console.error("Falha ao resumir incidentes de processos."),
          )
          .finally(() => {
            summaryRunning = false;
          });
      }
      if (cycles % 20 === 0) observability.evaluate();
      if (!runbooksRunning) {
        runbooksRunning = true;
        void runbooks
          .tick()
          .catch(() => console.error("Falha no ciclo de runbooks."))
          .finally(() => {
            runbooksRunning = false;
          });
      }
      if (!notificationRunning) {
        notificationRunning = true;
        void notifications
          .tick()
          .catch(() =>
            console.error("Falha no ciclo de notificações; será repetido."),
          )
          .finally(() => {
            notificationRunning = false;
          });
      }
      if (!urlRunning) {
        urlRunning = true;
        void urls
          .tick()
          .catch(() => console.error("Falha no ciclo de URLs; será repetido."))
          .finally(() => {
            urlRunning = false;
          });
      }

      if (++cycles % 240 === 0) {
        platform.cleanup();
        urls.cleanup();
        observability.cleanup();
      }
      if (webhook) {
        // URL is operator-controlled configuration, never supplied by an agent or a customer.
        const url = new URL(webhook);
        if (url.protocol !== "https:")
          throw new Error("ALERT_WEBHOOK_URL precisa usar HTTPS.");
        const rows = platform.store.db
          .prepare(
            "SELECT id,payload,attempts FROM outbox WHERE delivered_at IS NULL AND next_at<=? AND attempts<8 LIMIT 10",
          )
          .all(now()) as { id: string; payload: string; attempts: number }[];
        for (const row of rows) {
          try {
            const response = await fetch(url, {
              method: "POST",
              redirect: "error",
              headers: { "Content-Type": "application/json" },
              body: row.payload,
              signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) throw new Error("delivery");
            platform.store.db
              .prepare("UPDATE outbox SET delivered_at=? WHERE id=?")
              .run(now(), row.id);
          } catch {
            platform.store.db
              .prepare(
                "UPDATE outbox SET attempts=attempts+1,next_at=? WHERE id=?",
              )
              .run(now() + Math.min(3600, 30 * 2 ** row.attempts), row.id);
          }
        }
      }
    } catch {
      console.error(
        "O ciclo de monitoramento encontrou uma falha; será repetido.",
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, 15000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
