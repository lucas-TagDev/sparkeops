export const serverIcons = [
  { id: "ubuntu", label: "Ubuntu", group: "system" },
  { id: "debian", label: "Debian", group: "system" },
  { id: "fedora", label: "Fedora", group: "system" },
  { id: "redhat", label: "Red Hat", group: "system" },
  { id: "centos", label: "CentOS", group: "system" },
  { id: "rockylinux", label: "Rocky Linux", group: "system" },
  { id: "almalinux", label: "AlmaLinux", group: "system" },
  { id: "archlinux", label: "Arch Linux", group: "system" },
  { id: "alpinelinux", label: "Alpine Linux", group: "system" },
  { id: "opensuse", label: "openSUSE", group: "system" },
  { id: "linux", label: "Linux", group: "system" },
  { id: "server", label: "Servidor", group: "generic" },
  { id: "cloud", label: "Nuvem", group: "generic" },
  { id: "database", label: "Banco de dados", group: "generic" },
  { id: "terminal", label: "Terminal", group: "generic" },
  { id: "shield", label: "Segurança", group: "generic" },
  { id: "network", label: "Rede", group: "generic" },
  { id: "cpu", label: "Processamento", group: "generic" },
  { id: "globe", label: "Web", group: "generic" },
] as const;
export type ServerIconId = (typeof serverIcons)[number]["id"];
export function isServerIcon(value: unknown): value is ServerIconId {
  return (
    typeof value === "string" && serverIcons.some((icon) => icon.id === value)
  );
}
