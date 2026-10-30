import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("interface alterna PT, EN e ES sem alterar nomes de serviços ou comandos", async (t) => {
  const documentBefore = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    ),
    locationBefore = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "document", {
    value: {
      documentElement: { lang: "", style: { setProperty: () => {} } },
      querySelector: () => null,
      createElement: () => ({}),
      head: { append: () => {} },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    value: {
      origin: "http://localhost:8080",
      protocol: "http:",
      hostname: "localhost",
    },
    configurable: true,
  });
  t.after(() => {
    if (documentBefore)
      Object.defineProperty(globalThis, "document", documentBefore);
    else Reflect.deleteProperty(globalThis, "document");
    if (locationBefore)
      Object.defineProperty(globalThis, "location", locationBefore);
    else Reflect.deleteProperty(globalThis, "location");
  });
  const bundled = await build({
    stdin: {
      contents:
        'export {ObservabilityPanel} from "./web/ObservabilityPanel.tsx";' +
        'export {URLMonitoringPage,URLHistoryChart} from "./web/URLMonitoringPage.tsx";export {PaymentSettingsPanel} from "./web/PaymentSettingsPanel.tsx";export {PlanEditor} from "./web/PlanManagementPanel.tsx";export {PlatformAdminPanel} from "./web/PlatformAdminPanel.tsx";export {AuditEventsTable,AuditPanel} from "./web/AuditPanel.tsx";export {ServerOperations} from "./web/ServerOperations.tsx";export {ConfirmDialog} from "./web/ConfirmDialog.tsx";export {setLanguage,t} from "./web/i18n.ts";export {BrandingPanel} from "./web/BrandingPanel.tsx";export {applyBranding} from "./web/branding.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    jsx: "automatic",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  const ui = module.exports as {
    ObservabilityPanel: (props: {
      serverId: string;
      role: string;
    }) => ReturnType<typeof createElement>;
    URLMonitoringPage: (props: {
      organizations: { id: string; name: string }[];
      role: string;
    }) => ReturnType<typeof createElement>;
    URLHistoryChart: (props: {
      checks: import("../../shared/url-monitors.ts").URLCheck[];
    }) => ReturnType<typeof createElement>;
    PaymentSettingsPanel: () => ReturnType<typeof createElement>;
    PlanEditor: (props: {
      plan: import("../../shared/plans.ts").CatalogPlan | null;
      paymentsConfigured: boolean;
      onSaved: () => void;
      onCancel: () => void;
    }) => ReturnType<typeof createElement>;
    PlatformAdminPanel: (props: {
      userId: string;
    }) => ReturnType<typeof createElement>;
    AuditEventsTable: (props: {
      events: import("../../shared/audit.ts").AuditEvent[];
    }) => ReturnType<typeof createElement>;
    AuditPanel: () => ReturnType<typeof createElement>;
    ServerOperations: (props: {
      server: unknown;
      role: string;
    }) => ReturnType<typeof createElement>;
    ConfirmDialog: () => ReturnType<typeof createElement>;
    BrandingPanel: () => ReturnType<typeof createElement>;
    applyBranding: (value: {
      name: string;
      primaryColor: string;
      logo: string | null;
      favicon: string | null;
      revision: string;
    }) => void;
    setLanguage: (s: string) => void;
    t: (s: string) => string;
  };
  const server = {
    id: "test",
    organization: "test",
    name: "Serviço do cliente",
    details: {
      agent_version: "0.7.2",
      services: { "custom-worker": "active", mysql: "inactive" },
    },
    metrics: null,
  };
  ui.setLanguage("en");
  assert.match(
    renderToStaticMarkup(
      createElement(ui.ObservabilityPanel, { serverId: "test", role: "owner" }),
    ),
    /Observability and AIOps/,
  );
  let markup = renderToStaticMarkup(
    createElement(ui.ServerOperations, { server, role: "owner" }),
  );
  assert.match(markup, /Search services/);
  assert.match(markup, /Filter services by status/);
  assert.match(markup, /SSH connection/);
  assert.match(markup, /custom-worker/);
  assert.match(renderToStaticMarkup(createElement(ui.ConfirmDialog)), /Cancel/);
  ui.setLanguage("es");
  assert.match(
    renderToStaticMarkup(
      createElement(ui.ObservabilityPanel, { serverId: "test", role: "owner" }),
    ),
    /Observabilidad y AIOps/,
  );
  markup = renderToStaticMarkup(
    createElement(ui.ServerOperations, { server, role: "owner" }),
  );
  assert.match(markup, /Buscar servicio/);
  assert.match(markup, /Filtrar servicios por estado/);
  assert.match(markup, /Conexión SSH/);
  assert.match(
    renderToStaticMarkup(createElement(ui.ConfirmDialog)),
    /Cancelar/,
  );
  ui.setLanguage("pt-BR");
  markup = renderToStaticMarkup(
    createElement(ui.ServerOperations, { server, role: "owner" }),
  );
  assert.match(markup, /Buscar serviço/);
  assert.match(markup, /Conexão SSH/);
  assert.equal(ui.t("ss -lntup"), "ss -lntup");
  ui.applyBranding({
    name: "Minha Marca",
    primaryColor: "#2244aa",
    logo: "/branding/logo?v=test",
    favicon: "/branding/favicon?v=test",
    revision: "test",
  });
  ui.setLanguage("en");
  markup = renderToStaticMarkup(createElement(ui.BrandingPanel));
  assert.match(markup, /Platform branding/);
  assert.match(markup, /Minha Marca/);
  assert.match(markup, /Save branding/);
  assert.match(markup, /\/branding\/logo\?v=test/);
  ui.setLanguage("es");
  markup = renderToStaticMarkup(createElement(ui.BrandingPanel));
  assert.match(markup, /Identidad visual de la plataforma/);
  assert.match(markup, /Guardar identidad visual/);
  const events: import("../../shared/audit.ts").AuditEvent[] = [
    {
      id: "event",
      action: "platform.branding.updated",
      target: "",
      created_at: 1793210000,
      user_id: "user",
      actor_name: "Alice",
      actor_email: "alice@audit.test",
      resource_name: null,
      category: "changes",
    },
  ];
  ui.setLanguage("en");
  markup = renderToStaticMarkup(createElement(ui.AuditEventsTable, { events }));
  assert.match(markup, /Branding updated/);
  assert.match(markup, /Responsible user/);
  assert.match(markup, /Alice/);
  assert.match(markup, /alice@audit.test/);
  assert.match(markup, /platform.branding.updated/);
  markup = renderToStaticMarkup(createElement(ui.AuditPanel));
  assert.match(markup, /Search records/);
  assert.match(markup, /audit-pagination/);
  assert.match(markup, /Per page/);
  ui.setLanguage("es");
  assert.match(
    renderToStaticMarkup(createElement(ui.AuditEventsTable, { events })),
    /Identidad visual actualizada/,
  );
  ui.setLanguage("en");
  markup = renderToStaticMarkup(
    createElement(ui.PlatformAdminPanel, { userId: "root" }),
  );
  assert.match(markup, /Platform administration/);
  assert.match(markup, /Search workspaces or users/);
  ui.setLanguage("es");
  assert.match(
    renderToStaticMarkup(
      createElement(ui.PlatformAdminPanel, { userId: "root" }),
    ),
    /Administración de la plataforma/,
  );
  const plan: import("../../shared/plans.ts").CatalogPlan = {
    id: "premium",
    name: "Premium",
    description: "",
    servers: 10,
    organizations: 1,
    aiDaily: 50,
    retentionDays: 30,
    amount: 4990,
    currency: "BRL",
    interval: "month",
    enabled: true,
    trialDays: 14,
    revision: 1,
    subscribers: 0,
    checkoutReady: false,
    published: false,
  };
  ui.setLanguage("en");
  markup = renderToStaticMarkup(
    createElement(ui.PlanEditor, {
      plan,
      paymentsConfigured: false,
      onSaved: () => {},
      onCancel: () => {},
    }),
  );
  assert.match(markup, /Edit plan/);
  assert.match(markup, /Billing period/);
  assert.match(markup, /49.90/);
  assert.match(markup, /Save plan/);
  assert.match(markup, /Existing subscriptions keep their contracted price/);
  ui.setLanguage("es");
  assert.match(
    renderToStaticMarkup(
      createElement(ui.PlanEditor, {
        plan,
        paymentsConfigured: false,
        onSaved: () => {},
        onCancel: () => {},
      }),
    ),
    /Guardar plan/,
  );
  ui.setLanguage("en");
  markup = renderToStaticMarkup(createElement(ui.PaymentSettingsPanel));
  assert.match(markup, /Mercado Pago/);
  assert.match(
    markup,
    /Configure the account that will receive platform subscription payments/,
  );
  ui.setLanguage("en");
  markup = renderToStaticMarkup(
    createElement(ui.URLMonitoringPage, {
      organizations: [{ id: "customer", name: "Customer" }],
      role: "owner",
    }),
  );
  assert.match(markup, /URL monitoring/);
  assert.match(markup, /Add URL/);
  assert.match(markup, /24-hour availability/);
  const checks = [
    {
      id: "1",
      checked_at: 1793210000,
      ok: 1,
      status_code: 200,
      latency_ms: 25,
      error: null,
    },
    {
      id: "2",
      checked_at: 1793210060,
      ok: 0,
      status_code: 500,
      latency_ms: 90,
      error: "HTTP 500",
    },
  ];
  markup = renderToStaticMarkup(createElement(ui.URLHistoryChart, { checks }));
  assert.match(markup, /Response time history/);
  assert.match(markup, /#78dab3/);
  assert.match(markup, /#f18b8b/);
  ui.setLanguage("es");
  assert.match(
    renderToStaticMarkup(
      createElement(ui.URLMonitoringPage, {
        organizations: [],
        role: "reader",
      }),
    ),
    /Monitoreo de URLs/,
  );
});
