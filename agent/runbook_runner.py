#!/usr/bin/python3
"""Pinned local scripts, without shell interpolation or arguments supplied by AI."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
from threading import Timer


def script_file(path):
    if not isinstance(path, str) or len(path) > 400 or not re.fullmatch(r'/(opt|srv|usr/local)/[a-zA-Z0-9_./-]+', path) or '..' in path.split('/') or '//' in path:
        raise ValueError('invalid_path')
    target = Path(path)
    for part in [*reversed(target.parents), target]:
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('unsafe_permissions')
    info = target.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024 or not info.st_mode & 0o100:
        raise ValueError('not_executable_script')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    # Bind the checked inode to the descriptor that will actually be executed.
    actual = os.fstat(fd)
    if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
        os.close(fd)
        raise ValueError('changed_script')
    content = os.read(fd, 1024 * 1024 + 1)
    if not content.startswith(b'#!') or len(content) > 1024 * 1024:
        os.close(fd)
        raise ValueError('script_requires_shebang')
    os.lseek(fd, 0, os.SEEK_SET)
    return fd, hashlib.sha256(content).hexdigest()


def redact(text):
    text = re.sub(r'(?i)((?:password|passwd|token|api[_-]?key|secret)\s*[:=]\s*)[^\s,;]+', r'\1[REDACTED]', text)
    return re.sub(r'(?i)(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+', r'\1[REDACTED]', text)


def run(encoded):
    fd = None
    try:
        if os.geteuid() != 0 or len(encoded) > 4000:
            raise ValueError('root_required')
        data = json.loads(base64.b64decode(encoded, validate=True))
        marker = Path('/etc/foxops-agent/allow-runbooks')
        info = marker.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('runbooks_disabled')
        fd, digest = script_file(data.get('path'))
        if data.get('action') == 'inspect':
            report = {'status': 'inspected', 'sha256': digest}
        elif data.get('action') == 'run':
            if data.get('sha256') != digest or not re.fullmatch(r'[a-f0-9-]{36}', str(data.get('request_id', ''))):
                raise ValueError('hash_or_request_mismatch')
            state = Path('/var/lib/foxops-runbooks')
            state.mkdir(mode=0o700, exist_ok=True)
            meta = state.lstat()
            if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o077:
                raise ValueError('unsafe_state_directory')
            with open(state / 'lock', 'a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                # Durable idempotency: an uncertain execution is never run a second time.
                nonce = os.open(state / data['request_id'], os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
                os.close(nonce)
                with subprocess.Popen(['/proc/self/fd/' + str(fd)], pass_fds=(fd,), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      start_new_session=True, cwd='/', env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'HOME': '/root'}) as process:
                    timed_out = []
                    def stop():
                        timed_out.append(True)
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    timer = Timer(30, stop)
                    timer.start()
                    try:
                        output = process.stdout.read(12001)
                        if len(output) > 12000:
                            stop()
                        process.wait(timeout=3)
                        # Scripts are synchronous; do not leave background child processes behind.
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        report = {'status': 'unknown' if timed_out else 'completed', 'exit_code': process.returncode,
                                  'output': redact(output[:12000].decode('utf-8', errors='replace'))}
                        service = data.get('verify_service')
                        if not timed_out and process.returncode == 0 and service:
                            if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}', service):
                                raise ValueError('invalid_service')
                            check = subprocess.run(['/usr/bin/systemctl', 'is-active', '--', service + '.service'], capture_output=True, text=True, timeout=5, check=False)
                            report['service_state'] = check.stdout.strip()[:50]
                    finally:
                        timer.cancel()
        else:
            raise ValueError('invalid_action')
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired):
        report = {'status': 'rejected', 'output': 'Script recusado: confira habilitação, permissões, hash e identificação da execução.'}
    finally:
        if fd is not None:
            os.close(fd)
    print('FOXOPS_RUNBOOK:' + json.dumps(report, ensure_ascii=True))
    return 0
