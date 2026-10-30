#!/usr/bin/env bash
# Instala a PLATAFORMA, não o agente de monitoramento.
set -Eeuo pipefail
umask 027
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
BASE=/opt/foxops
DATA=/var/lib/foxops
ENV_FILE=/etc/foxops/foxops.env
UNIT=/etc/systemd/system/foxops.service
NODE_VERSION=24.22.2
PUBLIC_URL= ADMIN_EMAIL= PORT=8080 LOCAL=0 CHECK=0 CONFIRM_DNS_PORTS=0 HTTPS_REQUIRED=0
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
fail() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }
help() {
  cat <<'HELP'
Instalador da plataforma SparkeOPS (Linux com systemd).

Produção (HTTPS e certificado automáticos):
  sudo bash deploy/install.sh --public-url https://monitor.exemplo.com --admin-email admin@exemplo.com
Rede local:
  sudo bash deploy/install.sh --local --public-url http://192.168.3.180:8080 --admin-email admin@exemplo.com
Atualização (usa configuração existente e faz backup antes de trocar):
  sudo bash deploy/install.sh

Opções: --public-url URL, --admin-email EMAIL, --port 8080,
        --local (HTTP somente para testes), --check (somente verificar),
        --confirm-dns-ports (confirma DNS e portas 80/443), --help.
Dados: /var/lib/foxops. Configuração: /etc/foxops/foxops.env.
Não importa os dados de outra instalação automaticamente.
HELP
}
while (($#)); do
  case "$1" in
    --public-url|--admin-email|--port)
      (($# >= 2)) || fail "Falta o valor de $1"
      case "$1" in --public-url) PUBLIC_URL=$2;; --admin-email) ADMIN_EMAIL=$2;; --port) PORT=$2;; esac
      shift 2;;
    --local) LOCAL=1; shift;;
    --confirm-dns-ports) CONFIRM_DNS_PORTS=1; shift;;
    --check) CHECK=1; shift;;
    --help|-h) help; exit 0;;
    *) fail "Opção desconhecida: $1";;
  esac
done
[[ $(uname -s) == Linux ]] || fail 'Execute este instalador no Linux.'
[[ -r /etc/os-release ]] || fail 'Não foi possível identificar a distribuição.'
# Arquivo do próprio sistema operacional, nunca fornecido pelo pacote.
. /etc/os-release
FAMILY=
case " ${ID:-} ${ID_LIKE:-} " in
  *debian*|*ubuntu*) FAMILY=apt;;
  *rhel*|*fedora*|*rocky*|*almalinux*|*centos*) FAMILY=dnf;;
  *suse*) FAMILY=zypper;;
  *) fail 'Distribuição sem instalador de dependências suportado. Use Debian/Ubuntu, RHEL/Rocky/Alma/Fedora ou openSUSE.';;
esac
case $(uname -m) in x86_64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; *) fail 'Arquitetura suportada: x86_64 ou ARM64.';; esac
command -v systemctl >/dev/null || fail 'systemd é necessário.'
[[ -d /run/systemd/system ]] || fail 'systemd precisa estar em execução (não execute em um contêiner sem systemd).'
LIBC=$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}') || fail 'glibc é necessária; Alpine/musl não é suportado por este instalador.'
[[ $(printf '%s\n' 2.28 "$LIBC" | sort -V | head -n1) == 2.28 ]] || fail 'glibc 2.28 ou superior é necessária.'
KERNEL=$(uname -r | cut -d- -f1)
[[ $(printf '%s\n' 4.18 "$KERNEL" | sort -V | head -n1) == 4.18 ]] || fail 'Kernel Linux 4.18 ou superior é necessário.'
printf 'Sistema: %s; arquitetura: %s; glibc: %s\n' "${PRETTY_NAME:-$ID}" "$ARCH" "$LIBC"
((CHECK == 0)) || { printf 'Pré-verificação concluída. Nenhuma alteração realizada.\n'; exit 0; }
((EUID == 0)) || fail 'Execute com sudo ou como root.'
[[ -f "$SOURCE/package-lock.json" && -f "$SOURCE/src/server.ts" && -f "$SOURCE/deploy/platform-state.sh" ]] || fail 'Extraia o pacote completo antes de executar.'
. "$SOURCE/deploy/platform-state.sh"
command -v flock >/dev/null || fail 'Instale util-linux (flock) antes de continuar.'
exec 9>/run/foxops-install.lock
flock -n 9 || fail 'Outra instalação está em execução.'
for path in "$BASE" "$BASE/releases" "$BASE/runtime" "$BASE/current" "$DATA" /etc/foxops "$ENV_FILE" "$UNIT" /var/backups/foxops /var/cache/foxops; do
  [[ ! -L "$path" || "$path" == "$BASE/current" ]] || fail "Caminho não pode ser link simbólico: $path"
done
HAD_CONFIG=0
if [[ -f "$ENV_FILE" ]]; then
  HAD_CONFIG=1
  [[ -z "$PUBLIC_URL" && -z "$ADMIN_EMAIL" && "$LOCAL" == 0 && "$PORT" == 8080 ]] || fail 'Atualização preserva a configuração existente. Edite /etc/foxops/foxops.env para alterar o endereço ou administrador.'
  printf 'Atualização: configurações e credenciais existentes serão preservadas.\n'
else
  if [[ -z "$PUBLIC_URL" && -t 0 ]]; then read -r -p 'URL pública (https://dominio ou http://IP:8080 para teste): ' PUBLIC_URL; fi
  if [[ -z "$ADMIN_EMAIL" && -t 0 ]]; then read -r -p 'E-mail do administrador geral: ' ADMIN_EMAIL; fi
  [[ "$PUBLIC_URL" =~ ^https?://[a-zA-Z0-9][a-zA-Z0-9.:-]*/*$ ]] || fail 'Informe uma URL sem caminho, usuário, senha ou parâmetros.'
  PUBLIC_URL=${PUBLIC_URL%/}
  [[ "$ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || fail 'Informe um e-mail válido para o administrador.'
  [[ "$PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$PORT >= 1024 && 10#$PORT < 65536)) || fail 'Use uma porta entre 1024 e 65535.'
  PORT=$((10#$PORT))
  [[ "$PUBLIC_URL" == https://* || "$LOCAL" == 1 ]] || fail 'HTTP exige --local; produção exige HTTPS.'
  if ((LOCAL)); then
    [[ "$PUBLIC_URL" == http://* ]] || fail '--local usa HTTP. Para HTTPS remova --local.'
    authority=${PUBLIC_URL#http://}
    [[ "$authority" == *":$PORT" || ("$PORT" == 80 && "$authority" != *:*) ]] || fail 'A porta da URL local precisa corresponder a --port.'
  fi
fi
SETUP_URL=$PUBLIC_URL
if [[ -f "$ENV_FILE" ]]; then SETUP_URL=$(sed -n 's/^PUBLIC_URL=//p' "$ENV_FILE" | tail -n1); fi
if [[ "$SETUP_URL" == https://* ]]; then
  [[ -f "$SOURCE/deploy/https.sh" ]] || fail 'Pacote incompleto: deploy/https.sh'
  . "$SOURCE/deploy/https.sh"
  HTTPS_REQUIRED=1
  https_notice "$SETUP_URL" "$CONFIRM_DNS_PORTS"
  if [[ ! -f "$ENV_FILE" ]]; then PUBLIC_URL="https://$HTTPS_DOMAIN"; fi
fi
printf 'Instalando dependências do sistema...\n'
case "$FAMILY" in
  apt) export DEBIAN_FRONTEND=noninteractive; apt-get update; apt-get install -y ca-certificates curl tar xz-utils python3 make g++ libstdc++6 util-linux iproute2;;
  dnf) command -v dnf >/dev/null || fail 'dnf é necessário nesta distribuição.'; dnf install -y ca-certificates curl tar xz python3 make gcc-c++ libstdc++ util-linux iproute;;
  zypper) zypper --non-interactive install ca-certificates curl tar xz python3 make gcc-c++ libstdc++6 util-linux iproute2;;
esac
if [[ -f "$SOURCE/SHA256SUMS" ]]; then (cd "$SOURCE"; sha256sum --strict -c SHA256SUMS); fi
getent group foxops >/dev/null || groupadd --system foxops
if ! id foxops >/dev/null 2>&1; then
  useradd --system --gid foxops --home-dir "$DATA" --shell /usr/sbin/nologin foxops
else
  [[ $(id -u foxops) != 0 ]] || fail 'Usuário foxops não pode ser root.'
fi
install -d -m 0755 "$BASE" "$BASE/releases" "$BASE/runtime"
install -d -m 0700 /var/backups/foxops
install -d -m 0750 -o foxops -g foxops "$DATA" /var/cache/foxops
install -d -m 0750 -o root -g foxops /etc/foxops
TEMP=$(mktemp -d /tmp/foxops-platform.XXXXXXXX)
chmod 0755 "$TEMP"
PREVIOUS=$(platform_previous_release "$BASE/current")
STOPPED=0 SWITCHED=0 SUCCESS=0
cleanup() {
  code=$?
  if ((SUCCESS == 0 && STOPPED)); then
    if ((HTTPS_REQUIRED)); then https_restore || true; fi
    platform_stop_if_loaded foxops.service || true
    if ((SWITCHED)) && [[ -n "$PREVIOUS" && -d "$PREVIOUS" && -f "$TEMP/previous.service" ]]; then
      ln -sfn "$PREVIOUS" "$BASE/current.restore"
      mv -Tf "$BASE/current.restore" "$BASE/current"
    fi
    if [[ -n "$PREVIOUS" && -f "$TEMP/previous.service" ]]; then
      install -m 0644 "$TEMP/previous.service" "$UNIT"
      systemctl daemon-reload
    fi
    if [[ -n "$PREVIOUS" ]] && platform_unit_loaded foxops.service; then systemctl start foxops || true; fi
    printf 'Instalação não concluída. Verifique journalctl -u foxops. Backup preservado em /var/backups/foxops.\n' >&2
  fi
  # TEMP vem exclusivamente de mktemp com prefixo fixo.
  [[ "$TEMP" == /tmp/foxops-platform.* ]] && rm -rf -- "$TEMP"
  exit "$code"
}
trap cleanup EXIT
PHASE="preparação do HTTPS"
trap 'printf "ERRO: falha na etapa %s (linha %s, código %s).\n" "$PHASE" "$LINENO" "$?" >&2' ERR
if ((HTTPS_REQUIRED)); then https_prepare; fi
PHASE="instalação do Node.js"
NODE_HOME="$BASE/runtime/node-v$NODE_VERSION-linux-$ARCH"
if [[ ! -x "$NODE_HOME/bin/node" ]]; then
  FILE="node-v$NODE_VERSION-linux-$ARCH.tar.xz"
  URL="https://nodejs.org/dist/v$NODE_VERSION"
  curl --proto '=https' --tlsv1.2 -fL --retry 3 "$URL/$FILE" -o "$TEMP/$FILE"
  curl --proto '=https' --tlsv1.2 -fL --retry 3 "$URL/SHASUMS256.txt" -o "$TEMP/SHASUMS256.txt"
  (cd "$TEMP"; awk -v name="$FILE" '$2==name {print}' SHASUMS256.txt > expected.sha256; [[ -s expected.sha256 ]]; sha256sum -c expected.sha256)
  tar -xJf "$TEMP/$FILE" -C "$BASE/runtime" --no-same-owner
  chown -R root:root "$NODE_HOME"
fi
"$NODE_HOME/bin/node" --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const d=new DatabaseSync(":memory:"); d.close(); console.log("Node e SQLite disponíveis.")'
export PATH="$NODE_HOME/bin:$PATH"
PHASE="compilação da plataforma"
RELEASE="$BASE/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 0755 "$RELEASE"
for item in src shared web agent deploy scripts package.json package-lock.json tsconfig.json vite.config.ts index.html; do
  [[ -e "$SOURCE/$item" ]] || fail "Pacote incompleto: $item"
  cp -R -- "$SOURCE/$item" "$RELEASE/"
done
[[ -f "$SOURCE/.env.example" ]] && cp "$SOURCE/.env.example" "$RELEASE/"
chown -R foxops:foxops "$RELEASE"
# Instalação dos pacotes e build como usuário sem privilégios. Não executa scripts npm de terceiros.
runuser -u foxops -- env NODE_ENV=development PATH="$PATH" HOME="$DATA" npm_config_cache=/var/cache/foxops bash -c 'cd "$1" && npm ci --ignore-scripts --no-audit --no-fund && npm run typecheck && npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund' _ "$RELEASE"
chown -R root:root "$RELEASE"
chmod -R a+rX,go-w "$RELEASE"
if [[ ! -f "$ENV_FILE" ]]; then
  if ((LOCAL)); then MODE=development; HOST=0.0.0.0; PROXY=0; else MODE=production; HOST=127.0.0.1; PROXY=1; fi
  cat > "$ENV_FILE" <<ENV
NODE_ENV=$MODE
HOST=$HOST
PORT=$PORT
PUBLIC_URL=$PUBLIC_URL
TRUST_PROXY=$PROXY
FOXOPS_DATABASE=$DATA/foxops.sqlite3
FOXOPS_AI_KEY_FILE=$DATA/.secrets/ai-master.key
FOXOPS_PLATFORM_ADMIN_EMAILS=$ADMIN_EMAIL
ENV
  chmod 0600 "$ENV_FILE"
fi
if [[ -f "$UNIT" ]]; then cp "$UNIT" "$TEMP/previous.service"; fi
PHASE="backup da instalação anterior"
if [[ -n "$PREVIOUS" || -f "$DATA/foxops.sqlite3" || "$HAD_CONFIG" == 1 ]]; then
  platform_stop_if_loaded foxops.service
  STOPPED=1
  BACKUP="/var/backups/foxops/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
  # Inclui banco, eventuais WALs, arquivo mestre e configuração. Nunca distribua este backup com o instalador.
  BACKUP_PATHS=(etc/foxops var/lib/foxops)
  [[ ! -d /var/lib/sparkeops-https ]] || BACKUP_PATHS+=(var/lib/sparkeops-https)
  [[ ! -f "$UNIT" ]] || BACKUP_PATHS+=(etc/systemd/system/foxops.service)
  [[ ! -f /etc/systemd/system/sparkeops-https.service ]] || BACKUP_PATHS+=(etc/systemd/system/sparkeops-https.service)
  tar -czf "$BACKUP" -C / "${BACKUP_PATHS[@]}"
  chmod 0600 "$BACKUP"
  printf 'Backup: %s\n' "$BACKUP"
fi
PHASE="configuração do serviço da plataforma"
cat > "$UNIT" <<UNIT
[Unit]
Description=SparkeOPS Linux Monitoring Platform
Wants=network-online.target
After=network-online.target
[Service]
Type=simple
User=foxops
Group=foxops
WorkingDirectory=$BASE/current
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_HOME/bin/node src/server.ts
Restart=on-failure
RestartSec=5
TimeoutStopSec=60
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA
[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "$UNIT"
STOPPED=1
ln -s "$RELEASE" "$BASE/current.next"
mv -Tf "$BASE/current.next" "$BASE/current"
SWITCHED=1
systemctl daemon-reload
systemctl enable --now foxops
# --now não reinicia um serviço que já estava ativo em uma instalação inconsistente.
systemctl restart foxops
HEALTH_PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -n1)
HEALTH_URL=$(sed -n 's/^PUBLIC_URL=//p' "$ENV_FILE" | tail -n1)
HEALTH_HOST=${HEALTH_URL#*://}
HEALTH_HOST=${HEALTH_HOST%:443}
healthy=0
for ((i=0;i<30;i++)); do
  if curl --noproxy '*' -fsS -H "Host: $HEALTH_HOST" "http://127.0.0.1:$HEALTH_PORT/health" > /dev/null && systemctl is-active --quiet foxops; then healthy=1; break; fi
  sleep 1
done
((healthy)) || fail 'Aplicação não respondeu à verificação de saúde.'
PHASE="emissão e validação do certificado HTTPS"
if ((HTTPS_REQUIRED)); then
  CERT_EMAIL=$(sed -n 's/^FOXOPS_PLATFORM_ADMIN_EMAILS=//p' "$ENV_FILE" | tail -n1)
  https_activate "$HEALTH_PORT" "${CERT_EMAIL%%,*}"
fi
SUCCESS=1
printf '\nInstalação concluída: %s\nServiço: systemctl status foxops\nLogs: journalctl -u foxops -f\n' "$HEALTH_URL"
printf 'Cadastre no painel a conta com o e-mail de administrador informado. Nenhuma senha padrão foi criada.\n'
if ((HTTPS_REQUIRED)); then
  printf 'Proxy e certificado configurados. Renovação automática enquanto o domínio e o serviço permanecerem disponíveis.\nLogs HTTPS: journalctl -u sparkeops-https -f\n'
else
  printf 'Modo local de testes. Libere a porta %s no firewall se necessário.\n' "$HEALTH_PORT"
fi
