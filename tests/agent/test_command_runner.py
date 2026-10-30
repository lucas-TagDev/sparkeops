import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('command_runner',Path(__file__).resolve().parents[2]/'agent'/'command_runner.py')
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

class CommandRunnerTests(unittest.TestCase):
    def test_disabled_mode_never_executes_even_with_a_valid_command(self):
        output=io.StringIO()
        with patch.object(runner,'enabled',return_value=False),patch.object(runner,'execute') as execute,contextlib.redirect_stdout(output):
            code=runner.run(base64.b64encode(json.dumps({'command':'df -h'}).encode()).decode())
        self.assertEqual(code,1);execute.assert_not_called();self.assertIn('refused',output.getvalue())

    def test_enabled_mode_executes_exact_payload_and_returns_structured_status(self):
        output=io.StringIO()
        with patch.object(runner,'enabled',return_value=True),patch.object(runner,'execute',return_value={'status':'completed','exit_code':0,'output':'filesystem result'}) as execute,contextlib.redirect_stdout(output):
            code=runner.run(base64.b64encode(json.dumps({'command':'df -h'}).encode()).decode())
        self.assertEqual(code,0);execute.assert_called_once_with('df -h');self.assertIn('filesystem result',output.getvalue())

    def test_malformed_payload_does_not_execute(self):
        with patch.object(runner,'enabled',return_value=True),patch.object(runner,'execute') as execute,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.run('not base64!'),1)
        execute.assert_not_called()
