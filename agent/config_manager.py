#!/usr/bin/python3
"""Restricted configuration editor. Invoked only by the root SSH gateway."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import uuid


def sanitize_configuration(text):
    text = re.sub(r'-----BEGIN [^-]+-----.*?-----END [^-]+-----', '[CONTEUDO SENSIVEL OCULTADO]', text, flags=re.S)
    # Mask entire sensitive lines, including command arguments and environment values.
    text = '\n'.join('[CONTEÚDO SENSÍVEL OCULTADO]' if re.search(r'(password|passwd|secret|token|credential|authorization|api.?key|private.?key|Environment\s*=|BEGIN .*KEY)', line, re.I) else line for line in text.splitlines())
    text = re.sub(r'(://)[^/\s:@]+:[^/\s@]+@', r'\1[OCULTADO]@', text)
    return text


def browse(service):
    if not isinstance(service, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}', service):
        raise ValueError('Serviço inválido.')
    unit = service if service.endswith('.service') else service + '.service'
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--property=FragmentPath,DropInPaths', '--', unit], capture_output=True, text=True, timeout=7, check=False)
    candidates = []
    for line in result.stdout.splitlines():
        if '=' in line:
            candidates.extend(line.split('=', 1)[1].split())
    roots = ['/etc/' + service, '/etc/' + service + '.conf']
    aliases = {'mysql': ['/etc/mysql'], 'mariadb': ['/etc/mysql'], 'apache2': ['/etc/apache2'], 'sshd': ['/etc/ssh/sshd_config'], 'ssh': ['/etc/ssh/sshd_config'], 'postgresql': ['/etc/postgresql']}
    roots += aliases.get(service, [])
    match = re.fullmatch(r'php(\d{1,2}\.\d{1,2})-fpm', service)
    if match:
        roots.append('/etc/php/' + match[1] + '/fpm')
    for root in roots:
        path = Path(root)
        if path.is_file():
            candidates.append(str(path))
        elif path.is_dir():
            # Bounded traversal; do not follow directory symlinks.
            for folder_index, (folder, dirs, names) in enumerate(os.walk(path, followlinks=False)):
                if folder_index >= 100:
                    break
                dirs[:] = sorted(d for d in dirs if not Path(folder, d).is_symlink())[:30]
                for name in sorted(names):
                    if name.endswith(('.conf', '.cnf', '.ini', '.yaml', '.yml', '.json')):
                        candidates.append(str(Path(folder, name)))
                if len(candidates) >= 100:
                    break
    files, remaining = [], 5000
    for name in dict.fromkeys(candidates):
        if len(files) >= 12 or remaining <= 0:
            break
        path = Path(name)
        try:
            resolved = path.resolve()
            if not any(resolved.is_relative_to(base) for base in (Path('/etc'), Path('/usr/lib/systemd/system'), Path('/lib/systemd/system'))):
                continue
            info = resolved.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_size > 262144 or re.search(r'(password|secret|credential|token|private|\.key|\.pem)', path.name, re.I):
                continue
            text = resolved.read_text(encoding='utf-8')
            text = sanitize_configuration(text)
            content = text[:remaining]
            files.append({'path': str(path), 'content': content, 'truncated': len(content) < len(text)})
            remaining -= len(content)
        except (OSError, UnicodeError):
            continue
    return {'status': 'browsed', 'service': service, 'files': files, 'limited': len(candidates) > len(files), 'message': 'Leitura local dos arquivos encontrados; segredos conhecidos são ocultados. Includes externos e configurações em memória podem não estar nesta leitura.'}


def profile(service):
    if service == 'nginx':
        return '/etc/nginx/nginx.conf', {'worker_processes': (1, 256)}, ['/usr/sbin/nginx', '-t'], 'reload', ';'
    if service == 'apache2':
        return '/etc/apache2/apache2.conf', {'KeepAliveTimeout': (1, 300), 'Timeout': (1, 600)}, ['/usr/sbin/apachectl', 'configtest'], 'reload', ''
    match = re.fullmatch(r'php(\d{1,2}\.\d{1,2})-fpm', service)
    if match:
        version = match[1]
        return '/etc/php/' + version + '/fpm/pool.d/www.conf', {'pm.max_children': (1, 1024), 'pm.max_requests': (0, 100000)}, ['/usr/sbin/php-fpm' + version, '-t'], 'reload', ''
    if service == 'mysql':
        return '/etc/mysql/mysql.conf.d/mysqld.cnf', {'max_connections': (10, 2000)}, ['/usr/sbin/mysqld', '--validate-config'], 'restart', ''
    raise ValueError('ServiÃ§o sem perfil de ediÃ§Ã£o suportado.')


def locations(text, service):
    _, fields, _, _, end = profile(service)
    found = {}
    for key in fields:
        sep = r'\s*=\s*' if service.startswith('php') or service == 'mysql' else r'\s+'
        value_pattern = r'[0-9]+|auto' if service == 'nginx' and key == 'worker_processes' else r'[0-9]+'
        pattern = re.compile(r'^(\s*' + re.escape(key) + sep + r')(' + value_pattern + r')(\s*' + re.escape(end) + r'\s*(?:[#;].*)?)$', re.M | re.I)
        matches = list(pattern.finditer(text))
        # Never guess a section or add a missing directive. Multiple pools/contexts are refused.
        if len(matches) == 1:
            if service.startswith('php') or service == 'mysql':
                sections = re.findall(r'^\s*\[([^\]\r\n]+)\]', text[:matches[0].start()], re.M)
                if not sections or sections[-1].lower() != ('mysqld' if service == 'mysql' else 'www'):
                    continue
            found[key] = matches[0]
    return found


def edited(text, service, values):
    _, fields, _, _, _ = profile(service)
    matches = locations(text, service)
    if not isinstance(values, dict) or not values or len(values) > len(fields):
        raise ValueError('Selecione parÃ¢metros numÃ©ricos suportados.')
    changes = []
    for key, value in values.items():
        if key not in fields or key not in matches or type(value) is not int or not fields[key][0] <= value <= fields[key][1]:
            raise ValueError('ParÃ¢metro ausente, ambÃ­guo ou fora do intervalo.')
        match = matches[key]
        changes.append((match.start(2), match.end(2), str(value)))
    for start, end, value in sorted(changes, reverse=True):
        text = text[:start] + value + text[end:]
    return text


def validate_target(target):
    if target.is_symlink() or not target.is_file() or target.resolve() != target:
        raise ValueError('Arquivo deve existir no caminho padrÃ£o, sem links simbÃ³licos.')
    info = target.stat()
    if info.st_uid != 0 or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH) or info.st_size > 262144:
        raise ValueError('ProprietÃ¡rio, permissÃµes ou tamanho do arquivo nÃ£o permitem ediÃ§Ã£o.')
    for parent in target.parents:
        info_parent = parent.stat()
        if info_parent.st_uid != 0 or info_parent.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise ValueError('DiretÃ³rio de configuraÃ§Ã£o inseguro.')
    return info


def atomic_write(target, content, info):
    fd, name = tempfile.mkstemp(prefix='.foxops-', dir=str(target.parent))
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
            os.fchmod(output.fileno(), stat.S_IMODE(info.st_mode))
            os.fchown(output.fileno(), info.st_uid, info.st_gid)
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def command_ok(args):
    try:
        # Diagnostics can contain secrets; return only the exit status to the panel.
        return subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=7, check=False, env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C'}).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def apply_transaction(target, original, updated, info, check, activate, backup_dir):
    # A pre-existing invalid configuration must be repaired manually, not hidden by a tuning change.
    if not command_ok(check):
        return {'status':'baseline_invalid','message':'ConfiguraÃ§Ã£o atual invÃ¡lida ou validador indisponÃ­vel. Nenhum arquivo alterado.'}
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(backup_dir, 0o700)
    backup = backup_dir / (str(uuid.uuid4()) + '.bak')
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(original)
        output.flush()
        os.fsync(output.fileno())
    try:
        if target.read_bytes() != original:
            return {'status':'conflict','backup':backup.name,'message':'Arquivo alterado durante a validaÃ§Ã£o. Nenhum ajuste aplicado.'}
        atomic_write(target, updated, info)
        if not command_ok(check):
            atomic_write(target, original, info)
            return {'status':'rolled_back','backup':backup.name,'message':'Teste da proposta falhou. Arquivo original restaurado; serviÃ§o nÃ£o foi recarregado.'}
        if not command_ok(activate) or not command_ok(['/usr/bin/systemctl','is-active','--',activate[-1]]):
            atomic_write(target, original, info)
            recovered = command_ok(check) and command_ok(activate) and command_ok(['/usr/bin/systemctl','is-active','--',activate[-1]])
            return {'status':'rolled_back' if recovered else 'rollback_failed','backup':backup.name,'message':'Falha na ativaÃ§Ã£o. ConfiguraÃ§Ã£o original restaurada.' + (' ServiÃ§o recuperado.' if recovered else ' Verifique o serviÃ§o manualmente.')}
        return {'status':'applied','backup':backup.name,'message':'Backup criado, configuraÃ§Ã£o validada e serviÃ§o ativo apÃ³s aplicaÃ§Ã£o.'}
    except Exception:
        try:
            atomic_write(target, original, info)
            recovered = command_ok(check) and command_ok(activate)
        except Exception:
            recovered = False
        return {'status':'rolled_back' if recovered else 'rollback_failed','backup':backup.name,'message':'Erro de aplicaÃ§Ã£o. Confira a restauraÃ§Ã£o e o estado do serviÃ§o.'}


def handle(encoded):
    import fcntl
    if len(encoded) > 4000:
        raise ValueError('SolicitaÃ§Ã£o muito grande.')
    data = json.loads(base64.b64decode(encoded, validate=True))
    service = data.get('service', '')
    if data.get('operation') == 'browse':
        return browse(service)
    path, fields, check, activation, _ = profile(service)
    target = Path(path)
    # Fixed root-owned path: a lock survives disconnects and serializes reads/writes across panels.
    with open('/run/foxops-config.lock', 'a') as lock:
        os.chmod('/run/foxops-config.lock', 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = validate_target(target)
        original = target.read_bytes()
        text = original.decode('utf-8')
        digest = hashlib.sha256(original).hexdigest()
        matches = locations(text, service)
        if data.get('operation') == 'inspect':
            return {'status':'inspected','service':service,'path':path,'sha256':digest,'activation':activation,'values':{k:('auto' if m[2].lower()=='auto' else int(m[2])) for k,m in matches.items()},'limits':{k:fields[k] for k in matches}}
        if data.get('operation') != 'apply' or data.get('sha256') != digest:
            raise ValueError('Arquivo alterado apÃ³s a leitura. Leia novamente e prepare outra proposta.')
        updated = edited(text, service, data.get('values')).encode()
        if updated == original:
            raise ValueError('A proposta nÃ£o altera nenhum parÃ¢metro.')
        backup_root = Path('/var/lib/foxops-config')
        backup_root.mkdir(mode=0o700, exist_ok=True)
        for folder in (backup_root, backup_root / 'backups'):
            folder.mkdir(mode=0o700, exist_ok=True)
            folder_info = folder.lstat()
            if folder.is_symlink() or folder.resolve() != folder or folder_info.st_uid != 0 or folder_info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
                raise ValueError('DiretÃ³rio de backup inseguro.')
            os.chmod(folder, 0o700)
        return apply_transaction(target, original, updated, info, check, ['/usr/bin/systemctl',activation,'--',service+'.service'], backup_root / 'backups')


def run(encoded):
    try:
        result = handle(encoded)
    except Exception as error:
        result = {'status':'refused','message':str(error) if isinstance(error,ValueError) else 'OperaÃ§Ã£o recusada. Confira permissÃµes, caminho padrÃ£o e execuÃ§Ã£o concorrente.'}
    print('FOXOPS_CONFIG:' + json.dumps(result, ensure_ascii=False))
    return 0 if result['status'] in ('inspected','applied','browsed') else 1
