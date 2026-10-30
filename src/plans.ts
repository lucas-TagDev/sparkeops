import { randomUUID } from "node:crypto";
import { Store, APIError } from "./store.ts";
import { DEFAULT_LIMITS, type PlanDefinition } from "../shared/plans.ts";
type StoredPlan = PlanDefinition & {
  legacyPriceAllowed?: boolean;
  priceId?: string;
  productId?: string;
  publishedAmount?: number;
  publishedCurrency?: string;
  publishedInterval?: string;
  publishedName?: string;
};
export class PlanCatalog {
  store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS plan_catalog(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS plan_prices(price_id TEXT PRIMARY KEY,plan_id TEXT NOT NULL);CREATE TABLE IF NOT EXISTS plan_catalog_meta(id TEXT PRIMARY KEY);",
    );
    store.db
      .prepare(
        "INSERT INTO plan_catalog_meta SELECT ? WHERE NOT EXISTS(SELECT 1 FROM plan_catalog_meta)",
      )
      .run(randomUUID());
    const insert = store.db.prepare(
      "INSERT OR IGNORE INTO plan_catalog VALUES (?,?)",
    );
    for (const [id, limits] of Object.entries(DEFAULT_LIMITS))
      insert.run(
        id,
        JSON.stringify({
          ...limits,
          description: "",
          amount: id === "trial" ? 0 : null,
          currency: "BRL",
          interval: "month",
          enabled: true,
          trialDays: 14,
          revision: 1,
          legacyPriceAllowed: true,
        }),
      );
  }
  private normalize(id: string, plan: StoredPlan): StoredPlan {
    return {
      ...plan,
      urlMonitors:
        plan.urlMonitors ??
        (DEFAULT_LIMITS as Record<string, { urlMonitors: number }>)[id]
          ?.urlMonitors ??
        plan.servers,
    };
  }
  all(): Record<string, StoredPlan> {
    return Object.fromEntries(
      this.store.db
        .prepare("SELECT id,data FROM plan_catalog ORDER BY rowid")
        .all()
        .map((r) => [
          String(r.id),
          this.normalize(String(r.id), JSON.parse(String(r.data))),
        ]),
    );
  }
  get(id: string): StoredPlan {
    const row = this.store.db
      .prepare("SELECT data FROM plan_catalog WHERE id=?")
      .get(id);
    if (!row) throw new APIError(404, "Plano não encontrado.");
    return this.normalize(id, JSON.parse(String(row.data)));
  }
  public() {
    return Object.fromEntries(
      Object.entries(this.all()).map(([id, p]) => {
        const {
          priceId,
          productId,
          publishedAmount,
          publishedCurrency,
          publishedInterval,
          publishedName,
          legacyPriceAllowed,
          ...publicPlan
        } = p;
        return [id, publicPlan];
      }),
    );
  }
  matches(p: StoredPlan) {
    return (
      !!p.priceId &&
      p.amount === p.publishedAmount &&
      p.currency === p.publishedCurrency &&
      p.interval === p.publishedInterval &&
      p.name === p.publishedName
    );
  }
  validate(id: string, data: Record<string, unknown>): PlanDefinition {
    const name = typeof data.name === "string" ? data.name.trim() : "",
      description =
        typeof data.description === "string" ? data.description.trim() : "";
    if (
      !name ||
      name.length > 80 ||
      description.length > 300 ||
      typeof data.enabled !== "boolean" ||
      !["BRL", "USD", "EUR"].includes(String(data.currency)) ||
      !["month", "year"].includes(String(data.interval))
    )
      throw new APIError(400, "Dados do plano inválidos.");
    const urlMonitors = data.urlMonitors ?? this.all()[id]?.urlMonitors ?? 0;
    if (
      typeof urlMonitors !== "number" ||
      !Number.isInteger(urlMonitors) ||
      urlMonitors < 0 ||
      urlMonitors > 100000
    )
      throw new APIError(400, "Limites do plano inválidos.");
    for (const [key, min, max] of [
      ["servers", 1, 100000],
      ["organizations", 1, 100000],
      ["aiDaily", 0, 1000000],
      ["retentionDays", 1, 3650],
      ["trialDays", 1, 365],
    ] as const)
      if (
        typeof data[key] !== "number" ||
        !Number.isInteger(data[key]) ||
        Number(data[key]) < min ||
        Number(data[key]) > max
      )
        throw new APIError(400, "Limites do plano inválidos.");
    if (id === "trial" && (data.amount !== 0 || data.enabled !== true))
      throw new APIError(
        400,
        "O plano de avaliação deve permanecer gratuito e ativo.",
      );
    if (
      id !== "trial" &&
      data.amount !== null &&
      (typeof data.amount !== "number" ||
        !Number.isSafeInteger(data.amount) ||
        data.amount < 1 ||
        data.amount > 100000000)
    )
      throw new APIError(
        400,
        "Preço inválido. Informe um valor positivo com até duas casas decimais.",
      );
    return {
      name,
      description,
      servers: Number(data.servers),
      urlMonitors,
      organizations: Number(data.organizations),
      aiDaily: Number(data.aiDaily),
      retentionDays: Number(data.retentionDays),
      trialDays: Number(data.trialDays),
      amount: data.amount as number | null,
      currency: data.currency as PlanDefinition["currency"],
      interval: data.interval as PlanDefinition["interval"],
      enabled: data.enabled,
      revision: 1,
    };
  }
  save(id: string, data: Record<string, unknown>, create = false) {
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(id))
      throw new APIError(
        400,
        "Use um código de plano com 2 a 40 letras minúsculas, números ou hífen.",
      );
    const previousRow = this.store.db
      .prepare("SELECT data FROM plan_catalog WHERE id=?")
      .get(id);
    const previous: StoredPlan | undefined = previousRow
      ? JSON.parse(String(previousRow.data))
      : undefined;
    if (create && previous)
      throw new APIError(409, "Já existe um plano com este código.");
    if (!create && !previous) throw new APIError(404, "Plano não encontrado.");
    if (previous && data.revision !== previous.revision)
      throw new APIError(
        409,
        "O plano foi atualizado. Recarregue a lista antes de salvar.",
      );
    const next = {
      ...previous,
      ...this.validate(id, data),
      revision: (previous?.revision ?? 0) + 1,
      legacyPriceAllowed:
        !!previous?.legacyPriceAllowed && data.amount === null,
    };
    this.store.db
      .prepare(
        "INSERT INTO plan_catalog VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(id, JSON.stringify(next));
    return next;
  }
  bindLegacy(prices: Record<string, string | undefined>) {
    for (const [id, price] of Object.entries(prices))
      if (price && this.all()[id]) {
        const existing = this.store.db
          .prepare("SELECT plan_id FROM plan_prices WHERE price_id=?")
          .get(price);
        if (existing && existing.plan_id !== id)
          throw new Error("Um preço Stripe não pode representar dois planos.");
        this.store.db
          .prepare("INSERT OR IGNORE INTO plan_prices VALUES (?,?)")
          .run(price, id);
      }
  }
  published(
    id: string,
    revision: number,
    price: {
      id: string;
      product: string;
      unit_amount: number | null;
      currency: string;
      recurring: { interval: string } | null;
    },
  ) {
    const plan = this.get(id);
    if (plan.revision !== revision)
      throw new APIError(
        409,
        "O plano foi atualizado durante a publicação. Publique a versão atual.",
      );
    if (
      price.unit_amount !== plan.amount ||
      price.currency.toUpperCase() !== plan.currency ||
      price.recurring?.interval !== plan.interval
    )
      throw new APIError(409, "O preço de cobrança não corresponde ao plano.");
    const bound = this.pricePlan(price.id);
    if (bound && bound !== id)
      throw new APIError(409, "O preço de cobrança já pertence a outro plano.");
    const next = {
      ...plan,
      priceId: price.id,
      productId: price.product,
      publishedAmount: plan.amount!,
      publishedCurrency: plan.currency,
      publishedInterval: plan.interval,
      publishedName: plan.name,
    };
    this.store.db
      .prepare("INSERT OR IGNORE INTO plan_prices VALUES (?,?)")
      .run(price.id, id);
    this.store.db
      .prepare("UPDATE plan_catalog SET data=? WHERE id=?")
      .run(JSON.stringify(next), id);
  }
  pricePlan(price: string) {
    return this.store.db
      .prepare("SELECT plan_id FROM plan_prices WHERE price_id=?")
      .get(price)?.plan_id as string | undefined;
  }
}
