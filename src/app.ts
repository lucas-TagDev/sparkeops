import { Turnstile } from "./turnstile.ts";
import { StripeSettings } from "./stripe-settings.ts";
import { ServiceRecovery } from "./service-recovery.ts";
import { PlatformEmail } from "./platform-email.ts";
import { URLMonitoring, type URLProbe } from "./url-monitors.ts";
import { MercadoPagoBilling } from "./mercadopago.ts";
import { PlatformAdministration } from "./platform-admin.ts";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { APIError, Store } from "./store.ts";
import { Platform, hash, now } from "./platform.ts";
import type { Principal } from "./platform.ts";
import { handleMCP } from "./mcp.ts";
import { askAssistant } from "./assistant.ts";
import type { AIConfig } from "./assistant.ts";
import { Billing } from "./billing.ts";
import type { BillingConfig } from "./billing.ts";
import { AISettings } from "./ai-settings.ts";
import { Notifications } from "./notifications.ts";
import { Observability } from "./observability.ts";
import { Runbooks } from "./runbooks.ts";
import { ProcessMonitoring } from "./process-monitoring.ts";
import { ServiceMonitoring } from "./service-monitoring.ts";
import { TerminalGateway } from "./terminal.ts";
import { alertHistory } from "./alert-history.ts";
import { HistoricalInvestigation } from "./historical-investigation.ts";
import type { VaultOptions } from "./ai-settings.ts";
import { Operations } from "./operations.ts";
import { AgentTasks } from "./agent-tasks.ts";
import { ConfigEdits } from "./config-edits.ts";
import { CommandAgent } from "./command-agent.ts";
import { translate } from "../shared/translate.ts";
import { BrandingSettings } from "./branding.ts";
import type { SSHExecutor } from "./operations.ts";

export type AppOptions = {
  urlProbe?: URLProbe;
  mercadoPagoFetch?: typeof fetch;
  stripeSettingsFetch?: typeof fetch;
  turnstileFetch?: typeof fetch;
  platformAdmins?: string[];
  origin?: string;
  ai?: AIConfig;
  billing?: BillingConfig;
  trustProxy?: boolean;
  webhookConfigured?: boolean;
  aiVault?: VaultOptions;
  sshExecutor?: SSHExecutor;
};
export function createApp(
  store: Store,
  adminToken?: string,
  options: AppOptions = {},
) {
  if (options.origin)
    options = { ...options, origin: new URL(options.origin).origin };
  if (adminToken !== undefined && adminToken.length < 32)
    throw new Error("Defina FOXOPS_ADMIN_TOKEN com pelo menos 32 caracteres.");
  const platform = new Platform(store),
    app = express();
  const urlMonitoring = new URLMonitoring(platform, options.urlProbe);
  const branding = new BrandingSettings(platform, options.platformAdmins);
  const administration = new PlatformAdministration(platform, branding);
  const aiSettings = new AISettings(platform, options.aiVault);
  const platformEmail = new PlatformEmail(
    platform,
    aiSettings,
    branding,
    options.origin ?? "http://localhost:8080",
  );
  const turnstile = new Turnstile(
    platform,
    aiSettings,
    administration,
    options.origin ?? options.billing?.origin ?? "http://localhost:8080",
    options.turnstileFetch,
  );
  const notifications = new Notifications(platform, aiSettings);
  const operations = new Operations(platform, aiSettings, options.sshExecutor);
  const serviceRecovery = new ServiceRecovery(
    platform,
    operations,
    aiSettings,
    options.ai,
  );
  const historicalInvestigation = new HistoricalInvestigation(platform);
  const terminalGateway = new TerminalGateway(
    platform,
    operations,
    options.origin,
  );
  const processMonitoring = new ProcessMonitoring(
    platform,
    aiSettings,
    options.ai,
  );
  const serviceMonitoring = new ServiceMonitoring(
    platform,
    aiSettings,
    options.ai,
  );
  const observability = new Observability(platform);
  const runbooks = new Runbooks(platform, operations);
  const agentTasks = new AgentTasks(platform, operations);
  const configEdits = new ConfigEdits(platform, operations);
  const commandAgent = new CommandAgent(
    platform,
    operations,
    aiSettings,
    options.ai ?? {},
  );
  const platformAI = !!(options.ai?.key && options.ai?.model);
  const billing = new Billing(
    options.billing ?? { origin: options.origin ?? "http://localhost:8080" },
  );
  const mercadoPago = new MercadoPagoBilling(
    platform,
    aiSettings,
    administration,
    options.billing?.origin ?? options.origin ?? "http://localhost:8080",
    options.mercadoPagoFetch,
  );
  const stripeSettings = new StripeSettings(
    platform,
    aiSettings,
    administration,
    billing,
    options.stripeSettingsFetch,
  );
  const planManagement = () => {
    const result = billing.management(platform);
    return {
      ...result,
      mercadoPagoConfigured: mercadoPago.configured(),
      plans: result.plans.map((plan) => ({
        ...plan,
        checkoutReady: plan.checkoutReady || mercadoPago.ready(plan.id),
      })),
    };
  };
  platform.catalog.bindLegacy(options.billing?.prices ?? {});
  app.disable("x-powered-by");
  if (options.trustProxy) app.set("trust proxy", 1);
  const rates = new Map<string, { count: number; until: number }>();
  function limit(key: string, max: number, seconds = 60) {
    if (rates.size > 10000)
      for (const [k, value] of rates) if (value.until < now()) rates.delete(k);
    const row = rates.get(key);
    if (!row || row.until < now()) {
      rates.set(key, { count: 1, until: now() + seconds });
      return;
    }
    if (++row.count > max)
      throw new APIError(
        429,
        "Muitas solicitaÃ§Ãµes. Aguarde um pouco e tente novamente.",
      );
  }
  const cookieToken = (req: Request) =>
    (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("foxops_session="))
      ?.slice(15) ?? "";
  const principal = (req: Request) => platform.session(cookieToken(req));
  const origin = (req: Request) =>
    options.origin ?? `${req.protocol}://${req.headers.host}`;
  const setCookie = (
    req: Request,
    res: Response,
    token: string,
    maxAge = 7 * 86400,
  ) =>
    res.setHeader(
      "Set-Cookie",
      `foxops_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${origin(req).startsWith("https:") ? "; Secure" : ""}`,
    );
  const body = (req: Request): Record<string, unknown> => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      throw new APIError(400, "O corpo deve ser um objeto JSON.");
    return req.body;
  };
  app.use((req, res, next) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      if (req.path.startsWith("/api") || req.path === "/mcp")
        res.setHeader("Cache-Control", "no-store");
      const allowedHost = options.origin
        ? new URL(options.origin).host
        : undefined;
      if (
        allowedHost
          ? req.headers.host !== allowedHost
          : !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
              req.headers.host ?? "",
            )
      )
        throw new APIError(403, "Host nÃ£o permitido. Configure PUBLIC_URL.");
      if (req.headers.origin && req.headers.origin !== origin(req))
        throw new APIError(403, "Origem nÃ£o permitida.");
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
        req.path.startsWith("/api/v1") &&
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw new APIError(403, "Origem nÃ£o permitida.");
      next();
    } catch (error) {
      next(error);
    }
  });
  app.post(
    "/api/billing/mercadopago/webhook",
    express.json({ limit: "64kb" }),
    async (req, res) => {
      await mercadoPago.webhook(
        String(req.query["data.id"] ?? ""),
        String(req.headers["x-request-id"] ?? ""),
        String(req.headers["x-signature"] ?? ""),
        body(req),
      );
      res.json({ received: true });
    },
  );
  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
      await billing.webhook(
        platform,
        req.body,
        String(req.headers["stripe-signature"] ?? ""),
      );
      res.json({ received: true });
    },
  );
  app.use("/api/metrics", express.json({ limit: "512kb", strict: false }));
  app.use(
    "/api/agent/process-watch",
    express.json({ limit: "128kb", strict: true }),
  );
  app.use(
    "/api/telemetry/v1/traces",
    express.json({ limit: "256kb", strict: true }),
  );
  app.use(
    "/api/v1/platform/branding",
    express.json({ limit: "1500kb", strict: false }),
  );
  app.use(
    "/api/agent/live-checks",
    express.json({ limit: "256kb", strict: false }),
  );
  app.use(express.json({ limit: "32kb", strict: false }));
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.post("/api/telemetry/v1/traces", (req, res) => {
    const token = String(req.headers.authorization ?? "").replace(
      /^Bearer /,
      "",
    );
    limit("traces:" + hash(token), 30);
    res.json(observability.ingest(token, body(req)));
  });
  app.get("/api/config", (_req, res) => {
    res.json({
      ai: !!(options.ai?.key && options.ai?.model),
      billing: billing.ready(undefined, platform) || mercadoPago.configured(),
      webhook: !!options.webhookConfigured,
    });
  });
  app.get("/api/branding", (_req, res) => res.json(branding.public()));
  app.get("/branding/:kind", (req, res) => {
    if (!["logo", "favicon"].includes(String(req.params.kind)))
      throw new APIError(404, "Imagem nÃ£o encontrada.");
    const asset = branding.asset(req.params.kind as "logo" | "favicon");
    if (!asset) throw new APIError(404, "Imagem nÃ£o encontrada.");
    res.setHeader("Cache-Control", "no-cache");
    res.type(asset.mime).send(Buffer.from(asset.data, "base64"));
  });
  const authRoute =
    (method: "signup" | "login" | "acceptInvite") =>
    async (req: Request, res: Response) => {
      limit("auth:" + req.ip, 15, 900);
      await turnstile.verify(
        method === "login" ? "login" : "signup",
        body(req).captcha_token,
        req.ip,
      );
      const result = platform[method](body(req));
      if (method === "signup") {
        try {
          platformEmail.accountNotice(result.principal.userId, "welcome");
        } catch {
          console.error("NÃ£o foi possÃ­vel preparar o e-mail de boas-vindas.");
        }
      }
      setCookie(req, res, result.token);
      res
        .status(method === "signup" ? 201 : 200)
        .json({ user: result.principal });
    };
  app.post("/api/auth/forgot-password", async (req, res) => {
    limit("recover-ip:" + req.ip, 5, 900);
    limit(
      "recover-email:" + hash(String(body(req).email).trim().toLowerCase()),
      3,
      900,
    );
    await turnstile.verify("forgot_password", body(req).captcha_token, req.ip);
    res.json(platformEmail.forgot(body(req).email));
  });
  app.post("/api/auth/reset-password", async (req, res) => {
    limit("reset:" + req.ip, 10, 900);
    await turnstile.verify("reset_password", body(req).captcha_token, req.ip);
    res.json(platformEmail.reset(body(req)));
  });
  app.post("/api/auth/confirm-email", (req, res) => {
    limit("confirm-email:" + req.ip, 10, 900);
    res.json(platformEmail.confirmEmail(body(req).token));
  });
  app.get("/api/auth/captcha", (_req, res) =>
    res.json(turnstile.publicSettings()),
  );
  app.post("/api/auth/signup", authRoute("signup"));
  app.post("/api/auth/login", authRoute("login"));
  app.post("/api/auth/accept-invite", authRoute("acceptInvite"));
  app.post("/api/auth/logout", (req, res) => {
    platform.logout(cookieToken(req));
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });
  app.post("/api/agent/enroll", (req, res) => {
    limit("enroll:" + req.ip, 30);
    const result = platform.enroll(body(req).token);
    let ssh_bootstrap;
    if (
      body(req).setup_ssh === true &&
      !store.db
        .prepare("SELECT 1 FROM ssh_connections WHERE server_id=?")
        .get(result.server_id)
    )
      ssh_bootstrap = agentTasks.issue(result.server_id);
    res.json({ ...result, ssh_bootstrap });
  });
  app.post("/api/metrics", (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    limit("ingest:" + hash(token), 10);
    const data = body(req);
    if (
      data.details !== undefined &&
      (!data.details ||
        typeof data.details !== "object" ||
        Array.isArray(data.details) ||
        JSON.stringify(data.details).length > 384000)
    )
      throw new APIError(400, "Detalhes invÃ¡lidos.");
    platform.validateAgentSubscription(token);
    const result = store.ingest(token, data.event_id, data.metrics);
    if (result.accepted) {
      platform.recordDetails(token, data.details);
      observability.record(agentTasks.agent(token), data.details);
      platform.evaluate();
    }
    res.json({
      ...result,
      monitor_config: operations.agentConfig(token),
      log_checks: agentTasks.pending(token),
      process_checks: agentTasks.processes.pending(token),
      process_monitors: processMonitoring.config(token),
      live_checks: agentTasks.live.pending(token),
    });
  });
  app.post("/api/agent/ssh-bootstrap", (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    limit("ssh-bootstrap:" + hash(token), 5);
    res.json(agentTasks.bootstrap(token, body(req)));
  });
  app.post("/api/agent/log-checks/:check", (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    limit("log-check:" + hash(token), 10);
    res.json(agentTasks.complete(token, String(req.params.check), body(req)));
  });
  app.post("/api/agent/processes/:check", (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    limit("process-result:" + hash(token), 10);
    res.json(
      agentTasks.processes.complete(token, String(req.params.check), body(req)),
    );
  });
  app.post("/api/agent/logs", (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    limit("logs:" + hash(token), 5);
    res.json(operations.ingestLogs(token, body(req).entries));
  });
  app.all("/api/servers", (req, res) => {
    if (!adminToken)
      throw new APIError(404, "Rota administrativa legada desativada.");
    const expected = Buffer.from("Bearer " + adminToken),
      actual = Buffer.from(req.headers.authorization ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new APIError(401, "Acesso administrativo necessÃ¡rio.");
    if (req.method === "GET") {
      if (typeof req.query.organization !== "string" || !req.query.organization)
        throw new APIError(400, "Informe organization.");
      return res.json({ servers: store.listServers(req.query.organization) });
    }
    if (req.method === "POST") {
      if (Number(req.headers["content-length"]) > 16384)
        throw new APIError(413, "Corpo muito grande.");
      const data = body(req);
      return res.status(201).json(store.register(data.organization, data.name));
    }
    throw new APIError(404, "Rota nÃ£o encontrada.");
  });
  app.use("/api/v1", (req, res, next) => {
    try {
      res.locals.p = principal(req);
      limit("user:" + res.locals.p.userId, 180);
      next();
    } catch (error) {
      next(error);
    }
  });
  const p = (res: Response) => res.locals.p as Principal;
  app.post("/api/v1/assistant/history", (req, res) => {
    limit("history:" + p(res).userId, 5);
    res.json(historicalInvestigation.request(p(res), body(req)));
  });
  app.get("/api/v1/assistant/history/:id", (req, res) =>
    res.json(historicalInvestigation.get(p(res), String(req.params.id))),
  );
  app.get("/api/v1/servers/:id/terminal", (req, res) =>
    res.json(terminalGateway.metadata(p(res), String(req.params.id))),
  );
  app.put("/api/v1/servers/:id/terminal", (req, res) =>
    res.json(
      terminalGateway.enable(p(res), String(req.params.id), body(req).enabled),
    ),
  );
  app.post("/api/v1/servers/:id/terminal/ticket", (req, res) => {
    limit("terminal:" + p(res).userId, 5);
    res.json(
      terminalGateway.ticket(p(res), String(req.params.id), cookieToken(req)),
    );
  });
  app.get("/api/v1/servers/:id/service-watches", (req, res) =>
    res.json(serviceMonitoring.list(p(res), String(req.params.id))),
  );
  app.post("/api/v1/servers/:id/service-watches/bulk", (req, res) =>
    res.json(serviceMonitoring.bulk(p(res), String(req.params.id), body(req))),
  );
  app.put("/api/v1/servers/:id/service-watches/:service", (req, res) =>
    res.json(
      serviceMonitoring.save(
        p(res),
        String(req.params.id),
        String(req.params.service),
        body(req),
      ),
    ),
  );
  app.post("/api/agent/process-watch", (req, res) => {
    const token = String(req.headers.authorization ?? "").replace(
      /^Bearer /,
      "",
    );
    limit("process-watch:" + hash(token), 10);
    res.json(processMonitoring.record(token, body(req)));
  });
  app.get("/api/v1/servers/:id/process-monitors", (req, res) =>
    res.json(processMonitoring.list(p(res), String(req.params.id))),
  );
  app.post("/api/v1/servers/:id/process-monitors", (req, res) =>
    res.json(
      processMonitoring.save(
        p(res),
        String(req.params.id),
        undefined,
        body(req),
      ),
    ),
  );
  app.put("/api/v1/servers/:id/process-monitors/:rule", (req, res) =>
    res.json(
      processMonitoring.save(
        p(res),
        String(req.params.id),
        String(req.params.rule),
        body(req),
      ),
    ),
  );
  app.delete("/api/v1/servers/:id/process-monitors/:rule", (req, res) =>
    res.json(
      processMonitoring.remove(
        p(res),
        String(req.params.id),
        String(req.params.rule),
      ),
    ),
  );
  app.post("/api/v1/servers/:id/runbook-runs/:run/reviewed", (req, res) => {
    runbooks.reviewed(p(res), String(req.params.id), String(req.params.run));
    res.json({ ok: true });
  });
  app.get("/api/v1/servers/:id/observability", (req, res) =>
    res.json(observability.context(p(res), String(req.params.id))),
  );
  app.get("/api/v1/servers/:id/traces/:trace", (req, res) =>
    res.json(
      observability.trace(
        p(res),
        String(req.params.id),
        String(req.params.trace),
      ),
    ),
  );
  app.post("/api/v1/servers/:id/trace-key", (req, res) =>
    res.json(observability.issueKey(p(res), String(req.params.id))),
  );
  app.delete("/api/v1/servers/:id/trace-key", (req, res) => {
    observability.revokeKey(p(res), String(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/v1/servers/:id/runbooks", (req, res) =>
    res.json(runbooks.list(p(res), String(req.params.id))),
  );
  app.post("/api/v1/servers/:id/runbooks/inspect", async (req, res) => {
    limit("runbook-inspect:" + p(res).tenantId, 5);
    res.json(
      await runbooks.inspect(p(res), String(req.params.id), body(req).path),
    );
  });
  app.post("/api/v1/servers/:id/runbooks", (req, res) =>
    res.json(
      runbooks.save(p(res), String(req.params.id), undefined, body(req)),
    ),
  );
  app.put("/api/v1/servers/:id/runbooks/:book", (req, res) =>
    res.json(
      runbooks.save(
        p(res),
        String(req.params.id),
        String(req.params.book),
        body(req),
      ),
    ),
  );
  app.delete("/api/v1/servers/:id/runbooks/:book", (req, res) => {
    runbooks.remove(p(res), String(req.params.id), String(req.params.book));
    res.json({ ok: true });
  });
  app.post("/api/v1/servers/:id/runbooks/:book/request", (req, res) =>
    res.json(
      runbooks.request(p(res), String(req.params.id), String(req.params.book)),
    ),
  );
  app.post("/api/v1/servers/:id/runbook-runs/:run/approve", async (req, res) =>
    res.json(
      await runbooks.execute(
        p(res),
        String(req.params.id),
        String(req.params.run),
      ),
    ),
  );
  app.post("/api/v1/servers/:id/runbook-runs/:run/reject", (req, res) => {
    runbooks.reject(p(res), String(req.params.id), String(req.params.run));
    res.json({ ok: true });
  });
  app.get("/api/v1/platform/ai/endpoints", (_req, res) => {
    administration.authorize(p(res));
    res.json({ origins: aiSettings.endpoints.origins() });
  });
  app.put("/api/v1/platform/ai/endpoints", (req, res) => {
    administration.authorize(p(res));
    const result = platform.transaction(() => {
      const result = aiSettings.endpoints.save(body(req).origins);
      platform.audit(p(res), "platform.ai.endpoints.updated");
      return result;
    });
    res.json(result);
  });
  app.get("/api/v1/platform/security/turnstile", (_req, res) =>
    res.json(turnstile.metadata(p(res))),
  );
  app.put("/api/v1/platform/security/turnstile", (req, res) =>
    res.json(turnstile.save(p(res), body(req))),
  );
  app.post("/api/v1/platform/security/turnstile/test", async (req, res) => {
    administration.authorize(p(res));
    limit("captcha-test:" + p(res).userId, 10);
    await turnstile.verify(
      "settings_test",
      body(req).captcha_token,
      req.ip,
      true,
    );
    res.json({ ok: true });
  });
  app.get("/api/v1/platform/payments/stripe", (_req, res) =>
    res.json(stripeSettings.metadata(p(res))),
  );
  app.put("/api/v1/platform/payments/stripe", (req, res) =>
    res.json(stripeSettings.save(p(res), body(req))),
  );
  app.post("/api/v1/platform/payments/stripe/test", async (_req, res) => {
    limit("stripe-test:" + p(res).userId, 10);
    res.json(await stripeSettings.test(p(res)));
  });
  app.get("/api/v1/platform/payments/mercadopago", (_req, res) =>
    res.json(mercadoPago.metadata(p(res))),
  );
  app.put("/api/v1/platform/payments/mercadopago", (req, res) =>
    res.json(mercadoPago.save(p(res), body(req))),
  );
  app.post("/api/v1/platform/payments/mercadopago/test", async (_req, res) => {
    limit("mp-test:" + p(res).userId, 10);
    res.json(await mercadoPago.test(p(res)));
  });
  app.post("/api/v1/billing/mercadopago/cancel", async (_req, res) =>
    res.json(await mercadoPago.cancel(p(res))),
  );
  app.get("/api/v1/platform/plans", (_req, res) => {
    administration.authorize(p(res));
    res.json(planManagement());
  });
  app.post("/api/v1/platform/plans", (req, res) => {
    administration.authorize(p(res));
    const data = body(req);
    platform.transaction(() => {
      platform.catalog.save(String(data.id ?? ""), data, true);
      platform.audit(p(res), "platform.plan.created", String(data.id));
    });
    res.status(201).json(planManagement());
  });
  app.put("/api/v1/platform/plans/:id", (req, res) => {
    administration.authorize(p(res));
    const id = String(req.params.id);
    platform.transaction(() => {
      platform.catalog.save(id, body(req));
      platform.audit(p(res), "platform.plan.updated", id);
    });
    res.json(planManagement());
  });
  app.post("/api/v1/platform/plans/:id/publish", async (req, res) => {
    administration.authorize(p(res));
    limit("publish-plan:" + p(res).userId, 10);
    res.json(
      await billing.publish(
        platform,
        p(res),
        String(req.params.id),
        body(req).revision,
      ),
    );
  });
  app.get("/api/v1/platform/email", (req, res) =>
    res.json(platformEmail.settings(p(res))),
  );
  app.put("/api/v1/platform/email", (req, res) =>
    res.json(platformEmail.save(p(res), body(req))),
  );
  app.post("/api/v1/platform/email/test", async (req, res) => {
    limit("mail-test:" + p(res).userId, 3, 900);
    res.json(await platformEmail.test(p(res)));
  });
  app.post("/api/v1/me/password", (req, res) => {
    const user = p(res);
    limit("change-password:" + user.userId, 5, 900);
    platformEmail.changePassword(user, body(req));
    const session = platform.newSession(user);
    setCookie(req, res, session.token);
    res.json({ ok: true });
  });
  app.post("/api/v1/me/email", (req, res) => {
    limit("change-email:" + p(res).userId, 3, 900);
    res.json(platformEmail.changeEmail(p(res), body(req)));
  });
  app.get("/api/v1/platform/accounts", (req, res) =>
    res.json(administration.accounts(p(res), req.query)),
  );
  app.patch("/api/v1/platform/users/:user/access", (req, res) => {
    const result = administration.userAccess(
      p(res),
      String(req.params.user),
      body(req),
    );
    if (body(req).password !== undefined) {
      try {
        platformEmail.accountNotice(String(req.params.user), "password");
      } catch {
        console.error(
          "NÃ£o foi possÃ­vel preparar o aviso de alteraÃ§Ã£o de senha.",
        );
      }
    }
    res.json(result);
  });
  app.get("/api/v1/platform/workspaces", (req, res) =>
    res.json(administration.list(p(res), req.query)),
  );
  app.get("/api/v1/platform/workspaces/:id", (req, res) =>
    res.json(administration.details(p(res), String(req.params.id))),
  );
  app.patch("/api/v1/platform/workspaces/:id", (req, res) =>
    res.json(
      administration.rename(p(res), String(req.params.id), body(req).name),
    ),
  );
  app.post("/api/v1/platform/workspaces/:id/organizations", (req, res) =>
    res
      .status(201)
      .json(
        administration.organization(
          p(res),
          String(req.params.id),
          undefined,
          body(req).name,
        ),
      ),
  );
  app.patch(
    "/api/v1/platform/workspaces/:id/organizations/:organization",
    (req, res) =>
      res.json(
        administration.organization(
          p(res),
          String(req.params.id),
          String(req.params.organization),
          body(req).name,
        ),
      ),
  );
  app.post("/api/v1/platform/workspaces/:id/invites", (req, res) =>
    res
      .status(201)
      .json(administration.invite(p(res), String(req.params.id), body(req))),
  );
  app.patch("/api/v1/platform/workspaces/:id/members/:user", (req, res) =>
    res.json(
      administration.member(
        p(res),
        String(req.params.id),
        String(req.params.user),
        body(req),
      ),
    ),
  );
  app.delete("/api/v1/platform/workspaces/:id/members/:user", (req, res) =>
    res.json(
      administration.remove(
        p(res),
        String(req.params.id),
        String(req.params.user),
      ),
    ),
  );
  app.get("/api/v1/platform/branding", (req, res) => {
    branding.authorize(p(res));
    res.json(branding.public());
  });
  app.put("/api/v1/platform/branding", (req, res) => {
    limit("branding:" + p(res).userId, 10);
    res.json(branding.save(p(res), body(req)));
  });
  app.delete("/api/v1/platform/branding", (req, res) =>
    res.json(branding.reset(p(res))),
  );
  app.put("/api/v1/me/language", (req, res) =>
    res.json(platform.setLanguage(p(res), body(req).language)),
  );
  app.post("/api/v1/assistant/operator", async (req, res) => {
    limit("operator:" + p(res).userId, 10);
    res.json(await commandAgent.start(p(res), body(req)));
  });
  app.post("/api/v1/assistant/operator/:id/continue", async (req, res) => {
    limit("operator:" + p(res).userId, 10);
    res.json(await commandAgent.step(p(res), String(req.params.id)));
  });
  app.patch("/api/v1/assistant/operator/:id/actions/:action", (req, res) =>
    res.json(
      commandAgent.edit(
        p(res),
        String(req.params.id),
        String(req.params.action),
        body(req),
      ),
    ),
  );
  app.post(
    "/api/v1/assistant/operator/:id/actions/:action/cancel",
    (req, res) =>
      res.json(
        commandAgent.cancel(
          p(res),
          String(req.params.id),
          String(req.params.action),
        ),
      ),
  );
  app.post("/api/v1/assistant/checks", (req, res) => {
    limit("live:" + p(res).userId, 5);
    res.status(201).json(agentTasks.live.request(p(res), body(req)));
  });
  app.get("/api/v1/assistant/checks/:id", (req, res) =>
    res.json(agentTasks.live.get(p(res), String(req.params.id))),
  );
  app.post("/api/agent/live-checks/:id", (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    res.json(agentTasks.live.complete(token, String(req.params.id), body(req)));
  });
  app.post("/api/v1/servers/:id/configuration/browse", async (req, res) => {
    limit("config-read:" + p(res).userId, 5);
    res.json(
      await configEdits.browse(
        p(res),
        String(req.params.id),
        body(req).service,
      ),
    );
  });
  app.post("/api/v1/servers/:id/configuration/inspect", async (req, res) => {
    limit("config-read:" + p(res).userId, 5);
    res.json(
      await configEdits.inspect(
        p(res),
        String(req.params.id),
        body(req).service,
      ),
    );
  });
  app.post("/api/v1/servers/:id/configuration/propose", (req, res) =>
    res
      .status(201)
      .json(configEdits.propose(p(res), String(req.params.id), body(req))),
  );
  app.post("/api/v1/servers/:id/configuration/suggest", async (req, res) => {
    limit("config-ai:" + p(res).userId, 5);
    res.json(
      await configEdits.suggest(
        p(res),
        String(req.params.id),
        body(req),
        options.ai ?? {},
        aiSettings,
      ),
    );
  });
  app.get("/api/v1/servers/:id/processes", (req, res) =>
    res.json(agentTasks.processes.list(p(res), String(req.params.id))),
  );
  app.post("/api/v1/servers/:id/processes", (req, res) => {
    limit("request-process:" + p(res).userId, 5);
    res
      .status(201)
      .json(agentTasks.processes.request(p(res), String(req.params.id)));
  });
  app.post("/api/v1/servers/:id/ssh/bootstrap-ticket", (req, res) =>
    res.json(agentTasks.issue(String(req.params.id), p(res))),
  );
  app.get("/api/v1/servers/:id/log-checks", (req, res) =>
    res.json(agentTasks.list(p(res), String(req.params.id))),
  );
  app.post("/api/v1/servers/:id/log-checks", (req, res) => {
    limit("request-check:" + p(res).userId, 5);
    res
      .status(201)
      .json(agentTasks.request(p(res), String(req.params.id), body(req)));
  });
  app.get("/api/v1/servers/:id/monitor", (req, res) => {
    res.json(operations.get(p(res), String(req.params.id)));
  });
  app.put("/api/v1/servers/:id/monitor", (req, res) => {
    operations.save(p(res), String(req.params.id), body(req));
    res.json({ ok: true });
  });
  app.get("/api/v1/servers/:id/logs", (req, res) => {
    res.json(
      operations.logs(
        p(res),
        String(req.params.id),
        typeof req.query.service === "string" ? req.query.service : undefined,
      ),
    );
  });
  app.get("/api/v1/servers/:id/ssh", (req, res) => {
    res.json(operations.sshMetadata(p(res), String(req.params.id)));
  });
  app.put("/api/v1/servers/:id/ssh", (req, res) => {
    operations.saveSSH(p(res), String(req.params.id), body(req));
    res.json({ ok: true });
  });
  app.delete("/api/v1/servers/:id/ssh", (req, res) => {
    operations.removeSSH(p(res), String(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/v1/servers/:id/ssh/test", async (req, res) => {
    limit("ssh:" + p(res).userId, 5);
    res.json(await operations.testSSH(p(res), String(req.params.id)));
  });
  app.get("/api/v1/servers/:id/actions", (req, res) => {
    res.json(operations.actions(p(res), String(req.params.id)));
  });
  app.get("/api/v1/servers/:id/actions/history", (req, res) =>
    res.json(
      operations.actionHistory(p(res), String(req.params.id), req.query),
    ),
  );
  app.get("/api/v1/servers/:id/actions/:action", (req, res) =>
    res.json(
      operations.actionDetail(
        p(res),
        String(req.params.id),
        String(req.params.action),
      ),
    ),
  );
  app.post("/api/v1/servers/:id/actions", (req, res) => {
    limit("proposal:" + p(res).userId, 10);
    res
      .status(201)
      .json(operations.propose(p(res), String(req.params.id), body(req)));
  });
  app.post("/api/v1/servers/:id/actions/:action/approve", async (req, res) => {
    limit("execute:" + p(res).userId, 5);
    res.json(
      await operations.approve(
        p(res),
        String(req.params.id),
        String(req.params.action),
      ),
    );
  });
  app.post("/api/v1/servers/:id/actions/:action/reject", (req, res) => {
    operations.reject(p(res), String(req.params.id), String(req.params.action));
    res.json({ ok: true });
  });
  app.get("/api/v1/recovery-policy", (_req, res) =>
    res.json(serviceRecovery.policy(p(res))),
  );
  app.put("/api/v1/recovery-policy", (req, res) =>
    res.json(serviceRecovery.savePolicy(p(res), body(req))),
  );
  app.get("/api/v1/servers/:id/service-recovery/history", (req, res) =>
    res.json(serviceRecovery.history(p(res), String(req.params.id), req.query)),
  );
  app.get("/api/v1/servers/:id/service-recovery", (req, res) =>
    res.json(serviceRecovery.list(p(res), String(req.params.id))),
  );
  app.put("/api/v1/servers/:id/service-recovery/:service", (req, res) =>
    res.json(
      serviceRecovery.save(
        p(res),
        String(req.params.id),
        String(req.params.service),
        body(req),
      ),
    ),
  );
  app.get("/api/v1/ai/choices", (_req, res) =>
    res.json(aiSettings.choices(p(res), platformAI)),
  );
  app.get("/api/v1/ai/status", (_req, res) => {
    res.json(aiSettings.status(p(res), platformAI));
  });
  app.get("/api/v1/organizations/:org/notifications", (req, res) => {
    res.json(notifications.settings(p(res), String(req.params.org)));
  });
  app.put("/api/v1/organizations/:org/notifications/:channel", (req, res) => {
    res.json(
      notifications.save(
        p(res),
        String(req.params.org),
        String(req.params.channel),
        body(req),
      ),
    );
  });
  app.post(
    "/api/v1/organizations/:org/notifications/:channel/test",
    async (req, res) => {
      limit("notification-test:" + p(res).tenantId, 3);
      res.json(
        await notifications.test(
          p(res),
          String(req.params.org),
          String(req.params.channel),
        ),
      );
    },
  );
  app.get("/api/v1/ai/settings", (_req, res) => {
    res.json(aiSettings.metadata(p(res), platformAI));
  });
  app.put("/api/v1/ai/settings", (req, res) => {
    aiSettings.select(p(res), body(req), platformAI);
    res.json(aiSettings.metadata(p(res), platformAI));
  });
  app.put("/api/v1/ai/providers/:provider", (req, res) => {
    aiSettings.save(p(res), String(req.params.provider), body(req));
    res.json(aiSettings.metadata(p(res), platformAI));
  });
  app.delete("/api/v1/ai/providers/:provider", (req, res) => {
    aiSettings.remove(p(res), String(req.params.provider));
    res.json(aiSettings.metadata(p(res), platformAI));
  });
  app.post("/api/v1/ai/providers/:provider/test", async (req, res) => {
    limit("ai-test:" + p(res).tenantId, 5);
    res.json(await aiSettings.test(p(res), String(req.params.provider)));
  });
  app.get("/api/v1/me", (_req, res) => {
    res.json({
      user: p(res),
      platform_admin: branding.canManage(p(res)),
      account: platform.account(p(res)),
      organizations: platform.organizations(p(res)),
    });
  });
  app.patch("/api/v1/accounts/current", (req, res) => {
    res.json(platform.renameWorkspace(p(res), body(req).name));
  });
  app.get("/api/v1/accounts", (_req, res) => {
    res.json(
      store.db
        .prepare(
          "SELECT t.id,t.name,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=?",
        )
        .all(p(res).userId),
    );
  });
  app.post("/api/v1/accounts/switch", (req, res) => {
    const next = platform.principal(p(res).userId, String(body(req).account));
    platform.logout(cookieToken(req));
    const session = platform.newSession(next);
    setCookie(req, res, session.token);
    res.json({ ok: true });
  });
  app.get("/api/v1/url-monitors", (req, res) =>
    res.json(urlMonitoring.list(p(res), req.query)),
  );
  app.post("/api/v1/url-monitors", (req, res) =>
    res.status(201).json(urlMonitoring.save(p(res), undefined, body(req))),
  );
  app.get("/api/v1/url-monitors/:id", (req, res) =>
    res.json(
      urlMonitoring.details(
        p(res),
        String(req.params.id),
        Number(req.query.hours ?? 24),
      ),
    ),
  );
  app.put("/api/v1/url-monitors/:id", (req, res) =>
    res.json(urlMonitoring.save(p(res), String(req.params.id), body(req))),
  );
  app.delete("/api/v1/url-monitors/:id", (req, res) =>
    res.json(urlMonitoring.archive(p(res), String(req.params.id))),
  );
  app.post("/api/v1/url-monitors/:id/check", async (req, res) => {
    limit("url-check:" + p(res).tenantId, 10);
    res.json(await urlMonitoring.check(p(res), String(req.params.id)));
  });
  app.get("/api/v1/organizations", (_req, res) => {
    res.json(platform.organizations(p(res)));
  });
  app.post("/api/v1/organizations", (req, res) => {
    res.status(201).json(platform.createOrganization(p(res), body(req).name));
  });
  app.get("/api/v1/servers", (req, res) => {
    res.json(
      platform.servers(
        p(res),
        typeof req.query.organization === "string"
          ? req.query.organization
          : undefined,
      ),
    );
  });
  app.post("/api/v1/servers", (req, res) => {
    const data = body(req);
    res
      .status(201)
      .json(
        platform.createServer(p(res), data.organization, data.name, data.icon),
      );
  });
  app.get("/api/v1/servers/:id", (req, res) => {
    res.json(platform.server(p(res), String(req.params.id)));
  });
  app.patch("/api/v1/servers/:id/icon", (req, res) =>
    res.json(
      platform.updateServerIcon(p(res), String(req.params.id), body(req).icon),
    ),
  );
  app.get("/api/v1/servers/:id/history", (req, res) => {
    const hasRange = req.query.from !== undefined || req.query.to !== undefined;
    if (
      hasRange &&
      (typeof req.query.from !== "string" ||
        typeof req.query.to !== "string" ||
        !req.query.from ||
        !req.query.to)
    )
      throw new APIError(400, "Informe inÃ­cio e fim do perÃ­odo.");
    res.json(
      platform.history(
        p(res),
        String(req.params.id),
        Number(req.query.hours ?? 6),
        hasRange
          ? { from: Number(req.query.from), to: Number(req.query.to) }
          : undefined,
      ),
    );
  });
  app.get("/api/v1/servers/:id/rules", (req, res) => {
    res.json(platform.rules(p(res), String(req.params.id)));
  });
  app.put("/api/v1/servers/:id/rules", (req, res) => {
    platform.updateRules(p(res), String(req.params.id), body(req));
    res.json({ ok: true });
  });
  app.post("/api/v1/servers/:id/revoke", (req, res) => {
    platform.revokeAgent(p(res), String(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/v1/servers/:id/archive", (req, res) => {
    platform.removeServer(
      p(res),
      String(req.params.id),
      body(req).confirmation,
    );
    res.json({ ok: true });
  });
  app.post("/api/v1/servers/:id/enrollment", (req, res) => {
    res.json(platform.renewEnrollment(p(res), String(req.params.id)));
  });
  app.get("/api/v1/alerts", (_req, res) => {
    res.json(platform.alerts(p(res)));
  });
  app.get("/api/v1/alerts/history", (req, res) =>
    res.json(alertHistory(platform, p(res), req.query)),
  );
  app.post("/api/v1/alerts/:id/acknowledge", (req, res) => {
    platform.acknowledge(p(res), String(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/v1/tokens", (_req, res) => {
    res.json(platform.tokens(p(res)));
  });
  app.post("/api/v1/tokens", (req, res) => {
    res.status(201).json(platform.createToken(p(res), body(req)));
  });
  app.delete("/api/v1/tokens/:id", (req, res) => {
    platform.revokeToken(p(res), String(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/v1/members", (_req, res) => {
    res.json(platform.members(p(res)));
  });
  app.post("/api/v1/invites", (req, res) => {
    res.status(201).json(platform.invite(p(res), body(req)));
  });
  app.delete("/api/v1/members/:id", (req, res) => {
    platform.removeMember(p(res), String(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/v1/audit", (_req, res) => {
    res.json(platform.auditLog(p(res)));
  });
  app.get("/api/v1/audit/events", (req, res) =>
    res.json(platform.auditPage(p(res), req.query)),
  );
  app.get("/api/v1/chat", (req, res) => {
    res.json(
      commandAgent.decorate(
        platform.chatHistory(
          p(res),
          String(req.query.organization ?? ""),
          typeof req.query.server_id === "string"
            ? req.query.server_id
            : undefined,
        ),
      ),
    );
  });
  app.delete("/api/v1/chat", (req, res) => {
    const d = body(req);
    res.json(
      platform.clearChat(
        p(res),
        String(d.organization ?? ""),
        typeof d.server_id === "string" ? d.server_id : undefined,
      ),
    );
  });
  app.post("/api/v1/chat/restore", (req, res) => {
    const d = body(req);
    res.json(
      platform.restoreChat(
        p(res),
        String(d.organization ?? ""),
        typeof d.server_id === "string" ? d.server_id : undefined,
        d.clear_id,
      ),
    );
  });
  app.post("/api/v1/assistant", async (req, res) => {
    limit("ai:" + p(res).userId, 10);
    res.json(
      await askAssistant(
        platform,
        p(res),
        body(req),
        options.ai ?? {},
        aiSettings,
      ),
    );
  });
  app.get("/api/v1/billing", (_req, res) => {
    res.json({
      plans: platform.catalog.public(),
      enabled: billing.configured() || mercadoPago.configured(),
      stripeEnabled: billing.configured(),
      providers: Object.fromEntries(
        Object.keys(platform.catalog.all()).map((id) => [
          id,
          [
            ...(mercadoPago.ready(id) ? ["mercadopago"] : []),
            ...(billing.ready(id, platform) ? ["stripe"] : []),
          ],
        ]),
      ),
      mercadoPagoPending: mercadoPago.pending(p(res)),
      available: Object.keys(platform.catalog.all()).filter(
        (plan) => billing.ready(plan, platform) || mercadoPago.ready(plan),
      ),
      account: platform.account(p(res)),
    });
  });
  app.post("/api/v1/billing/checkout", async (req, res) => {
    const data = body(req);
    if (data.provider === "mercadopago")
      res.json(await mercadoPago.checkout(p(res), data.plan, data.revision));
    else if (data.provider === undefined || data.provider === "stripe")
      res.json(
        await billing.checkout(platform, p(res), data.plan, data.revision),
      );
    else throw new APIError(400, "Provedor de pagamento invÃ¡lido.");
  });
  app.post("/api/v1/billing/portal", async (_req, res) => {
    res.json(await billing.portal(platform, p(res)));
  });
  app.post("/mcp", async (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const user = platform.tokenPrincipal(token);
    limit("mcp:" + user.userId, 120);
    await handleMCP(req, res, platform, user, req.body, operations, agentTasks);
  });
  app.all("/mcp", (_req, res) => {
    res.setHeader("Allow", "POST");
    res
      .status(405)
      .json({ error: "Este servidor MCP usa HTTP stateless via POST." });
  });
  const root = fileURLToPath(new URL("../", import.meta.url));
  app.get("/agent/linux_agent.py", (_req, res) => {
    res.type("text/x-python").sendFile(resolve(root, "agent/linux_agent.py"));
  });
  app.get("/agent/install.sh", (_req, res) => {
    res.type("text/plain").sendFile(resolve(root, "agent/install.sh"));
  });
  app.get("/agent/upgrade.sh", (_req, res) => {
    res.type("text/plain").sendFile(resolve(root, "agent/upgrade.sh"));
  });
  app.get("/agent/setup_ssh.py", (_req, res) =>
    res.type("text/plain").sendFile(resolve(root, "agent/setup_ssh.py")),
  );
  app.get("/agent/ssh_gateway.py", (_req, res) =>
    res.type("text/plain").sendFile(resolve(root, "agent/ssh_gateway.py")),
  );
  app.get("/agent/config_manager.py", (_req, res) =>
    res.type("text/plain").sendFile(resolve(root, "agent/config_manager.py")),
  );
  app.get("/agent/command_runner.py", (_req, res) =>
    res.type("text/plain").sendFile(resolve(root, "agent/command_runner.py")),
  );
  app.get("/agent/runbook_runner.py", (_req, res) =>
    res.sendFile(resolve("agent/runbook_runner.py")),
  );
  app.use(express.static(resolve(root, "dist"), { index: "index.html" }));
  app.use((req, res) => {
    if (req.path !== "/" || req.method !== "GET")
      return res.status(404).json({ error: "Rota nÃ£o encontrada." });
    res.sendFile(resolve(root, "dist/index.html"));
  });
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) return;
      const status =
        error instanceof APIError
          ? error.status
          : (error as { status?: number })?.status;
      const message =
        error instanceof APIError
          ? error.message
          : status === 413
            ? "Corpo muito grande."
            : status === 400
              ? "JSON invÃ¡lido."
              : "Falha interna.";
      res.status(status && status >= 400 && status < 600 ? status : 500).json({
        error: translate(
          message,
          res.locals.p?.language ??
            _req.headers["accept-language"]?.split(",")[0]?.split(";")[0],
        ),
      });
    },
  );
  const server = createServer(app);
  terminalGateway.attach(server);
  server.on("foxops:shutdown", () => terminalGateway.closeAll());
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  return server;
}
