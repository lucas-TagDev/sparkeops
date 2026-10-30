import { t as tx, getLanguage } from "./i18n.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
import { useEffect, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  Wifi,
} from "lucide-react";
import { api, stamp } from "./api.ts";
import { MODEL_EXAMPLES } from "./model-examples.ts";

type Provider = {
  id: string;
  name: string;
  description: string;
  docs: string;
  configured: boolean;
  enabled: boolean;
  model: string;
  updated_at: number | null;
  tested_at: number | null;
  test_ok: boolean | null;
};
type Settings = {
  can_manage: boolean;
  status: {
    mode: "own" | "platform" | "off";
    provider: string | null;
    enabled: boolean;
    platform_available: boolean;
  };
  providers: Provider[];
};

export function AISettingsPanel({
  role,
  onChanged,
}: {
  role: string;
  onChanged: () => Promise<void>;
}) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [selectedProvider, setSelectedProvider] = useState("");
  const allowed = ["owner", "admin"].includes(role);
  const load = async () => {
    const data = await api<Settings>("/ai/settings");
    setSettings(data);
  };
  useEffect(() => {
    if (allowed) void load().catch((e) => setError(e.message));
  }, [allowed]);
  const action = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await load();
      await onChanged();
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!allowed)
    return (
      <section className="panel padded">
        <h2>
          <Sparkles size={18} />
          {tx("Inteligência artificial")}
        </h2>
        <p className="muted">
          {tx(
            "O proprietário da conta pode configurar as chaves e escolher o provedor em uso pelo assistente.",
          )}
        </p>
      </section>
    );
  return (
    <section className="panel ai-settings">
      <div className="panel-head">
        <h2>
          <Sparkles size={18} />
          {tx("Inteligência artificial")}
        </h2>
        <span className="tag">{tx("Chaves da sua conta")}</span>
      </div>
      <div className="ai-settings-body">
        <p className="muted">
          {tx(
            "Cadastre suas chaves, habilite os provedores e escolha qual modelo será usado pelo assistente. O consumo das suas chaves é cobrado diretamente pelo provedor.",
          )}
        </p>
        <div className="banner info">
          <ShieldCheck size={18} />
          <span>
            {tx(
              "As chaves ficam criptografadas no servidor, separadas por conta, e não são exibidas após salvar. Apenas o proprietário pode alterá-las. A escolha vale para todos os clientes e membros autorizados desta conta.",
            )}
          </span>
        </div>
        {location.protocol === "http:" &&
          !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && (
            <div className="banner info">
              <KeyRound size={18} />
              <span>
                {tx(
                  "Esta conexão HTTP na rede não é criptografada. Use HTTPS para cadastrar e utilizar chaves reais fora do seu computador.",
                )}
              </span>
            </div>
          )}
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="ai-message" role="status">
            <Check size={16} />
            {message}
          </div>
        )}
        {settings && (
          <>
            <div className="ai-default">
              <div>
                <h3>{tx("Modo do assistente")}</h3>
                <p className="muted">
                  {tx(
                    "Escolha entre sua própria chave, a IA da plataforma ou o diagnóstico básico.",
                  )}
                </p>
              </div>
              <select
                aria-label={tx("Provedor padrão do assistente")}
                disabled={busy || !settings.can_manage}
                value={
                  settings.status.mode === "own"
                    ? (settings.status.provider ?? "off")
                    : settings.status.mode
                }
                onChange={(e) => {
                  const value = e.target.value;
                  void action(
                    () =>
                      api(
                        "/ai/settings",
                        value === "off" || value === "platform"
                          ? { mode: value }
                          : { mode: "own", provider: value },
                        "PUT",
                      ),
                    tx("Modo do assistente atualizado."),
                  );
                }}
              >
                <option value="off">{tx("Somente diagnóstico básico")}</option>
                <option
                  value="platform"
                  disabled={!settings.status.platform_available}
                >
                  {tx("IA da plataforma")}
                  {!settings.status.platform_available
                    ? tx(" · indisponível")
                    : ""}
                </option>
                {settings.providers.map((p) => (
                  <option
                    value={p.id}
                    key={p.id}
                    disabled={!p.configured || !p.enabled}
                  >
                    {p.name}
                    {tx("· minha chave")}
                    {!p.configured
                      ? tx(" · cadastrar")
                      : !p.enabled
                        ? tx(" · desabilitado")
                        : ""}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="ai-provider-tabs"
              role="tablist"
              aria-label={tx("Configurar provedor de IA")}
            >
              {settings.providers.map((provider) => (
                <button
                  key={provider.id}
                  id={"ai-tab-" + provider.id}
                  role="tab"
                  aria-selected={
                    (selectedProvider ||
                      settings.status.provider ||
                      settings.providers[0]?.id) === provider.id
                  }
                  aria-controls={"ai-provider-" + provider.id}
                  disabled={busy}
                  onClick={() => setSelectedProvider(provider.id)}
                >
                  {provider.name}
                  <span className="tag">
                    {tx(
                      provider.configured ? "Configurado" : "Não configurado",
                    )}
                  </span>
                </button>
              ))}
            </div>
            <p className="muted">
              {tx(
                "Selecione um provedor para configurar sua chave. A troca de aba não altera o provedor em uso pelo assistente.",
              )}
            </p>
            <div className="ai-provider-single">
              {settings.providers.map((provider) => (
                <div
                  key={provider.id}
                  id={"ai-provider-" + provider.id}
                  role="tabpanel"
                  aria-labelledby={"ai-tab-" + provider.id}
                  hidden={
                    (selectedProvider ||
                      settings.status.provider ||
                      settings.providers[0]?.id) !== provider.id
                  }
                >
                  <ProviderCard
                    key={
                      provider.id +
                      ":" +
                      provider.updated_at +
                      ":" +
                      provider.enabled
                    }
                    provider={provider}
                    active={
                      settings.status.mode === "own" &&
                      settings.status.provider === provider.id &&
                      settings.status.enabled
                    }
                    manage={settings.can_manage}
                    busy={busy}
                    action={action}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function ProviderCard({
  provider,
  active,
  manage,
  busy,
  action,
}: {
  provider: Provider;
  active: boolean;
  manage: boolean;
  busy: boolean;
  action: (fn: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [key, setKey] = useState(""),
    [model, setModel] = useState(provider.model),
    [enabled, setEnabled] = useState(
      provider.configured ? provider.enabled : true,
    ),
    [models, setModels] = useState<string[]>([]),
    [testMessage, setTestMessage] = useState("");
  const dirty =
    !!key || model !== provider.model || enabled !== provider.enabled;
  const examples = MODEL_EXAMPLES[provider.id];
  const symbols: Record<string, string> = {
    openai: "O",
    claude: "C",
    grok: "X",
    deepseek: "D",
    gemini: "G",
  };
  return (
    <form
      className={"ai-provider-card " + (active ? "selected" : "")}
      onSubmit={(e) => {
        e.preventDefault();
        void action(
          async () => {
            await api(
              "/ai/providers/" + provider.id,
              { key: key || undefined, model, enabled },
              "PUT",
            );
            setKey("");
            setTestMessage("");
          },
          tx`${provider.name}: configuração salva.`,
        );
      }}
    >
      <div className="ai-provider-heading">
        <span className={"provider-logo " + provider.id}>
          {symbols[provider.id]}
        </span>
        <div>
          <h3>{provider.name}</h3>
          <small>{tx(provider.description)}</small>
        </div>
        {active ? (
          <span className="status online">
            <i />
            {tx("Em uso")}
          </span>
        ) : (
          <span className="tag">
            {provider.configured
              ? provider.enabled
                ? tx("Habilitado")
                : tx("Desabilitado")
              : tx("Não configurado")}
          </span>
        )}
      </div>
      <label>
        {tx("Modelo")}
        <input
          aria-label={tx`Modelo ${provider.name}`}
          list={`models-${provider.id}`}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
          maxLength={150}
          disabled={!manage || busy}
          placeholder={
            examples
              ? tx`Ex.: ${examples.items[0].id}`
              : tx("ID do modelo disponível na sua conta")
          }
        />
        <datalist id={`models-${provider.id}`}>
          {[
            ...new Set([
              ...(examples?.items.map((item) => item.id) ?? []),
              ...models,
            ]),
          ].map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </label>
      {examples && (
        <div className="model-examples">
          <div className="model-examples-heading">
            <strong>{tx("Exemplos para escolher")}</strong>
            <a href={examples.source} target="_blank" rel="noreferrer">
              {tx("Catálogo oficial")}
              <ExternalLink size={11} />
            </a>
          </div>
          {examples.items.map((example) => (
            <button
              type="button"
              key={example.id}
              className={
                "model-example " + (model === example.id ? "chosen" : "")
              }
              disabled={!manage || busy}
              aria-label={tx`Usar exemplo ${example.id}`}
              onClick={() => setModel(example.id)}
            >
              <span>
                <code>{example.id}</code>
                <em>{tx(example.label)}</em>
              </span>
              <small>{tx(example.use)}</small>
            </button>
          ))}
          <p>
            {tx(
              "Clique para preencher o modelo; depois salve. Você também pode digitar outro ID. Exemplos conferidos em 28/10/2026; confirme o acesso com sua chave em Testar conexão.",
            )}
          </p>
        </div>
      )}
      <label>
        {tx("Chave da API")}
        <input
          aria-label={tx`Chave da API ${provider.name}`}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          maxLength={4096}
          disabled={!manage || busy}
          required={!provider.configured}
          placeholder={
            provider.configured
              ? tx("Chave salva · deixe vazio para manter")
              : tx("Cole sua chave de API")
          }
        />
      </label>
      <div className="ai-key-row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!manage || busy}
          />
          {tx("Habilitar")}
          {provider.name}
        </label>
        <a href={provider.docs} target="_blank" rel="noreferrer">
          {tx("Obter chave")}
          <ExternalLink size={12} />
        </a>
      </div>
      {provider.configured && (
        <p className="ai-key-note">
          <KeyRound size={12} />
          {tx("Chave protegida · Atualizada em")}
          {stamp(provider.updated_at)}
        </p>
      )}
      {testMessage && (
        <p className="ai-test-result" role="status">
          {testMessage}
        </p>
      )}
      {provider.tested_at && !testMessage && (
        <p className="ai-key-note">
          {tx("Último teste:")}
          {provider.test_ok ? tx("conexão confirmada") : tx("falhou")} ·{" "}
          {stamp(provider.tested_at)}
        </p>
      )}
      {manage && (
        <>
          <div className="ai-card-actions">
            <button className="primary" type="submit" disabled={busy}>
              <Save size={14} />
              {tx("Salvar")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !provider.configured || dirty}
              title={
                dirty
                  ? tx("Salve as alterações antes de testar")
                  : tx(
                      "Consulta os modelos sem enviar métricas nem gerar texto",
                    )
              }
              onClick={() =>
                void action(async () => {
                  const result = await api<{
                    message: string;
                    models: string[];
                  }>("/ai/providers/" + provider.id + "/test", {});
                  setModels(result.models);
                  setTestMessage(result.message);
                }, tx("Teste de conexão concluído."))
              }
            >
              <Wifi size={14} />
              {tx("Testar conexão")}
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={tx`Remover chave ${provider.name}`}
              disabled={busy || !provider.configured}
              onClick={async () => {
                if (
                  await confirmAction(
                    tx`Remover a chave ${provider.name} desta conta? Se estiver em uso, o assistente passará ao diagnóstico básico.`,
                  )
                )
                  void action(
                    () =>
                      api("/ai/providers/" + provider.id, undefined, "DELETE"),
                    tx("Chave removida."),
                  );
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
          {provider.configured && provider.enabled && !active && (
            <button
              type="button"
              className="text-button"
              disabled={busy || dirty}
              onClick={() =>
                void action(
                  () =>
                    api(
                      "/ai/settings",
                      { mode: "own", provider: provider.id },
                      "PUT",
                    ),
                  tx`${provider.name} selecionado para o assistente.`,
                )
              }
            >
              {tx("Usar no assistente")}
              <ChevronRight size={14} />
            </button>
          )}
        </>
      )}
      <small className="ai-test-note">
        {tx(
          "O teste consulta a lista de modelos, sem gerar uma resposta. Salvar a chave não faz chamadas ao provedor.",
        )}
      </small>
    </form>
  );
}
