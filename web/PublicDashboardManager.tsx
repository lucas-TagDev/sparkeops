import { useEffect, useState } from "react";
import {
  Globe,
  Plus,
  Copy,
  ExternalLink,
  RefreshCw,
  Pencil,
  Trash2,
} from "lucide-react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
import type {
  PublicDashboardConfig,
  PublicDashboardMode,
} from "../shared/public-dashboards.ts";
type Draft = Omit<PublicDashboardConfig, "id" | "link"> & { id?: string };
type Option = { id: string; name: string };
const initial = (): Draft => ({
  layout: {
    columns: 0,
    page_size: 12,
    density: "comfortable",
    rotation_seconds: 20,
  },
  title: "Monitoramento",
  enabled: false,
  servers: "selected",
  server_ids: [],
  urls: "selected",
  url_ids: [],
  show_metrics: true,
  show_addresses: false,
});
function ResourcePicker({
  title,
  options,
  mode,
  ids,
  onMode,
  onIDs,
}: {
  title: string;
  options: Option[];
  mode: PublicDashboardMode;
  ids: string[];
  onMode: (mode: PublicDashboardMode) => void;
  onIDs: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter((option) =>
    option.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="panel padded public-resource-picker">
      <h3>{title}</h3>
      <label>
        {t("O que mostrar")}
        <select
          value={mode}
          onChange={(e) => onMode(e.target.value as PublicDashboardMode)}
        >
          <option value="none">{t("Não incluir")}</option>
          <option value="all">{t("Todos, incluindo novos recursos")}</option>
          <option value="selected">{t("Somente os selecionados")}</option>
        </select>
      </label>
      {mode === "selected" && (
        <>
          <input
            aria-label={t("Buscar recursos")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Buscar por nome…")}
          />
          <small className="muted">
            {ids.length} {t("selecionados")}
          </small>
          <div className="public-resource-list">
            {filtered.slice(0, 100).map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(option.id)}
                  onChange={(e) =>
                    onIDs(
                      e.target.checked
                        ? [...ids, option.id]
                        : ids.filter((id) => id !== option.id),
                    )
                  }
                />
                {option.name}
              </label>
            ))}
            {!filtered.length && (
              <p className="muted">{t("Nenhum recurso encontrado.")}</p>
            )}
            {filtered.length > 100 && (
              <small>
                {t("Refine a busca para encontrar outros recursos.")}
              </small>
            )}
          </div>
        </>
      )}
    </div>
  );
}
export function PublicDashboardManager() {
  const [boards, setBoards] = useState<PublicDashboardConfig[]>([]),
    [options, setOptions] = useState<{ servers: Option[]; urls: Option[] }>({
      servers: [],
      urls: [],
    }),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = async () => {
    const [list, resources] = await Promise.all([
      api<PublicDashboardConfig[]>("/public-dashboards"),
      api<typeof options>("/public-dashboards/options"),
    ]);
    setBoards(list);
    setOptions(resources);
  };
  useEffect(() => {
    void load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      setNotice(t(message));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (board: PublicDashboardConfig) => {
    const { id, link, ...data } = board;
    await api("/public-dashboards/" + id, data, "PUT");
  };
  return (
    <div>
      <section className="panel padded">
        <div className="public-manager-heading">
          <div>
            <h2>
              <Globe size={20} /> {t("Painéis públicos")}
            </h2>
            <p className="muted">
              {t(
                "Crie um link de visualização para TV, com servidores e URLs escolhidos por você.",
              )}
            </p>
          </div>
          <button
            className="primary"
            disabled={busy}
            onClick={() => setDraft(initial())}
          >
            <Plus size={16} />
            {t("Novo painel")}
          </button>
        </div>
      </section>
      <p className="banner">
        {t(
          "Qualquer pessoa com o link poderá ver os nomes, status e os dados que você publicar. Nenhuma ação no servidor ou acesso ao assistente é disponibilizado. Você pode desativar ou trocar o link a qualquer momento.",
        )}
      </p>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="banner success" role="status">
          {notice}
        </p>
      )}
      {draft && (
        <form
          className="panel padded public-dashboard-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(
                "/public-dashboards" + (draft.id ? "/" + draft.id : ""),
                draft,
                draft.id ? "PUT" : "POST",
              );
              setDraft(null);
            }, "Painel público salvo.");
          }}
        >
          <h3>
            {t(
              draft.id ? "Editar painel público" : "Configurar painel público",
            )}
          </h3>
          <label>
            {t("Título do painel")}
            <input
              required
              maxLength={100}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="public-picker-grid">
            <ResourcePicker
              title={t("Servidores")}
              options={options.servers}
              mode={draft.servers}
              ids={draft.server_ids}
              onMode={(servers) => setDraft({ ...draft, servers })}
              onIDs={(server_ids) => setDraft({ ...draft, server_ids })}
            />
            <ResourcePicker
              title={t("Monitoramento de URLs")}
              options={options.urls}
              mode={draft.urls}
              ids={draft.url_ids}
              onMode={(urls) => setDraft({ ...draft, urls })}
              onIDs={(url_ids) => setDraft({ ...draft, url_ids })}
            />
          </div>
          <fieldset className="tv-layout-settings">
            <legend>{t("Layout do painel")}</legend>
            <div className="public-picker-grid">
              <label>
                {t("Colunas do grid")}
                <select
                  value={draft.layout?.columns ?? 0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      layout: {
                        ...({
                          columns: 0,
                          page_size: 12,
                          density: "comfortable",
                          rotation_seconds: 20,
                        } as const),
                        ...draft.layout,
                        columns: Number(e.target.value),
                      },
                    })
                  }
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? t("Automático") : n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Itens por página")}
                <select
                  value={draft.layout?.page_size ?? 12}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      layout: {
                        ...({
                          columns: 0,
                          page_size: 12,
                          density: "comfortable",
                          rotation_seconds: 20,
                        } as const),
                        ...draft.layout,
                        page_size: Number(e.target.value),
                      },
                    })
                  }
                >
                  {[4, 6, 8, 12, 16, 24].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("Tamanho dos cartões")}
                <select
                  value={draft.layout?.density ?? "comfortable"}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      layout: {
                        ...({
                          columns: 0,
                          page_size: 12,
                          density: "comfortable",
                          rotation_seconds: 20,
                        } as const),
                        ...draft.layout,
                        density: e.target.value as "compact" | "comfortable",
                      },
                    })
                  }
                >
                  <option value="comfortable">{t("Confortável")}</option>
                  <option value="compact">{t("Compacto")}</option>
                </select>
              </label>
              <label>
                {t("Intervalo de rotação")}
                <select
                  value={draft.layout?.rotation_seconds ?? 20}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      layout: {
                        ...({
                          columns: 0,
                          page_size: 12,
                          density: "comfortable",
                          rotation_seconds: 20,
                        } as const),
                        ...draft.layout,
                        rotation_seconds: Number(e.target.value),
                      },
                    })
                  }
                >
                  {[10, 20, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} s
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.show_metrics}
              onChange={(e) =>
                setDraft({ ...draft, show_metrics: e.target.checked })
              }
            />
            {t("Mostrar CPU, memória e disco dos servidores")}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.show_addresses}
              onChange={(e) =>
                setDraft({ ...draft, show_addresses: e.target.checked })
              }
            />
            {t("Mostrar o domínio das URLs (sem caminho ou parâmetros)")}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
            />
            {t("Ativar link público")}
          </label>
          <div className="platform-row-actions">
            <button className="primary" disabled={busy}>
              {t("Salvar painel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              {t("Cancelar")}
            </button>
          </div>
        </form>
      )}
      {loading && <p role="status">{t("Carregando…")}</p>}
      {!loading && !boards.length && (
        <section className="panel padded">
          <p>
            {t(
              "Nenhum painel público criado. Escolha os recursos para montar sua primeira tela de monitoramento.",
            )}
          </p>
        </section>
      )}
      {boards.map((board) => (
        <section key={board.id} className="panel padded public-dashboard-entry">
          <div className="public-manager-heading">
            <h3>{board.title}</h3>
            <span className="tag">
              {t(board.enabled ? "Ativo" : "Desativado")}
            </span>
          </div>
          <label>
            {t("Link público")}
            <input
              readOnly
              value={board.link}
              onFocus={(e) => e.target.select()}
              spellCheck={false}
            />
          </label>
          <div className="platform-row-actions">
            <a
              className="button secondary"
              href={board.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={15} />
              {t("Abrir painel")}
            </a>
            <button
              disabled={busy}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(board.link)
                  .then(() => setNotice(t("Link copiado.")))
                  .catch(() =>
                    setNotice(
                      t("Selecione e copie o endereço do campo acima."),
                    ),
                  );
                if (!navigator.clipboard)
                  setNotice(t("Selecione e copie o endereço do campo acima."));
              }}
            >
              <Copy size={15} />
              {t("Copiar link")}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const { link, ...config } = board;
                setDraft(config);
              }}
            >
              <Pencil size={15} />
              {t("Editar")}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  () => save({ ...board, enabled: !board.enabled }),
                  "Disponibilidade do painel atualizada.",
                )
              }
            >
              {t(board.enabled ? "Desativar link" : "Ativar link")}
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  await confirmAction(
                    t(
                      "Trocar o link invalida o endereço atual. Atualize o endereço usado nas TVs.",
                    ),
                  )
                )
                  void run(
                    () => api("/public-dashboards/" + board.id + "/rotate", {}),
                    "Novo link gerado. O endereço anterior foi revogado.",
                  );
              }}
            >
              <RefreshCw size={15} />
              {t("Trocar link")}
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  await confirmAction(
                    t("Excluir este painel e revogar seu link público?"),
                    { destructive: true },
                  )
                )
                  void run(
                    () => api("/public-dashboards/" + board.id, {}, "DELETE"),
                    "Painel público excluído.",
                  );
              }}
            >
              <Trash2 size={15} />
              {t("Excluir")}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
