import { createApp } from "./app.ts";
import { Store } from "./store.ts";
import { Platform } from "./platform.ts";
import { startWorker } from "./worker.ts";
import { dirname, resolve } from "node:path";

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT inválida.");
const host = process.env.HOST ?? "127.0.0.1";
const origin = process.env.PUBLIC_URL
  ? new URL(process.env.PUBLIC_URL).origin
  : undefined;
if (host !== "127.0.0.1" && !origin)
  throw new Error("Configure PUBLIC_URL ao publicar a aplicação.");
if (
  process.env.NODE_ENV === "production" &&
  (!origin?.startsWith("https://") || process.env.FOXOPS_ADMIN_TOKEN)
)
  throw new Error(
    "Produção exige PUBLIC_URL com HTTPS e a rota administrativa legada desativada.",
  );
const store = new Store(process.env.FOXOPS_DATABASE ?? "foxops.sqlite3");
const server = createApp(store, process.env.FOXOPS_ADMIN_TOKEN, {
  platformAdmins: (process.env.FOXOPS_PLATFORM_ADMIN_EMAILS ?? "").split(","),
  origin,
  trustProxy: process.env.TRUST_PROXY === "1",
  ai: { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
  aiVault: {
    keyFile:
      process.env.FOXOPS_AI_KEY_FILE ??
      resolve(
        dirname(process.env.FOXOPS_DATABASE ?? "foxops.sqlite3"),
        ".secrets/ai-master.key",
      ),
  },
  webhookConfigured: !!process.env.ALERT_WEBHOOK_URL,
  billing: {
    origin: origin ?? `http://localhost:${port}`,
    key: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    prices: {
      starter: process.env.STRIPE_PRICE_STARTER,
      growth: process.env.STRIPE_PRICE_GROWTH,
      msp: process.env.STRIPE_PRICE_MSP,
    },
  },
});
const stopWorker = startWorker(
  new Platform(store),
  process.env.ALERT_WEBHOOK_URL,
  {
    keyFile:
      process.env.FOXOPS_AI_KEY_FILE ??
      resolve(
        dirname(process.env.FOXOPS_DATABASE ?? "foxops.sqlite3"),
        ".secrets/ai-master.key",
      ),
  },
  { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
);
server.on("error", (error) => {
  stopWorker();
  store.close();
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, host, () =>
  console.log(`FoxOps: ${origin ?? `http://localhost:${port}`}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopWorker();
    server.emit("foxops:shutdown");
    server.close(() => store.close());
  });
