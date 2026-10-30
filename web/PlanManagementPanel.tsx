import { useEffect, useState, useRef } from "react";
import { Plus, Package, RefreshCw } from "lucide-react";
import { api } from "./api.ts";
import { t, getLanguage } from "./i18n.ts";
import {
  money,
  type CatalogPlan,
  type PlanManagement,
  type PlanDefinition,
} from "../shared/plans.ts";
const emptyPlan: PlanDefinition = {
  name: "",
  description: "",
  servers: 10,
  urlMonitors: 10,
  organizations: 1,
  aiDaily: 50,
  retentionDays: 30,
  amount: null,
  currency: "BRL",
  interval: "month",
  enabled: true,
  trialDays: 14,
  revision: 0,
};
export function PlanEditor({
  plan,
  paymentsConfigured,
  onSaved,
  onCancel,
}: {
  plan: CatalogPlan | null;
  paymentsConfigured: boolean;
  onSaved: (result: PlanManagement, id: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PlanDefinition>({
      ...emptyPlan,
      ...plan,
      urlMonitors: plan?.urlMonitors ?? 10,
    }),
    [id, setId] = useState(plan?.id ?? ""),
    [price, setPrice] = useState(
      plan?.amount === null || !plan ? "" : (plan.amount / 100).toFixed(2),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(!plan);
  const editor = useRef<HTMLElement>(null);
  useEffect(() => {
    editor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const trial = id === "trial",
    change = (key: keyof PlanDefinition, value: unknown) => {
      setDraft((p) => ({ ...p, [key]: value }));
      setDirty(true);
    };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      let amount: number | null = null;
      if (trial) amount = 0;
      else if (price.trim()) {
        if (!/^\d+(?:[.,]\d{1,2})?$/.test(price.trim()))
          throw new Error(
            t(
              "Preço inválido. Informe um valor positivo com até duas casas decimais.",
            ),
          );
        const [whole, fraction = ""] = price
          .trim()
          .replace(",", ".")
          .split(".");
        amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      }
      const result = await api<PlanManagement>(
        "/platform/plans" + (plan ? "/" + id : ""),
        { ...draft, id, amount },
        plan ? "PUT" : "POST",
      );
      onSaved(result, id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await api<PlanManagement>("/platform/plans/" + id + "/publish", {
          revision: plan.revision,
        }),
        id,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section ref={editor} className="panel padded plan-editor">
      <div className="panel-head">
        <h2>{t(plan ? "Editar plano" : "Novo plano")}</h2>
        <button type="button" disabled={busy} onClick={onCancel}>
          {t("Fechar")}
        </button>
      </div>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="plan-form-grid">
          {!plan && (
            <label>
              {t("Código do plano")}
              <input
                required
                pattern="[a-z][a-z0-9_-]{1,39}"
                minLength={2}
                maxLength={40}
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setDirty(true);
                }}
                placeholder="premium"
              />
            </label>
          )}
          <label>
            {t("Nome do plano")}
            <input
              required
              maxLength={80}
              value={draft.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </label>
          <label className="plan-description">
            {t("Descrição")}
            <textarea
              maxLength={300}
              value={draft.description}
              onChange={(e) => change("description", e.target.value)}
            />
          </label>
        </div>
        <h3>{t("Preço e disponibilidade")}</h3>
        <div className="plan-form-grid">
          <label>
            {t("Preço")}
            <input
              disabled={trial}
              inputMode="decimal"
              placeholder="99,90"
              value={trial ? "0,00" : price}
              onChange={(e) => {
                setPrice(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label>
            {t("Moeda")}
            <select
              disabled={trial}
              value={draft.currency}
              onChange={(e) => change("currency", e.target.value)}
            >
              <option value="BRL">BRL — R$</option>
              <option value="USD">USD — $</option>
              <option value="EUR">EUR — €</option>
            </select>
          </label>
          <label>
            {t("Periodicidade")}
            <select
              disabled={trial}
              value={draft.interval}
              onChange={(e) => change("interval", e.target.value)}
            >
              <option value="month">{t("Mensal")}</option>
              <option value="year">{t("Anual")}</option>
            </select>
          </label>
        </div>
        {!trial && (
          <label className="plan-enabled">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => change("enabled", e.target.checked)}
            />
            {t("Disponível para novas contratações")}
          </label>
        )}
        <h3>{t("Limites do plano")}</h3>
        <div className="plan-form-grid">
          {(
            [
              ["servers", "Servidores", 1, 100000],
              ["urlMonitors", "URLs monitoradas", 0, 100000],
              ["organizations", "Clientes", 1, 100000],
              ["aiDaily", "Consultas de IA por dia", 0, 1000000],
              ["retentionDays", "Dias de retenção", 1, 3650],
              ...(trial ? [["trialDays", "Dias de avaliação", 1, 365]] : []),
            ] as [keyof PlanDefinition, string, number, number][]
          ).map(([key, label, min, max]) => (
            <label key={key}>
              {t(label)}
              <input
                type="number"
                required
                step={1}
                min={min}
                max={max}
                value={Number(draft[key])}
                onChange={(e) => change(key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <p className="muted">
          {t(
            "Os limites salvos se aplicam a todos os workspaces deste plano. Reduzir a retenção pode remover histórico antigo.",
          )}
        </p>
        {trial && (
          <p className="muted">
            {t("O prazo de avaliação será usado nos próximos cadastros.")}
          </p>
        )}
        <div className="platform-row-actions">
          <button className="primary" disabled={busy}>
            {busy ? t("Salvando...") : t("Salvar plano")}
          </button>
          {!trial && plan && (
            <button
              type="button"
              disabled={
                busy ||
                dirty ||
                !paymentsConfigured ||
                plan.amount === null ||
                plan.published
              }
              onClick={() => void publish()}
            >
              {t("Publicar preço na Stripe")}
            </button>
          )}
        </div>
        {!trial && (
          <p className="muted">
            {t(
              "No Mercado Pago, os preços salvos são usados nas novas assinaturas. Na Stripe, publique o preço após salvar. Assinaturas existentes mantêm o valor contratado.",
            )}
          </p>
        )}
        {!trial && dirty && plan && (
          <p className="muted">{t("Salve as alterações antes de publicar.")}</p>
        )}
      </form>
    </section>
  );
}
export function PlanManagementPanel() {
  const [data, setData] = useState<PlanManagement | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api<PlanManagement>("/platform/plans")
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const saved = (result: PlanManagement, id: string) => {
    setData(result);
    setSelected(id);
    setCreating(false);
    setNotice(t("Plano salvo."));
  };
  return (
    <div className="plan-management">
      <section className="panel padded">
        <div className="panel-head">
          <div>
            <h2>
              <Package size={18} />
              {t("Planos e preços")}
            </h2>
            <p className="muted">
              {t("Defina os planos, preços e limites da sua plataforma.")}
            </p>
          </div>
          <div className="platform-row-actions">
            <button
              onClick={() => setRevision((v) => v + 1)}
              disabled={loading}
              aria-label={t("Atualizar")}
            >
              <RefreshCw size={16} />
            </button>
            <button
              className="primary"
              disabled={loading || !data}
              onClick={() => {
                setCreating(true);
                setSelected(null);
                setNotice("");
              }}
            >
              <Plus size={16} />
              {t("Novo plano")}
            </button>
          </div>
        </div>
        {data && !data.paymentsConfigured && !data.mercadoPagoConfigured && (
          <p className="banner info">
            {t(
              "A cobrança online ainda não está configurada. Salve os planos e configure Mercado Pago ou Stripe para receber pagamentos.",
            )}
          </p>
        )}
      </section>
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="banner success">
          {notice}
        </p>
      )}
      {loading && !data && <p>{t("Carregando...")}</p>}
      {data && (
        <section className="panel">
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>{t("Plano")}</th>
                  <th>{t("Preço")}</th>
                  <th>{t("Limites")}</th>
                  <th>{t("Workspaces")}</th>
                  <th>{t("Disponibilidade")}</th>
                  <th>{t("Ações")}</th>
                </tr>
              </thead>
              <tbody>
                {data.plans.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <small>{p.id}</small>
                    </td>
                    <td>
                      {p.id === "trial"
                        ? t("Gratuito")
                        : p.amount === null
                          ? t("Preço não definido")
                          : money(p.amount, p.currency, getLanguage())}
                      <small>
                        {p.id === "trial"
                          ? `${p.trialDays} ${t("dias")}`
                          : t(p.interval === "year" ? "por ano" : "por mês")}
                      </small>
                    </td>
                    <td>
                      {p.servers} {t("servidores")} · {p.urlMonitors ?? 0} URLs
                      · {p.organizations} {t("cliente(s)")}
                      <small>
                        {p.aiDaily} {t("consultas de IA por dia")} ·{" "}
                        {p.retentionDays} {t("dias de histórico")}
                      </small>
                    </td>
                    <td>{p.subscribers}</td>
                    <td>
                      <span className="tag">
                        {t(
                          p.id === "trial"
                            ? "Avaliação"
                            : !p.enabled
                              ? "Fora de venda"
                              : p.checkoutReady
                                ? "Disponível para contratação"
                                : "Aguardando publicação",
                        )}
                      </span>
                    </td>
                    <td>
                      <button
                        disabled={loading}
                        onClick={() => {
                          setSelected(p.id);
                          setCreating(false);
                          setNotice("");
                        }}
                      >
                        {t("Editar")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data && (creating || selected) && (
        <PlanEditor
          key={
            creating
              ? "new"
              : selected +
                "-" +
                data.plans.find((p) => p.id === selected)?.revision +
                "-" +
                data.plans.find((p) => p.id === selected)?.published
          }
          plan={
            creating
              ? null
              : (data.plans.find((p) => p.id === selected) ?? null)
          }
          paymentsConfigured={data.paymentsConfigured}
          onSaved={saved}
          onCancel={() => {
            setSelected(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
