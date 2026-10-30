export type PlanDefinition = {
  name: string;
  description: string;
  servers: number;
  urlMonitors?: number;
  organizations: number;
  aiDaily: number;
  retentionDays: number;
  amount: number | null;
  currency: "BRL" | "USD" | "EUR";
  interval: "month" | "year";
  enabled: boolean;
  trialDays: number;
  revision: number;
};
export type CatalogPlan = PlanDefinition & {
  id: string;
  subscribers: number;
  checkoutReady: boolean;
  published: boolean;
};
export type PlanManagement = {
  plans: CatalogPlan[];
  paymentsConfigured: boolean;
  mercadoPagoConfigured?: boolean;
};
export const DEFAULT_LIMITS = {
  trial: {
    name: "Avaliação",
    servers: 5,
    urlMonitors: 5,
    organizations: 3,
    aiDaily: 20,
    retentionDays: 7,
  },
  starter: {
    name: "Essencial",
    servers: 10,
    urlMonitors: 10,
    organizations: 1,
    aiDaily: 50,
    retentionDays: 30,
  },
  growth: {
    name: "Equipe",
    servers: 30,
    urlMonitors: 30,
    organizations: 10,
    aiDaily: 150,
    retentionDays: 60,
  },
  msp: {
    name: "Prestador",
    servers: 100,
    urlMonitors: 100,
    organizations: 100,
    aiDaily: 500,
    retentionDays: 90,
  },
} as const;
export const money = (amount: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    amount / 100,
  );
