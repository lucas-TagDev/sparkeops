#!/usr/bin/env bash
# Biblioteca do instalador: proxy exclusivo da plataforma, sem alterar Nginx/Apache/Caddy existentes.
HTTPS_UNIT=/etc/systemd/system/sparkeops-https.service
HTTPS_CONFIG=/etc/foxops/https.Caddyfile
HTTPS_DATA=/var/lib/sparkeops-https
HTTPS_CHANGED=0
HTTPS_WAS_ACTIVE=0

https_verify_archive() {
  python3 - "$1" "$2" "$3" <<'PY'
import hashlib, hmac, pathlib, re, sys
directory, name, manifest = sys.argv[1:]
if pathlib.Path(name).name != name:
    raise SystemExit('Nome do arquivo Caddy inválido.')
matches = []
for line in pathlib.Path(manifest).read_text(encoding='utf-8-sig').splitlines():
    parts = line.split()
    if len(parts) == 2 and parts[1].lstrip('*') == name:
        matches.append(parts[0].lower())
if len(matches) != 1:
    raise SystemExit('Manifesto Caddy sem checksum único para o arquivo baixado.')
expected = matches[0]
if not re.fullmatch(r'[a-f0-9]+', expected) or len(expected) not in (64, 128):
    raise SystemExit('Algoritmo de checksum Caddy desconhecido. Instalação interrompida.')
algorithm = 'sha256' if len(expected) == 64 else 'sha512'
digest = hashlib.new(algorithm)
with open(pathlib.Path(directory) / name, 'rb') as archive:
    for chunk in iter(lambda: archive.read(1024 * 1024), b''):
        digest.update(chunk)
if not hmac.compare_digest(digest.hexdigest(), expected):
    raise SystemExit('Checksum Caddy divergente. Arquivo não será instalado.')
print(f'Caddy: {algorithm.upper()} verificado com sucesso.')
PY
}

https_domain() {
  local url=$1 domain
  [[ "$url" == https://* ]] || return 1
  domain=${url#https://}
  domain=${domain%:443}
  [[ ${#domain} -le 253 && "$domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]] || return 1
  case "$domain" in *.localhost|*.local|*.internal|*.test|*.invalid|*.example) return 1;; esac
  printf '%s\n' "$domain"
}

https_notice() {
  local url=$1 confirmed=$2 answer
  HTTPS_DOMAIN=$(https_domain "$url") || fail 'HTTPS automático exige um domínio público, sem caminho ou porta diferente de 443.'
  printf '\nATENÇÃO OBRIGATÓRIA — HTTPS AUTOMÁTICO\n'
  printf 'O domínio %s deve apontar para este servidor (DNS A e, se houver, AAAA).\n' "$HTTPS_DOMAIN"
  printf 'As portas TCP 80 e 443 devem estar abertas no servidor, firewall, roteador/NAT e provedor.\n'
  printf 'Sem esses requisitos, a emissão do certificado e a instalação não serão concluídas.\n'
  if [[ "$confirmed" != 1 ]]; then
    [[ -t 0 ]] || fail 'Confirme os requisitos acrescentando --confirm-dns-ports ao comando.'
    read -r -p 'Confirma DNS e portas? Digite SIM: ' answer
    [[ "$answer" == SIM ]] || fail 'Requisitos de DNS e portas não confirmados.'
  fi
}

https_prepare() {
  local file version archive_url checksums_url
  for file in "$HTTPS_UNIT" "$HTTPS_CONFIG" "$HTTPS_DATA" "$BASE/proxy"; do
    [[ ! -L "$file" ]] || fail "Caminho HTTPS não pode ser link simbólico: $file"
  done
  if [[ -f "$HTTPS_UNIT" ]] && ! grep -q '^# Managed by SparkeOPS installer$' "$HTTPS_UNIT"; then
    fail 'A unidade sparkeops-https já existe e não pertence ao instalador.'
  fi
  if [[ -f "$HTTPS_CONFIG" ]] && ! grep -q '^# Managed by SparkeOPS installer$' "$HTTPS_CONFIG"; then
    fail 'O arquivo https.Caddyfile já existe e não pertence ao instalador.'
  fi
  getent ahosts "$HTTPS_DOMAIN" >/dev/null || fail "O DNS de $HTTPS_DOMAIN ainda não resolve. Corrija o apontamento e execute novamente."
  if systemctl is-active --quiet sparkeops-https; then
    HTTPS_WAS_ACTIVE=1
  elif [[ -n $(ss -H -ltn 'sport = :80 or sport = :443') ]]; then
    fail 'As portas 80/443 já estão em uso. Libere-as antes de instalar o HTTPS; nenhum serviço existente foi interrompido.'
  fi
  install -d -m 0755 "$BASE/proxy"
  if [[ ! -x "$BASE/proxy/caddy" ]]; then
    # Releases oficiais com SHA-256; não executa instaladores remotos via pipe.
    curl --proto '=https' --tlsv1.2 -fL --retry 3 https://api.github.com/repos/caddyserver/caddy/releases/latest -o "$TEMP/caddy-release.json"
    python3 - "$TEMP/caddy-release.json" "$ARCH" > "$TEMP/caddy-downloads" <<'PY'
import json, re, sys
release = json.load(open(sys.argv[1], encoding='utf-8'))
tag = release['tag_name']
if not re.fullmatch(r'v\d+\.\d+\.\d+', tag): raise SystemExit('Release Caddy inválida')
version = tag[1:]
arch = {'x64': 'amd64', 'arm64': 'arm64'}[sys.argv[2]]
names = [f'caddy_{version}_linux_{arch}.tar.gz', f'caddy_{version}_checksums.txt']
assets = {a['name']: a['browser_download_url'] for a in release['assets']}
print(names[0])
for name in names:
    url = assets[name]
    if url != f'https://github.com/caddyserver/caddy/releases/download/{tag}/{name}': raise SystemExit('Origem Caddy inválida')
    print(url)
PY
    { read -r file; read -r archive_url; read -r checksums_url; } < "$TEMP/caddy-downloads"
    curl --proto '=https' --tlsv1.2 -fL --retry 3 "$archive_url" -o "$TEMP/$file"
    curl --proto '=https' --tlsv1.2 -fL --retry 3 "$checksums_url" -o "$TEMP/caddy-checksums.txt"
    https_verify_archive "$TEMP" "$file" "$TEMP/caddy-checksums.txt"
    tar -xzf "$TEMP/$file" -C "$TEMP" caddy
    install -m 0755 -o root -g root "$TEMP/caddy" "$BASE/proxy/caddy"
  fi
  "$BASE/proxy/caddy" version
  getent group sparkeops-proxy >/dev/null || groupadd --system sparkeops-proxy
  if ! id sparkeops-proxy >/dev/null 2>&1; then
    useradd --system --gid sparkeops-proxy --home-dir "$HTTPS_DATA" --shell /usr/sbin/nologin sparkeops-proxy
  fi
  [[ $(id -u sparkeops-proxy) != 0 ]] || fail 'Usuário do proxy não pode ser root.'
  install -d -m 0750 -o sparkeops-proxy -g sparkeops-proxy "$HTTPS_DATA"
  [[ ! -f "$HTTPS_UNIT" ]] || cp "$HTTPS_UNIT" "$TEMP/previous-https.service"
  [[ ! -f "$HTTPS_CONFIG" ]] || cp "$HTTPS_CONFIG" "$TEMP/previous-https.Caddyfile"
}

https_activate() {
  local port=$1 email=$2
  [[ "$email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || fail 'E-mail do administrador inválido para o certificado.'
  cat > "$TEMP/new.Caddyfile" <<CADDY
# Managed by SparkeOPS installer
{
  admin off
  email $email
}
$HTTPS_DOMAIN {
  tls {
    issuer acme {
      dir https://acme-v02.api.letsencrypt.org/directory
    }
  }
  reverse_proxy 127.0.0.1:$port
}
CADDY
  "$BASE/proxy/caddy" validate --config "$TEMP/new.Caddyfile" --adapter caddyfile
  HTTPS_CHANGED=1
  # Apenas o arquivo dedicado à plataforma é escrito. O Caddyfile global não é alterado.
  install -m 0644 -o root -g root "$TEMP/new.Caddyfile" "$HTTPS_CONFIG"
  cat > "$HTTPS_UNIT" <<UNIT
# Managed by SparkeOPS installer
[Unit]
Description=SparkeOPS Automatic HTTPS Proxy
Wants=network-online.target
After=network-online.target foxops.service
[Service]
Type=simple
User=sparkeops-proxy
Group=sparkeops-proxy
Environment=HOME=$HTTPS_DATA
Environment=XDG_DATA_HOME=$HTTPS_DATA/data
Environment=XDG_CONFIG_HOME=$HTTPS_DATA/config
ExecStart=$BASE/proxy/caddy run --config $HTTPS_CONFIG --adapter caddyfile
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$HTTPS_DATA
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
  chmod 0644 "$HTTPS_UNIT"
  # /etc/foxops é privado; conceda somente travessia do grupo ao usuário dedicado do proxy.
  usermod -a -G foxops sparkeops-proxy
  systemctl daemon-reload
  systemctl enable sparkeops-https
  systemctl restart sparkeops-https
  printf 'Aguardando emissão do certificado HTTPS (até 180 segundos)...\n'
  local deadline=$((SECONDS+180))
  while ((SECONDS < deadline)); do
    # Não usa -k: certificado, nome do domínio e cadeia de confiança devem ser válidos.
    if curl --noproxy '*' --connect-timeout 3 --max-time 5 --resolve "$HTTPS_DOMAIN:443:127.0.0.1" -fsS "https://$HTTPS_DOMAIN/health" >/dev/null && systemctl is-active --quiet sparkeops-https; then
      printf 'HTTPS validado: https://%s (certificado com renovação automática).\n' "$HTTPS_DOMAIN"
      return 0
    fi
    sleep 2
  done
  fail 'Certificado/HTTPS não ficou disponível. Confira DNS A/AAAA, portas 80/443, NAT e journalctl -u sparkeops-https. A instalação não foi marcada como concluída.'
}

https_restore() {
  ((HTTPS_CHANGED)) || return 0
  systemctl stop sparkeops-https || true
  if [[ -f "$TEMP/previous-https.Caddyfile" ]]; then
    install -m 0644 "$TEMP/previous-https.Caddyfile" "$HTTPS_CONFIG"
  else
    rm -f -- "$HTTPS_CONFIG"
  fi
  if [[ -f "$TEMP/previous-https.service" ]]; then
    install -m 0644 "$TEMP/previous-https.service" "$HTTPS_UNIT"
  else
    systemctl disable sparkeops-https || true
    rm -f -- "$HTTPS_UNIT"
  fi
  systemctl daemon-reload
  if ((HTTPS_WAS_ACTIVE)); then systemctl start sparkeops-https || true; fi
}
