import { useEffect, useState } from "react";
import { Bell, Send, Save } from "lucide-react";
import { api, stamp } from "./api.ts";
import { t } from "./i18n.ts";
import {
  notificationChannels,
  notificationKinds,
  notificationDefaults,
  type NotificationChannel,
  type NotificationConfig,
  type NotificationSettings,
} from "../shared/notifications.ts";

const channelNames = {
  telegram: "Telegram",
  whatsapp: "WhatsApp Business",
  email: "E-mail",
};
const kindNames: Record<string, string> = {
  process: "Processos monitorados",
  predictive: "Previsões e anomalias",
  offline: "Servidor sem comunicação",
  cpu: "CPU",
  memory: "Memória",
  disk: "Disco",
  service: "Serviços",
  url: "URLs",
};
const fieldSets: Record<
  NotificationChannel,
  {
    key: keyof NotificationConfig;
    label: string;
    placeholder?: string;
    secret?: boolean;
  }[]
> = {
  telegram: [
    { key: "token", label: "Token do bot", secret: true },
    {
      key: "chatId",
      label: "ID do chat ou grupo",
      placeholder: "-1001234567890",
    },
  ],
  whatsapp: [
    { key: "token", label: "Token de acesso", secret: true },
    { key: "phoneId", label: "ID do número no WhatsApp Business" },
    {
      key: "recipient",
      label: "Número de destino com código do país",
      placeholder: "5511999999999",
    },
    {
      key: "template",
      label: "Nome do modelo aprovado",
      placeholder: "alerta_monitoramento",
    },
    { key: "language", label: "Idioma do modelo", placeholder: "pt_BR" },
    { key: "apiVersion", label: "Versão da API Meta", placeholder: "vXX.0" },
  ],
  email: [
    { key: "host", label: "Servidor SMTP", placeholder: "smtp.example.com" },
    { key: "port", label: "Porta SMTP", placeholder: "587" },
    { key: "user", label: "Usuário SMTP" },
    { key: "password", label: "Senha SMTP", secret: true },
    {
      key: "from",
      label: "E-mail remetente",
      placeholder: "alertas@example.com",
    },
    {
      key: "to",
      label: "Destinatários de e-mail",
      placeholder: "admin@example.com, equipe@example.com",
    },
  ],
};
export function NotificationsPanel() {
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]),
    [org, setOrg] = useState(""),
    [channel, setChannel] = useState<NotificationChannel>("telegram"),
    [data, setData] = useState<NotificationSettings | null>(null),
    [draft, setDraft] = useState<NotificationConfig>(notificationDefaults()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    void api<typeof orgs>("/organizations")
      .then((rows) => {
        setOrgs(rows);
        setOrg(rows[0]?.id ?? "");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!org) return;
    let active = true;
    setData(null);
    setError("");
    setNotice("");
    void api<NotificationSettings>(`/organizations/${org}/notifications`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [org]);
  useEffect(() => {
    if (data) setDraft({ ...data.channels[channel], token: "", password: "" });
  }, [data, channel]);
  const run = async (test = false) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (test) {
        await api(`/organizations/${org}/notifications/${channel}/test`, {});
        setNotice(t("Mensagem de teste enviada. Confira o destinatário."));
      } else {
        const result = await api<NotificationSettings>(
          `/organizations/${org}/notifications/${channel}`,
          draft,
          "PUT",
        );
        setData(result);
        setNotice(t("Notificações salvas."));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel padded notification-panel">
      <h2>
        <Bell size={18} />
        {t("Notificações por organização")}
      </h2>
      <p className="muted">
        {t(
          "Configure canais e destinatários separados para cada organização. Salve antes de testar. Campos de senha vazios mantêm a credencial atual.",
        )}
      </p>
      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="notification-selectors">
        <label>
          {t("Organização")}
          <select
            disabled={busy}
            value={org}
            onChange={(e) => setOrg(e.target.value)}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Canal")}
          <select
            disabled={busy}
            value={channel}
            onChange={(e) => setChannel(e.target.value as NotificationChannel)}
          >
            {notificationChannels.map((c) => (
              <option key={c} value={c}>
                {channelNames[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <fieldset disabled={busy} className="notification-fields">
            <label className="notification-toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              {t("Canal habilitado")}
            </label>
            {channel === "telegram" && (
              <p className="muted">
                {t(
                  "Crie um bot no BotFather, inicie uma conversa com ele ou adicione-o ao grupo e informe o ID do chat.",
                )}
              </p>
            )}
            {channel === "whatsapp" && (
              <p className="muted">
                {t(
                  "Use a API oficial do WhatsApp Business. O modelo deve estar aprovado, ter uma variável de texto no corpo ({{1}}) e nenhum outro parâmetro obrigatório. O destinatário deve autorizar as mensagens. Podem existir custos da Meta.",
                )}
              </p>
            )}
            {channel === "email" && (
              <p className="muted">
                {t(
                  "SMTP com autenticação e TLS obrigatório: porta 465 ou 587. Use um servidor público e até 10 destinatários separados por vírgula.",
                )}
              </p>
            )}
            <div className="notification-grid">
              {fieldSets[channel].map((field) => (
                <label key={field.key}>
                  {t(field.label)}
                  <input
                    autoComplete={field.secret ? "new-password" : "off"}
                    type={field.secret ? "password" : "text"}
                    value={String(draft[field.key] ?? "")}
                    placeholder={
                      field.secret && data.channels[channel].hasSecret
                        ? t("Credencial cadastrada — deixe vazio para manter")
                        : field.placeholder
                    }
                    onChange={(e) =>
                      setDraft({ ...draft, [field.key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <h3>{t("Quando notificar")}</h3>
            <div className="notification-options">
              {(["opening", "recovery"] as const).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.checked })
                    }
                  />
                  {t(key === "opening" ? "Abertura do alerta" : "Recuperação")}
                </label>
              ))}
            </div>
            <h3>{t("Tipos de alerta")}</h3>
            <div className="notification-options">
              {notificationKinds.map((kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={draft.kinds.includes(kind)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        kinds: e.target.checked
                          ? [...draft.kinds, kind]
                          : draft.kinds.filter((k) => k !== kind),
                      })
                    }
                  />
                  {t(kindNames[kind])}
                </label>
              ))}
            </div>
            <div className="notification-actions">
              <button className="primary" type="submit">
                <Save size={16} />
                {t("Salvar notificações")}
              </button>
              <button
                type="button"
                disabled={!data.channels[channel].enabled}
                onClick={() => void run(true)}
              >
                <Send size={16} />
                {t("Enviar teste salvo")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {!!data?.deliveries.length && (
        <>
          <h3>{t("Últimos 20 envios")}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("Data")}</th>
                  <th>{t("Canal")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("Tentativas")}</th>
                  <th>{t("Detalhes")}</th>
                </tr>
              </thead>
              <tbody>
                {data.deliveries.map((d) => (
                  <tr key={d.id}>
                    <td>{stamp(d.created_at)}</td>
                    <td>{channelNames[d.channel as NotificationChannel]}</td>
                    <td>
                      {t(
                        (
                          {
                            pending: "Pendente",
                            sent: "Enviado",
                            failed: "Falhou",
                            canceled: "Cancelado",
                          } as Record<string, string>
                        )[d.status] ?? d.status,
                      )}
                    </td>
                    <td>{d.attempts}</td>
                    <td>{d.last_error ? t(d.last_error) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api<NotificationSettings>(
                `/organizations/${org}/notifications`,
              )
                .then(setData)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {t("Atualizar")}
          </button>
        </>
      )}
    </section>
  );
}
