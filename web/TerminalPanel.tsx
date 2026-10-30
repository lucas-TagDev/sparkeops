import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  TerminalSquare,
  Plug,
  Unplug,
  Maximize2,
  Minimize2,
  Eraser,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";
import { confirmAction } from "./ConfirmDialog.tsx";
type Metadata = {
  configured: boolean;
  enabled: boolean;
  host: string | null;
  port: number | null;
  username: string | null;
};
const reasons: Record<string, string> = {
  closed: "Sessão encerrada.",
  disabled: "Terminal desabilitado pelo proprietário.",
  idle: "Sessão encerrada após 10 minutos sem digitação.",
  timeout: "Limite de uma hora atingido. Conecte novamente.",
  connection_lost: "Conexão interrompida. Nenhum comando foi reenviado.",
  access_changed: "Acesso ou conexão SSH alterado. A sessão foi encerrada.",
  invalid_message: "A sessão foi encerrada por uma mensagem inválida.",
  output_limit: "Volume de saída excedido. Conecte novamente.",
  shell_unavailable:
    "O servidor recusou o terminal interativo. Confira a configuração SSH.",
  remote_closed: "O servidor encerrou a sessão SSH.",
  ssh_failed: "Falha SSH. Confira rede, credenciais e fingerprint.",
};
export default function TerminalPanel({
  serverId,
  role,
}: {
  serverId: string;
  role: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    socket = useRef<WebSocket | null>(null),
    mounted = useRef(false),
    ready = useRef(false),
    attempt = useRef(0);
  const [metadata, setMetadata] = useState<Metadata | null>(null),
    [state, setState] = useState("disconnected"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [full, setFull] = useState(false),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const root = `/servers/${serverId}/terminal`,
    active = state === "connecting" || state === "ready";
  const dimensions = () => ({
    type: "resize",
    cols: Math.max(20, Math.min(300, terminal.current?.cols ?? 100)),
    rows: Math.max(5, Math.min(120, terminal.current?.rows ?? 28)),
  });
  useEffect(() => {
    mounted.current = true;
    const term = new Terminal({
        cursorBlink: true,
        disableStdin: true,
        fontSize: 13,
        fontFamily: '"Cascadia Code", Consolas, monospace',
        scrollback: 3000,
        theme: {
          background: "#0d1117",
          foreground: "#dbe5f3",
          cursor: "#79b8ff",
          selectionBackground: "#34516e",
          red: "#ff7b72",
          green: "#7ee787",
          yellow: "#e3b341",
          blue: "#79c0ff",
          magenta: "#d2a8ff",
          cyan: "#a5d6ff",
        },
      }),
      fit = new FitAddon();
    terminal.current = term;
    term.loadAddon(fit);
    term.open(container.current!);
    fit.fit();
    term.writeln("\x1b[1;34mSSH Terminal\x1b[0m");
    term.writeln(t("Conecte para abrir uma sessão interativa no servidor."));
    setLoaded(true);
    const resize = new ResizeObserver(() => {
      try {
        fit.fit();
        if (socket.current?.readyState === WebSocket.OPEN)
          socket.current.send(JSON.stringify(dimensions()));
      } catch {
        /* The container may be closing. */
      }
    });
    resize.observe(container.current!);
    const input = term.onData((data) => {
      if (!ready.current || socket.current?.readyState !== WebSocket.OPEN)
        return;
      for (let index = 0; index < data.length; index += 2000)
        socket.current.send(
          JSON.stringify({
            type: "input",
            data: data.slice(index, index + 2000),
          }),
        );
    });
    void api<Metadata>(root)
      .then((value) => {
        if (mounted.current) setMetadata(value);
      })
      .catch((e) => {
        if (mounted.current) setError(e.message);
      });
    return () => {
      mounted.current = false;
      attempt.current++;
      ready.current = false;
      socket.current?.close();
      socket.current = null;
      input.dispose();
      resize.disconnect();
      term.dispose();
      terminal.current = null;
    };
  }, [root]);
  const connect = async () => {
    const current = ++attempt.current;
    setState("connecting");
    setError("");
    setNotice("");
    ready.current = false;
    try {
      const result = await api<{ ticket: string }>(root + "/ticket", {});
      if (!mounted.current || attempt.current !== current) return;
      const url = new URL("/api/v1/terminal/socket", location.origin);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", result.ticket);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onopen = () => {
        if (attempt.current !== current) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify(dimensions()));
      };
      ws.onmessage = (event) => {
        if (!mounted.current || attempt.current !== current) return;
        if (event.data instanceof ArrayBuffer) {
          terminal.current?.write(new Uint8Array(event.data));
          return;
        }
        try {
          const message = JSON.parse(event.data);
          if (message.type === "status") {
            setState(
              message.state === "closed" ? "disconnected" : message.state,
            );
            ready.current = message.state === "ready";
            if (terminal.current)
              terminal.current.options.disableStdin = !ready.current;
            if (ready.current) terminal.current?.focus();
            if (message.state === "closed")
              setNotice(t(reasons[message.message] ?? "Sessão encerrada."));
          }
        } catch {
          setError(t("Resposta inválida do terminal."));
          ws.close();
        }
      };
      ws.onerror = () => {
        if (mounted.current && attempt.current === current)
          setError(
            t(
              "Não foi possível abrir o terminal. Confira a conexão SSH e o suporte a WebSocket no proxy.",
            ),
          );
      };
      ws.onclose = () => {
        if (mounted.current && attempt.current === current) {
          ready.current = false;
          if (terminal.current) terminal.current.options.disableStdin = true;
          setState("disconnected");
          socket.current = null;
        }
      };
    } catch (e) {
      if (mounted.current && attempt.current === current) {
        setError((e as Error).message);
        setState("disconnected");
      }
    }
  };
  const disconnect = () => {
    attempt.current++;
    ready.current = false;
    socket.current?.close();
    socket.current = null;
    if (terminal.current) terminal.current.options.disableStdin = true;
    setState("disconnected");
    setNotice(t("Sessão encerrada."));
  };
  const toggle = async () => {
    if (!metadata) return;
    if (
      !metadata.enabled &&
      !(await confirmAction(
        t(
          "Habilitar acesso ao terminal interativo? Os comandos digitados executam diretamente com as permissões da conta SSH, sem aprovação por comando da IA.",
        ),
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const value = await api<Metadata>(
        root,
        { enabled: !metadata.enabled },
        "PUT",
      );
      setMetadata(value);
      if (!value.enabled) disconnect();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={"ssh-terminal-panel" + (full ? " ssh-terminal-full" : "")}
    >
      <div className="ssh-terminal-heading">
        <div>
          <h3>
            <TerminalSquare size={19} />
            {t("Terminal SSH")}
          </h3>
          <p className="muted">
            {metadata?.configured
              ? `${metadata.username}@${metadata.host}:${metadata.port}`
              : t("Configure primeiro a conexão SSH deste servidor.")}
          </p>
        </div>
        <span className={"ssh-terminal-state " + state}>
          <i />
          {t(
            state === "ready"
              ? "Conectado"
              : state === "connecting"
                ? "Conectando…"
                : "Desconectado",
          )}
        </span>
      </div>
      <p className="ssh-terminal-note">
        <ShieldCheck size={15} />
        {t(
          "Terminal direto: os comandos digitados executam no servidor. O conteúdo da sessão não é enviado à IA nem gravado no histórico do chat.",
        )}
      </p>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      <div className="ssh-terminal-toolbar">
        <div>
          <button
            type="button"
            className="primary"
            disabled={!loaded || !metadata?.enabled || active || busy}
            onClick={() => void connect()}
          >
            <Plug size={15} />
            {t("Conectar")}
          </button>
          <button
            type="button"
            className="danger"
            disabled={!active}
            onClick={disconnect}
          >
            <Unplug size={15} />
            {t("Desconectar")}
          </button>
        </div>
        <div>
          <button
            type="button"
            className="secondary"
            onClick={() => terminal.current?.clear()}
          >
            <Eraser size={15} />
            {t("Limpar tela")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setFull(!full)}
          >
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{" "}
            {t(full ? "Restaurar tamanho" : "Expandir terminal")}
          </button>
        </div>
      </div>
      <div
        ref={container}
        className="ssh-terminal-canvas"
        aria-label={t("Terminal interativo do servidor")}
      />
      <div className="ssh-terminal-footer">
        <span>
          {t(
            "Inatividade: 10 min · Duração máxima: 1 h · Reconexão sempre manual",
          )}
        </span>
        {role === "owner" && metadata?.configured && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void toggle()}
          >
            {t(
              metadata.enabled ? "Desabilitar terminal" : "Habilitar terminal",
            )}
          </button>
        )}
      </div>
      {metadata && !metadata.enabled && (
        <p className="muted">
          {t(
            "O proprietário precisa habilitar o terminal para esta conexão SSH. Alterar as credenciais exige habilitação novamente.",
          )}
        </p>
      )}
      {metadata?.username === "foxops-ssh" && (
        <details className="ssh-terminal-setup">
          <summary>
            {t("Habilitar o terminal do usuário SSH gerenciado no Ubuntu")}
          </summary>
          <p>
            {t(
              "O usuário gerenciado é restrito por padrão. Para permitir uma shell administrativa, execute no Ubuntu como root:",
            )}
          </p>
          <pre>{`curl -fsS '${location.origin}/agent/upgrade.sh' -o /tmp/foxops-upgrade.sh\nsudo bash /tmp/foxops-upgrade.sh --enable-terminal`}</pre>
          <p>
            {t(
              "Depois habilite o terminal no painel e conecte. Para bloquear novas shells no Ubuntu, use --disable-terminal e encerre as sessões ativas no painel.",
            )}
          </p>
        </details>
      )}
    </section>
  );
}
