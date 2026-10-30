#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo 'Execute com sudo bash.'; exit 1; fi
command -v python3 >/dev/null || { echo 'Instale Python 3.10 ou superior.'; exit 1; }
command -v systemctl >/dev/null || { echo 'Este instalador requer systemd.'; exit 1; }
command -v curl >/dev/null || { echo 'Instale curl.'; exit 1; }
python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10 ou superior necessário"'
endpoint="${1:?Informe a URL da aplicação como primeiro argumento}"
lan_flag=''
ssh_choice='ask'
for option in "${@:2}"; do
    case "$option" in
        --allow-lan-http) lan_flag="$option" ;;
        --setup-ssh) ssh_choice='yes' ;;
        --no-ssh) ssh_choice='no' ;;
        *) echo 'Opção desconhecida.'; exit 1 ;;
    esac
done
if [ "$ssh_choice" = 'ask' ] && [ -t 0 ]; then
    echo 'Opcional: criar usuário SSH dedicado, gerar chave e cadastrar no painel.'
    echo 'Permite somente operações de serviços aprovadas, sem terminal livre.'
    read -r -p 'Configurar SSH automaticamente? [s/N] ' answer
    case "$answer" in s|S|sim|SIM) ssh_choice='yes' ;; *) ssh_choice='no' ;; esac
fi
python3 -c 'import sys, urllib.parse, ipaddress; u=urllib.parse.urlparse(sys.argv[1]); private=False
if sys.argv[2] == "--allow-lan-http":
    try: private=any(ipaddress.IPv4Address(u.hostname) in ipaddress.IPv4Network(n) for n in ("10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"))
    except (ValueError, TypeError): pass
assert u.scheme=="https" or (u.scheme=="http" and (u.hostname in ("localhost","127.0.0.1","::1") or private)), "Use HTTPS; teste com IP privado exige --allow-lan-http"
assert not u.username and not u.password and not u.query and not u.fragment and u.path in ("", "/"), "Informe somente a origem"' "$endpoint" "$lan_flag"
if ! id foxops-agent >/dev/null 2>&1; then useradd --system --no-create-home --shell /usr/sbin/nologin foxops-agent; fi
for group in adm systemd-journal; do
    if getent group "$group" >/dev/null; then usermod -a -G "$group" foxops-agent; fi
done
install -d -m 0755 /opt/foxops-agent
install -d -m 0750 -o foxops-agent -g foxops-agent /etc/foxops-agent
agent_tmp="$(mktemp)"
trap 'rm -f -- "$agent_tmp"' EXIT
curl --fail --silent --show-error --max-time 30 "${endpoint%/}/agent/linux_agent.py" -o "$agent_tmp"
install -m 0644 "$agent_tmp" /opt/foxops-agent/linux_agent.py
enroll_flags=()
if [ "$lan_flag" = '--allow-lan-http' ]; then enroll_flags+=(--allow-lan-http); fi
if [ "$ssh_choice" = 'yes' ]; then enroll_flags+=(--setup-ssh); fi
python3 /opt/foxops-agent/linux_agent.py --enroll --endpoint "$endpoint" --config /etc/foxops-agent/config.json "${enroll_flags[@]}"
chown foxops-agent:foxops-agent /etc/foxops-agent/config.json
chmod 0600 /etc/foxops-agent/config.json
cat > /etc/systemd/system/foxops-agent.service <<'UNIT'
[Unit]
Description=SparkeOPS Linux Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=foxops-agent
Group=foxops-agent
ExecStart=/usr/bin/python3 -u /opt/foxops-agent/linux_agent.py --config /etc/foxops-agent/config.json
Restart=on-failure
RestartSec=15
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now foxops-agent.service
if [ "$ssh_choice" = 'yes' ]; then
    for helper in setup_ssh.py ssh_gateway.py config_manager.py; do
        curl --fail --silent --show-error --max-time 30 "${endpoint%/}/agent/$helper" -o "$agent_tmp"
        install -m 0644 "$agent_tmp" "/opt/foxops-agent/$helper"
    done
    python3 /opt/foxops-agent/setup_ssh.py || echo 'Agente ativo; configuração SSH pendente. Confira Conexão SSH no painel.'
fi
echo 'Agente instalado. Acompanhe com: journalctl -u foxops-agent -f'
