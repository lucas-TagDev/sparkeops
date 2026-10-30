import { RecoveryHistory } from "./RecoveryHistory.tsx";
import { t as tx, getLanguage } from "./i18n.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
import { useEffect, useState, lazy, Suspense } from "react";
import {
  Activity,
  Bot,
  Check,
  FileText,
  KeyRound,
  RefreshCw,
  Save,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { api, stamp, stampSeconds } from "./api.ts";
import type { Server } from "../src/platform.ts";
import { ProcessPanel } from "./ProcessPanel.tsx";
import { ConfigPanel } from "./ConfigPanel.tsx";
import { ActionHistory } from "./ActionHistory.tsx";
import { PersistentDetails } from "./PersistentDetails.tsx";
import { AgentActivationGuide } from "./AgentActivationGuide.tsx";
import { ServiceReports, type ServiceWatchData } from "./ServiceReports.tsx";

const TerminalPanel = lazy(() => import("./TerminalPanel.tsx"));
type Monitor = {
  auto_discover: boolean;
  services: string[];
  logs_enabled: boolean;
  discovered_services: string[];
  agent_version: string;
  log_error: string | null;
};
type Log = {
  service: string;
  timestamp: number;
  priority: string;
  message: string;
};
type LocalCheck = {
  id: string;
  service: string;
  since: number;
  until: number;
  status: string;
  result: string | null;
};
type SSH = {
  configured: boolean;
  host?: string;
  port?: number;
  username?: string;
  fingerprint?: string;
};
export function ServerOperations({
  server,
  role,
}: {
  server: Server;
  role: string;
}) {
  const [attemptLimit, setAttemptLimit] = useState(5);
  const [recoveries, setRecoveries] = useState<
    { service: string; enabled: number }[]
  >([]);
  const [monitor, setMonitor] = useState<Monitor | null>(null),
    [serviceWatches, setServiceWatches] = useState<ServiceWatchData>({
      watches: [],
      reports: [],
    }),
    [serviceSearch, setServiceSearch] = useState(""),
    [serviceStatus, setServiceStatus] = useState("all"),
    [servicePage, setServicePage] = useState(1),
    [servicePageSize, setServicePageSize] = useState(20),
    [serviceBulkScope, setServiceBulkScope] = useState("filtered"),
    [auto, setAuto] = useState(true),
    [serviceInput, setServiceInput] = useState(""),
    [logEnabled, setLogEnabled] = useState(false),
    [checks, setChecks] = useState<LocalCheck[]>([]),
    [checkMinutes, setCheckMinutes] = useState(15),
    [bootstrapTicket, setBootstrapTicket] = useState(""),
    [filter, setFilter] = useState(""),
    [pendingActions, setPendingActions] = useState(0),
    [actionRefresh, setActionRefresh] = useState(0),
    [ssh, setSSH] = useState<SSH>({ configured: false });
  const [host, setHost] = useState(""),
    [port, setPort] = useState(22),
    [username, setUsername] = useState("foxops"),
    [fingerprint, setFingerprint] = useState(""),
    [auth, setAuth] = useState("key"),
    [privateKey, setPrivateKey] = useState(""),
    [password, setPassword] = useState(""),
    [passphrase, setPassphrase] = useState("");
  const [service, setService] = useState(""),
    [action, setAction] = useState("status"),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("services"),
    [analysis, setAnalysis] = useState(""),
    [suggestions, setSuggestions] = useState<
      { service: string; action: string; reason: string }[]
    >([]);
  const privileged = ["owner", "admin"].includes(role),
    canManage = role !== "reader",
    root = `/servers/${server.id}`;
  const load = async (initial = false) => {
    const [m, a, w, recovery, policy] = await Promise.all([
      api<Monitor>(root + "/monitor"),
      api<{ pending: number }>(root + "/actions/history?limit=5"),
      api<ServiceWatchData>(root + "/service-watches"),
      api<typeof recoveries>(root + "/service-recovery"),
      api<{ max_attempts: number }>("/recovery-policy"),
    ]);
    setMonitor(m);
    setRecoveries(recovery);
    setAttemptLimit(policy.max_attempts);
    setServiceWatches(w);
    setPendingActions(a.pending);
    if (initial) {
      setAuto(m.auto_discover);
      setServiceInput(m.services.join(", "));
      setLogEnabled(m.logs_enabled);
    }
    if (privileged) {
      const s = await api<SSH>(root + "/ssh");
      setSSH(s);
      if (initial) {
        setHost(s.host ?? "");
        setPort(s.port ?? 22);
        setUsername(s.username ?? "foxops");
        setFingerprint(s.fingerprint ?? "");
      }
    }
  };
  useEffect(() => {
    void load(true).catch((e) => setError(e.message));
    const timer = setInterval(
      () => void load().catch((e) => setError(e.message)),
      15000,
    );
    return () => clearInterval(timer);
  }, [server.id]);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      setActionRefresh((value) => value + 1);
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const known = [
    ...new Set([
      ...Object.keys((server.details?.services ?? {}) as object),
      ...(monitor?.discovered_services ?? []),
      ...(monitor?.services ?? []),
      ...serviceWatches.watches.map((watch) => watch.service),
    ]),
  ];
  const states = (server.details?.services ?? {}) as Record<string, string>;
  const filteredServices = known
    .filter(
      (name) =>
        name
          .toLocaleLowerCase()
          .includes(serviceSearch.trim().toLocaleLowerCase()) &&
        (serviceStatus === "all" ||
          (serviceStatus === "other"
            ? !["active", "inactive", "failed"].includes(states[name])
            : states[name] === serviceStatus)),
    )
    .sort((a, b) => a.localeCompare(b));
  const servicePages = Math.max(
    1,
    Math.ceil(filteredServices.length / servicePageSize),
  );
  const currentServicePage = Math.min(servicePage, servicePages);
  const serviceOffset = (currentServicePage - 1) * servicePageSize;
  const visibleServices = filteredServices.slice(
    serviceOffset,
    serviceOffset + servicePageSize,
  );
  useEffect(() => {
    setServicePage((page) => Math.min(page, servicePages));
  }, [servicePages]);
  return (
    <PersistentDetails
      storageKey={"server:" + server.id + ":operations"}
      className="panel server-operations collapsible-panel"
      onToggle={(e) => {
        if (!e.currentTarget.open && tab === "terminal") setTab("services");
      }}
    >
      <summary className="panel-head collapsible-heading">
        <h2>
          <Activity size={18} />
          {tx("Serviços, logs e correções")}
        </h2>
        <span className="tag">
          {tx("Agente")}
          {monitor?.agent_version ?? "…"}
        </span>
      </summary>
      <div className="tabs operations-tabs">
        <button
          className={tab === "services" ? "active" : ""}
          onClick={() => setTab("services")}
        >
          {tx("Serviços")}
        </button>
        <button
          className={tab === "recovery" ? "active" : ""}
          onClick={() => setTab("recovery")}
        >
          {tx("Tentativas de correção")}
        </button>
        <button
          className={tab === "processes" ? "active" : ""}
          onClick={() => setTab("processes")}
        >
          {tx("Processos")}
        </button>
        {canManage && (
          <button
            className={tab === "configuration" ? "active" : ""}
            onClick={() => setTab("configuration")}
          >
            {tx("Configurações de serviços")}
          </button>
        )}
        {privileged && (
          <button
            className={tab === "ssh" ? "active" : ""}
            onClick={() => setTab("ssh")}
          >
            {tx("Conexão SSH")}
          </button>
        )}
        {privileged && (
          <button
            className={tab === "terminal" ? "active" : ""}
            onClick={() => setTab("terminal")}
          >
            <Terminal size={14} />
            {tx("Terminal SSH")}
          </button>
        )}
        <button
          className={tab === "actions" ? "active" : ""}
          onClick={() => setTab("actions")}
        >
          {tx("Ações e aprovações")} <span>{pendingActions}</span>
        </button>
      </div>
      <div className="operations-content">
        {tab === "terminal" && privileged && (
          <Suspense fallback={<p>{tx("Carregando terminal…")}</p>}>
            <TerminalPanel serverId={server.id} role={role} />
          </Suspense>
        )}
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="ai-message" role="status">
            <Check size={15} />
            {notice}
          </div>
        )}
        {!(
          Number(monitor?.agent_version.split(".")[0]) >= 1 ||
          Number(monitor?.agent_version.split(".")[1]) >= 5
        ) && (
          <div className="banner info">
            <Terminal size={18} />
            <div>
              {tx(
                "Atualize o agente uma vez no Ubuntu para habilitar descoberta de serviços, logs e processos, preservando a credencial.",
              )}
              <pre>{`curl -fsS '${location.origin}/agent/upgrade.sh' -o /tmp/foxops-upgrade.sh\nsudo bash /tmp/foxops-upgrade.sh`}</pre>
            </div>
          </div>
        )}
        {tab === "processes" && (
          <ProcessPanel
            server={server}
            role={role}
            onPrepared={() => {
              setTab("actions");
              void load().catch((e) => setError(e.message));
            }}
          />
        )}
        {tab === "configuration" && canManage && (
          <ConfigPanel
            server={server}
            onPrepared={() => {
              setTab("actions");
              void load().catch((e) => setError(e.message));
            }}
          />
        )}
        {tab === "services" && (
          <>
            <p className="muted">
              {tx(
                "Descobre as unidades de serviço instaladas e carregadas no systemd, incluindo serviços personalizados e instâncias. A lista é revisada a cada cinco minutos; os estados chegam a cada coleta. No modo automático, somente o estado failed gera alerta de serviço; unidades inativas podem ser normais.",
              )}
            </p>
            <div className="service-list-controls">
              <label>
                {tx("Buscar serviço")}
                <input
                  type="search"
                  aria-label={tx("Buscar serviço")}
                  placeholder={tx("Ex.: nginx, mysql, ssh…")}
                  value={serviceSearch}
                  onChange={(e) => {
                    setServiceSearch(e.target.value);
                    setServicePage(1);
                  }}
                />
              </label>
              <label>
                {tx("Estado")}
                <select
                  aria-label={tx("Filtrar serviços por estado")}
                  value={serviceStatus}
                  onChange={(e) => {
                    setServiceStatus(e.target.value);
                    setServicePage(1);
                  }}
                >
                  <option value="all">{tx("Todos os estados")}</option>
                  <option value="active">{tx("Ativos")}</option>
                  <option value="inactive">{tx("Inativos")}</option>
                  <option value="failed">{tx("Com falha")}</option>
                  <option value="other">{tx("Demais estados")}</option>
                </select>
              </label>
              <label>
                {tx("Por página")}
                <select
                  aria-label={tx("Serviços por página")}
                  value={servicePageSize}
                  onChange={(e) => {
                    setServicePageSize(Number(e.target.value));
                    setServicePage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
            <p className="muted" role="status" aria-live="polite">
              {filteredServices.length
                ? tx`${serviceOffset + 1}–${Math.min(serviceOffset + servicePageSize, filteredServices.length)} de ${filteredServices.length} serviço(s)`
                : tx("Nenhum serviço encontrado")}{" "}
              · {known.length}
              {tx("no total")}
            </p>
            <p className="muted">
              {tx(
                "Marque os serviços essenciais para avisar também quando ficarem inativos ou não carregados. Resumo IA verifica os logs localmente, usa a franquia da conta e envia uma análise por incidente. Habilite Serviços nos canais da organização.",
              )}
            </p>
            <div className="operations-service-grid">
              {canManage && (
                <div className="service-bulk-toolbar">
                  <label>
                    {tx("Aplicar seleção a")}
                    <select
                      disabled={busy}
                      value={serviceBulkScope}
                      onChange={(e) => setServiceBulkScope(e.target.value)}
                    >
                      <option value="filtered">
                        {tx("Todos os resultados filtrados")} (
                        {filteredServices.length})
                      </option>
                      <option value="page">
                        {tx("Página atual")} ({visibleServices.length})
                      </option>
                    </select>
                  </label>
                  <div>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || !filteredServices.length}
                      onClick={() =>
                        void run(async () => {
                          setServiceWatches(
                            await api<ServiceWatchData>(
                              root + "/service-watches/bulk",
                              {
                                services:
                                  serviceBulkScope === "page"
                                    ? visibleServices
                                    : filteredServices,
                                enabled: true,
                              },
                            ),
                          );
                        }, tx("Serviços selecionados para monitoramento."))
                      }
                    >
                      <Check size={14} />
                      {tx("Marcar todos")}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || !filteredServices.length}
                      onClick={() =>
                        void run(async () => {
                          setServiceWatches(
                            await api<ServiceWatchData>(
                              root + "/service-watches/bulk",
                              {
                                services:
                                  serviceBulkScope === "page"
                                    ? visibleServices
                                    : filteredServices,
                                enabled: false,
                              },
                            ),
                          );
                        }, tx("Seleção de monitoramento removida."))
                      }
                    >
                      <X size={14} />
                      {tx("Desmarcar todos")}
                    </button>
                  </div>
                </div>
              )}
              {visibleServices.map((name) => (
                <div className="service-row" key={name}>
                  <span>{name}</span>
                  <span
                    className={
                      states[name] === "active"
                        ? "text-green"
                        : states[name] === "failed"
                          ? "text-red"
                          : "muted"
                    }
                  >
                    {states[name] ?? tx("Aguardando coleta")}
                  </span>
                  {canManage && (
                    <div className="service-watch-controls">
                      <label>
                        <input
                          type="checkbox"
                          checked={
                            !!serviceWatches.watches.find(
                              (w) => w.service === name,
                            )?.enabled
                          }
                          disabled={busy}
                          onChange={(e) =>
                            void run(async () => {
                              setServiceWatches(
                                await api<ServiceWatchData>(
                                  root +
                                    "/service-watches/" +
                                    encodeURIComponent(name),
                                  {
                                    enabled: e.target.checked,
                                    ai_summary:
                                      serviceWatches.watches.find(
                                        (w) => w.service === name,
                                      )?.ai_summary !== 0,
                                  },
                                  "PUT",
                                ),
                              );
                            }, tx("Seleção de serviços salva."))
                          }
                        />
                        {tx("Monitorar serviço")}
                      </label>
                      {!!serviceWatches.watches.find((w) => w.service === name)
                        ?.enabled && (
                        <label>
                          <input
                            type="checkbox"
                            checked={
                              !!serviceWatches.watches.find(
                                (w) => w.service === name,
                              )?.ai_summary
                            }
                            disabled={busy}
                            onChange={(e) =>
                              void run(async () => {
                                setServiceWatches(
                                  await api<ServiceWatchData>(
                                    root +
                                      "/service-watches/" +
                                      encodeURIComponent(name),
                                    {
                                      enabled: true,
                                      ai_summary: e.target.checked,
                                    },
                                    "PUT",
                                  ),
                                );
                              }, tx("Seleção de serviços salva."))
                            }
                          />
                          {tx("Resumo IA")}
                        </label>
                      )}
                      {privileged &&
                        !!serviceWatches.watches.find((w) => w.service === name)
                          ?.enabled && (
                          <label
                            title={tx`Autoriza até ${attemptLimit} tentativas sequenciais por incidente. O proprietário define o limite nas configurações.`}
                          >
                            <input
                              type="checkbox"
                              checked={
                                !!recoveries.find((r) => r.service === name)
                                  ?.enabled
                              }
                              disabled={busy}
                              onChange={(e) => {
                                const enabled = e.target.checked;
                                void run(async () => {
                                  if (
                                    enabled &&
                                    !(await confirmAction(
                                      tx`Autorizar correção imediata de ${name}? O sistema poderá verificar e reiniciar somente este serviço, sem pedir aprovação a cada incidente. Serão feitas até ${attemptLimit} tentativas por incidente, seguindo o intervalo configurado pelo proprietário e parando quando recuperar. A IA investigará a causa antes de agir. Ajustes de configuração só ocorrerão quando habilitados pelo proprietário.`,
                                    ))
                                  )
                                    return;
                                  setRecoveries(
                                    await api<typeof recoveries>(
                                      root +
                                        "/service-recovery/" +
                                        encodeURIComponent(name),
                                      { enabled, confirm: enabled },
                                      "PUT",
                                    ),
                                  );
                                }, tx("Correção imediata atualizada."));
                              }}
                            />
                            {tx("Correção imediata")}
                          </label>
                        )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!!known.length && !filteredServices.length && (
              <p>
                {tx(
                  "Nenhum serviço corresponde à busca e ao estado selecionado.",
                )}
              </p>
            )}
            {filteredServices.length > 0 && (
              <nav
                className="service-pagination"
                aria-label={tx("Paginação dos serviços")}
              >
                <span className="service-page-caption">
                  {tx("Página")}
                  {currentServicePage}
                  {tx("de")}
                  {servicePages}
                </span>
                <div className="service-page-buttons">
                  <button
                    type="button"
                    aria-label={tx("Página anterior")}
                    title={tx("Página anterior")}
                    disabled={currentServicePage === 1}
                    onClick={() => setServicePage(currentServicePage - 1)}
                  >
                    ‹
                  </button>
                  {Array.from(
                    new Set([
                      1,
                      ...Array.from(
                        { length: 3 },
                        (_, i) => currentServicePage + i - 1,
                      ).filter((p) => p > 1 && p < servicePages),
                      servicePages,
                    ]),
                  )
                    .sort((a, b) => a - b)
                    .map((page, index, pages) => (
                      <span className="service-page-item" key={page}>
                        {index > 0 && page - pages[index - 1] > 1 && (
                          <span className="service-page-gap">…</span>
                        )}
                        <button
                          type="button"
                          aria-label={tx`Ir para página ${page}`}
                          aria-current={
                            page === currentServicePage ? "page" : undefined
                          }
                          onClick={() => setServicePage(page)}
                        >
                          {page}
                        </button>
                      </span>
                    ))}
                  <button
                    type="button"
                    aria-label={tx("Próxima página")}
                    title={tx("Próxima página")}
                    disabled={currentServicePage === servicePages}
                    onClick={() => setServicePage(currentServicePage + 1)}
                  >
                    ›
                  </button>
                </div>
              </nav>
            )}
            {!known.length && (
              <p className="muted">
                {tx(
                  "Aguardando descoberta de serviços ou atualização do agente.",
                )}
              </p>
            )}
            {canManage && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      api(
                        root + "/monitor",
                        {
                          auto_discover: auto,
                          services: serviceInput
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                          logs_enabled: false,
                        },
                        "PUT",
                      ),
                    tx("Monitoramento configurado. Aguarde a próxima coleta."),
                  );
                }}
              >
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={auto}
                    onChange={(e) => setAuto(e.target.checked)}
                  />
                  {tx("Descobrir automaticamente serviços instalados")}
                </label>
                <label>
                  {tx("Serviços selecionados (separados por vírgula)")}
                  <input
                    value={serviceInput}
                    onChange={(e) => setServiceInput(e.target.value)}
                    disabled={auto}
                    placeholder="nginx, apache2, php8.3-fpm"
                  />
                </label>
                <p className="muted">
                  {tx(
                    "Use o assistente para investigar os logs diretamente no servidor.",
                  )}
                </p>
                <button className="secondary" disabled={busy}>
                  <Save size={14} />
                  {tx("Salvar monitoramento")}
                </button>
              </form>
            )}
          </>
        )}
        {tab === "services" && (
          <ServiceReports reports={serviceWatches.reports} />
        )}
        {tab === "recovery" && (
          <RecoveryHistory key={server.id} serverId={server.id} />
        )}
        {tab === "ssh" && privileged && <AgentActivationGuide feature="ssh" />}
        {tab === "ssh" && privileged && (
          <>
            {role === "owner" && !ssh.configured && (
              <div className="banner">
                <p>
                  {tx(
                    "O instalador pode criar um usuário SSH dedicado e cadastrar a chave automaticamente. Para um agente já instalado, gere uma autorização temporária e execute a atualização com --setup-ssh.",
                  )}
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await api<{ ticket: string }>(
                        root + "/ssh/bootstrap-ticket",
                        {},
                      );
                      setBootstrapTicket(r.ticket);
                    }, tx("Autorização válida por 15 minutos e usada uma única vez."))
                  }
                >
                  {tx("Autorizar configuração automática")}
                </button>
                {bootstrapTicket && (
                  <>
                    <p>
                      {tx(
                        "Cole esta autorização apenas quando o instalador pedir no Ubuntu:",
                      )}
                    </p>
                    <code>{bootstrapTicket}</code>
                    <pre>bash /tmp/foxops-upgrade.sh --setup-ssh</pre>
                  </>
                )}
              </div>
            )}
            {location.protocol !== "https:" && (
              <p className="notice">
                {tx(
                  "Este painel usa HTTP na rede de teste. Configure HTTPS antes de cadastrar credenciais em produção.",
                )}
              </p>
            )}
            <p className="muted">
              {tx(
                "A aplicação FoxOps se conecta ao Ubuntu por SSH. O agente continua enviando métricas por saída; ele não precisa de acesso root para coletar métricas.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api(
                    root + "/ssh",
                    {
                      host,
                      port,
                      username,
                      fingerprint,
                      privateKey:
                        auth === "key" ? privateKey || undefined : undefined,
                      password:
                        auth === "password" ? password || undefined : undefined,
                      passphrase: passphrase || undefined,
                    },
                    "PUT",
                  );
                  setPrivateKey("");
                  setPassword("");
                  setPassphrase("");
                }, tx("Conexão SSH salva com credencial criptografada."));
              }}
            >
              <div className="rules-grid">
                <label>
                  {tx("Host ou IP do Ubuntu")}
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    required
                    disabled={role !== "owner"}
                    placeholder="192.168.3.50"
                  />
                </label>
                <label>
                  {tx("Porta SSH")}
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    disabled={role !== "owner"}
                  />
                </label>
                <label>
                  {tx("Usuário SSH")}
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    disabled={role !== "owner"}
                  />
                </label>
                <label>
                  {tx("Autenticação")}
                  <select
                    value={auth}
                    onChange={(e) => setAuth(e.target.value)}
                    disabled={role !== "owner"}
                  >
                    <option value="key">{tx("Chave privada")}</option>
                    <option value="password">{tx("Senha")}</option>
                  </select>
                </label>
              </div>
              <label>
                {tx("Fingerprint da chave do servidor (SHA256)")}
                <input
                  value={fingerprint}
                  onChange={(e) => setFingerprint(e.target.value)}
                  required
                  disabled={role !== "owner"}
                  placeholder="SHA256:..."
                />
              </label>
              <p className="muted">
                {tx("Obtenha no console do Ubuntu, por exemplo:")}{" "}
                <code>
                  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
                </code>
                {tx(
                  ". A conexão será recusada se a identidade não corresponder.",
                )}
              </p>
              {auth === "key" ? (
                <label>
                  {tx("Chave privada SSH")}
                  <textarea
                    aria-label={tx("Chave privada SSH")}
                    rows={5}
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    disabled={role !== "owner"}
                    spellCheck={false}
                    placeholder={
                      ssh.configured
                        ? tx("Credencial salva · deixe vazio para manter")
                        : "-----BEGIN OPENSSH PRIVATE KEY-----"
                    }
                  />
                </label>
              ) : (
                <label>
                  {tx("Senha SSH")}
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={role !== "owner"}
                    placeholder={
                      ssh.configured
                        ? tx("Credencial salva · deixe vazio para manter")
                        : tx("Senha do usuário SSH")
                    }
                  />
                </label>
              )}
              {auth === "key" && (
                <label>
                  {tx("Frase secreta da chave (opcional)")}
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    disabled={role !== "owner"}
                    autoComplete="new-password"
                  />
                </label>
              )}
              <div className="action-row">
                {role === "owner" && (
                  <button className="primary" disabled={busy}>
                    <Save size={14} />
                    {tx("Salvar SSH")}
                  </button>
                )}
                <button
                  className="secondary"
                  type="button"
                  disabled={busy || !ssh.configured}
                  onClick={() =>
                    void run(async () => {
                      const r = await api<{ code: number; output: string }>(
                        root + "/ssh/test",
                        {},
                      );
                      if (r.code !== 0)
                        throw new Error(
                          tx("A conexão não concluiu a consulta de hostname."),
                        );
                      setNotice(r.output);
                    }, tx("SSH conectado; consulta de hostname concluída."))
                  }
                >
                  <KeyRound size={14} />
                  {tx("Testar SSH")}
                </button>
                {role === "owner" && (
                  <button
                    className="danger"
                    type="button"
                    disabled={busy || !ssh.configured}
                    onClick={async () => {
                      if (
                        await confirmAction(
                          tx("Remover a credencial SSH deste servidor?"),
                        )
                      )
                        void run(
                          () => api(root + "/ssh", undefined, "DELETE"),
                          tx("Credencial SSH removida."),
                        );
                    }}
                  >
                    {tx("Remover SSH")}
                  </button>
                )}
              </div>
            </form>
            <div className="banner info">
              <ShieldCheck size={18} />
              <span>
                {tx(
                  "Use um usuário com sudo sem senha apenas para os comandos necessários. Não há terminal livre nem execução de scripts gerados pela IA. Testes de configuração são feitos antes de recarregar ou reiniciar Nginx, Apache e PHP-FPM.",
                )}
              </span>
            </div>
          </>
        )}
        {tab === "actions" && (
          <>
            {canManage && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () => api(root + "/actions", { service, action, reason }),
                    tx("Ação preparada. Revise e aprove para executar."),
                  );
                }}
              >
                <div className="rules-grid">
                  <label>
                    {tx("Serviço")}
                    <select
                      value={service}
                      onChange={(e) => setService(e.target.value)}
                      required
                    >
                      <option value="">{tx("Selecione")}</option>
                      {known.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {tx("Ação")}
                    <select
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                    >
                      <option value="status">{tx("Consultar estado")}</option>
                      <option value="configtest">
                        {tx("Validar configuração")}
                      </option>
                      <option value="reload">{tx("Recarregar serviço")}</option>
                      <option value="restart">{tx("Reiniciar serviço")}</option>
                    </select>
                  </label>
                </div>
                <label>
                  {tx("Motivo")}
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    placeholder={tx("Ex.: serviço falhou após uma atualização")}
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  <ShieldCheck size={14} />
                  {tx("Preparar ação para revisão")}
                </button>
              </form>
            )}
            <p className="muted">
              {tx(
                "Ações preparadas expiram em 15 minutos. Uma falha de conexão pode deixar o resultado indeterminado: verifique o servidor antes de repetir.",
              )}
            </p>
            <ActionHistory
              serverId={server.id}
              serverName={server.name}
              role={role}
              refreshToken={actionRefresh}
              onChanged={() => load()}
            />
          </>
        )}
        {busy && (
          <p className="muted" role="status">
            {tx("Processando… Aguarde o resultado antes de repetir a ação.")}
          </p>
        )}
      </div>
    </PersistentDetails>
  );
}
