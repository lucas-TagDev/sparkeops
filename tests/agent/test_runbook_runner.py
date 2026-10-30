import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch, MagicMock

spec=importlib.util.spec_from_file_location('runbook_runner',Path(__file__).resolve().parents[2]/'agent'/'runbook_runner.py')
runner=importlib.util.module_from_spec(spec)
# Linux-only fcntl is mocked on Windows. No remote script is executed.
if sys.platform=='win32':
    with patch.dict(sys.modules,{'fcntl':SimpleNamespace(LOCK_EX=2,LOCK_NB=4,flock=MagicMock())}):
        spec.loader.exec_module(runner)
else:
    spec.loader.exec_module(runner)

class RunbookRunnerTests(unittest.TestCase):
    def test_paths_cannot_escape_managed_script_directories(self):
        for path in ['/tmp/a.sh','/opt/../etc/passwd','/opt/a.sh;id','/opt//a.sh','relative.sh']:
            with self.assertRaises(ValueError):runner.script_file(path)

    def test_checks_root_ownership_and_no_writable_parents(self):
        for uid,mode in [(1000,stat.S_IFDIR|0o755),(0,stat.S_IFDIR|0o777),(0,stat.S_IFLNK|0o755)]:
            with patch.object(Path,'lstat',return_value=SimpleNamespace(st_uid=uid,st_mode=mode)),self.assertRaises(ValueError):runner.script_file('/opt/runbooks/a.sh')

    def test_hash_is_calculated_from_checked_open_descriptor(self):
        info=SimpleNamespace(st_uid=0,st_mode=stat.S_IFREG|0o755,st_size=12,st_ino=2,st_dev=1)
        content=b'#!/bin/sh\necho ok\n'
        with patch.object(Path,'lstat',return_value=info),patch.object(Path,'stat',return_value=info),patch.object(runner.os,'O_NOFOLLOW',0,create=True),patch.object(runner.os,'open',return_value=99),patch.object(runner.os,'fstat',return_value=info),patch.object(runner.os,'read',return_value=content),patch.object(runner.os,'lseek'):
            fd,digest=runner.script_file('/opt/runbooks/a.sh')
        self.assertEqual(fd,99);self.assertEqual(digest,hashlib.sha256(content).hexdigest())

    def test_inspection_does_not_execute_and_hash_mismatch_is_rejected(self):
        marker=SimpleNamespace(st_uid=0,st_mode=stat.S_IFREG|0o600)
        for action,digest,expected in [('inspect','a'*64,'inspected'),('run','b'*64,'rejected')]:
            payload=base64.b64encode(json.dumps({'action':action,'path':'/opt/runbooks/a.sh','sha256':digest,'request_id':'a'*36}).encode()).decode()
            output=io.StringIO()
            with patch.object(runner.os,'geteuid',return_value=0,create=True),patch.object(Path,'lstat',return_value=marker),patch.object(runner,'script_file',return_value=(99,'a'*64)),patch.object(runner.os,'close'),patch.object(runner.subprocess,'Popen') as execute,contextlib.redirect_stdout(output):
                runner.run(payload)
            execute.assert_not_called();self.assertIn(expected,output.getvalue())

    def test_malformed_payload_and_disabled_marker_never_execute(self):
        for encoded in ['bad encoding!',base64.b64encode(b'{"action":"run"}').decode()]:
            with patch.object(runner.os,'geteuid',return_value=0,create=True),patch.object(Path,'lstat',side_effect=FileNotFoundError),patch.object(runner.subprocess,'Popen') as execute,contextlib.redirect_stdout(io.StringIO()):
                runner.run(encoded)
            execute.assert_not_called()
