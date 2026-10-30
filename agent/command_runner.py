#!/usr/bin/python3
"""Opt-in execution for commands explicitly approved in SparkeOPS. Disabled by default."""
import base64
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import time


def enabled():
    marker=Path('/etc/foxops-agent/allow-approved-commands')
    try:
        info=marker.lstat()
        return not marker.is_symlink() and info.st_uid==0 and info.st_mode & 0o077==0 and marker.read_text().strip()=='enabled'
    except OSError:return False


def execute(command):
    if not isinstance(command,str) or not command.strip() or len(command)>2000 or '\x00' in command:
        raise ValueError('Comando inválido.')
    output=bytearray();status='completed'
    with subprocess.Popen(['/bin/bash','-c',command],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,env={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C'}) as process:
        selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
        deadline=time.monotonic()+30
        try:
            while selector.get_map():
                if time.monotonic()>deadline:status='timed_out';break
                for key,_ in selector.select(.2):
                    chunk=os.read(key.fd,4096)
                    if not chunk:selector.unregister(key.fileobj);break
                    output.extend(chunk)
                    if len(output)>16000:status='output_limit';break
                if status!='completed':break
        finally:
            selector.close()
            if status=='completed':
                try:process.wait(timeout=max(.1,deadline-time.monotonic()))
                except subprocess.TimeoutExpired:status='timed_out'
            # Stop remaining children belonging to this command's process group.
            try:os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            process.wait()
    text=output[:16000].decode('utf-8',errors='replace')
    text=re.sub(r'(?i)((?:password|passwd|token|api[_-]?key|secret|authorization)\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+',r'\1[REDACTED]',text)
    return {'status':status,'exit_code':process.returncode,'output':text}


def run(encoded):
    if not enabled():
        result={'status':'refused','output':'Execução de comandos da IA desabilitada no Ubuntu. Habilite explicitamente com o atualizador --enable-approved-commands.'}
    else:
        try:
            if len(encoded)>4000:raise ValueError('Solicitação muito grande.')
            data=json.loads(base64.b64decode(encoded,validate=True))
            result=execute(data.get('command'))
        except Exception:
            result={'status':'refused','output':'Não foi possível executar o comando aprovado.'}
    text=result.pop('output','')
    print('FOXOPS_COMMAND:'+json.dumps(result,ensure_ascii=True))
    print(text)
    return 0 if result.get('status')=='completed' and result.get('exit_code')==0 else 1
