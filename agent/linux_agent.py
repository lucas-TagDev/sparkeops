"""Linux metrics collector; only Python standard library is required."""
import json
import os
from pathlib import Path
import shutil
import time
import urllib.error
import urllib.request
import uuid
import argparse
import getpass
import platform
import socket
import subprocess
import ipaddress
import re
import hashlib
from datetime import datetime
from threading import Timer
from types import SimpleNamespace
from urllib.parse import urlparse


def cpu_ticks():
    values = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    return sum(values), values[3] + values[4]


def collect():
    total1, idle1 = cpu_ticks()
    time.sleep(1)
    total2, idle2 = cpu_ticks()
    memory = {line.split(':')[0]: int(line.split()[1])
              for line in Path('/proc/meminfo').read_text().splitlines()}
    disk = shutil.disk_usage('/')
    return {
        'cpu_percent': round(100 * (1 - (idle2 - idle1) / max(1, total2 - total1)), 2),
        'memory_percent': round(100 * (1 - memory['MemAvailable'] / memory['MemTotal']), 2),
        'disk_percent': round(100 * disk.used / disk.total, 2),
    }


_previous_disk_io = None


def collect_telemetry():
    """Optional sensors and interval I/O; unavailable values stay absent."""
    global _previous_disk_io
    result, temperatures, disks = {}, [], {}
    for path in list(Path('/sys/class/hwmon').glob('hwmon*/temp*_input'))[:100]:
        try:
            value = float(path.read_text().strip()) / 1000
            if 0 <= value <= 150:
                temperatures.append(value)
        except (OSError, ValueError):
            pass
    if temperatures:
        result['temperature_max_c'] = round(max(temperatures), 2)
    try:
        for line in Path('/proc/diskstats').read_text().splitlines():
            fields = line.split()
            if len(fields) < 14 or fields[2].startswith(('loop', 'ram', 'fd', 'sr')) or not Path('/sys/block', fields[2]).exists():
                continue
            disks[fields[2]] = {'ops': int(fields[3]) + int(fields[7]), 'ms': int(fields[6]) + int(fields[10]),
                               'read': int(fields[5]) * 512, 'write': int(fields[9]) * 512}
        at = time.monotonic()
        if _previous_disk_io and 1 <= at - _previous_disk_io[0] <= 600:
            elapsed = at - _previous_disk_io[0]
            latencies, reads, writes = [], [], []
            for device, counters in disks.items():
                old = _previous_disk_io[1].get(device)
                if not old or any(counters[k] < old[k] for k in counters):
                    continue
                operations = counters['ops'] - old['ops']
                if operations:
                    latencies.append((counters['ms'] - old['ms']) / operations)
                reads.append((counters['read'] - old['read']) / elapsed)
                writes.append((counters['write'] - old['write']) / elapsed)
            if latencies:
                result['disk_await_ms'] = round(max(latencies), 3)
            if reads:
                result['disk_read_bytes_per_sec'] = round(max(reads), 2)
                result['disk_write_bytes_per_sec'] = round(max(writes), 2)
        _previous_disk_io = (at, disks)
    except (OSError, ValueError):
        pass
    return result


def validate_endpoint(endpoint, allow_lan_http=False):
    url = urlparse(endpoint)
    private_lan = False
    if allow_lan_http and url.hostname:
        try:
            address = ipaddress.IPv4Address(url.hostname)
            private_lan = any(address in ipaddress.IPv4Network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
        except ipaddress.AddressValueError:
            pass
    if url.scheme != 'https' and not (url.scheme == 'http' and (url.hostname in ('localhost', '127.0.0.1', '::1') or private_lan)):
        raise SystemExit('Use HTTPS. Para teste com IP privado, use --allow-lan-http explicitamente.')
    if url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise SystemExit('Informe somente a origem da aplicação, sem caminho ou credenciais.')


def discover_services():
    try:
        result = subprocess.run(['systemctl', 'list-unit-files', '--type=service', '--no-pager', '--no-legend'], capture_output=True, text=True, timeout=10, check=False)
        loaded = subprocess.run(['systemctl', 'list-units', '--type=service', '--all', '--plain', '--no-pager', '--no-legend'], capture_output=True, text=True, timeout=10, check=False)
        names = [line.split()[0].removesuffix('.service') for line in (result.stdout+'\n'+loaded.stdout).splitlines() if line.split() and line.split()[0].endswith('.service')]
        # Templates are not running instances; actual instantiated units come from list-units.
        return sorted({name for name in names if re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}', name) and not name.endswith('@')})[:1000]
    except (OSError, subprocess.TimeoutExpired):
        return []


def redact(message):
    message = re.sub(r'(?i)(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+', r'\1[REDACTED]', message)
    return re.sub(r'(?i)((?:password|passwd|token|api[_-]?key|secret)\s*[:=]\s*)[^\s,;]+', r'\1[REDACTED]', message)[:1000]


def collect_logs(services, cursors):
    events, next_cursors, errors = [], dict(cursors), []
    for service in services[:20]:
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}', service):
            continue
        command = ['journalctl', '--no-pager', '-o', 'json', '-n', '3', '-u', service]
        command += ['--after-cursor', cursors[service]] if service in cursors else ['--since', '2 minutes ago']
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=5, check=False)
            if result.returncode != 0:
                errors.append('Sem acesso ao journal de ' + service)
            for line in result.stdout.splitlines():
                try:
                    item = json.loads(line)
                    cursor = item.get('__CURSOR', '')
                    message = item.get('MESSAGE', '')
                    if not cursor or not isinstance(message, str) or len(events) >= 25:
                        continue
                    events.append({'event_id': hashlib.sha256((service + cursor).encode()).hexdigest(), 'service': service,
                        'timestamp': int(item['__REALTIME_TIMESTAMP']) / 1000000, 'priority': str(item.get('PRIORITY', '6')), 'message': redact(message)})
                    next_cursors[service] = cursor
                except (ValueError, KeyError, TypeError):
                    continue
            # Conventional error logs; no arbitrary paths are accepted from the server.
            paths = {'nginx': '/var/log/nginx/error.log', 'apache2': '/var/log/apache2/error.log', 'httpd': '/var/log/httpd/error_log'}
            path = paths.get(service)
            if re.fullmatch(r'php\d+\.\d+-fpm', service):
                path = '/var/log/' + service + '.log'
            if path and Path(path).exists() and len(events) < 25:
                with open(path, 'rb') as log:
                    log.seek(0, 2)
                    log.seek(max(0, log.tell() - 8192))
                    lines = log.read(8192).decode('utf-8', errors='replace').splitlines()[-3:]
                for line in lines:
                    if line and len(events) < 25:
                        events.append({'event_id': hashlib.sha256((path + line).encode()).hexdigest(), 'service': service,
                            'timestamp': time.time(), 'priority': '3', 'message': redact(line)})
        except (OSError, subprocess.TimeoutExpired):
            errors.append('Não foi possível ler logs de ' + service)
    return events, next_cursors, '; '.join(errors)[:300]


def run_journal(command):
    """Bound both runtime and memory even when a journal record is very large."""
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
        def stop():
            try:
                process.kill()
            except OSError:
                pass
        timer = Timer(12, stop)
        timer.start()
        try:
            output = process.stdout.read(2 * 1024 * 1024 + 1)
            truncated = len(output) > 2 * 1024 * 1024
            if truncated:
                stop()
                output = output[:2 * 1024 * 1024].rsplit(b'\n', 1)[0]
            process.wait(timeout=2)
            text = output.decode('utf-8', errors='replace')
            # Only journalctl diagnostic lines, not MESSAGE values, indicate access failure.
            diagnostic = '\n'.join(line for line in text.splitlines() if not line.startswith('{'))
            return SimpleNamespace(stdout=text, stderr=diagnostic, returncode=0 if truncated else process.returncode, truncated=truncated)
        finally:
            timer.cancel()
            if process.poll() is None:
                stop()


def local_error_tail(service):
    unit = service.removesuffix('.service')
    path = {'nginx': '/var/log/nginx/error.log', 'apache2': '/var/log/apache2/error.log', 'httpd': '/var/log/httpd/error_log'}.get(unit)
    if re.fullmatch(r'php\d+\.\d+-fpm', unit):
        path = '/var/log/' + unit + '.log'
    if not path:
        return None
    with open(path, 'rb') as log:
        log.seek(0, 2)
        size = log.tell()
        log.seek(max(0, size - 262144))
        lines = log.read(262144).decode('utf-8', errors='replace').splitlines()
        if size > 262144:
            lines = lines[1:]  # Do not interpret a partial first record.
        return lines[-500:], size > 262144 or len(lines) >= 500


def error_line_time(line):
    # Conventional Nginx, Apache and PHP-FPM timestamps, in this host's timezone.
    for pattern, fmt in [
        (r'^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})', '%Y/%m/%d %H:%M:%S'),
        (r'^\[([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \d{4})\]', '%a %b %d %H:%M:%S.%f %Y'),
        (r'^\[(\d{2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2})\]', '%d-%b-%Y %H:%M:%S'),
    ]:
        match = re.search(pattern, line)
        if match:
            try:
                return datetime.strptime(match[1], fmt).timestamp()
            except ValueError:
                if '%f' in fmt:
                    try:
                        return datetime.strptime(match[1], fmt.replace('.%f', '')).timestamp()
                    except ValueError:
                        pass
    return None


def check_local_logs(job):
    """Inspect the local journal. Only structured counts leave this host."""
    service = job.get('service', '')
    since, until = job.get('since'), job.get('until')
    if (service != '__system__' and not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}', service)) or not isinstance(since, int) or not isinstance(until, int) or not 0 < until - since <= 90000 or since < time.time() - 30 * 86400 or until > time.time() + 60:
        raise ValueError('Invalid local log check')
    patterns = {
        'permission_denied': r'permission denied|access denied',
        'connection_refused': r'connection refused',
        'upstream_timeout': r'upstream.*timed?\s*out|upstream.*timeout',
        'configuration_error': r'syntax error|invalid configuration|unknown directive|configuration.*failed',
        'out_of_memory': r'out of memory|oom.kill|cannot allocate memory',
        'tunnel_connection_error': r'failed to (?:dial|serve|connect)|unable to reach the origin|no active connection|tunnel.*error',
    }
    counts = {key: 0 for key in [*patterns, 'other_errors', 'warnings']}
    summary = {'counts': counts, 'scanned': 0, 'read_status': 'unavailable', 'truncated': False, 'sources': [], 'unparsed': 0}
    def inspect(message, priority):
        if summary['scanned'] >= 500:
            summary['truncated'] = True
            return
        summary['scanned'] += 1
        matched = False
        for category, pattern in patterns.items():
            if re.search(pattern, message[:20000], re.I):
                counts[category] += 1
                matched = True
        if priority <= 3 and not matched:
            counts['other_errors'] += 1
        elif priority == 4:
            counts['warnings'] += 1
    try:
        command = ['journalctl', '--no-pager', '--quiet', '-o', 'json', '--output-fields=MESSAGE,PRIORITY', '-n', '500']
        if service != '__system__':
            command += ['-u', service]
        command += ['--since', '@' + str(since), '--until', '@' + str(until)]
        result = run_journal(command)
        readable = result.returncode == 0 and not re.search(r'permission|no journal files', result.stderr, re.I)
        if readable:
            summary['read_status'] = 'ok'
            summary['sources'].append('journalctl')
        for line in (result.stdout.splitlines()[-500:] if readable else []):
            try:
                item = json.loads(line)
                message = item.get('MESSAGE', '')
                if not isinstance(message, str):
                    continue
                priority = int(item.get('PRIORITY', 6))
            except (ValueError, TypeError):
                continue
            inspect(message, priority)
        summary['truncated'] = summary['scanned'] >= 500 or getattr(result, 'truncated', False)
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        tail = local_error_tail(service)
        if tail is not None:
            lines, truncated = tail
            summary['read_status'] = 'ok'
            summary['sources'].append('service_error_file')
            summary['truncated'] = summary['truncated'] or truncated
            for line in lines:
                timestamp = error_line_time(line)
                if timestamp is None:
                    summary['unparsed'] += 1
                elif since <= timestamp <= until:
                    inspect(line, 4 if re.search(r'\bwarn(?:ing)?\b', line, re.I) else 3)
    except OSError:
        pass
    return summary


def process_snapshot():
    """Read only proc stat metadata; command lines and environments are never read."""
    processes, skipped, truncated = {}, 0, False
    started = time.monotonic()
    with os.scandir('/proc') as entries:
        for entry in entries:
            if not entry.name.isdigit():
                continue
            if len(processes) >= 20000 or time.monotonic() - started > 5:
                truncated = True
                break
            try:
                path = Path(entry.path)
                with open(path / 'stat') as stat:
                    raw = stat.read(4096)
                end = raw.rfind(')')
                begin = raw.find('(')
                if end < begin or begin < 0:
                    raise ValueError('stat')
                fields = raw[end+1:].split()
                processes[int(entry.name)] = {
                    'name': ''.join(c if c.isprintable() else '?' for c in raw[begin+1:end])[:100] or '?',
                    'ticks': int(fields[11]) + int(fields[12]), 'start': int(fields[19]),
                    'rss_pages': max(0, int(fields[21])), 'state': fields[0], 'uid': entry.stat().st_uid,
                }
            except (OSError, ValueError, IndexError):
                skipped += 1
    return processes, skipped, truncated


def process_service(pid):
    try:
        with open('/proc/' + str(pid) + '/cgroup') as source:
            value = source.read(8192)
        for line in value.splitlines():
            for part in reversed(line.split(':', 2)[-1].split('/')):
                if part.endswith('.service') and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}', part.removesuffix('.service')):
                    return part.removesuffix('.service')
    except OSError:
        pass
    return None


def top_processes(rows):
    cpu = sorted(rows, key=lambda r: (-r['cpu_percent'], -r['rss_bytes'], r['pid']))[:10]
    ram = sorted(rows, key=lambda r: (-r['rss_bytes'], -r['cpu_percent'], r['pid']))[:10]
    return {row['pid']: row for row in cpu + ram}


def collect_processes():
    """Sample CPU over an interval, normalized against the whole host like the dashboard."""
    empty = {'processes': [], 'visible': 0, 'skipped': 0, 'truncated': False, 'read_status': 'unavailable', 'sample_seconds': 1, 'collected_at': time.time()}
    try:
        memory = {line.split(':')[0]: int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()}
        total_memory = memory['MemTotal'] * 1024
        page_size = os.sysconf('SC_PAGE_SIZE')
        hz = os.sysconf('SC_CLK_TCK')
        total_before = cpu_ticks()[0]
        start = time.monotonic()
        before, skipped_before, truncated_before = process_snapshot()
        time.sleep(1)
        after, skipped_after, truncated_after = process_snapshot()
        total_delta = cpu_ticks()[0] - total_before
        sample_seconds = time.monotonic() - start
        uptime = float(Path('/proc/uptime').read_text().split()[0])
        if total_memory <= 0 or total_delta <= 0 or sample_seconds > 60 or not after:
            return empty
        users = {}
        try:
            for line in Path('/etc/passwd').read_text().splitlines():
                fields = line.split(':')
                if len(fields) > 2 and fields[2].isdigit():
                    users[int(fields[2])] = fields[0][:100]
        except OSError:
            pass
        rows, skipped = [], skipped_before + skipped_after
        for pid, proc in after.items():
            previous = before.get(pid)
            # A recycled or newly started PID has no reliable interval sample.
            if previous is None or previous['start'] != proc['start']:
                skipped += 1
                continue
            rss = proc['rss_pages'] * page_size
            rows.append({'pid': pid, 'name': proc['name'], 'user': users.get(proc['uid'], str(proc['uid'])), 'state': proc['state'],
                'cpu_percent': round(max(0, min(100, (proc['ticks'] - previous['ticks']) / total_delta * 100)), 2),
                'memory_percent': round(min(100, rss / total_memory * 100), 2), 'rss_bytes': rss,
                'elapsed_seconds': round(max(0, uptime - proc['start'] / hz), 1)})
        # Preserve both rankings, so low-CPU memory consumers are not hidden.
        selected = top_processes(rows)
        for pid, row in selected.items():
            # Verify the identity again before attaching a service to a PID.
            try:
                with open('/proc/' + str(pid) + '/stat') as source:
                    raw = source.read(4096)
                same = int(raw[raw.rfind(')')+1:].split()[19]) == after[pid]['start']
                row['service'] = process_service(pid) if same else None
            except (OSError, IndexError, ValueError):
                row['service'] = None
        return {'processes': list(selected.values()), 'visible': len(after), 'skipped': min(200000, skipped),
            'truncated': truncated_before or truncated_after, 'read_status': 'ok' if rows else 'unavailable',
            'sample_seconds': round(sample_seconds, 3), 'collected_at': time.time()}
    except (OSError, ValueError, KeyError, AttributeError):
        return empty


def monitor_processes(rules):
    """Check selected identities independently of the top-process ranking."""
    rules = [r for r in rules[:20] if isinstance(r, dict) and isinstance(r.get('id'), str) and isinstance(r.get('revision'), int)]
    results = [{'id': r['id'], 'revision': r['revision'], 'read_status': 'unavailable', 'count': 0, 'cpu_percent': None, 'memory_percent': None, 'identities': []} for r in rules]
    try:
        memory = {line.split(':')[0]: int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()}
        total_memory, page_size = memory['MemTotal'] * 1024, os.sysconf('SC_PAGE_SIZE')
        total = cpu_ticks()[0]
        before, _, _ = process_snapshot()
        time.sleep(1)
        after, skipped, truncated = process_snapshot()
        delta = cpu_ticks()[0] - total
        if not after or total_memory <= 0 or delta <= 0:
            return results
        users = {}
        try:
            for line in Path('/etc/passwd').read_text().splitlines():
                fields = line.split(':')
                if len(fields) > 2 and fields[2].isdigit():
                    users[int(fields[2])] = fields[0]
        except OSError:
            pass
        services = {}
        for rule, result in zip(rules, results):
            matched, partial = [], bool(skipped or truncated)
            for pid, proc in after.items():
                if proc['name'] != rule.get('name') or (rule.get('user') and users.get(proc['uid'], str(proc['uid'])) != rule['user']):
                    continue
                if rule.get('service'):
                    if pid not in services:
                        services[pid] = process_service(pid)
                    if services[pid] is None:
                        partial = True
                    if services[pid] != rule['service']:
                        continue
                if proc['state'] in ('Z', 'X', 'T', 't'):
                    continue
                matched.append((pid, proc))
            reliable = all(pid in before and before[pid]['start'] == proc['start'] for pid, proc in matched)
            ticks = sum(max(0, proc['ticks'] - before[pid]['ticks']) for pid, proc in matched) if reliable else None
            result.update({'read_status': 'partial' if partial else 'ok', 'count': len(matched),
                           'cpu_percent': round(min(100, ticks / delta * 100), 2) if ticks is not None else None,
                           'memory_percent': round(min(100, sum(proc['rss_pages'] * page_size for _, proc in matched) / total_memory * 100), 2),
                           'identities': [str(pid) + ':' + str(proc['start']) for pid, proc in matched[:200]] if len(matched) <= 200 else []})
    except (OSError, ValueError, KeyError, AttributeError):
        pass
    return results


def safe_local_origin(value):
    try:
        parsed=urlparse(value)
        return parsed.scheme in ('http','https') and parsed.hostname in ('127.0.0.1','::1','localhost') and not (parsed.username or parsed.password or parsed.query or parsed.fragment) and (parsed.port is None or 1<=parsed.port<=65535)
    except (ValueError,TypeError):
        return False


def discover_tunnel_origins():
    """Inspect locally, returning only sanitized loopback origins, never ExecStart or tokens."""
    paths=['/etc/cloudflared/config.yml','/etc/cloudflared/config.yaml','/usr/local/etc/cloudflared/config.yml','/usr/local/etc/cloudflared/config.yaml']
    origins=[]
    info={'management':'unknown','source':'not_found','read_errors':0}
    try:
        result=subprocess.run(['systemctl','show','cloudflared.service','--property=ExecStart','--property=InvocationID'],capture_output=True,text=True,timeout=5,check=False)
        raw=result.stdout[:65536]
        if re.search(r'--token(?:[=\s-]|$)|TUNNEL_TOKEN',raw):info['management']='remote'
        match=re.search(r'--config(?:=|\s+)["\']?(/[^\s;"\']+)',raw)
        if match:
            path=match[1]
            if path.endswith(('.yml','.yaml')) and any(path.startswith(folder) for folder in ('/etc/cloudflared/','/usr/local/etc/cloudflared/')) and '..' not in Path(path).parts:
                paths=[path]
            else:
                paths=[]
                info['source']='unsupported_config_path'
        direct=re.search(r'--url(?:=|\s+)["\']?(https?://[^\s;"\']+)',raw)
        if direct and safe_local_origin(direct[1]):
            origins.append(direct[1]);info['source']='service_arguments'
        invocation=re.search(r'^InvocationID=([0-9a-f]{32})$',raw,re.M)
        if info['management']=='remote':
            # A remote route may be recorded locally when this invocation receives its config.
            # Never use an old file left behind by a previous locally-managed installation.
            if invocation:
                journal=run_journal(['journalctl','--no-pager','-o','json','-u','cloudflared.service','_SYSTEMD_INVOCATION_ID='+invocation[1],'--grep=Updated to new configuration','-n','1'])
                for line in journal.stdout.splitlines():
                    try:
                        message=json.loads(line).get('MESSAGE','')
                        match=re.search(r'\bconfig=("(?:\\.|[^"\\])*"|\{.*\})',message)
                        if not match:continue
                        data=json.loads(match[1])
                        if isinstance(data,str):data=json.loads(data)
                        for entry in data.get('ingress',[])[:50]:
                            origin=entry.get('service','')
                            if safe_local_origin(origin):origins.append(origin)
                    except (ValueError,TypeError,AttributeError):
                        continue
                if origins:info['source']='runtime_journal'
            return list(dict.fromkeys(origins))[:5],info
    except (OSError,subprocess.TimeoutExpired):
        info['read_errors']+=1
    if info['management']=='remote':
        return list(dict.fromkeys(origins))[:5],info
    for path in dict.fromkeys(paths):
        try:
            with open(path) as stream:text=stream.read(65536)
            for match in re.finditer(r'^\s*(?:-\s*)?service:\s*["\']?(https?://[^\s"\'#]+)',text,re.M):
                if safe_local_origin(match[1]):origins.append(match[1])
            info['source']='local_config'
            if info['management']=='unknown':info['management']='local'
            break
        except FileNotFoundError:
            continue
        except (OSError,UnicodeError):
            info['read_errors']+=1
    return list(dict.fromkeys(origins))[:5],info


def inspect_service_runtime(services):
    """Common diagnostics for any valid systemd service; no shell or ExecStart secrets."""
    fields=['Id','LoadState','ActiveState','SubState','MainPID','NRestarts','ExecMainStatus','Result','Type','UnitFileState']
    if not services:return {}
    if len(services)>5 or not all(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}',s) for s in services):raise ValueError('Invalid service')
    command=['systemctl','show','--no-pager']+['--property='+field for field in fields]+['--']+[s if s.endswith('.service') else s+'.service' for s in services]
    try:
        result=subprocess.run(command,capture_output=True,text=True,timeout=8,check=False)
        output={}
        for block in result.stdout[:65536].strip().split('\n\n'):
            values=dict(line.split('=',1) for line in block.splitlines() if '=' in line and line.split('=',1)[0] in fields)
            unit=values.get('Id','').removesuffix('.service')
            if unit and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}',unit):
                output[unit]={key:int(value) if key in ('MainPID','NRestarts','ExecMainStatus') and value.isdigit() else value[:100] for key,value in values.items()}
        return output
    except (OSError,subprocess.TimeoutExpired):return {}


def live_diagnostic(job, config):
    requested=job.get('services', [])
    if not isinstance(requested,list) or len(requested)>5 or not all(isinstance(s,str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}',s) for s in requested):
        raise ValueError('Invalid diagnostic target')
    services=discover_services() if job.get('all_services') else requested
    info=details(services)
    result={'checked_at':time.time(),'metrics':collect(),'services':info['services'],'hostname':info['hostname'],'logs':{},'limitations':[]}
    result['service_details']=inspect_service_runtime(requested)
    if requested and not result['service_details']:
        result['limitations'].append('Não foi possível ler os detalhes de execução dos serviços com as permissões atuais.')
    if job.get('processes'):
        result['processes']=collect_processes()
    if job.get('logs'):
        for service in requested[:3]:
            result['logs'][service]=check_local_logs({'service':service,'since':int(time.time())-900,'until':int(time.time())})
        if not requested:
            result['limitations'].append('Nenhum serviço específico identificado para verificar logs. Informe o nome do serviço.')
    if job.get('origin'):
        origin=config.get('diagnostic_origin_url','')
        origins=[]
        if safe_local_origin(origin):origins=[origin]
        if 'cloudflared' in requested:
            discovered,tunnel=discover_tunnel_origins()
            result['tunnel']=tunnel
            if not origins:origins=discovered
        if not origins:
            result['origin']={'status':'not_configured'}
            if result.get('tunnel',{}).get('management')=='remote':
                result['limitations'].append('O serviço usa token de túnel gerenciado remotamente. A origem não foi encontrada em configuração local acessível; a rota pode estar definida no painel da Cloudflare. Nenhum token foi enviado à IA.')
            elif result.get('tunnel',{}).get('read_errors'):
                result['limitations'].append('A descoberta tentou ler o serviço e os arquivos locais, mas houve falhas de acesso. Não foi possível identificar a origem com as permissões do agente.')
            else:
                result['limitations'].append('A origem não foi encontrada nos argumentos ou arquivos locais suportados. Não foi possível confirmar que o site responde.')
        else:
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self,*args,**kwargs):return None
            result['origin_tests']=[]
            for origin in origins:
                try:
                    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
                    with opener.open(urllib.request.Request(origin,method='HEAD'),timeout=4) as response:
                        test={'status':'responded','http_status':response.status}
                except urllib.error.HTTPError as error:
                    test={'status':'http_error','http_status':error.code}
                except (OSError,ValueError):
                    test={'status':'unreachable'}
                result['origin_tests'].append(test)
            result['origin']=next((r for r in result['origin_tests'] if r['status']!='responded'),result['origin_tests'][0])
        result['limitations'].append('Serviço ativo e origem local respondendo não comprovam disponibilidade pública, DNS ou saúde da conexão do túnel com a Cloudflare.')
    result['checked_at']=time.time()
    return result


def details(services, discovered=None):
    network = [line.split(':', 1) for line in Path('/proc/net/dev').read_text().splitlines()[2:] if ':' in line]
    rx, tx = 0, 0
    for name, values in network:
        if name.strip() == 'lo':
            continue
        fields = values.split()
        rx += int(fields[0])
        tx += int(fields[8])
    states = {}
    try:
        result = subprocess.run(['systemctl', 'list-units', '--type=service', '--all', '--plain', '--no-pager', '--no-legend'], capture_output=True, text=True, timeout=10, check=False)
        loaded = {parts[0].removesuffix('.service'):parts[2] for line in result.stdout.splitlines() if len(parts:=line.split())>=4 and parts[0].endswith('.service')}
        states = {service: loaded.get(service.removesuffix('.service'), 'not_loaded' if result.returncode==0 else 'unknown') for service in services[:1000] if re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}', service)}
    except (OSError, subprocess.TimeoutExpired):
        states = {service:'unknown' for service in services[:1000]}
    return {'agent_version': '0.11.1', 'telemetry': collect_telemetry(), 'discovery_limit_reached': len(discovered or services)>=1000, 'discovered_services': discovered if discovered is not None else services, 'hostname': socket.gethostname(), 'os': platform.platform(),
            'uptime_seconds': int(float(Path('/proc/uptime').read_text().split()[0])),
            'network_rx_bytes': rx, 'network_tx_bytes': tx, 'services': states}


def diagnose_service(service):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,99}', service):
        raise ValueError('Invalid service')
    unit=service.removesuffix('.service')
    report={'service':unit,'runtime':inspect_service_runtime([unit]).get(unit,{}),'logs':check_local_logs({'service':unit,'since':int(time.time())-900,'until':int(time.time())}),'error_samples':[]}
    journal=run_journal(['journalctl','--no-pager','--quiet','-o','json','--output-fields=MESSAGE,PRIORITY','-n','30','-u',unit+'.service'])
    for line in journal.stdout.splitlines():
        try:
            entry=json.loads(line)
            if int(entry.get('PRIORITY',6))>4:continue
            message=str(entry.get('MESSAGE',''))[:2000]
            message=re.sub(r'(?i)(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+',r'\1[REDACTED]',message)
            message=re.sub(r'\b(sk-[a-zA-Z0-9_-]{12,}|AIza[a-zA-Z0-9_-]{20,})\b','[REDACTED]',message)
            message=re.sub(r'(?i)((?:password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+',r'\1[REDACTED]',message)
            message=re.sub(r'://[^\s/@:]+:[^\s/@]+@','://[REDACTED]@',message)
            if message and message[:400] not in report['error_samples']:report['error_samples'].append(message[:400])
            if len(report['error_samples'])>=8:break
        except (ValueError,TypeError):continue
    return report


def main():
    parser = argparse.ArgumentParser(description='Agente de monitoramento FoxOps')
    parser.add_argument('--config', default=os.environ.get('FOXOPS_CONFIG', ''))
    parser.add_argument('--enroll', action='store_true')
    parser.add_argument('--setup-ssh', action='store_true')
    parser.add_argument('--endpoint', default=os.environ.get('FOXOPS_ENDPOINT', ''))
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--allow-lan-http', action='store_true', help='Permitir HTTP somente para IPs privados em teste local')
    parser.add_argument('--diagnose-service')
    args = parser.parse_args()
    if args.diagnose_service:
        print('FOXOPS_DIAGNOSE:'+json.dumps(diagnose_service(args.diagnose_service),ensure_ascii=True))
        return
    config = json.loads(Path(args.config).read_text()) if args.config and Path(args.config).exists() else {}
    endpoint = (args.endpoint or config.get('endpoint', '')).rstrip('/')
    allow_lan_http = args.allow_lan_http or config.get('allow_lan_http') is True
    validate_endpoint(endpoint, allow_lan_http)
    if args.enroll:
        if not args.config:
            raise SystemExit('Informe --config para armazenar a credencial individual.')
        enrollment = getpass.getpass('Token temporário de instalação: ')
        request = urllib.request.Request(endpoint + '/api/agent/enroll',
            data=json.dumps({'token': enrollment, 'setup_ssh': args.setup_ssh}).encode(), headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                result = json.load(response)
        except urllib.error.HTTPError as exc:
            raise SystemExit(f'Instalação recusada: HTTP {exc.code}. Gere outro token no painel.') from None
        config = {'endpoint': endpoint, 'token': result['agent_token'], 'services': config.get('services', []), 'allow_lan_http': allow_lan_http}
        if result.get('ssh_bootstrap'):
            config['ssh_bootstrap_ticket'] = result['ssh_bootstrap']['ticket']
            config['ssh_bootstrap_expires_at'] = result['ssh_bootstrap']['expires_at']
        descriptor = os.open(args.config, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(config, output)
        os.chmod(args.config, 0o600)
        print('Agente registrado. Credencial armazenada no arquivo protegido.')
        return
    token = os.environ.get('FOXOPS_AGENT_TOKEN') or config.get('token')
    if not token:
        raise SystemExit('Configure uma credencial de agente ou faça o registro com --enroll.')
    services = config.get('services', [])
    discovered, discovered_at, cursors, monitor, log_error = [], 0, {}, {'auto_discover': True, 'services': services, 'logs_enabled': False}, ''
    pending = None
    failures = 0
    while True:
        if pending is None:
            if time.time() - discovered_at > 300:
                discovered, discovered_at = discover_services(), time.time()
            services = discovered if monitor.get('auto_discover', True) else monitor.get('services', [])
            services = list(dict.fromkeys(monitor.get('required_services', []) + services))[:1000]
            info = details(services, discovered)
            info['service_alert_mode'] = 'failed_only' if monitor.get('auto_discover', True) else 'all_inactive'
            info['log_error'] = log_error
            pending = json.dumps({'event_id': str(uuid.uuid4()), 'metrics': collect(), 'details': info}).encode()
        request = urllib.request.Request(endpoint + '/api/metrics', data=pending,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                result = json.load(response)
                monitor = result.get('monitor_config', monitor)
            for job in result.get('live_checks', [])[:1]:
                try:
                    summary=live_diagnostic(job,config)
                    live_request=urllib.request.Request(endpoint+'/api/agent/live-checks/'+str(uuid.UUID(job['id'])),data=json.dumps(summary).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
                    with urllib.request.urlopen(live_request,timeout=15) as response:response.read()
                except (OSError,ValueError,KeyError):
                    log_error='Diagnóstico do chat não confirmado; nova tentativa no próximo ciclo.'
            if result.get('process_monitors'):
                try:
                    watched = monitor_processes(result['process_monitors'])
                    watch_request = urllib.request.Request(endpoint + '/api/agent/process-watch', data=json.dumps({'event_id': str(uuid.uuid4()), 'collected_at': time.time(), 'results': watched}).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
                    with urllib.request.urlopen(watch_request, timeout=15) as response:
                        response.read()
                except (OSError, ValueError, KeyError):
                    log_error = 'Monitoramento de processos não confirmado; nova coleta no próximo ciclo.'
            for job in result.get('process_checks', [])[:1]:
                try:
                    summary = collect_processes()
                    process_request = urllib.request.Request(endpoint + '/api/agent/processes/' + str(uuid.UUID(job['id'])), data=json.dumps(summary).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
                    with urllib.request.urlopen(process_request, timeout=15) as response:
                        response.read()
                except (OSError, ValueError, KeyError):
                    log_error = 'Consulta de processos não confirmada; será tentada novamente.'
            for job in result.get('log_checks', [])[:1]:
                try:
                    summary = check_local_logs(job)
                    check_request = urllib.request.Request(endpoint + '/api/agent/log-checks/' + str(uuid.UUID(job['id'])), data=json.dumps(summary).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
                    with urllib.request.urlopen(check_request, timeout=15) as response:
                        response.read()
                except (OSError, ValueError, KeyError):
                    log_error = 'Verificação local não confirmada; será tentada novamente.'
            # Raw log shipping is no longer automatic. Legacy mode requires local opt-in.
            if config.get('ship_raw_logs') is True and monitor.get('logs_enabled'):
                entries, next_cursors, log_error = collect_logs(services, cursors)
                while entries and len(json.dumps({'entries': entries}).encode()) > 27000:
                    entries.pop()
                if entries:
                    log_request = urllib.request.Request(endpoint + '/api/agent/logs', data=json.dumps({'entries': entries}).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
                    try:
                        with urllib.request.urlopen(log_request, timeout=15) as response:
                            response.read()
                        cursors = next_cursors
                    except (OSError, urllib.error.URLError):
                        log_error = 'Falha ao enviar logs; as métricas continuam sendo coletadas.'
            pending = None
            failures = 0
        except urllib.error.HTTPError as exc:
            print(f'Coleta recusada: HTTP {exc.code}', flush=True)
            if exc.code in (401, 403):
                raise SystemExit('Credencial inválida ou revogada. Registre o agente novamente.') from None
            failures += 1
        except (OSError, urllib.error.URLError):
            print('Falha de conexão; nova tentativa no próximo ciclo.', flush=True)
            failures += 1
        if args.once:
            return
        # Keep only the most recent failed event in memory; retries reuse its ID.
        if failures >= 3:
            pending = None
            failures = 0
        time.sleep(29)


if __name__ == '__main__':
    main()
