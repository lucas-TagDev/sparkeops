import { AccountConfirmationPending } from "./AccountConfirmationPending.tsx";
import { useCaptcha } from "./TurnstileWidget.tsx";
import { RecoveryPolicyPanel } from "./RecoveryPolicyPanel.tsx";
import {
  AccountRecovery,
  ChangeEmailPanel,
  ChangePasswordPanel,
} from "./PlatformEmailPanel.tsx";
import { AlertHistory } from "./AlertHistory.tsx";
import { historicalDateMention } from "../shared/historical-time.ts";
import { PersistentDetails } from "./PersistentDetails.tsx";
import { URLMonitoringPage } from "./URLMonitoringPage.tsx";
import { AgentActivationGuide } from "./AgentActivationGuide.tsx";
import { ServerIconPicker, ServerVisualIcon } from "./ServerIconPicker.tsx";
import { SERVER_REMOVAL_WORD } from "../shared/server-actions.ts";
import type { ServerIconId } from "../shared/server-icons.ts";
import { money, type PlanDefinition } from "../shared/plans.ts";
import { PlatformAdminPanel } from "./PlatformAdminPanel.tsx";
import { t as tx, getLanguage } from "./i18n.ts";
import { useBranding } from "./branding.ts";
import { AuditPanel } from "./AuditPanel.tsx";
import { confirmAction } from "./ConfirmDialog.tsx";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bot,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Clock3,
  Code2,
  Cpu,
  CreditCard,
  Database,
  ExternalLink,
  Gauge,
  Globe,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Plus,
  RefreshCw,
  Search,
  Save,
  Send,
  Server as ServerIcon,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Users,
  Wifi,
  X,
  Pencil,
  Zap,
} from "lucide-react";
import type {
  Alert,
  Organization,
  Principal,
  Server,
} from "../src/platform.ts";
import { api, pct, roleName, stamp, stampSeconds } from "./api.ts";
import { AISettingsPanel } from "./AISettingsPanel.tsx";
import { NotificationsPanel } from "./NotificationsPanel.tsx";
import { UsageChart } from "./UsageChart.tsx";
import { ServerOperations } from "./ServerOperations.tsx";
import { ObservabilityPanel } from "./ObservabilityPanel.tsx";

type Account = {
  id: string;
  name: string;
  plan: string;
  subscription_status: string;
  trial_until: number;
  billing_provider?: string | null;
  billing_until?: number | null;
  server_count: number;
  limits: {
    name: string;
    servers: number;
    organizations: number;
    aiDaily: number;
    retentionDays: number;
  };
  ai_usage: { calls: number; tokens: number };
};
type Me = {
  user: Principal;
  account: Account;
  organizations: Organization[];
  platform_admin?: boolean;
};
type Config = {
  ai: boolean;
  billing: boolean;
  webhook: boolean;
  ai_provider?: string | null;
  ai_model?: string | null;
};
type Page =
  | "urls"
  | "overview"
  | "servers"
  | "clients"
  | "alerts"
  | "assistant"
  | "integrations"
  | "team"
  | "billing"
  | "settings"
  | "platform";
type Enrollment = {
  server_id: string;
  enrollment_token: string;
  expires_at: number;
};
const ErrorContext = createContext("");
const navigation = [
  { id: "overview", title: "Visão geral", icon: LayoutDashboard },
  { id: "servers", title: "Servidores", icon: ServerIcon },
  { id: "urls", title: "Monitoramento de URLs", icon: Globe },
  { id: "clients", title: "Clientes", icon: Building2 },
  { id: "alerts", title: "Alertas", icon: Bell },
  { id: "assistant", title: "Assistente", icon: Sparkles },
  { id: "integrations", title: "Integrações MCP", icon: Network },
  { id: "team", title: "Equipe e acessos", icon: Users },
  { id: "billing", title: "Plano e consumo", icon: CreditCard },
  { id: "settings", title: "Configurações", icon: Settings2 },
  { id: "platform", title: "Administração da plataforma", icon: ShieldCheck },
] as const;

function Logo({ small = false }: { small?: boolean }) {
  const branding = useBranding();
  return (
    <div className={"brand " + (small ? "small" : "")}>
      {branding.logo ? (
        <img
          className="platform-logo-image"
          src={branding.logo}
          alt={branding.name}
        />
      ) : (
        <span className="fox-mark">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M4 3 13 9 19 9 28 3 26 21 16 29 6 21Z"
              fill="currentColor"
            />
            <path d="m8 14 8 5 8-5-3 8H11Z" fill="#14171d" />
            <path d="m13 22 3 3 3-3Z" fill="#14171d" />
          </svg>
        </span>
      )}
      <span>
        {branding.name === "SparkeOPS" ? (
          <>
            fox<span className="brand-light">ops</span>
          </>
        ) : (
          branding.name
        )}
        <small>LINUX MONITORING</small>
      </span>
    </div>
  );
}
function Status({ server }: { server: Server }) {
  const state =
    !server.enabled && server.last_seen !== null ? "disabled" : server.status;
  return (
    <span className={"status " + state}>
      <i />
      {
        (
          {
            online: "Online",
            offline: "Offline",
            awaiting: tx("Aguardando"),
            disabled: tx("Desativado"),
          } as Record<string, string>
        )[state]
      }
    </span>
  );
}
function Empty({
  icon = <ServerIcon size={28} />,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Metric({
  value,
  color = "green",
}: {
  value?: number | null;
  color?: string;
}) {
  return (
    <div className="metric">
      <span>{pct(value)}</span>
      <div>
        <i
          className={value != null && value >= 90 ? "red" : color}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}
function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-button"
      title={tx("Copiar")}
      aria-label={tx("Copiar")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={16} /> : <Clipboard size={16} />}
    </button>
  );
}
function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const error = useContext(ErrorContext);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={tx("Fechar")}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}
function Code({ text }: { text: string }) {
  return (
    <div className="code">
      <pre>{text}</pre>
      <Copy text={text} />
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null>(null),
    [config, setConfig] = useState<Config>({
      ai: false,
      billing: false,
      webhook: false,
    });
  const [loading, setLoading] = useState(true),
    [page, setPage] = useState<Page>("overview"),
    [org, setOrg] = useState("all");
  const [servers, setServers] = useState<Server[]>([]),
    [newServerIcon, setNewServerIcon] = useState<ServerIconId>("server"),
    [alerts, setAlerts] = useState<Alert[]>([]),
    [search, setSearch] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<"server" | "client" | "install" | null>(
      null,
    ),
    [enrollment, setEnrollment] = useState<Enrollment | null>(null),
    [selected, setSelected] = useState<Server | null>(null);
  const [assistantAlert, setAssistantAlert] = useState<Alert | null>(null);
  const [updated, setUpdated] = useState<number>();
  const refresh = useCallback(async () => {
    const user = await api<Me>("/me");
    setMe(user);
    const [s, a, c, aiStatus] = await Promise.all([
      api<Server[]>("/servers"),
      api<Alert[]>("/alerts"),
      api<Config>("/api/config"),
      api<{ enabled: boolean; provider: string | null; model: string | null }>(
        "/ai/status",
      ),
    ]);
    setServers(s);
    setAlerts(a);
    setConfig({
      ...c,
      ai: aiStatus.enabled,
      ai_provider: aiStatus.provider,
      ai_model: aiStatus.model,
    });
    setUpdated(Date.now());
  }, []);
  useEffect(() => {
    refresh()
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (me && org !== "all" && !me.organizations.some((o) => o.id === org))
      setOrg("all");
  }, [me?.account.id, me?.organizations, org]);
  useEffect(() => {
    if (!me) return;
    const interval = setInterval(() => {
      void refresh().catch(() =>
        setError(
          tx(
            "Não foi possível atualizar. Verifique sua conexão ou entre novamente.",
          ),
        ),
      );
    }, 15000);
    return () => clearInterval(interval);
  }, [!!me, refresh]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const run = async (fn: () => Promise<unknown>, message?: string) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const accountLink = new URLSearchParams(location.hash.slice(1));
  if (
    accountLink.has("reset") ||
    accountLink.has("confirm-email") ||
    accountLink.has("confirm-account")
  )
    return (
      <AccountRecovery
        kind={
          accountLink.has("reset")
            ? "reset"
            : accountLink.has("confirm-account")
              ? "confirm-account"
              : "confirm-email"
        }
        token={
          accountLink.get("reset") ??
          accountLink.get("confirm-email") ??
          accountLink.get("confirm-account") ??
          ""
        }
        onBack={() => {
          history.replaceState(null, "", "/");
          location.reload();
        }}
      />
    );
  if (loading)
    return (
      <div className="loading">
        <Logo />
        <span>{tx("Preparando seu ambiente…")}</span>
      </div>
    );
  if (!me)
    return (
      <Auth
        onSuccess={async () => {
          setLoading(true);
          await refresh();
          setLoading(false);
        }}
      />
    );
  const filtered = servers.filter(
    (s) =>
      (org === "all" || s.organization === org) &&
      (s.name + " " + s.organization_name)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const activeAlerts = alerts.filter(
    (a) => !a.resolved_at && (org === "all" || a.organization === org),
  );
  const canManage = me.user.role !== "reader",
    canAdmin = ["owner", "admin"].includes(me.user.role);
  const navigate = (next: Page) => {
    setAssistantAlert(null);
    setPage(next);
    setSelected(null);
    setSearch("");
    setMenu(false);
    setError("");
  };
  const newServer = () => {
    setEnrollment(null);
    setModal("server");
  };
  const install = (e: Enrollment) => {
    setEnrollment(e);
    setModal("install");
  };
  const contentProps = { me, config, run, busy, notice: setNotice };
  return (
    <ErrorContext.Provider value={error}>
      <div className="app-shell">
        <aside className={menu ? "sidebar open" : "sidebar"}>
          <Logo />
          <div className="workspace">
            <span className="workspace-avatar">
              {me.account.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{me.account.name}</strong>
              <small>Workspace</small>
            </div>
            <ChevronDown size={15} />
          </div>
          <div className="nav-label">{tx("MONITORAMENTO")}</div>
          <nav>
            {navigation
              .filter(
                (n) =>
                  !["team", "billing", "settings", "platform"].includes(n.id),
              )
              .map((n) => (
                <button
                  key={n.id}
                  className={page === n.id ? "active" : ""}
                  onClick={() => navigate(n.id)}
                >
                  <n.icon size={18} />
                  {tx(n.title)}
                  {n.id === "alerts" && activeAlerts.length > 0 && (
                    <em>{activeAlerts.length}</em>
                  )}
                  {n.id === "assistant" && (
                    <span className="nav-ai">{tx("IA")}</span>
                  )}
                </button>
              ))}
          </nav>
          <div className="nav-label manage-label">WORKSPACE</div>
          <nav>
            {navigation
              .filter((n) =>
                ["team", "billing", "settings", "platform"].includes(n.id),
              )
              .filter(
                (n) =>
                  (n.id !== "team" || canAdmin) &&
                  (n.id !== "platform" || me.platform_admin),
              )
              .map((n) => (
                <button
                  key={n.id}
                  className={page === n.id ? "active" : ""}
                  onClick={() => navigate(n.id)}
                >
                  <n.icon size={18} />
                  {tx(n.title)}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="plan-box">
              <div>
                <Zap size={15} />
                <strong>{tx(me.account.limits.name)}</strong>
                <span>
                  {me.account.server_count}/{me.account.limits.servers}
                </span>
              </div>
              <div className="plan-progress">
                <i
                  style={{
                    width: `${Math.min(100, (me.account.server_count / me.account.limits.servers) * 100)}%`,
                  }}
                />
              </div>
              <button onClick={() => navigate("billing")}>
                {tx("Ver meu plano")}
                <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="profile">
              <span className="avatar">
                {me.user.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{me.user.name}</strong>
                <small>{tx(roleName[me.user.role])}</small>
              </div>
              <button
                className="icon-button"
                title={tx("Sair")}
                aria-label={tx("Sair")}
                onClick={() => {
                  void api("/api/auth/logout", {}).then(() => setMe(null));
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              aria-label={tx("Abrir menu")}
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              Workspace <ChevronRight size={13} />
              <strong>
                {tx(navigation.find((n) => n.id === page)?.title ?? "")}
              </strong>
            </div>
            <div className="top-right">
              <span className="live">
                <i />
                {tx("Atualiza a cada 15s")}
              </span>
              <button
                className="icon-button"
                title={tx("Atualizar")}
                aria-label={tx("Atualizar")}
                onClick={() => void run(refresh)}
              >
                <RefreshCw size={17} className={busy ? "spin" : ""} />
              </button>
              <button
                className="icon-button alert-button"
                aria-label={tx("Ver alertas")}
                onClick={() => navigate("alerts")}
              >
                <Bell size={18} />
                {activeAlerts.length > 0 && <i />}
              </button>
              <span className="avatar mini">
                {me.user.name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          </header>
          <main>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {tx("SEU AMBIENTE, SOB CONTROLE")}
                </div>
                <h1>
                  {selected
                    ? selected.name
                    : tx(navigation.find((n) => n.id === page)?.title ?? "")}
                </h1>
                <p>
                  {selected
                    ? tx`${selected.organization_name} · Detalhes e histórico do servidor`
                    : {
                        overview: tx(
                          "Um olhar completo sobre a saúde da sua infraestrutura.",
                        ),
                        urls: tx("Acompanhe sites e APIs em um só lugar."),
                        servers: tx(
                          "Acompanhe cada servidor. Antecipe o próximo problema.",
                        ),
                        clients: tx(
                          "Todos os seus clientes, cada um no seu próprio ambiente.",
                        ),
                        alerts: tx(
                          "O que precisa de atenção, antes de virar um problema.",
                        ),
                        assistant: tx(
                          "Transforme métricas em próximos passos.",
                        ),
                        integrations: tx(
                          "Sua infraestrutura, conectada às ferramentas de IA.",
                        ),
                        team: tx("As pessoas certas, com os acessos certos."),
                        billing: tx(
                          "Um plano que acompanha o seu crescimento.",
                        ),
                        platform: tx(
                          "Gerencie empresas, workspaces e acessos de toda a plataforma.",
                        ),
                        settings: tx(
                          "Preferências e rastreabilidade do seu workspace.",
                        ),
                      }[page]}
                </p>
              </div>
              <div className="heading-actions">
                {["overview", "servers"].includes(page) && canManage && (
                  <button className="primary" onClick={newServer}>
                    <Plus size={17} />
                    {tx("Adicionar servidor")}
                  </button>
                )}
                {page === "clients" && canAdmin && (
                  <button
                    className="primary"
                    onClick={() => setModal("client")}
                  >
                    <Plus size={17} />
                    {tx("Novo cliente")}
                  </button>
                )}
              </div>
            </div>
            {error && (
              <div className="banner error" role="alert">
                {error}
                <button
                  className="icon-button"
                  aria-label={tx("Fechar erro")}
                  onClick={() => setError("")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {notice && (
              <div className="toast" role="status">
                <CheckCheck size={18} />
                {notice}
              </div>
            )}
            {selected ? (
              <ServerDetail
                role={me.user.role}
                server={servers.find((s) => s.id === selected.id) ?? selected}
                canManage={canManage}
                back={() => setSelected(null)}
                run={run}
                busy={busy}
                install={install}
              />
            ) : (
              <>
                {["overview", "servers", "alerts"].includes(page) && (
                  <div className="filterbar">
                    <div className="select-wrap">
                      <Building2 size={15} />
                      <select
                        aria-label={tx("Filtrar por cliente")}
                        value={org}
                        onChange={(e) => setOrg(e.target.value)}
                      >
                        <option value="all">{tx("Todos os clientes")}</option>
                        {me.organizations.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="updated">
                      <Clock3 size={13} />
                      {tx("Última atualização")}{" "}
                      {updated
                        ? new Date(updated).toLocaleTimeString(getLanguage(), {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </span>
                  </div>
                )}
                {page === "overview" && (
                  <Overview
                    servers={filtered}
                    alerts={activeAlerts}
                    clients={org === "all" ? me.organizations.length : 1}
                    newServer={canManage ? newServer : undefined}
                    onServer={setSelected}
                    navigate={navigate}
                  />
                )}
                {page === "servers" && (
                  <section className="panel">
                    <div className="panel-head">
                      <h2>
                        {tx("Inventário de servidores")}{" "}
                        <span className="count">{filtered.length}</span>
                      </h2>
                      <label className="search">
                        <Search size={15} />
                        <input
                          aria-label={tx("Buscar servidor")}
                          placeholder={tx("Buscar servidor…")}
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                    </div>
                    <ServerTable
                      servers={filtered}
                      onServer={setSelected}
                      newServer={canManage ? newServer : undefined}
                    />
                  </section>
                )}
                {page === "clients" && (
                  <div className="client-grid">
                    {me.organizations.map((o) => {
                      const list = servers.filter(
                        (s) => s.organization === o.id,
                      );
                      const problems = alerts.filter(
                        (a) => a.organization === o.id && !a.resolved_at,
                      ).length;
                      return (
                        <button
                          key={o.id}
                          className="panel client-card"
                          onClick={() => {
                            setOrg(o.id);
                            navigate("servers");
                          }}
                        >
                          <div className="client-icon">
                            <Building2 size={23} />
                            <ArrowUpRight size={16} />
                          </div>
                          <h2>{o.name}</h2>
                          <p>
                            {tx("Ambiente isolado ·")}
                            {list.length}
                            {tx("servidor(es)")}
                          </p>
                          <div className="client-stats">
                            <span>
                              <i className="dot green" />
                              {
                                list.filter(
                                  (s) => s.status === "online" && s.enabled,
                                ).length
                              }{" "}
                              online
                            </span>
                            <span className={problems ? "text-red" : ""}>
                              {problems}
                              {tx("alertas ativos")}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {page === "alerts" && (
                  <AlertHistory
                    onAssistant={(alert) => {
                      navigate("assistant");
                      setAssistantAlert(alert);
                    }}
                    organization={org}
                    servers={servers}
                    canManage={canManage}
                    onAck={(id) =>
                      void run(
                        () => api(`/alerts/${id}/acknowledge`, {}),
                        tx("Alerta reconhecido."),
                      )
                    }
                    busy={busy}
                  />
                )}
                {page === "assistant" && (
                  <Assistant
                    key={assistantAlert?.id ?? "assistant"}
                    initialAlert={assistantAlert}
                    {...contentProps}
                    organizations={me.organizations}
                    servers={servers}
                  />
                )}
                {page === "integrations" && (
                  <Integrations
                    {...contentProps}
                    organizations={me.organizations}
                  />
                )}
                {page === "team" && (
                  <Team {...contentProps} organizations={me.organizations} />
                )}
                {page === "urls" && (
                  <URLMonitoringPage
                    organizations={me.organizations}
                    role={me.user.role}
                  />
                )}
                {page === "billing" && <BillingPage {...contentProps} />}
                {page === "settings" && (
                  <Settings
                    {...contentProps}
                    onOpenPlatform={() => navigate("platform")}
                  />
                )}
                {page === "platform" && me.platform_admin && (
                  <PlatformAdminPanel userId={me.user.userId} />
                )}
              </>
            )}
            <footer>
              <Logo small />
              <span>{tx("Observabilidade Linux, com contexto.")}</span>
              <span className="footer-secure">
                <ShieldCheck size={13} />
                {tx("Conexões autenticadas · Acesso por cliente")}
              </span>
            </footer>
          </main>
        </div>
        {modal === "server" && (
          <Dialog
            title={tx("Adicionar servidor Linux")}
            close={() => setModal(null)}
          >
            <p className="muted">
              {tx(
                "Escolha o cliente e dê um nome ao servidor. Depois, instale o agente para começar a receber métricas.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () =>
                  install(
                    await api<Enrollment>("/servers", {
                      name: f.get("name"),
                      icon: newServerIcon,
                      organization: f.get("organization"),
                    }),
                  ),
                );
              }}
            >
              <label>
                {tx("Cliente")}
                <select
                  name="organization"
                  required
                  defaultValue={org === "all" ? me.organizations[0]?.id : org}
                >
                  {me.organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tx("Nome do servidor")}
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder={tx("Ex.: producao-web-01")}
                  autoFocus
                />
              </label>
              <ServerIconPicker
                value={newServerIcon}
                onChange={setNewServerIcon}
                disabled={busy}
              />
              <button
                className="primary full"
                disabled={busy || !me.organizations.length}
              >
                <Plus size={17} />
                {tx("Cadastrar e instalar agente")}
              </button>
            </form>
          </Dialog>
        )}
        {modal === "client" && (
          <Dialog title={tx("Novo cliente")} close={() => setModal(null)}>
            <p className="muted">
              {tx(
                "Os servidores, métricas e acessos deste cliente ficam em um ambiente separado.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await api("/organizations", { name: f.get("name") });
                  setModal(null);
                }, tx("Cliente criado."));
              }}
            >
              <label>
                {tx("Nome da empresa")}
                <input
                  name="name"
                  required
                  maxLength={120}
                  autoFocus
                  placeholder={tx("Ex.: Acme Tecnologia")}
                />
              </label>
              <button className="primary full" disabled={busy}>
                {tx("Criar cliente")}
              </button>
            </form>
          </Dialog>
        )}
        {modal === "install" && enrollment && (
          <Dialog
            title={tx("Conecte seu servidor")}
            close={() => setModal(null)}
          >
            <div className="step">
              <span>1</span>
              <div>
                <h3>{tx("No terminal do servidor Linux")}</h3>
                <p>
                  {tx(
                    "Baixe o instalador e execute com permissão de administrador.",
                  )}
                </p>
              </div>
            </div>
            <Code
              text={`curl -fsS '${location.origin}/agent/install.sh' -o /tmp/foxops-install.sh\nsudo bash /tmp/foxops-install.sh '${location.origin}'${location.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ? " --allow-lan-http" : ""}`}
            />
            <div className="step">
              <span>2</span>
              <div>
                <h3>{tx("Informe este token quando solicitado")}</h3>
                <p>
                  {tx("Uso único. Válido até")}
                  {stamp(enrollment.expires_at)}.
                </p>
              </div>
            </div>
            <Code text={enrollment.enrollment_token} />
            <AgentActivationGuide />
            <div className="banner info">
              <ShieldCheck size={18} />
              <span>
                {tx(
                  "O agente coleta métricas e se conecta por saída. Nenhum comando remoto é executado.",
                )}
              </span>
            </div>
            <p className="muted">
              {tx(
                "Endereços localhost exigem um túnel até esta máquina. Para servidores remotos, publique a aplicação com HTTPS.",
              )}
            </p>
            <button className="primary full" onClick={() => setModal(null)}>
              {tx("Entendi, acompanhar servidor")}
              <ArrowRight size={16} />
            </button>
          </Dialog>
        )}
      </div>
    </ErrorContext.Provider>
  );
}

function Auth({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [pendingEmail, setPendingEmail] = useState<string | null>(null),
    [confirmationEnabled, setConfirmationEnabled] = useState(false);
  useEffect(() => {
    void api<{ confirmation_required: boolean }>("/api/auth/account-policy")
      .then((result) => setConfirmationEnabled(result.confirmation_required))
      .catch(() => {});
  }, []);
  const [forgot, setForgot] = useState(false);
  const branding = useBranding();
  const invite = new URLSearchParams(location.hash.slice(1)).get("invite");
  const [mode, setMode] = useState<"login" | "signup">(
      invite ? "signup" : "login",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const captcha = useCaptcha(invite ? "signup" : mode);
  if (pendingEmail !== null)
    return (
      <AccountConfirmationPending
        email={pendingEmail}
        onBack={() => {
          setPendingEmail(null);
          setMode("login");
        }}
      />
    );
  if (forgot)
    return <AccountRecovery kind="forgot" onBack={() => setForgot(false)} />;
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Logo />
        <div className="auth-copy">
          <span className="pill">
            <i className="dot green" />
            {tx("LINUX. CONTEXTO. CONTROLE.")}
          </span>
          <h1>
            {tx("Sua infraestrutura.")}
            <br />
            {tx("Sem pontos")}
            <br />
            <span>{tx("cegos.")}</span>
          </h1>
          <p>
            {tx(
              "Monitoramento que conecta servidores, pessoas e inteligência. Do primeiro Linux à operação de todos os seus clientes.",
            )}
          </p>
          <div className="auth-features">
            <span>
              <Activity size={18} />
              {tx("Métricas e alertas contínuos")}
            </span>
            <span>
              <Building2 size={18} />
              {tx("Múltiplos clientes, um painel")}
            </span>
            <span>
              <Sparkles size={18} />
              {tx("Assistente integrado + MCP")}
            </span>
          </div>
        </div>
        <div className="auth-bottom">
          <ShieldCheck size={16} />
          {tx("Sua operação merece clareza.")}
        </div>
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
      </section>
      <section className="auth-form">
        <div>
          <span className="eyebrow">{tx`Bem-vindo a ${branding.name}`}</span>
          <h2>
            {invite
              ? tx("Você foi convidado")
              : mode === "login"
                ? tx("Bom ter você por aqui.")
                : tx("Sua operação começa aqui.")}
          </h2>
          <p>
            {invite
              ? tx("Crie seu acesso ou use a senha da sua conta existente.")
              : mode === "login"
                ? tx("Entre para acompanhar o seu ambiente.")
                : tx("Crie sua conta. Avaliação de 14 dias, até 5 servidores.")}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              if (!captcha.canSubmit) {
                setError(tx("Conclua a verificação de segurança."));
                return;
              }
              setBusy(true);
              const data = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const result = await api<{
                  verification_required?: boolean;
                  email?: string;
                }>(invite ? "/api/auth/accept-invite" : `/api/auth/${mode}`, {
                  ...data,
                  ...(invite ? { token: invite } : {}),
                  captcha_token: captcha.token,
                });
                if (result.verification_required) {
                  if (invite) history.replaceState(null, "", "/");
                  setPendingEmail(result.email ?? String(data.email ?? ""));
                  return;
                }
                if (invite) history.replaceState(null, "", "/");
                await onSuccess();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                captcha.reset();
                setBusy(false);
              }
            }}
          >
            {(mode === "signup" || invite) && (
              <label>
                {tx("Seu nome")}
                <input
                  name="name"
                  placeholder={tx("Como podemos chamar você?")}
                  required={!invite}
                  autoComplete="name"
                />
              </label>
            )}
            {mode === "signup" && !invite && (
              <label>
                {tx("Empresa ou operação")}
                <input
                  name="company"
                  placeholder={tx("Nome do seu workspace")}
                  required
                  maxLength={120}
                />
              </label>
            )}
            {!invite && (
              <label>
                {tx("E-mail")}
                <input
                  name="email"
                  type="email"
                  placeholder="voce@empresa.com.br"
                  required
                  autoComplete="email"
                />
              </label>
            )}
            <div className="auth-password-field">
              <div className="auth-password-heading">
                <label htmlFor="auth-password">{tx("Senha")}</label>
              </div>
              <input
                id="auth-password"
                name="password"
                type="password"
                placeholder={
                  mode === "signup"
                    ? tx("Pelo menos 12 caracteres")
                    : tx("Sua senha")
                }
                minLength={mode === "signup" && !invite ? 12 : undefined}
                maxLength={128}
                required
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </div>
            {error && (
              <div className="banner error" role="alert">
                {error}
              </div>
            )}
            {captcha.element}
            <button
              className="primary full"
              disabled={busy || !captcha.canSubmit}
            >
              {busy
                ? tx("Aguarde…")
                : invite
                  ? tx("Aceitar convite")
                  : mode === "login"
                    ? tx("Entrar no workspace")
                    : tx("Criar minha conta")}
              <ArrowRight size={17} />
            </button>
            {!invite && mode === "login" && (
              <button
                type="button"
                className="auth-forgot-link auth-forgot-below"
                disabled={busy}
                onClick={() => setForgot(true)}
              >
                {tx("Esqueci minha senha")}
              </button>
            )}
          </form>
          {confirmationEnabled && (
            <p className="auth-switch">
              <button type="button" onClick={() => setPendingEmail("")}>
                {tx("Reenviar confirmação de conta")}
              </button>
            </p>
          )}
          {!invite && (
            <p className="auth-switch">
              {mode === "login"
                ? tx("Ainda não tem uma conta?")
                : tx("Já tem uma conta?")}{" "}
              <button
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setError("");
                }}
              >
                {mode === "login" ? tx("Começar agora") : tx("Entrar")}
              </button>
            </p>
          )}
          <div className="auth-note">
            <ShieldCheck size={15} />
            {tx("Senhas protegidas e acesso isolado por cliente.")}
          </div>
        </div>
      </section>
    </div>
  );
}

function Overview({
  servers,
  alerts,
  clients,
  newServer,
  onServer,
  navigate,
}: {
  servers: Server[];
  alerts: Alert[];
  clients: number;
  newServer?: () => void;
  onServer: (s: Server) => void;
  navigate: (p: Page) => void;
}) {
  const online = servers.filter(
    (s) => s.enabled && s.status === "online",
  ).length;
  const offline = servers.filter(
    (s) => s.enabled && s.status === "offline",
  ).length;
  return (
    <>
      <div className="stat-grid">
        {[
          {
            icon: ServerIcon,
            label: tx("Servidores monitorados"),
            value: servers.length,
            note: tx`${clients} cliente(s) conectado(s)`,
            color: "blue",
          },
          {
            icon: Wifi,
            label: tx("Servidores online"),
            value: online,
            note: servers.length
              ? tx`${Math.round((online / servers.length) * 100)}% do inventário com coleta recente`
              : tx("Aguardando sua primeira conexão"),
            color: "green",
          },
          {
            icon: Bell,
            label: tx("Alertas ativos"),
            value: alerts.length,
            note: alerts.length
              ? tx("Precisam da sua atenção")
              : tx("Nenhum incidente ativo"),
            color: alerts.length ? "orange" : "green",
          },
          {
            icon: Activity,
            label: tx("Sem comunicação"),
            value: offline,
            note: offline
              ? tx("Verifique os agentes e a rede")
              : tx("Nenhum servidor offline"),
            color: "purple",
          },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <div>
              <span>{s.label}</span>
              <span className={"stat-icon " + s.color}>
                <s.icon size={18} />
              </span>
            </div>
            <strong>
              {s.value}
              <small>
                {s.label === tx("Alertas ativos") && s.value === 0 ? (
                  <Check size={16} />
                ) : null}
              </small>
            </strong>
            <p>
              <i className={"dot " + s.color} />
              {s.note}
            </p>
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel inventory">
          <div className="panel-head">
            <h2>
              <ServerIcon size={18} />
              {tx("Seus servidores")}
              <span className="count">{servers.length}</span>
            </h2>
            <button className="text-button" onClick={() => navigate("servers")}>
              {tx("Ver todos")}
              <ArrowRight size={14} />
            </button>
          </div>
          <ServerTable
            servers={servers.slice(0, 6)}
            onServer={onServer}
            newServer={newServer}
          />
        </section>
        <section className="panel attention">
          <div className="panel-head">
            <h2>
              <Bell size={18} />
              {tx("Em atenção")}
            </h2>
            <span className="count">{alerts.length}</span>
          </div>
          {alerts.length ? (
            <div className="attention-list">
              {alerts.slice(0, 4).map((a) => (
                <button key={a.id} onClick={() => navigate("alerts")}>
                  <span className={"alert-symbol " + a.severity}>
                    <Activity size={16} />
                  </span>
                  <div>
                    <strong>{a.server_name}</strong>
                    <p>{a.message}</p>
                    <small>{stamp(a.opened_at)}</small>
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon={<ShieldCheck size={30} />}
              title={tx("Tudo tranquilo por aqui")}
            >
              {tx(
                "Os incidentes aparecem aqui quando uma regra de alerta é acionada.",
              )}
            </Empty>
          )}
          <div className="panel-foot">
            <span className="dot green" />
            {tx("Monitoramento independente de IA")}
          </div>
        </section>
      </div>
      <section className="assistant-banner">
        <div className="sparkle-tile">
          <Sparkles size={26} />
        </div>
        <div>
          <span className="eyebrow">{tx("MENOS RUÍDO. MAIS CONTEXTO.")}</span>
          <h2>{tx("Suas métricas têm uma história para contar.")}</h2>
          <p>
            {tx(
              "Investigue seu ambiente com o assistente ou conecte sua própria IA via MCP.",
            )}
          </p>
        </div>
        <button onClick={() => navigate("assistant")}>
          {tx("Explorar assistente")}
          <ArrowUpRight size={17} />
        </button>
      </section>
      <div className="bottom-grid">
        <div className="panel quickstart">
          <span className="section-kicker">{tx("SEU PRÓXIMO PASSO")}</span>
          <h2>
            {servers.length
              ? tx("Conecte sua operação.")
              : tx("Do terminal ao painel em poucos minutos.")}
          </h2>
          <p>
            {servers.length
              ? tx(
                  "Adicione clientes, convide sua equipe e conecte ferramentas de IA com acesso de consulta.",
                )
              : tx(
                  "Cadastre um servidor, execute o instalador Linux e acompanhe as primeiras métricas neste painel.",
                )}
          </p>
          <button
            className="text-button"
            onClick={
              servers.length
                ? () => navigate("integrations")
                : (newServer ?? (() => navigate("servers")))
            }
          >
            {servers.length
              ? tx("Configurar MCP")
              : tx("Conectar primeiro servidor")}
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="panel collection">
          <div className="collection-icon">
            <Terminal size={24} />
          </div>
          <h3>{tx("Leve no servidor. Completo na operação.")}</h3>
          <p>
            {tx(
              "Coleta por agente Linux, conexão de saída e acesso de consulta. Você mantém o controle.",
            )}
          </p>
          <div>
            <span>
              <Cpu size={14} />
              CPU
            </span>
            <span>
              <Database size={14} />
              {tx("Memória")}
            </span>
            <span>
              <HardDrive size={14} />
              {tx("Disco")}
            </span>
            <span>
              <Network size={14} />
              {tx("Rede")}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function ServerTable({
  servers,
  onServer,
  newServer,
}: {
  servers: Server[];
  onServer: (s: Server) => void;
  newServer?: () => void;
}) {
  if (!servers.length)
    return (
      <Empty
        title={tx("Seu próximo servidor começa aqui")}
        action={
          newServer && (
            <button className="secondary" onClick={newServer}>
              <Plus size={16} />
              {tx("Adicionar servidor")}
            </button>
          )
        }
      >
        {tx(
          "Conecte um servidor Linux para acompanhar métricas reais, estado do agente e alertas.",
        )}
      </Empty>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{tx("SERVIDOR / CLIENTE")}</th>
            <th>STATUS</th>
            <th>CPU</th>
            <th>{tx("MEMÓRIA")}</th>
            <th>{tx("DISCO")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {servers.map((s) => (
            <tr key={s.id}>
              <td>
                <button className="server-link" onClick={() => onServer(s)}>
                  <span className="server-tile">
                    <ServerVisualIcon icon={s.icon} size={21} />
                  </span>
                  <span>
                    <strong>{s.name}</strong>
                    <small>{s.organization_name}</small>
                  </span>
                </button>
              </td>
              <td>
                <Status server={s} />
              </td>
              <td>
                <Metric value={s.metrics?.cpu_percent} />
              </td>
              <td>
                <Metric value={s.metrics?.memory_percent} color="purple" />
              </td>
              <td>
                <Metric value={s.metrics?.disk_percent} color="blue" />
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={tx`Detalhes de ${s.name}`}
                  onClick={() => onServer(s)}
                >
                  <ChevronRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, message?: string) => Promise<void>;
type Shared = {
  me: Me;
  config: Config;
  run: Run;
  busy: boolean;
  notice: (message: string) => void;
};
function ServerDetail({
  role,
  server,
  canManage,
  back,
  run,
  busy,
  install,
}: {
  role: string;
  server: Server;
  canManage: boolean;
  back: () => void;
  run: Run;
  busy: boolean;
  install: (e: Enrollment) => void;
}) {
  const [rules, setRules] = useState<Record<string, number> | null>(null),
    [error, setError] = useState("");
  const [editingIcon, setEditingIcon] = useState(false),
    [iconDraft, setIconDraft] = useState<ServerIconId>(server.icon ?? "server");
  useEffect(() => {
    let cancelled = false;
    api<Record<string, number>>(`/servers/${server.id}/rules`)
      .then((r) => {
        if (!cancelled) setRules(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [server.id]);
  return (
    <>
      <button className="text-button back" onClick={back}>
        {tx("← Voltar ao inventário")}
      </button>
      {error && <div className="banner error">{error}</div>}
      <div className="detail-top panel">
        <div>
          <Status server={server} />
          <h2 className="server-detail-identity">
            <ServerVisualIcon icon={server.icon} size={28} />
            {server.name}
          </h2>
          {canManage && (
            <button
              className="secondary server-change-icon"
              aria-haspopup="dialog"
              aria-expanded={editingIcon}
              onClick={() => {
                setIconDraft(server.icon ?? "server");
                setEditingIcon(true);
              }}
            >
              {tx("Alterar logo ou ícone")}
            </button>
          )}
          <p>
            {tx("Última coleta:")}
            {stampSeconds(server.last_seen)}
          </p>
          <p className="muted">
            {tx(
              "Coletas a cada ~30 segundos · Painel atualiza a cada 15 segundos · Valores com duas casas decimais",
            )}
          </p>
        </div>
        <div className="detail-metrics">
          <span>
            CPU<strong>{pct(server.metrics?.cpu_percent)}</strong>
          </span>
          <span>
            {tx("MEMÓRIA")}
            <strong>{pct(server.metrics?.memory_percent)}</strong>
          </span>
          <span>
            {tx("DISCO")}
            <strong>{pct(server.metrics?.disk_percent)}</strong>
          </span>
        </div>
      </div>
      <UsageChart
        key={server.id}
        serverId={server.id}
        lastSeen={server.last_seen}
      />
      {editingIcon && canManage && (
        <Dialog
          title={tx("Alterar logo ou ícone")}
          close={() => setEditingIcon(false)}
        >
          <ServerIconPicker
            value={iconDraft}
            onChange={setIconDraft}
            disabled={busy}
          />
          <div className="action-row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(
                    `/servers/${server.id}/icon`,
                    { icon: iconDraft },
                    "PATCH",
                  );
                  setEditingIcon(false);
                }, tx("Ícone do servidor atualizado."))
              }
            >
              {tx("Salvar ícone")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setEditingIcon(false)}
            >
              {tx("Cancelar")}
            </button>
          </div>
        </Dialog>
      )}
      <ServerOperations
        key={`operations-${server.id}`}
        server={server}
        role={role}
      />
      <ObservabilityPanel
        key={`observability-${server.id}`}
        serverId={server.id}
        role={role}
      />
      <div className="bottom-grid">
        <PersistentDetails
          storageKey={"server:" + server.id + ":rules"}
          className="panel padded collapsible-panel"
        >
          <summary className="collapsible-heading">
            <h2>
              <Settings2 size={18} />
              {tx("Regras de alerta")}
            </h2>
          </summary>
          <p className="muted">
            {tx(
              "O alerta abre quando o limite permanece excedido durante a janela configurada.",
            )}
          </p>
          {rules && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => api(`/servers/${server.id}/rules`, rules, "PUT"),
                  tx("Regras salvas."),
                );
              }}
            >
              <div className="rules-grid">
                {Object.entries({
                  cpu: "CPU (%)",
                  memory: tx("Memória (%)"),
                  disk: tx("Disco (%)"),
                  offline: tx("Sem comunicação (s)"),
                  duration: tx("Duração mínima (s)"),
                }).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min={key === "duration" ? 0 : key === "offline" ? 60 : 1}
                      max={
                        key === "offline"
                          ? 3600
                          : key === "duration"
                            ? 900
                            : 100
                      }
                      disabled={!canManage}
                      value={rules[key]}
                      onChange={(e) =>
                        setRules({ ...rules, [key]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
              {canManage && (
                <button className="secondary" disabled={busy}>
                  {tx("Salvar regras")}
                </button>
              )}
            </form>
          )}
        </PersistentDetails>
        <PersistentDetails
          storageKey={"server:" + server.id + ":agent"}
          className="panel padded collapsible-panel"
        >
          <summary className="collapsible-heading">
            <h2>
              <Terminal size={18} />
              {tx("Agente e sistema")}
            </h2>
          </summary>
          <p className="muted">
            {tx("Informações da última coleta, sem execução remota.")}
          </p>
          <dl className="details-list">
            <dt>{tx("Hostname")}</dt>
            <dd>{String(server.details?.hostname ?? "—")}</dd>
            <dt>{tx("Sistema")}</dt>
            <dd>{String(server.details?.os ?? "—")}</dd>
            <dt>Uptime</dt>
            <dd>
              {typeof server.details?.uptime_seconds === "number"
                ? tx`${Math.floor(server.details.uptime_seconds / 3600)} horas`
                : "—"}
            </dd>
            <dt>{tx("Rede recebida / enviada")}</dt>
            <dd>
              {typeof server.details?.network_rx_bytes === "number"
                ? tx`${(server.details.network_rx_bytes / 1048576).toFixed(1)} / ${(Number(server.details.network_tx_bytes ?? 0) / 1048576).toFixed(1)} MB acumulados`
                : "—"}
            </dd>
          </dl>
          {canManage && (
            <div className="action-row">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    install(
                      await api<Enrollment>(
                        `/servers/${server.id}/enrollment`,
                        {},
                      ),
                    ),
                  )
                }
              >
                {tx("Reinstalar agente")}
              </button>
              <button
                className="danger"
                disabled={busy || !server.enabled}
                onClick={async () => {
                  if (
                    await confirmAction(
                      tx(
                        "Revogar a credencial deste agente e interromper o recebimento de métricas?",
                      ),
                    )
                  )
                    void run(
                      () => api(`/servers/${server.id}/revoke`, {}),
                      tx("Credencial revogada."),
                    );
                }}
              >
                {tx("Revogar acesso")}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirmAction(
                      tx`Remover ${server.name} do painel e revogar seu agente? O histórico será preservado durante a retenção do plano.`,
                      {
                        confirmationWord: SERVER_REMOVAL_WORD,
                        destructive: true,
                        title: tx("Remover servidor"),
                      },
                    )
                  )
                    void run(async () => {
                      await api(`/servers/${server.id}/archive`, {
                        confirmation: SERVER_REMOVAL_WORD,
                      });
                      back();
                    }, tx("Servidor removido do painel."));
                }}
              >
                <Trash2 size={15} />
                {tx("Remover servidor")}
              </button>
            </div>
          )}
        </PersistentDetails>
      </div>
    </>
  );
}

function Assistant({
  me,
  initialAlert,
  organizations,
  servers,
  config,
  run,
  busy,
}: Shared & {
  initialAlert?: Alert | null;
  organizations: Organization[];
  servers: Server[];
}) {
  const branding = useBranding();
  const [operatorMode, setOperatorMode] = useState(true);
  const contextPreferenceKey = `foxops-chat-context:${me.user.userId}:${me.account.id}`;
  const [useContext, setUseContext] = useState(() => {
    try {
      return localStorage.getItem(contextPreferenceKey) !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      setUseContext(localStorage.getItem(contextPreferenceKey) !== "false");
    } catch {
      setUseContext(true);
    }
  }, [contextPreferenceKey]);
  const [editingAction, setEditingAction] = useState<string | null>(null),
    [commandDraft, setCommandDraft] = useState("");
  const chatErrorRef = useRef<HTMLDivElement>(null);
  const [clearedConversation, setClearedConversation] = useState<{
    id: string;
    org: string;
    server: string;
  } | null>(null);
  const [verificationProgress, setVerificationProgress] = useState("");
  const [org, setOrg] = useState(
      initialAlert?.organization ?? organizations[0]?.id ?? "",
    ),
    [question, setQuestion] = useState(
      initialAlert
        ? `Investigue este alerta no servidor ${initialAlert.server_name}: ${initialAlert.message}. Aberto em ${stamp(initialAlert.opened_at)}. ID: ${initialAlert.id}. ${initialAlert.recovery?.summary ?? ""} Verifique a causa e proponha os próximos passos.`
        : "",
    ),
    [messages, setMessages] = useState<
      {
        id: string;
        question: string;
        answer: string;
        mode: string;
        created_at: number;
        suggestions?: { service: string; action: string; reason: string }[];
        session_id?: string;
        action_id?: string | null;
        command?: string | null;
        reason?: string;
        executed?: boolean;
        status?: string;
        edited?: boolean | number;
      }[]
    >([]),
    [error, setError] = useState(""),
    [mode, setMode] = useState("auto");
  const [serverId, setServerId] = useState(
    () =>
      initialAlert?.server_id ??
      servers.find((s) => s.organization === organizations[0]?.id && s.enabled)
        ?.id ??
      servers.find((s) => s.organization === organizations[0]?.id)?.id ??
      "",
  );
  const [aiChoices, setAIChoices] = useState<{
    providers: { id: string; name: string; model: string }[];
    platform_available: boolean;
  }>({ providers: [], platform_available: false });
  useEffect(() => {
    let active = true;
    setMode("auto");
    setAIChoices({ providers: [], platform_available: false });
    void api<typeof aiChoices>("/ai/choices")
      .then((value) => {
        if (active) setAIChoices(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [me.account.id]);
  const selectedAIAvailable =
    mode === "auto"
      ? config.ai
      : mode === "platform"
        ? aiChoices.platform_available
        : aiChoices.providers.some((p) => p.id === mode);
  const [includeLogs, setIncludeLogs] = useState(false);
  const [includeProcesses, setIncludeProcesses] = useState(false);
  useEffect(() => {
    if (error)
      chatErrorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
  }, [error]);
  const usingCommands =
    operatorMode &&
    selectedAIAvailable &&
    mode !== "diagnostic" &&
    me.user.role !== "reader";
  const available = servers.filter((s) => s.organization === org);
  const targetName =
    serverId === "all"
      ? tx("todos os servidores deste cliente")
      : (available.find((s) => s.id === serverId)?.name ?? "um servidor");
  useEffect(() => {
    if (serverId !== "all" && !available.some((s) => s.id === serverId))
      setServerId(
        available.find((s) => s.enabled)?.id ?? available[0]?.id ?? "",
      );
  }, [org, servers, serverId]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setEditingAction(null);
    setCommandDraft("");
    setQuestion("");
    setError("");
    if (org && serverId)
      api<typeof messages>(
        `/chat?organization=${encodeURIComponent(org)}${serverId !== "all" ? "&server_id=" + encodeURIComponent(serverId) : ""}`,
      )
        .then((data) => {
          if (!cancelled) setMessages(data);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [org, serverId]);
  useEffect(() => setIncludeLogs(false), [org, serverId]);
  useEffect(() => setIncludeProcesses(false), [org, serverId]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);
  const send = (value: string) => {
    if (!value.trim() || busy || !org || !serverId) return;
    setError("");
    if (serverId === "all") {
      setError(
        tx(
          "Selecione um servidor específico para verificar seu pedido na máquina.",
        ),
      );
      return;
    }
    void run(async () => {
      try {
        if (historicalDateMention(value)) {
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          setVerificationProgress(
            tx(
              "Consultando histórico, alertas do dia e solicitando logs do período…",
            ),
          );
          const check = await api<{ id: string; status: string }>(
            "/assistant/history",
            {
              organization: org,
              server_id: serverId,
              question: value,
              time_zone: zone,
            },
          );
          let status = check.status;
          const deadline = Date.now() + 105000;
          while (status === "pending" && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 1800));
            status = (
              await api<{ status: string }>(`/assistant/history/${check.id}`)
            ).status;
          }
          setVerificationProgress(
            tx("Analisando as evidências históricas disponíveis…"),
          );
          const answer = await api<{
            id: string;
            answer: string;
            mode: string;
            created_at: number;
          }>("/assistant", {
            use_context: useContext,
            organization: org,
            server_id: serverId,
            question: value,
            mode,
            historical_id: check.id,
          });
          setMessages((messages) => [
            ...messages,
            { ...answer, question: value },
          ]);
          setQuestion("");
          return;
        }
        if (
          operatorMode &&
          selectedAIAvailable &&
          mode !== "diagnostic" &&
          me.user.role !== "reader"
        ) {
          setVerificationProgress(
            tx("Preparando investigação por comandos SSH…"),
          );
          const answer = await api<{
            id: string;
            answer: string;
            mode: string;
            created_at: number;
            session_id: string;
            action_id: string | null;
            command: string | null;
            reason: string;
          }>("/assistant/operator", {
            use_context: useContext,
            organization: org,
            server_id: serverId,
            question: value,
            mode,
          });
          setMessages((m) => [...m, { ...answer, question: value }]);
          setQuestion("");
          return;
        }
        setVerificationProgress(tx("Solicitando verificação no servidor…"));
        const check = await api<{ id: string }>("/assistant/checks", {
          organization: org,
          server_id: serverId,
          question: value,
          include_logs: includeLogs,
          include_processes: includeProcesses,
        });
        let completed = false;
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
          const status = await api<{ status: string }>(
            `/assistant/checks/${check.id}`,
          );
          if (status.status === "completed") {
            completed = true;
            break;
          }
          if (status.status === "expired") break;
          setVerificationProgress(
            status.status === "running"
              ? tx("O agente recebeu o pedido. Verificando na máquina…")
              : tx(
                  "Verificando no servidor… aguardando o agente receber o pedido.",
                ),
          );
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        if (!completed)
          throw new Error(
            tx(
              "O agente não concluiu a verificação a tempo. Nenhum diagnóstico atual foi confirmado. Confira conectividade e versão do agente.",
            ),
          );
        setVerificationProgress(
          tx("Verificação recebida. Analisando o resultado…"),
        );
        const answer = await api<{
          id: string;
          answer: string;
          mode: string;
          created_at: number;
          suggestions?: { service: string; action: string; reason: string }[];
        }>("/assistant", {
          use_context: useContext,
          organization: org,
          server_id: serverId === "all" ? undefined : serverId,
          question: value,
          mode,
          live_check_id: check.id,
        });
        setMessages((m) => [...m, { ...answer, question: value }]);
        setQuestion("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setVerificationProgress("");
      }
    });
  };
  return (
    <section className="panel assistant-panel">
      <div className="panel-head">
        <h2>
          <Sparkles size={18} />
          {branding.name} {tx("Assistente")}{" "}
          <span className="tag">
            {selectedAIAvailable && mode !== "diagnostic"
              ? tx`${({ openai: "OpenAI", claude: "Claude", grok: "Grok", deepseek: "DeepSeek", gemini: "Gemini", compatible: "API compatível / Local" } as Record<string, string>)[mode === "auto" ? (config.ai_provider ?? "openai") : mode === "platform" ? "openai" : mode]} conectada`
              : tx("Diagnóstico básico")}
          </span>
        </h2>
        <div className="assistant-scope-selects">
          <select
            aria-label={tx("Escolher IA")}
            disabled={busy}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="auto">{tx("Usar IA configurada")}</option>
            {aiChoices.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {tx(provider.name)} · {provider.model}
              </option>
            ))}
            {aiChoices.platform_available && (
              <option value="platform">{tx("IA da plataforma")}</option>
            )}
            <option value="diagnostic">{tx("Usar diagnóstico básico")}</option>
          </select>
          <button
            type="button"
            className="secondary"
            disabled={busy || !messages.length}
            onClick={async () => {
              if (
                !(await confirmAction(
                  tx`Limpar sua conversa sobre ${targetName}? Você poderá desfazer. As ações e a auditoria serão preservadas.`,
                ))
              )
                return;
              void run(async () => {
                try {
                  const result = await api<{ clear_id: string }>(
                    "/chat",
                    {
                      organization: org,
                      server_id: serverId === "all" ? undefined : serverId,
                    },
                    "DELETE",
                  );
                  setClearedConversation({
                    id: result.clear_id,
                    org,
                    server: serverId,
                  });
                  setMessages([]);
                  setError("");
                  setQuestion("");
                } catch (e) {
                  setError((e as Error).message);
                }
              });
            }}
          >
            {tx("Limpar conversa")}
          </button>
          <select
            aria-label={tx("Cliente da conversa")}
            value={org}
            disabled={busy}
            onChange={(e) => {
              setOrg(e.target.value);
              setServerId("");
            }}
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            aria-label={tx("Servidor da conversa")}
            value={serverId}
            disabled={busy || !available.length}
            onChange={(e) => setServerId(e.target.value)}
          >
            {!available.length && (
              <option value="">{tx("Nenhum servidor cadastrado")}</option>
            )}
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {available.length > 0 && (
              <option value="all">
                {tx("Todos os servidores deste cliente")}
              </option>
            )}
          </select>
        </div>
      </div>
      <div className="assistant-scope-note">
        <ShieldCheck size={13} />
        <span>
          {tx("Conversa sobre")}
          <strong>{targetName}</strong>.{" "}
          {usingCommands
            ? tx(
                "A IA prepara comandos para investigar no servidor por SSH. Cada execução precisa de aprovação; o resultado volta ao chat para análise. Requer habilitação explícita dos comandos aprovados no Ubuntu.",
              )
            : tx(
                "Cada pedido solicita uma nova verificação pelas ferramentas do agente antes da resposta.",
              )}
        </span>
      </div>
      <div className="chat-area">
        {clearedConversation?.org === org &&
          clearedConversation.server === serverId && (
            <div className="banner info">
              {tx("Conversa limpa.")}{" "}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    try {
                      await api("/chat/restore", {
                        organization: org,
                        server_id: serverId === "all" ? undefined : serverId,
                        clear_id: clearedConversation.id,
                      });
                      setMessages(
                        await api<typeof messages>(
                          `/chat?organization=${encodeURIComponent(org)}${serverId === "all" ? "" : "&server_id=" + encodeURIComponent(serverId)}`,
                        ),
                      );
                      setClearedConversation(null);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  })
                }
              >
                {tx("Desfazer")}
              </button>
            </div>
          )}
        {error && (
          <div ref={chatErrorRef} className="banner error" role="alert">
            {error}
          </div>
        )}
        {!messages.length && (
          <div className="chat-welcome">
            <div className="sparkle-tile">
              <Sparkles size={30} />
            </div>
            <h2>{tx("O que acontece no seu ambiente?")}</h2>
            <p>
              {selectedAIAvailable
                ? tx`Pergunte sobre saúde, utilização e alertas de ${targetName}. O histórico da conversa fica separado por servidor.`
                : tx(
                    "O diagnóstico básico já está disponível. A IA ainda não foi ativada nesta instalação; enquanto isso, acompanhe a saúde do ambiente por regras.",
                  )}
            </p>
            <div className="suggestions">
              {[
                tx("Como está a saúde deste ambiente?"),
                tx("O que precisa de atenção?"),
                tx("Há risco de falta de espaço em disco?"),
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  disabled={busy || !org || !serverId}
                >
                  {q}
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div className="chat-pair" key={m.id}>
            <div className="user-message">{m.question}</div>
            <div className="assistant-message">
              <span className="bot-avatar">
                <Bot size={20} />
              </span>
              <div>
                <strong>
                  {branding.name}{" "}
                  <span className="muted">
                    · {m.mode === "ai" ? tx("IA") : tx("Regras")} ·{" "}
                    {stamp(m.created_at)}
                  </span>
                </strong>
                <p>{m.answer}</p>
                {m.command && m.action_id && (
                  <div className="operations-analysis">
                    <p>{m.reason}</p>
                    {editingAction === m.id ? (
                      <form
                        className="chat-command-editor"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setError("");
                          void run(async () => {
                            try {
                              const updated = await api<{
                                action_id: string;
                                command: string;
                                status: string;
                                executed: boolean;
                                edited: boolean;
                              }>(
                                `/assistant/operator/${m.session_id}/actions/${m.action_id}`,
                                { command: commandDraft },
                                "PATCH",
                              );
                              setMessages((rows) =>
                                rows.map((row) =>
                                  row.id === m.id
                                    ? { ...row, ...updated }
                                    : row,
                                ),
                              );
                              setEditingAction(null);
                              setCommandDraft("");
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          });
                        }}
                      >
                        <label>
                          {tx("Editar comando")}
                          <textarea
                            aria-label={tx("Comando para revisão")}
                            rows={5}
                            maxLength={2000}
                            spellCheck={false}
                            autoComplete="off"
                            value={commandDraft}
                            disabled={busy}
                            onChange={(e) => setCommandDraft(e.target.value)}
                          />
                        </label>
                        <p className="muted">
                          {tx(
                            "Salvar a edição substitui a proposta anterior. O comando editado ainda precisa de aprovação para executar.",
                          )}
                        </p>
                        <div className="action-row">
                          <button
                            type="submit"
                            className="primary"
                            disabled={busy || !commandDraft.trim()}
                          >
                            {tx("Salvar comando para revisão")}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => {
                              setEditingAction(null);
                              setCommandDraft("");
                            }}
                          >
                            {tx("Descartar edição")}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <pre>{m.command}</pre>
                    )}
                    {!!m.edited && (
                      <p className="muted">
                        {tx(
                          "Comando editado. Revise o conteúdo atualizado antes de aprovar.",
                        )}
                      </p>
                    )}
                    {m.status === "canceled" && (
                      <p className="command-state-note" role="status">
                        {tx("Ação cancelada. Este comando não foi executado.")}
                      </p>
                    )}
                    {m.status === "expired" && (
                      <p className="command-state-note">
                        {tx(
                          "Esta proposta expirou. Inicie uma nova investigação.",
                        )}
                      </p>
                    )}
                    <p className="muted">
                      {tx("Comando proposto para")}
                      {targetName}
                      {tx(
                        ". Revise todo o conteúdo: a execução pode ler dados ou alterar o sistema. A IA só receberá a saída após a aprovação.",
                      )}
                    </p>
                    {!m.executed &&
                      (!m.status || m.status === "pending") &&
                      editingAction !== m.id &&
                      ["owner", "admin"].includes(me.user.role) && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !(await confirmAction(
                                tx`Executar exatamente o comando exibido em ${targetName}?\n\n${m.command}`,
                              ))
                            )
                              return;
                            void run(async () => {
                              try {
                                setVerificationProgress(
                                  tx(
                                    "Executando o comando aprovado no servidor…",
                                  ),
                                );
                                const result = await api<{
                                  status: string;
                                  output: string;
                                }>(
                                  `/servers/${serverId}/actions/${m.action_id}/approve`,
                                  {},
                                );
                                setMessages((messages) =>
                                  messages.map((row) =>
                                    row.id === m.id
                                      ? {
                                          ...row,
                                          executed: true,
                                          status: result.status,
                                          answer:
                                            row.answer +
                                            tx("\n\nResultado da execução:\n") +
                                            (result.output ?? result.status),
                                        }
                                      : row,
                                  ),
                                );
                                if (result.status === "unknown")
                                  throw new Error(
                                    tx(
                                      "Execução indeterminada. Confira o servidor antes de repetir.",
                                    ),
                                  );
                                setVerificationProgress(
                                  tx("Analisando a saída do comando…"),
                                );
                                const next = await api<{
                                  id: string;
                                  answer: string;
                                  mode: string;
                                  created_at: number;
                                  session_id: string;
                                  action_id: string | null;
                                  command: string | null;
                                  reason: string;
                                }>(
                                  `/assistant/operator/${m.session_id}/continue`,
                                  {},
                                );
                                setMessages((messages) => [
                                  ...messages,
                                  {
                                    ...next,
                                    question: tx(
                                      "Analisar o resultado da investigação",
                                    ),
                                  },
                                ]);
                              } catch (e) {
                                setError((e as Error).message);
                              } finally {
                                setVerificationProgress("");
                              }
                            });
                          }}
                        >
                          {tx("Aprovar comando e continuar análise")}
                        </button>
                      )}
                    {!m.executed &&
                      (!m.status || m.status === "pending") &&
                      m.session_id &&
                      ["owner", "admin", "operator"].includes(me.user.role) && (
                        <div className="action-row chat-command-controls">
                          {["owner", "admin"].includes(me.user.role) &&
                            editingAction !== m.id && (
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() => {
                                  setEditingAction(m.id);
                                  setCommandDraft(m.command ?? "");
                                  setError("");
                                }}
                              >
                                <Pencil size={15} />
                                {tx("Editar comando")}
                              </button>
                            )}
                          <button
                            type="button"
                            className="danger"
                            disabled={busy}
                            onClick={() => {
                              setError("");
                              void run(async () => {
                                try {
                                  await api(
                                    `/assistant/operator/${m.session_id}/actions/${m.action_id}/cancel`,
                                    {},
                                  );
                                  setMessages((rows) =>
                                    rows.map((row) =>
                                      row.id === m.id
                                        ? {
                                            ...row,
                                            status: "canceled",
                                            executed: true,
                                          }
                                        : row,
                                    ),
                                  );
                                  setEditingAction(null);
                                  setCommandDraft("");
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              });
                            }}
                          >
                            <X size={15} />
                            {tx("Cancelar ação")}
                          </button>
                        </div>
                      )}
                  </div>
                )}
                {m.suggestions?.map((suggestion, i) => (
                  <div className="operations-analysis" key={i}>
                    <p>{suggestion.reason}</p>
                    <span className="muted">
                      {tx("Sugestão:")}
                      {suggestion.action} · {suggestion.service}
                      {tx(". Ainda não executada.")}
                    </span>
                    {serverId !== "all" && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api(`/servers/${serverId}/actions`, suggestion),
                            tx(
                              "Ação preparada. Abra Serviços, logs e correções → Ações e aprovações nos detalhes do servidor para revisar e executar.",
                            ),
                          )
                        }
                      >
                        <ShieldCheck size={14} />
                        {tx("Preparar para aprovação")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        {busy && (
          <p className="muted" role="status" aria-live="polite">
            {verificationProgress || tx("Processando…")}
          </p>
        )}
        <div ref={end} />
      </div>
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
      >
        <label className="checkbox chat-context-option">
          <input
            type="checkbox"
            checked={useContext}
            disabled={busy}
            onChange={(e) => {
              const enabled = e.target.checked;
              setUseContext(enabled);
              try {
                localStorage.setItem(contextPreferenceKey, String(enabled));
              } catch {}
            }}
          />
          <span>
            {tx("Usar contexto da conversa")}
            <small>
              {tx(
                "Considera até seis mensagens recentes deste usuário e servidor, com limite de tamanho.",
              )}
            </small>
          </span>
        </label>
        {(config.ai ||
          aiChoices.platform_available ||
          aiChoices.providers.length > 0) &&
          me.user.role !== "reader" && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={operatorMode}
                disabled={busy}
                onChange={(e) => setOperatorMode(e.target.checked)}
              />
              {tx(
                "Investigar usando comandos SSH, com aprovação antes de cada execução",
              )}
            </label>
          )}
        {usingCommands && <AgentActivationGuide feature="commands" />}
        {!usingCommands && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeLogs}
              disabled={serverId === "all" || busy}
              onChange={(e) => setIncludeLogs(e.target.checked)}
            />
            {tx("Incluir verificação local de logs neste pedido")}
          </label>
        )}
        {!usingCommands && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeProcesses}
              disabled={serverId === "all" || busy}
              onChange={(e) => setIncludeProcesses(e.target.checked)}
            />
            {tx("Incluir nova coleta de processos neste pedido")}
          </label>
        )}
        <div>
          <input
            aria-label={tx("Pergunta ao assistente")}
            placeholder={tx`Pergunte sobre ${targetName}…`}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button
            className="primary"
            aria-label={tx("Enviar pergunta")}
            disabled={busy || !question.trim() || !org || !serverId}
          >
            <Send size={18} />
          </button>
        </div>
        <small>
          <ShieldCheck size={12} />
          {operatorMode && selectedAIAvailable && mode !== "diagnostic"
            ? tx("Comandos SSH após aprovação")
            : tx("Consultas pelo agente")}{" "}
          ·{" "}
        </small>
      </form>
    </section>
  );
}

type Token = {
  id: string;
  name: string;
  organization: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
};
function Integrations({
  organizations,
  run,
  busy,
  notice,
}: Shared & { organizations: Organization[] }) {
  const [tokens, setTokens] = useState<Token[]>([]),
    [created, setCreated] = useState(""),
    [show, setShow] = useState(false),
    [error, setError] = useState("");
  const load = () => api<Token[]>("/tokens").then(setTokens);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const example = JSON.stringify(
    {
      mcpServers: {
        foxops: {
          url: location.origin + "/mcp",
          headers: { Authorization: "Bearer SEU_TOKEN_MCP" },
        },
      },
    },
    null,
    2,
  );
  return (
    <>
      <div className="integration-hero panel">
        <div className="network-tile">
          <Network size={30} />
        </div>
        <div>
          <span className="eyebrow">MODEL CONTEXT PROTOCOL</span>
          <h2>{tx("Leve contexto real para sua IA.")}</h2>
          <p>
            {tx(
              "Consulte inventário, métricas, serviços e alertas por uma interface MCP de leitura, com as mesmas permissões do painel.",
            )}
          </p>
        </div>
        <span className="pill">
          <i className="dot green" />
          HTTP + Bearer token
        </span>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="bottom-grid">
        <section className="panel padded">
          <h2>{tx("Conecte seu cliente MCP")}</h2>
          <p className="muted">
            {tx(
              "Use um cliente que permita configurar uma URL HTTP e o cabeçalho Authorization.",
            )}
          </p>
          <label>
            Endpoint
            <Code text={location.origin + "/mcp"} />
          </label>
          <Code text={example} />
          <p className="muted">
            {tx(
              "O formato da configuração depende do cliente. Este endpoint usa Streamable HTTP stateless. Clientes que exigem OAuth precisam de uma integração adicional.",
            )}
          </p>
        </section>
        <section className="panel padded">
          <h2>{tx("Ferramentas disponíveis")}</h2>
          <div className="tool-list">
            {[
              ["list_organizations", tx("Clientes autorizados")],
              ["list_servers", tx("Inventário e métricas recentes")],
              ["get_server_health", tx("Saúde e última comunicação")],
              ["query_metrics", tx("Histórico agregado por minuto")],
              ["list_alerts", tx("Incidentes e recuperações")],
              ["get_service_status", tx("Estado dos serviços configurados")],
            ].map(([name, description]) => (
              <div key={name}>
                <Code2 size={16} />
                <span>
                  <code>{name}</code>
                  <small>{description}</small>
                </span>
                <ShieldCheck size={14} />
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>{tx("Seus tokens de acesso")}</h2>
          <button
            className="primary"
            onClick={() => {
              setCreated("");
              setShow(true);
            }}
          >
            <Plus size={16} />
            {tx("Novo token")}
          </button>
        </div>
        {tokens.length ? (
          <div className="token-list">
            {tokens.map((t) => (
              <div key={t.id}>
                <span className="server-tile">
                  <Network size={17} />
                </span>
                <div>
                  <strong>{t.name}</strong>
                  <small>
                    {t.organization
                      ? organizations.find((o) => o.id === t.organization)?.name
                      : tx("Todos os clientes permitidos")}{" "}
                    {tx("· Expira")}
                    {stamp(t.expires_at)}
                  </small>
                </div>
                <span className="tag">
                  {t.revoked_at
                    ? tx("Revogado")
                    : t.expires_at * 1000 < Date.now()
                      ? tx("Expirado")
                      : tx("Ativo")}
                </span>
                <button
                  className="icon-button"
                  aria-label={tx`Revogar ${t.name}`}
                  disabled={busy || !!t.revoked_at}
                  onClick={() =>
                    void run(async () => {
                      await api(`/tokens/${t.id}`, undefined, "DELETE");
                      await load();
                    }, tx("Token revogado."))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon={<Network size={27} />}
            title={tx("Sua próxima conexão começa com um token")}
          >
            {tx("Crie uma credencial de leitura para sua ferramenta de IA.")}
          </Empty>
        )}
      </section>
      {show && (
        <Dialog
          title={created ? tx("Token criado") : tx("Novo token MCP")}
          close={() => {
            setShow(false);
            setCreated("");
          }}
        >
          {created ? (
            <>
              <p className="muted">
                {tx(
                  "Copie agora. O token completo não será exibido novamente.",
                )}
              </p>
              <Code text={created} />
              <button
                className="primary full"
                onClick={() => {
                  setShow(false);
                  setCreated("");
                  notice(tx("Token criado. Configure-o no seu cliente MCP."));
                }}
              >
                {tx("Concluir")}
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  const token = await api<{ token: string }>("/tokens", {
                    name: f.get("name"),
                    organization: f.get("organization") || null,
                    days: Number(f.get("days")),
                  });
                  setCreated(token.token);
                  await load();
                });
              }}
            >
              <label>
                {tx("Nome")}
                <input
                  name="name"
                  placeholder={tx("Ex.: Minha ferramenta de IA")}
                  required
                  maxLength={120}
                />
              </label>
              <label>
                {tx("Escopo")}
                <select name="organization">
                  <option value="">{tx("Todos os clientes permitidos")}</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tx("Validade")}
                <select name="days" defaultValue="30">
                  <option value="7">{tx("7 dias")}</option>
                  <option value="30">{tx("30 dias")}</option>
                  <option value="90">{tx("90 dias")}</option>
                </select>
              </label>
              <button className="primary full" disabled={busy}>
                {tx("Criar token de leitura")}
              </button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}

type Member = { id: string; name: string; email: string; role: string };
function Team({
  me,
  organizations,
  run,
  busy,
}: Shared & { organizations: Organization[] }) {
  const [members, setMembers] = useState<Member[]>([]),
    [show, setShow] = useState(false),
    [link, setLink] = useState(""),
    [role, setRole] = useState("reader"),
    [error, setError] = useState("");
  const load = () => api<Member[]>("/members").then(setMembers);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>
            {tx("Pessoas no workspace")}
            <span className="count">{members.length}</span>
          </h2>
          <button
            className="primary"
            onClick={() => {
              setLink("");
              setShow(true);
            }}
          >
            <Plus size={16} />
            {tx("Convidar pessoa")}
          </button>
        </div>
        {error && <div className="banner error">{error}</div>}
        <div className="token-list">
          {members.map((m) => (
            <div key={m.id}>
              <span className="avatar">{m.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>
                  {m.name}
                  {m.id === me.user.userId && tx(" (você)")}
                </strong>
                <small>{m.email}</small>
              </div>
              <span className="tag">{tx(roleName[m.role])}</span>
              {m.role !== "owner" && m.id !== me.user.userId && (
                <button
                  className="icon-button"
                  aria-label={tx`Remover ${m.name}`}
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmAction(
                        tx`Remover ${m.name} deste workspace?`,
                      )
                    )
                      void run(async () => {
                        await api(`/members/${m.id}`, undefined, "DELETE");
                        await load();
                      }, tx("Acesso removido."));
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
      <div className="banner info">
        <ShieldCheck size={18} />
        <span>
          {tx(
            "Administradores acessam todos os clientes. Operadores gerenciam os servidores dos clientes atribuídos. Leitores têm acesso de consulta.",
          )}
        </span>
      </div>
      {show && (
        <Dialog
          title={link ? tx("Convite pronto") : tx("Convidar para o workspace")}
          close={() => setShow(false)}
        >
          {link ? (
            <>
              <p className="muted">
                {tx(
                  "Compartilhe o link com a pessoa convidada. Ele expira em 24 horas. Nenhum e-mail foi enviado automaticamente.",
                )}
              </p>
              <Code text={link} />
              <button className="primary full" onClick={() => setShow(false)}>
                {tx("Concluir")}
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  const result = await api<{ token: string }>("/invites", {
                    email: f.get("email"),
                    role,
                    organizations: f.getAll("organizations"),
                  });
                  setLink(location.origin + "/#invite=" + result.token);
                });
              }}
            >
              <label>
                {tx("E-mail")}
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="pessoa@empresa.com.br"
                />
              </label>
              <label>
                {tx("Perfil")}
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="reader">{tx("Leitor")}</option>
                  <option value="operator">{tx("Operador")}</option>
                  <option value="admin">{tx("Administrador")}</option>
                </select>
              </label>
              {role !== "admin" && (
                <fieldset>
                  <legend>{tx("Clientes permitidos")}</legend>
                  {organizations.map((o) => (
                    <label className="checkbox" key={o.id}>
                      <input
                        type="checkbox"
                        name="organizations"
                        value={o.id}
                      />
                      {o.name}
                    </label>
                  ))}
                </fieldset>
              )}
              <button className="primary full" disabled={busy}>
                {tx("Gerar convite")}
              </button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}

function BillingPage({ me, run, busy }: Shared) {
  type BillingData = {
    enabled: boolean;
    available: string[];
    plans: Record<string, PlanDefinition>;
    providers: Record<string, string[]>;
    mercadoPagoPending: boolean;
    stripeEnabled: boolean;
  };
  const [paymentMethods, setPaymentMethods] = useState<Record<string, string>>(
    {},
  );
  const [billing, setBilling] = useState<BillingData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<BillingData>("/billing")
      .then(setBilling)
      .catch((e) => setError(e.message));
  }, []);
  const redirect = async (path: string, data: unknown) => {
    const result = await api<{ url: string }>(path, data);
    location.assign(result.url);
  };
  return (
    <>
      {error && <div className="banner error">{error}</div>}
      <section className="panel billing-summary">
        <div>
          <span className="eyebrow">{tx("SEU PLANO ATUAL")}</span>
          <h2>{tx(me.account.limits.name)}</h2>
          <p>
            {me.account.subscription_status === "trialing"
              ? tx`Avaliação até ${stamp(me.account.trial_until)}`
              : tx`Situação da assinatura: ${me.account.subscription_status}`}
          </p>
        </div>
        <div>
          <span>
            {tx("Servidores")}
            <strong>
              {me.account.server_count}{" "}
              <small>/ {me.account.limits.servers}</small>
            </strong>
          </span>
          <span>
            {tx("Consultas de IA hoje")}
            <strong>
              {me.account.ai_usage.calls}{" "}
              <small>/ {me.account.limits.aiDaily}</small>
            </strong>
          </span>
          <span>
            {tx("Retenção de métricas")}
            <strong>
              {me.account.limits.retentionDays} <small>{tx("dias")}</small>
            </strong>
          </span>
        </div>
      </section>
      <div className="pricing-grid">
        {billing &&
          Object.entries(billing.plans)
            .filter(([key, plan]) => key !== "trial" && plan.enabled)
            .map(([key, plan]) => (
              <section
                key={key}
                className={
                  "panel pricing " + (key === "growth" ? "featured" : "")
                }
              >
                {key === "growth" && (
                  <span className="pricing-recommend">
                    {tx("PARA EQUIPES EM CRESCIMENTO")}
                  </span>
                )}
                <span className="stat-icon green">
                  {key === "msp" ? (
                    <Building2 size={21} />
                  ) : key === "growth" ? (
                    <Users size={21} />
                  ) : (
                    <ServerIcon size={21} />
                  )}
                </span>
                <h2>{tx(plan.name)}</h2>
                {plan.description && <p>{plan.description}</p>}
                <div className="price-label">
                  {plan.amount === null
                    ? tx("Preço definido no checkout")
                    : money(plan.amount, plan.currency, getLanguage())}
                  <small>
                    {tx(plan.interval === "year" ? "por ano" : "por mês")}
                  </small>
                </div>
                <ul>
                  <li>
                    <Check size={16} />
                    {plan.servers}
                    {tx("servidores")}
                  </li>
                  <li>
                    <Check size={16} />
                    {plan.organizations}
                    {tx("cliente(s)")}
                  </li>
                  <li>
                    <Globe size={16} />
                    {plan.urlMonitors ?? 0} {tx("URLs monitoradas")}
                  </li>
                  <li>
                    <Check size={16} />
                    {plan.retentionDays}
                    {tx("dias de histórico")}
                  </li>
                  <li>
                    <Check size={16} />
                    {plan.aiDaily}
                    {tx("consultas de IA por dia")}
                  </li>
                  <li>
                    <Check size={16} />
                    {tx("MCP e alertas incluídos")}
                  </li>
                </ul>
                {(billing.providers[key]?.length ?? 0) > 1 && (
                  <label className="billing-provider">
                    {tx("Forma de pagamento")}
                    <select
                      value={paymentMethods[key] ?? billing.providers[key][0]}
                      onChange={(e) =>
                        setPaymentMethods((previous) => ({
                          ...previous,
                          [key]: e.target.value,
                        }))
                      }
                    >
                      {billing.providers[key].map((provider) => (
                        <option key={provider} value={provider}>
                          {provider === "mercadopago"
                            ? "Mercado Pago"
                            : "Stripe"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {(billing.providers[key]?.length ?? 0) === 1 && (
                  <p className="muted">
                    {billing.providers[key][0] === "mercadopago"
                      ? tx("Pagamento pelo Mercado Pago")
                      : tx("Pagamento pela Stripe")}
                  </p>
                )}
                <button
                  className={
                    key === "growth" ? "primary full" : "secondary full"
                  }
                  disabled={
                    busy ||
                    me.user.role !== "owner" ||
                    !billing.available.includes(key)
                  }
                  onClick={() =>
                    void run(() =>
                      redirect("/billing/checkout", {
                        plan: key,
                        revision: plan.revision,
                        provider:
                          paymentMethods[key] ??
                          billing.providers[key]?.[0] ??
                          "stripe",
                      }),
                    )
                  }
                >
                  {me.account.plan === key
                    ? tx("Plano atual")
                    : billing.available.includes(key)
                      ? tx("Escolher plano")
                      : tx("Pagamento não configurado")}
                  <ArrowUpRight size={16} />
                </button>
              </section>
            ))}
      </div>
      <div className="banner info">
        <CreditCard size={18} />
        <span>
          {billing?.enabled
            ? tx(
                "O pagamento é processado pelo provedor escolhido. A assinatura é ativada após a confirmação do pagamento.",
              )
            : tx(
                "Os limites dos planos já são aplicados. A cobrança online será disponibilizada pelo administrador da plataforma.",
              )}
        </span>
      </div>
      {me.user.role === "owner" &&
        billing?.stripeEnabled &&
        me.account.billing_provider !== "mercadopago" &&
        !billing.mercadoPagoPending && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(() => redirect("/billing/portal", {}))}
          >
            {tx("Gerenciar assinatura e pagamentos")}
            <ExternalLink size={16} />
          </button>
        )}
      {me.user.role === "owner" &&
        (me.account.billing_provider === "mercadopago" ||
          billing?.mercadoPagoPending) && (
          <section className="panel padded">
            <h2>Mercado Pago</h2>
            {me.account.billing_until && (
              <p>
                {tx("Acesso pago até")} {stamp(me.account.billing_until)}
              </p>
            )}
            {me.account.subscription_status === "canceled" ? (
              <p>
                {tx(
                  "Assinatura cancelada. O acesso continua até o fim do período pago.",
                )}
              </p>
            ) : (
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirmAction(
                      tx(
                        "Cancelar a assinatura Mercado Pago? O acesso continua até o fim do período já pago.",
                      ),
                    )
                  )
                    void run(async () => {
                      await api("/billing/mercadopago/cancel", {});
                      setBilling(await api<BillingData>("/billing"));
                    });
                }}
              >
                {tx("Cancelar assinatura Mercado Pago")}
              </button>
            )}
          </section>
        )}
    </>
  );
}

function Settings({
  me,
  run,
  onOpenPlatform,
}: Shared & { onOpenPlatform: () => void }) {
  const [section, setSection] = useState("profile");
  const [accounts, setAccounts] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  const [name, setName] = useState(me.account.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const admin = ["owner", "admin"].includes(me.user.role);
  useEffect(() => {
    setName(me.account.name);
    void api<typeof accounts>("/accounts")
      .then(setAccounts)
      .catch((e) => setError(e.message));
  }, [me.account.id, me.account.name]);
  useEffect(() => {
    setSection("profile");
    setSaved(false);
    setError("");
  }, [me.account.id]);
  const tabs = [
    ["profile", "Meu perfil", "Senha e e-mail da sua conta pessoal."],
    [
      "workspace",
      "Workspace",
      "Nome, acesso e retenção de dados da organização.",
    ],
    [
      "ai",
      "Inteligência artificial",
      "Provedores e modelos usados neste workspace.",
    ],
    ...(admin
      ? [
          [
            "notifications",
            "Notificações",
            "Canais e destinatários dos alertas da organização.",
          ],
        ]
      : []),
    [
      "automation",
      "Automações",
      "Regras e limites da correção automática de serviços.",
    ],
    ...(admin
      ? [
          [
            "audit",
            "Auditoria",
            "Alterações feitas pelos usuários deste workspace.",
          ],
        ]
      : []),
  ];
  const current = tabs.find((tab) => tab[0] === section) ?? tabs[0];
  return (
    <div className="settings-layout">
      <nav
        className="panel settings-navigation"
        aria-label={tx("Categorias de configuração")}
      >
        <p className="muted">{tx("Configurações do workspace")}</p>
        {tabs.map(([id, title]) => (
          <button
            key={id}
            className={section === id ? "active" : ""}
            aria-current={section === id ? "page" : undefined}
            onClick={() => setSection(id)}
          >
            {tx(title)}
          </button>
        ))}
        {me.platform_admin && (
          <div className="settings-platform-link">
            <small className="muted">{tx("Administração global")}</small>
            <button onClick={onOpenPlatform}>
              <ShieldCheck size={16} />
              {tx("Administração da plataforma")}
              <ArrowRight size={15} />
            </button>
            <small className="muted">
              {tx(
                "Marca, planos, pagamentos, e-mails da plataforma e gestão de todas as organizações.",
              )}
            </small>
          </div>
        )}
      </nav>
      <div className="settings-content">
        <header className="settings-section-heading">
          <h2>{tx(current[1])}</h2>
          <p className="muted">{tx(current[2])}</p>
          {section !== "profile" && (
            <small className="tag">{me.account.name}</small>
          )}
        </header>
        {section === "profile" && (
          <>
            <ChangePasswordPanel />
            <ChangeEmailPanel email={me.user.email} />
          </>
        )}
        {section === "ai" && (
          <AISettingsPanel
            key={`ai-settings:${me.account.id}`}
            role={me.user.role}
            onChanged={() => run(async () => {})}
          />
        )}
        {section === "notifications" && admin && (
          <NotificationsPanel key={`notifications:${me.account.id}`} />
        )}
        {section === "automation" && (
          <RecoveryPolicyPanel key={`recovery-policy:${me.account.id}`} />
        )}
        {section === "audit" && admin && (
          <AuditPanel key={`audit:${me.account.id}`} />
        )}
        {section === "workspace" && (
          <section className="panel padded">
            <h2>
              <Building2 size={18} />
              {tx("Dados do workspace")}
            </h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                setError("");
                setSaved(false);
                try {
                  await api(
                    "/accounts/current",
                    { name: name.trim() },
                    "PATCH",
                  );
                  await run(async () => {});
                  setSaved(true);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <label>
                {tx("Nome do workspace")}
                <input
                  value={name}
                  maxLength={120}
                  required
                  disabled={me.user.role !== "owner" || saving}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaved(false);
                  }}
                />
              </label>
              {me.user.role === "owner" ? (
                <button
                  className="primary"
                  disabled={
                    saving || !name.trim() || name.trim() === me.account.name
                  }
                >
                  <Save size={16} />
                  {tx("Salvar nome do workspace")}
                </button>
              ) : (
                <p className="muted">
                  {tx(
                    "Somente o proprietário pode alterar o nome do workspace.",
                  )}
                </p>
              )}
              {error && (
                <p className="banner error" role="alert">
                  {error}
                </p>
              )}
              {saved && (
                <p className="banner" role="status">
                  {tx("Nome do workspace atualizado.")}
                </p>
              )}
            </form>
            <dl className="details-list">
              <dt>{tx("Seu perfil")}</dt>
              <dd>{tx(roleName[me.user.role])}</dd>
              <dt>{tx("Conta")}</dt>
              <dd>{me.user.email}</dd>
              <dt>{tx("Retenção")}</dt>
              <dd>
                {me.account.limits.retentionDays} {tx("dias")}
              </dd>
            </dl>
            <p className="muted">
              {tx(
                "O vencimento não exclui o workspace. Novas coletas e operações pagas são suspensas; o histórico de métricas, traces e verificações de URLs continua sujeito à retenção do plano, inclusive durante a suspensão.",
              )}
            </p>
            {accounts.length > 1 && (
              <label>
                {tx("Alternar workspace")}
                <select
                  value={me.account.id}
                  onChange={(e) =>
                    void run(() =>
                      api("/accounts/switch", { account: e.target.value }),
                    )
                  }
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
