import { useState } from "react";
import {
  Server,
  Cloud,
  Database,
  Terminal,
  Shield,
  Network,
  Cpu,
  Globe,
  Shuffle,
  Check,
} from "lucide-react";
import {
  siUbuntu,
  siDebian,
  siFedora,
  siRedhat,
  siCentos,
  siRockylinux,
  siAlmalinux,
  siArchlinux,
  siAlpinelinux,
  siOpensuse,
  siLinux,
} from "simple-icons";
import {
  serverIcons,
  isServerIcon,
  type ServerIconId,
} from "../shared/server-icons.ts";
import { t } from "./i18n.ts";
const logos = {
  ubuntu: siUbuntu,
  debian: siDebian,
  fedora: siFedora,
  redhat: siRedhat,
  centos: siCentos,
  rockylinux: siRockylinux,
  almalinux: siAlmalinux,
  archlinux: siArchlinux,
  alpinelinux: siAlpinelinux,
  opensuse: siOpensuse,
  linux: siLinux,
};
const generic = {
  server: Server,
  cloud: Cloud,
  database: Database,
  terminal: Terminal,
  shield: Shield,
  network: Network,
  cpu: Cpu,
  globe: Globe,
};
export function ServerVisualIcon({
  icon,
  size = 24,
}: {
  icon?: string;
  size?: number;
}) {
  const id = isServerIcon(icon) ? icon : "server";
  if (id in logos) {
    const logo = logos[id as keyof typeof logos];
    return (
      <span
        className="server-system-logo"
        style={{ width: size + 8, height: size + 8 }}
      >
        <svg
          role="img"
          aria-label={logo.title}
          viewBox="0 0 24 24"
          width={size}
          height={size}
        >
          <path
            d={logo.path}
            fill={id === "linux" ? "#17202a" : "#" + logo.hex}
          />
        </svg>
      </span>
    );
  }
  const Icon = generic[id as keyof typeof generic] ?? Server;
  return <Icon size={size} aria-hidden="true" />;
}
export function ServerIconPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ServerIconId;
  onChange: (id: ServerIconId) => void;
  disabled?: boolean;
}) {
  const [group, setGroup] = useState<"system" | "generic">(
    value === "server"
      ? "system"
      : (serverIcons.find((icon) => icon.id === value)?.group ?? "system"),
  );
  return (
    <fieldset className="server-icon-picker" disabled={disabled}>
      <legend>{t("Ícone do servidor")}</legend>
      <div className="server-icon-picker-header">
        <div className="server-icon-preview">
          <ServerVisualIcon icon={value} />
          <span>
            {t(
              serverIcons.find((icon) => icon.id === value)?.label ??
                "Servidor",
            )}
          </span>
        </div>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            const choices = serverIcons.filter(
              (icon) => icon.group === "generic" && icon.id !== value,
            );
            const next = choices[Math.floor(Math.random() * choices.length)];
            onChange(next.id);
            setGroup("generic");
          }}
        >
          <Shuffle size={15} />
          {t("Ícone aleatório")}
        </button>
      </div>
      <div className="server-icon-categories">
        <button
          type="button"
          className={group === "system" ? "selected" : ""}
          aria-pressed={group === "system"}
          onClick={() => setGroup("system")}
        >
          {t("Sistemas Linux")}
        </button>
        <button
          type="button"
          className={group === "generic" ? "selected" : ""}
          aria-pressed={group === "generic"}
          onClick={() => setGroup("generic")}
        >
          {t("Ícones genéricos")}
        </button>
      </div>
      <div className="server-icon-options">
        {serverIcons
          .filter((icon) => icon.group === group)
          .map((icon) => (
            <button
              key={icon.id}
              className={value === icon.id ? "selected" : ""}
              type="button"
              aria-label={t(icon.label)}
              aria-pressed={value === icon.id}
              onClick={() => onChange(icon.id)}
            >
              <ServerVisualIcon icon={icon.id} size={25} />
              <span>{t(icon.label)}</span>
              {value === icon.id && (
                <Check size={12} className="server-icon-check" />
              )}
            </button>
          ))}
      </div>
      <p className="muted">
        {t(
          "Escolha apenas visual. Não altera o sistema operacional nem a instalação do agente.",
        )}
      </p>
    </fieldset>
  );
}
