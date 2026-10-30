#!/usr/bin/python3
"""Opt-in SSH bootstrap, invoked as root by the installer, never by the daemon."""
import getpass
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import time
import urllib.request
from urllib.parse import urlparse


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=20, **kwargs)


def setup():
    if os.geteuid() != 0:
        raise RuntimeError('Execute como root.')
    config_path = Path('/etc/foxops-agent/config.json')
    config = json.loads(config_path.read_text())
    from linux_agent import validate_endpoint
    validate_endpoint(config['endpoint'], config.get('allow_lan_http') is True)
    stored_ticket = config.get('ssh_bootstrap_ticket') if config.get('ssh_bootstrap_expires_at', 0) > time.time() else None
    ticket = stored_ticket or getpass.getpass('Autorização temporária SSH gerada no painel: ')
    if not ticket:
        raise RuntimeError('Gere uma autorização em Conexão SSH no painel.')
    if not shutil.which('ssh-keygen') or not Path('/usr/sbin/sshd').exists() or not shutil.which('sudo'):
        if not shutil.which('apt-get'):
            raise RuntimeError('Instale openssh-server e sudo antes da configuração SSH.')
        print('Instalando OpenSSH Server e sudo para a opção SSH escolhida...')
        subprocess.run(['apt-get', 'update'], check=True, timeout=300, env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})
        subprocess.run(['apt-get', 'install', '-y', 'openssh-server', 'sudo'], check=True, timeout=300, env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})
    unit = 'ssh.service' if Path('/lib/systemd/system/ssh.service').exists() or Path('/usr/lib/systemd/system/ssh.service').exists() else 'sshd.service'
    run(['systemctl', 'enable', '--now', unit])
    run(['/usr/sbin/sshd', '-t'])
    host_key = Path('/etc/ssh/ssh_host_ed25519_key.pub')
    if not host_key.exists():
        raise RuntimeError('Configure uma chave de host Ed25519 no OpenSSH.')
    fp = run(['ssh-keygen', '-lf', str(host_key), '-E', 'sha256']).stdout.split()[1]
    port = 22
    for line in run(['/usr/sbin/sshd', '-T']).stdout.splitlines():
        if line.startswith('port '):
            port = int(line.split()[1])
            break
    address = urlparse(config['endpoint']).hostname
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        route.connect((address, urlparse(config['endpoint']).port or (443 if config['endpoint'].startswith('https:') else 80)))
        host = route.getsockname()[0]
    print('Endereço sugerido para acesso do painel:', host)
    host = input('IP ou DNS acessível pelo painel [Enter para usar o sugerido]: ').strip() or host
    state = Path('/var/lib/foxops-ssh')
    state.mkdir(mode=0o700, exist_ok=True)
    os.chmod(state, 0o700)
    marker = state / 'managed'
    try:
        pwd.getpwnam('foxops-ssh')
        if not marker.exists():
            raise RuntimeError('Usuário foxops-ssh já existe fora desta instalação; escolha configuração manual.')
    except KeyError:
        run(['useradd', '--system', '--create-home', '--home-dir', '/var/lib/foxops-ssh-user', '--shell', '/bin/sh', 'foxops-ssh'])
        marker.touch(mode=0o600)
    home = Path(pwd.getpwnam('foxops-ssh').pw_dir)
    # Root ownership prevents the SSH account from replacing its restrictions.
    os.chown(home, 0, 0)
    os.chmod(home, 0o755)
    ssh_dir = home / '.ssh'
    ssh_dir.mkdir(mode=0o755, exist_ok=True)
    os.chown(ssh_dir, 0, 0)
    os.chmod(ssh_dir, 0o755)
    gateway = Path('/usr/local/sbin/foxops-ssh-gateway')
    shutil.copyfile(Path(__file__).with_name('ssh_gateway.py'), gateway)
    os.chown(gateway, 0, 0)
    os.chmod(gateway, 0o755)
    shutil.copyfile(Path(__file__).with_name('config_manager.py'), '/usr/local/sbin/foxops_config_manager.py')
    os.chown('/usr/local/sbin/foxops_config_manager.py', 0, 0)
    os.chmod('/usr/local/sbin/foxops_config_manager.py', 0o644)
    Path('/usr/local/sbin/foxops-config').write_text('#!/usr/bin/python3\nimport os,sys\nfrom foxops_config_manager import run\nsys.exit(run(sys.argv[1]) if os.geteuid()==0 and len(sys.argv)==2 else 126)\n')
    os.chown('/usr/local/sbin/foxops-config', 0, 0)
    os.chmod('/usr/local/sbin/foxops-config', 0o755)
    rule = Path('/etc/sudoers.d/foxops-ssh')
    if rule.exists() and 'SparkeOPS managed' not in rule.read_text():
        raise RuntimeError('Arquivo sudoers existente não pertence ao SparkeOPS.')
    rule.write_text('# SparkeOPS managed: validator accepts only fixed service operations\nfoxops-ssh ALL=(root) NOPASSWD: /usr/local/sbin/foxops-ssh-gateway *\n')
    os.chmod(rule, 0o440)
    try:
        run(['/usr/sbin/visudo', '-cf', str(rule)])
    except Exception:
        rule.unlink(missing_ok=True)
        raise
    key = state / 'bootstrap-key'
    if not key.exists():
        run(['ssh-keygen', '-t', 'ed25519', '-N', '', '-C', 'foxops-managed', '-f', str(key)])
    os.chmod(key, 0o600)
    authorized = ssh_dir / 'authorized_keys'
    previous = authorized.read_text() if authorized.exists() else ''
    entry = 'restrict,command="/usr/local/sbin/foxops-ssh-gateway" ' + key.with_suffix('.pub').read_text().strip()
    if entry not in previous:
        authorized.write_text(previous.rstrip() + '\n' + entry + '\n')
    os.chown(authorized, 0, 0)
    os.chmod(authorized, 0o644)
    try:
        payload = {'ticket': ticket, 'host': host, 'port': port, 'username': 'foxops-ssh', 'fingerprint': fp, 'privateKey': key.read_text()}
        req = urllib.request.Request(config['endpoint'].rstrip('/') + '/api/agent/ssh-bootstrap', data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as response:
            response.read()
    except Exception:
        # Keep the root-only key for retry but revoke access until registration succeeds.
        authorized.write_text(previous)
        config.pop('ssh_bootstrap_ticket', None)
        config.pop('ssh_bootstrap_expires_at', None)
        config_path.write_text(json.dumps(config))
        os.chmod(config_path, 0o600)
        raise RuntimeError('Cadastro recusado; acesso novo revogado. Gere outra autorização no painel e tente novamente.') from None
    key.unlink()
    key.with_suffix('.pub').unlink(missing_ok=True)
    config.pop('ssh_bootstrap_ticket', None)
    config.pop('ssh_bootstrap_expires_at', None)
    config_path.write_text(json.dumps(config))
    os.chmod(config_path, 0o600)
    print('SSH cadastrado no painel. Chave privada temporária removida do Ubuntu. Teste a conexão pelo painel.')


if __name__ == '__main__':
    try:
        setup()
    except Exception as error:
        # Do not dump request bodies, key material or credentials.
        print('Configuração SSH não concluída:', str(error) if isinstance(error, RuntimeError) else 'verifique OpenSSH, permissões e conectividade.')
        raise SystemExit(1)
