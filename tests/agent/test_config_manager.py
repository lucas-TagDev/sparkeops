import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('config_manager',Path(__file__).resolve().parents[2]/'agent'/'config_manager.py')
manager=importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)

class ConfigManagerTests(unittest.TestCase):
    def test_browse_masks_credentials_and_preserves_parameters(self):
        raw = 'port=3306\npassword=hello\nEnvironment=AUTH=x\nurl=https://user:pass@host/path\n-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----'
        result = manager.sanitize_configuration(raw)
        self.assertIn('port=3306', result)
        for secret in ('hello', 'AUTH=x', 'user:pass', 'abc123'):
            self.assertNotIn(secret, result)

    def test_browse_validates_unit_and_uses_argument_vector(self):
        for service in ('../mysql', 'mysql;id', '-bad', ''):
            with self.assertRaises(ValueError): manager.browse(service)
        from types import SimpleNamespace
        with patch.object(manager.subprocess, 'run', return_value=SimpleNamespace(stdout='')) as call, patch.object(manager.Path, 'is_file', return_value=False), patch.object(manager.Path, 'is_dir', return_value=False):
            result = manager.browse('custom@instance')
        self.assertEqual(result['status'], 'browsed')
        self.assertEqual(result['files'], [])
        self.assertEqual(call.call_args.args[0][-1], 'custom@instance.service')

    def test_changes_only_numeric_directive_preserving_rest_and_auto(self):
        original='user www-data;\nworker_processes auto; # comment\nevents { worker_connections 768; }\n'
        updated=manager.edited(original,'nginx',{'worker_processes':2})
        self.assertEqual(updated,original.replace('auto','2'))
        for values in ({'worker_processes':'2; include /tmp/evil'}, {'include':1}, {'worker_processes':0}):
            with self.assertRaises(ValueError):manager.edited(original,'nginx',values)
        with self.assertRaises(ValueError):manager.edited(original+'worker_processes 3;\n','nginx',{'worker_processes':2})

    def test_profiles_refuse_custom_paths_and_unsupported_database(self):
        for service in ('../nginx','nginx;id','postgresql','mariadb'):
            with self.assertRaises(ValueError):manager.profile(service)
        self.assertEqual(manager.profile('mysql')[2],['/usr/sbin/mysqld','--validate-config'])
        original='[www]\npm.max_children = 5\npm.max_requests = 0\n'
        self.assertIn('pm.max_children = 10',manager.edited(original,'php8.3-fpm',{'pm.max_children':10}))
        with self.assertRaises(ValueError):manager.edited('[other]\npm.max_children = 5\n','php8.3-fpm',{'pm.max_children':10})
        with self.assertRaises(ValueError):manager.edited('[client]\nmax_connections = 100\n','mysql',{'max_connections':200})

    def transaction(self,checks):
        temp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent);self.addCleanup(temp.cleanup)
        root=Path(temp.name);target=root/'test.conf';target.write_bytes(b'original')
        def write(path,content,info):path.write_bytes(content)
        with patch.object(manager,'command_ok',side_effect=checks),patch.object(manager,'atomic_write',side_effect=write):
            result=manager.apply_transaction(target,b'original',b'updated',None,['validator'],['systemctl','reload','--','nginx.service'],root/'backups')
        backups=list((root/'backups').glob('*.bak'))
        return result,target.read_bytes(),[p.read_bytes() for p in backups]

    def test_success_keeps_backup_and_applies_after_validation(self):
        result,content,backups=self.transaction([True,True,True,True])
        self.assertEqual(result['status'],'applied');self.assertEqual(content,b'updated');self.assertEqual(backups,[b'original'])

    def test_bad_candidate_restores_original_without_reload(self):
        result,content,backups=self.transaction([True,False])
        self.assertEqual(result['status'],'rolled_back');self.assertEqual(content,b'original');self.assertEqual(backups,[b'original'])

    def test_failed_activation_restores_original_and_recovers_service(self):
        result,content,_=self.transaction([True,True,False,True,True,True])
        self.assertEqual(result['status'],'rolled_back');self.assertEqual(content,b'original')

    def test_failed_recovery_is_visible_instead_of_reported_success(self):
        result,content,_=self.transaction([True,True,False,True,False])
        self.assertEqual(result['status'],'rollback_failed');self.assertEqual(content,b'original')

    def test_invalid_baseline_does_not_modify_or_create_backup(self):
        result,content,backups=self.transaction([False])
        self.assertEqual(result['status'],'baseline_invalid');self.assertEqual(content,b'original');self.assertEqual(backups,[])
