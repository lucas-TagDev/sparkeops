#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo 'Execute como root ou com sudo bash.'; exit 1; fi
if [ "${1:-}" = '--disable-terminal' ]; then
    rm -f -- /etc/foxops-terminal-enabled
    echo 'Novas sessões do terminal gerenciado desabilitadas. Encerre também as sessões ativas no painel.'
    exit 0
fi
if [ "${1:-}" = '--disable-runbooks' ]; then
    rm -f -- /etc/foxops-agent/allow-runbooks
    echo 'Runbooks desabilitados neste servidor.'
    exit 0
fi
if [ "${1:-}" = '--disable-approved-commands' ]; then
    rm -f -- /etc/foxops-agent/allow-approved-commands
    echo 'Execução genérica de comandos desabilitada; monitoramento preservado.'
    exit 0
fi
test -f /etc/foxops-agent/config.json || { echo 'Instale o agente pelo painel antes de atualizar.'; exit 1; }
endpoint="$(python3 -c 'import json; print(json.load(open("/etc/foxops-agent/config.json"))["endpoint"])')"
agent_tmp="$(mktemp --suffix=.py)"
trap 'rm -f -- "$agent_tmp"' EXIT
curl --fail --silent --show-error --max-time 30 "${endpoint%/}/agent/linux_agent.py" -o "$agent_tmp"
python3 -m py_compile "$agent_tmp"
install -m 0644 "$agent_tmp" /opt/foxops-agent/linux_agent.py
for group in adm systemd-journal; do
    if getent group "$group" >/dev/null; then usermod -a -G "$group" foxops-agent; fi
done
systemctl restart foxops-agent.service
if [ -f /usr/local/sbin/foxops-ssh-gateway ] || [ -f /opt/foxops-agent/ssh_gateway.py ] || getent passwd foxops-ssh >/dev/null; then
    for helper in ssh_gateway.py config_manager.py runbook_runner.py; do
        curl --fail --silent --show-error --max-time 30 "${endpoint%/}/agent/$helper" -o "$agent_tmp"
        python3 -m py_compile "$agent_tmp"
        if [ "$helper" = 'ssh_gateway.py' ]; then
            install -m 0755 "$agent_tmp" /usr/local/sbin/foxops-ssh-gateway
        elif [ "$helper" = 'config_manager.py' ]; then
            install -m 0644 "$agent_tmp" /usr/local/sbin/foxops_config_manager.py
        else
            install -m 0644 "$agent_tmp" /usr/local/sbin/foxops_runbook_runner.py
        fi
    done
    printf '%s\n' '#!/usr/bin/python3' 'import os,sys' 'from foxops_config_manager import run' 'sys.exit(run(sys.argv[1]) if os.geteuid()==0 and len(sys.argv)==2 else 126)' > /usr/local/sbin/foxops-config
    chmod 0755 /usr/local/sbin/foxops-config
    printf '%s\n' '#!/usr/bin/python3' 'import os,sys' 'from foxops_runbook_runner import run' 'sys.exit(run(sys.argv[1]) if os.geteuid()==0 and len(sys.argv)==2 else 126)' > /usr/local/sbin/foxops-runbook
    chmod 0755 /usr/local/sbin/foxops-runbook
fi
if [ "${1:-}" = '--setup-ssh' ]; then
    for helper in setup_ssh.py ssh_gateway.py config_manager.py; do
        curl --fail --silent --show-error --max-time 30 "${endpoint%/}/agent/$helper" -o "$agent_tmp"
        install -m 0644 "$agent_tmp" "/opt/foxops-agent/$helper"
    done
    python3 /opt/foxops-agent/setup_ssh.py
fi
if [ -f /usr/local/sbin/foxops-ssh-gateway ]; then
    /usr/local/sbin/foxops-ssh-gateway '/usr/bin/hostname' >/dev/null || { echo 'Falha ao executar o gateway SSH instalado. Confira Python e permissões.'; exit 1; }
    echo 'Gateway SSH instalado e execução local validada.'
fi
echo 'Agente atualizado; credencial e configuração preservadas.'
if [ "${1:-}" = '--enable-terminal' ]; then
    test -f /usr/local/sbin/foxops-ssh-gateway || { echo 'Configure primeiro o SSH gerenciado no painel.'; exit 1; }
    python3 - <<'PY'
from pathlib import Path
import pwd
path=Path(pwd.getpwnam('foxops-ssh').pw_dir)/'.ssh/authorized_keys'
lines=path.read_text().splitlines()
prefix='restrict,command="/usr/local/sbin/foxops-ssh-gateway" '
lines=[line.replace(prefix,'restrict,pty,command="/usr/local/sbin/foxops-ssh-gateway" ',1) if line.startswith(prefix) else line for line in lines]
path.write_text('\n'.join(lines)+'\n')
PY
    printf '%s\n' enabled > /etc/foxops-terminal-enabled
    chown root:root /etc/foxops-terminal-enabled
    chmod 0600 /etc/foxops-terminal-enabled
    echo 'Terminal gerenciado habilitado: sessões autorizadas no painel podem abrir shell como root.'
fi
if [ "${1:-}" = '--enable-runbooks' ]; then
    test -f /usr/local/sbin/foxops-ssh-gateway || { echo 'Configure primeiro o SSH gerenciado pelo painel.'; exit 1; }
    printf '%s\n' enabled > /etc/foxops-agent/allow-runbooks
    chown root:root /etc/foxops-agent/allow-runbooks
    chmod 0600 /etc/foxops-agent/allow-runbooks
    echo 'Scripts locais cadastrados e aprovados no painel podem executar como root; automação exige autorização por runbook.'
fi
if [ "${1:-}" = '--enable-approved-commands' ]; then
    test -f /usr/local/sbin/foxops-ssh-gateway || { echo 'Configure o SSH gerenciado pelo painel antes de habilitar comandos.'; exit 1; }
    echo 'Habilitando comandos administrativos aprovados no painel. Esse acesso pode alterar o sistema como root.'
    curl --fail --silent --show-error --max-time 30 "${endpoint%/}/agent/command_runner.py" -o "$agent_tmp"
    install -m 0644 "$agent_tmp" /usr/local/sbin/foxops_command_runner.py
    printf '%s\n' '#!/usr/bin/python3' 'import os,sys' 'from foxops_command_runner import run' 'sys.exit(run(sys.argv[1]) if os.geteuid()==0 and len(sys.argv)==2 else 126)' > /usr/local/sbin/foxops-command
    chmod 0755 /usr/local/sbin/foxops-command
    printf '%s\n' enabled > /etc/foxops-agent/allow-approved-commands
    chown root:root /etc/foxops-agent/allow-approved-commands
    chmod 0600 /etc/foxops-agent/allow-approved-commands
fi
