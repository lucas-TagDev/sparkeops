#!/usr/bin/python3
"""Root-owned forced SSH command gateway. No shell evaluation or free terminal."""
import os
import re
import shlex
import subprocess
import sys
import stat
from pathlib import Path


def allowed(command):
    try:
        parts = shlex.split(command)
    except ValueError:
        return None
    if parts[:2] == ['sudo', '-n']:
        parts = parts[2:]
    if len(parts)==4 and parts[:3]==['/usr/bin/python3','/opt/foxops-agent/linux_agent.py','--diagnose-service'] and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}',parts[3]):
        return parts
    if parts == ['/usr/bin/hostname']:
        return parts
    if parts in (['/usr/sbin/nginx', '-t'], ['/usr/sbin/apachectl', 'configtest']):
        return parts
    if len(parts) == 2 and re.fullmatch(r'/usr/sbin/php-fpm\d+\.\d+', parts[0]) and parts[1] == '-t':
        return parts
    if len(parts) == 4 and parts[0] == '/usr/bin/systemctl' and parts[1] in ('is-active', 'start', 'restart', 'reload', 'reset-failed') and parts[2] == '--' and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}\.service', parts[3]):
        return parts
    return None


def main():
    if os.geteuid() != 0:
        # The forced command runs as foxops-ssh; only the root-owned validator is sudoable.
        command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
        if not command and os.isatty(0):
            command = 'foxops-terminal'
        os.execv('/usr/bin/sudo', ['sudo', '-n', '/usr/local/sbin/foxops-ssh-gateway', command])
    command = sys.argv[1] if len(sys.argv) == 2 else ''
    if command == 'foxops-terminal' and os.isatty(0):
        try:
            marker=Path('/etc/foxops-terminal-enabled').lstat()
            if not stat.S_ISREG(marker.st_mode) or marker.st_uid != 0 or marker.st_mode & 0o022:
                raise ValueError('disabled')
        except (OSError, ValueError):
            print('Terminal interativo desabilitado. Execute o upgrade com --enable-terminal no Ubuntu.', file=sys.stderr)
            return 126
        os.execve('/bin/bash', ['/bin/bash','-l'], {'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','USER':'root','LOGNAME':'root','TERM':'xterm-256color','LANG':'C.UTF-8'})
    try:
        config_args = shlex.split(command)
        if config_args[:2] == ['sudo', '-n']:
            config_args = config_args[2:]
        if len(config_args) == 2 and config_args[0] == '/usr/local/sbin/foxops-config' and re.fullmatch(r'[A-Za-z0-9+/=]{1,4000}', config_args[1]):
            from foxops_config_manager import run
            return run(config_args[1])
        if len(config_args)==2 and config_args[0]=='/usr/local/sbin/foxops-command' and re.fullmatch(r'[A-Za-z0-9+/=]{1,4000}',config_args[1]):
            from foxops_command_runner import run
            return run(config_args[1])
        if len(config_args)==2 and config_args[0]=='/usr/local/sbin/foxops-runbook' and re.fullmatch(r'[A-Za-z0-9+/=]{1,4000}',config_args[1]):
            from foxops_runbook_runner import run
            return run(config_args[1])
    except (ValueError, ImportError):
        return 126
    args = allowed(command)
    if not args:
        print('SparkeOPS: comando não autorizado.', file=sys.stderr)
        return 126
    try:
        return subprocess.run(args, timeout=35, check=False, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'}).returncode
    except (OSError, subprocess.TimeoutExpired):
        return 124


if __name__ == '__main__':
    sys.exit(main())
