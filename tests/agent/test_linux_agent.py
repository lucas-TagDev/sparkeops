import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch, mock_open, MagicMock
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('linux_agent', Path(__file__).resolve().parents[2] / 'agent' / 'linux_agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class LinuxAgentTests(unittest.TestCase):
    def test_platform_requests_identify_the_agent_and_preserve_authentication(self):
        request = agent.platform_request('https://platform.example/api/metrics', data=b'{}', headers={'Authorization': 'Bearer TEST_ONLY'})
        self.assertEqual(request.get_header('User-agent'), 'SparkeOPS-Agent/' + agent.AGENT_VERSION)
        self.assertEqual(request.get_header('Authorization'), 'Bearer TEST_ONLY')
        self.assertEqual(request.get_header('Accept'), 'application/json')

    def test_cloudflare_403_is_not_reported_as_an_invalid_token(self):
        import io
        error = agent.urllib.error.HTTPError('https://platform.example/api/agent/enroll', 403, 'Forbidden', {'Server': 'cloudflare'}, io.BytesIO(b'error code: 1010'))
        message = agent.http_failure(error)
        self.assertIn('Cloudflare', message)
        self.assertNotIn('Gere outro', message)
        error = agent.urllib.error.HTTPError('https://platform.example/api/agent/enroll', 403, 'Forbidden', {'Server': 'cloudflare', 'Content-Type': 'application/json'}, io.BytesIO(b'{"error":"Host not allowed"}'))
        self.assertIn('PUBLIC_URL', agent.http_failure(error))
        error = agent.urllib.error.HTTPError('https://platform.example/api/agent/enroll', 401, 'Unauthorized', {}, io.BytesIO(b'{}'))
        self.assertIn('Gere outro token', agent.http_failure(error))

    def test_live_service_diagnosis_is_scoped_and_redacts_error_samples(self):
        raw='{"MESSAGE":"Start request repeated too quickly token=secret_value","PRIORITY":"3"}\n'
        with patch.object(agent,'inspect_service_runtime',return_value={'my-app':{'Result':'start-limit-hit'}}),patch.object(agent,'check_local_logs',return_value={'counts':{'other_errors':1}}),patch.object(agent,'run_journal',return_value=SimpleNamespace(stdout=raw,stderr='',returncode=0,truncated=False)) as journal:
            result=agent.diagnose_service('my-app')
        self.assertEqual(result['runtime']['Result'],'start-limit-hit')
        self.assertNotIn('secret_value',str(result))
        self.assertIn('my-app.service',journal.call_args.args[0])
        with self.assertRaises(ValueError):agent.diagnose_service('nginx;id')

    def test_historical_system_journal_uses_exact_window_without_service_filter_or_raw_output(self):
        since=int(agent.time.time())-10*86400;until=since+3600
        raw='{"MESSAGE":"Out of memory: killed process secret-content","PRIORITY":"3"}\n'
        with patch.object(agent,'run_journal',return_value=SimpleNamespace(stdout=raw,stderr='',returncode=0,truncated=False)) as command,patch.object(agent,'local_error_tail',return_value=None):
            result=agent.check_local_logs({'service':'__system__','since':since,'until':until})
        args=command.call_args.args[0];self.assertNotIn('-u',args);self.assertIn('@'+str(since),args);self.assertIn('@'+str(until),args)
        self.assertEqual(result['counts']['out_of_memory'],1);self.assertNotIn('secret-content',str(result));self.assertEqual(result['read_status'],'ok')
    def test_monitoring_selected_processes_is_independent_of_top_rank_and_tracks_pid_start(self):
        before={10:{'name':'node','uid':1000,'ticks':100,'start':50,'rss_pages':10,'state':'S'},20:{'name':'other','uid':1000,'ticks':10,'start':20,'rss_pages':20,'state':'S'}}
        after={10:{**before[10],'ticks':110,'rss_pages':20},20:before[20]}
        def read(path):
            if path.as_posix()=='/proc/meminfo':return 'MemTotal: 1000 kB\n'
            if path.as_posix()=='/etc/passwd':return 'worker:x:1000:1000::/:/bin/false\n'
            raise AssertionError(path)
        rules=[{'id':'selected','revision':1,'name':'node','user':'worker','service':'queue'},{'id':'missing','revision':2,'name':'gone','user':'','service':''}]
        with patch.object(agent,'process_snapshot',side_effect=[(before,0,False),(after,0,False)]),patch.object(agent,'cpu_ticks',side_effect=[(1000,0),(1100,0)]),patch.object(agent.os,'sysconf',return_value=4096,create=True),patch.object(agent.time,'sleep'),patch.object(Path,'read_text',read),patch.object(agent,'process_service',return_value='queue'),patch.object(agent,'top_processes',side_effect=AssertionError('must not use top ranking')):
            result=agent.monitor_processes(rules)
        self.assertEqual(result[0]['count'],1);self.assertEqual(result[0]['identities'],['10:50']);self.assertEqual(result[0]['cpu_percent'],10);self.assertEqual(result[0]['memory_percent'],8)
        self.assertEqual(result[1]['count'],0);self.assertEqual(result[1]['read_status'],'ok')

    def test_process_monitoring_partial_reads_are_not_reported_as_reliable_absence(self):
        rows={10:{'name':'other','uid':0,'ticks':1,'start':1,'rss_pages':1,'state':'S'}}
        def read(path):return 'MemTotal: 1000 kB\n' if path.as_posix()=='/proc/meminfo' else 'root:x:0:0::/:/bin/sh\n'
        with patch.object(agent,'process_snapshot',side_effect=[(rows,0,False),(rows,1,False)]),patch.object(agent,'cpu_ticks',side_effect=[(1000,0),(1100,0)]),patch.object(agent.os,'sysconf',return_value=4096,create=True),patch.object(agent.time,'sleep'),patch.object(Path,'read_text',read):
            result=agent.monitor_processes([{'id':'rule','revision':1,'name':'node','user':'','service':''}])
        self.assertEqual(result[0]['count'],0);self.assertEqual(result[0]['read_status'],'partial')
    def test_generic_diagnostics_work_for_custom_services_without_returning_execstart(self):
        raw='Id=minha-fila.service\nActiveState=failed\nMainPID=0\nNRestarts=12\nExecMainStatus=1\nResult=exit-code\nExecStart=SECRET-TOKEN\n'
        with patch.object(agent.subprocess,'run',return_value=SimpleNamespace(stdout=raw)) as command:
            result=agent.inspect_service_runtime(['minha-fila'])
        self.assertEqual(result['minha-fila']['NRestarts'],12)
        self.assertEqual(result['minha-fila']['Result'],'exit-code')
        self.assertNotIn('SECRET',str(result));self.assertNotIn('shell',command.call_args.kwargs)
        self.assertIn('minha-fila.service',command.call_args.args[0])
        with self.assertRaises(ValueError):agent.inspect_service_runtime(['mysql;id'])

    def test_tunnel_discovery_reads_local_origins_without_exposing_credentials(self):
        config='tunnel: SECRET-ID\ncredentials-file: /root/secret.json\ningress:\n  - service: http://localhost:8080\n  - service: http://user:password@localhost:9000\n  - service: http://169.254.169.254/metadata\n'
        with patch.object(agent.subprocess,'run',return_value=SimpleNamespace(stdout='ExecStart=/usr/bin/cloudflared tunnel run\n')),patch('builtins.open',mock_open(read_data=config)):
            origins,info=agent.discover_tunnel_origins()
        self.assertEqual(origins,['http://localhost:8080']);self.assertEqual(info['source'],'local_config')
        self.assertNotIn('SECRET',str(info));self.assertNotIn('password',str(origins))

    def test_remote_tunnel_does_not_use_stale_local_configuration(self):
        with patch.object(agent.subprocess,'run',return_value=SimpleNamespace(stdout='ExecStart=/usr/bin/cloudflared tunnel run --token SECRET-TOKEN\n')),patch('builtins.open',mock_open(read_data='service: http://localhost:9999')) as files:
            origins,info=agent.discover_tunnel_origins()
        self.assertEqual(origins,[]);self.assertEqual(info['management'],'remote');files.assert_not_called()
        self.assertNotIn('SECRET-TOKEN',str(info))

    def test_remote_tunnel_origin_can_be_discovered_from_current_invocation_journal(self):
        import json
        payload={'ingress':[{'service':'http://127.0.0.1:8080'},{'service':'http_status:404'}],'token':'NEVER-SEND'}
        message='Updated to new configuration config='+json.dumps(json.dumps(payload))+' version=2'
        with patch.object(agent.subprocess,'run',return_value=SimpleNamespace(stdout='ExecStart=/usr/bin/cloudflared tunnel run --token SECRET\nInvocationID='+'a'*32+'\n')),patch.object(agent,'run_journal',return_value=SimpleNamespace(stdout=json.dumps({'MESSAGE':message}))) as journal:
            origins,info=agent.discover_tunnel_origins()
        self.assertEqual(origins,['http://127.0.0.1:8080']);self.assertEqual(info['source'],'runtime_journal')
        self.assertIn('_SYSTEMD_INVOCATION_ID='+'a'*32,journal.call_args.args[0]);self.assertNotIn('NEVER-SEND',str(info))

    def test_live_chat_reads_requested_service_and_logs_without_claiming_site_health(self):
        with patch.object(agent,'details',return_value={'services':{'cloudflared':'active'},'hostname':'host'}),patch.object(agent,'collect',return_value={'cpu_percent':1,'memory_percent':40,'disk_percent':30}),patch.object(agent,'check_local_logs',return_value={'counts':{'connection_refused':1},'scanned':2,'read_status':'ok'}) as logs,patch.object(agent,'collect_processes') as processes,patch.object(agent.urllib.request,'build_opener') as http:
            result=agent.live_diagnostic({'services':['cloudflared'],'logs':True,'origin':True},{})
        self.assertEqual(logs.call_args.args[0]['service'],'cloudflared')
        self.assertEqual(result['origin']['status'],'not_configured')
        self.assertTrue(result['limitations'])
        processes.assert_not_called();http.assert_not_called()

    def test_live_diagnostic_refuses_arbitrary_services_and_external_origin(self):
        with self.assertRaises(ValueError):agent.live_diagnostic({'services':['nginx;id']},{})
        with patch.object(agent,'details',return_value={'services':{},'hostname':'host'}),patch.object(agent,'collect',return_value={}),patch.object(agent.urllib.request,'build_opener') as http:
            result=agent.live_diagnostic({'services':[],'origin':True},{'diagnostic_origin_url':'http://169.254.169.254/metadata'})
        self.assertEqual(result['origin']['status'],'not_configured');http.assert_not_called()

    def test_process_rankings_preserve_low_cpu_high_memory_consumers(self):
        rows=[{'pid':pid,'cpu_percent':26-pid,'rss_bytes':pid*100} for pid in range(1,26)]
        selected=agent.top_processes(rows)
        self.assertEqual(set(selected),set(range(1,11))|set(range(16,26)))
        self.assertEqual(len(selected),20)

    def test_process_cpu_uses_interval_and_excludes_recycled_and_new_pids(self):
        before = {1: {'name':'php-fpm','ticks':100,'start':1000,'rss_pages':2,'uid':33,'state':'S'}, 2:{'name':'mysql','ticks':10,'start':1000,'rss_pages':40,'uid':27,'state':'S'}, 4:{'name':'old','ticks':20,'start':999,'rss_pages':1,'uid':0,'state':'S'}}
        after = {1:{**before[1],'ticks':140}, 2:{**before[2],'ticks':12}, 3:{**before[1]}, 4:{**before[4],'start':1000,'ticks':200}}
        fields=['S']+['0']*21
        fields[19]='1000'
        def read(path,*args,**kwargs):
            return {'/proc/meminfo':'MemTotal: 1024 kB\n','/proc/uptime':'1000 0','/etc/passwd':'www-data:x:33:33::/:/bin/sh\nmysql:x:27:27::/:/bin/sh\n'}[path.as_posix()]
        with patch.object(agent,'process_snapshot',side_effect=[(before,0,False),(after,1,False)]),patch.object(agent,'cpu_ticks',side_effect=[(1000,0),(1200,0)]),patch.object(agent.time,'sleep'),patch.object(agent.time,'monotonic',side_effect=[10,11]),patch.object(agent.Path,'read_text',read),patch.object(agent.os,'sysconf',side_effect=lambda key:4096 if key=='SC_PAGE_SIZE' else 100,create=True),patch('builtins.open',mock_open(read_data='1 (php fpm) '+' '.join(fields))),patch.object(agent,'process_service',return_value='php8.3-fpm'):
            result=agent.collect_processes()
        self.assertEqual(result['read_status'],'ok')
        rows={r['pid']:r for r in result['processes']}
        self.assertEqual(set(rows),{1,2})
        self.assertEqual(rows[1]['cpu_percent'],20)
        self.assertEqual(rows[1]['user'],'www-data')
        self.assertEqual(rows[1]['elapsed_seconds'],990)
        self.assertEqual(rows[2]['memory_percent'],15.62)
        self.assertNotIn('cmdline',str(result))
        self.assertNotIn('environ',str(result))

    def test_process_stat_handles_names_with_parentheses_without_reading_arguments(self):
        fields=['R']+['0']*21
        fields[11],fields[12],fields[19],fields[21]='100','20','50','8'
        entries=MagicMock()
        entries.__enter__.return_value=iter([SimpleNamespace(name='42',path='/proc/42',stat=lambda:SimpleNamespace(st_uid=33))])
        with patch.object(agent.os,'scandir',return_value=entries),patch('builtins.open',mock_open(read_data='42 (worker (pool)) '+' '.join(fields))) as opened:
            rows,skipped,truncated=agent.process_snapshot()
        self.assertEqual(rows[42]['name'],'worker (pool)')
        self.assertEqual(rows[42]['ticks'],120)
        self.assertEqual(rows[42]['start'],50)
        self.assertEqual(rows[42]['rss_pages'],8)
        self.assertTrue(str(opened.call_args.args[0]).endswith('stat'))
        self.assertEqual(skipped,0)
        self.assertFalse(truncated)

    def test_process_permission_failure_does_not_claim_empty_healthy_host(self):
        with patch.object(agent.Path,'read_text',side_effect=PermissionError()):
            result=agent.collect_processes()
        self.assertEqual(result['read_status'],'unavailable')
        self.assertEqual(result['processes'],[])

    def test_local_check_returns_counts_without_log_content(self):
        import json
        import time
        job = {'service': 'nginx', 'since': int(time.time())-900, 'until': int(time.time())}
        rows = [json.dumps({'MESSAGE': 'connection refused SECRET=private', 'PRIORITY': '3'}), json.dumps({'MESSAGE': 'ordinary notice', 'PRIORITY': '6'})]
        with patch.object(agent, 'run_journal', return_value=SimpleNamespace(stdout='\n'.join(rows), stderr='', returncode=0)) as command, patch.object(agent, 'local_error_tail', return_value=None):
            result = agent.check_local_logs(job)
        self.assertEqual(result['counts']['connection_refused'], 1)
        self.assertEqual(result['scanned'], 2)
        self.assertNotIn('private', json.dumps(result))
        self.assertIn('@'+str(job['since']), command.call_args.args[0])
        self.assertNotIn('shell', command.call_args.kwargs)
        with self.assertRaises(ValueError):
            agent.check_local_logs({**job, 'service': 'nginx; curl evil'})

    def test_local_file_is_filtered_by_time_and_unparseable_lines_are_reported(self):
        from datetime import datetime
        timestamp = datetime.now().replace(microsecond=0)
        job = {'service': 'nginx', 'since': int(timestamp.timestamp())-60, 'until': int(timestamp.timestamp())}
        lines = [timestamp.strftime('%Y/%m/%d %H:%M:%S')+' [error] permission denied secret', 'unparseable private line', '2020/01/01 10:00:00 [error] connection refused']
        with patch.object(agent, 'run_journal', return_value=SimpleNamespace(stdout='', stderr='permission denied', returncode=1)), patch.object(agent, 'local_error_tail', return_value=(lines,False)):
            result = agent.check_local_logs(job)
        self.assertEqual(result['scanned'], 1)
        self.assertEqual(result['unparsed'], 1)
        self.assertEqual(result['counts']['permission_denied'], 1)
        self.assertEqual(result['sources'], ['service_error_file'])
        self.assertNotIn('secret', str(result))

    def test_unreadable_journal_is_not_reported_as_healthy(self):
        import time
        job = {'service': 'nginx', 'since': int(time.time())-60, 'until': int(time.time())}
        with patch.object(agent, 'run_journal', side_effect=OSError()), patch.object(agent, 'local_error_tail', side_effect=PermissionError()):
            self.assertEqual(agent.check_local_logs(job)['read_status'], 'unavailable')

    def test_local_journal_output_is_bounded(self):
        import sys
        result = agent.run_journal([sys.executable, '-c', "import sys; sys.stdout.write(('x'*1000+'\\n')*3000)"])
        self.assertTrue(result.truncated)
        self.assertLessEqual(len(result.stdout.encode()), 2 * 1024 * 1024)

    def test_forced_ssh_gateway_rejects_shell_and_privilege_commands(self):
        spec = importlib.util.spec_from_file_location('ssh_gateway', Path(__file__).resolve().parents[2] / 'agent' / 'ssh_gateway.py')
        gateway = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gateway)
        self.assertEqual(gateway.allowed("sudo -n /usr/bin/systemctl restart -- 'nginx.service'"), ['/usr/bin/systemctl','restart','--','nginx.service'])
        self.assertEqual(gateway.allowed("sudo -n /usr/bin/python3 /opt/foxops-agent/linux_agent.py --diagnose-service 'my-app'"), ['/usr/bin/python3','/opt/foxops-agent/linux_agent.py','--diagnose-service','my-app'])
        self.assertIsNone(gateway.allowed('/usr/bin/python3 /tmp/evil.py --diagnose-service my-app'))
        for service in ('lacgamesbr', 'cloudflared', 'worker@cliente', 'php8.3-fpm'):
            for action in ('is-active', 'restart', 'reload'):
                self.assertEqual(gateway.allowed(f"sudo -n /usr/bin/systemctl {action} -- '{service}.service'"), ['/usr/bin/systemctl', action, '--', service+'.service'])
        for command in ('bash', '/bin/sh', '/usr/bin/systemctl enable -- ssh.service', '/usr/bin/systemctl restart -- ../evil.service', '/usr/bin/systemctl restart -- -evil.service', '/usr/bin/hostname; id', '/usr/sbin/nginx -t -c /tmp/evil', '/usr/bin/systemctl restart -- nginx.service && id', 'sudo /usr/bin/hostname'):
            self.assertIsNone(gateway.allowed(command))

    def test_discovers_web_and_php_services_without_accepting_shell_input(self):
        output = 'nginx.service enabled\napache2.service disabled\nphp8.3-fpm.service enabled\nssh.service enabled\nsshd.service enabled\nmeu-app.service enabled\nworker@cliente.service enabled\nworker@.service disabled\nbad;command.service enabled\n'
        with patch.object(agent.subprocess, 'run', return_value=SimpleNamespace(stdout=output)) as command:
            self.assertEqual(agent.discover_services(), ['apache2', 'meu-app', 'nginx', 'php8.3-fpm', 'ssh', 'sshd', 'worker@cliente'])
        self.assertNotIn('shell', command.call_args.kwargs)

    def test_journal_events_are_redacted_and_have_stable_ids(self):
        import json
        row = {'__CURSOR': 'cursor-one', '__REALTIME_TIMESTAMP': '1793190000000000', 'MESSAGE': 'password=secret token=abc', 'PRIORITY': '3'}
        with patch.object(agent.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(row), returncode=0)), patch.object(Path, 'exists', return_value=False):
            events, cursors, error = agent.collect_logs(['nginx'], {})
            again, _, _ = agent.collect_logs(['nginx'], {})
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['event_id'], again[0]['event_id'])
        self.assertNotIn('secret', events[0]['message'])
        self.assertNotIn('abc', events[0]['message'])
        self.assertEqual(cursors['nginx'], 'cursor-one')

    def test_cpu_memory_and_disk_from_linux_counters(self):
        cpu = iter(['cpu  100 0 50 800 50 0 0 0 0 0\n', 'cpu  110 0 55 875 60 0 0 0 0 0\n'])
        def read(path):
            if path.as_posix() == '/proc/stat':
                return next(cpu)
            if path.as_posix() == '/proc/meminfo':
                return 'MemTotal: 1000 kB\nMemAvailable: 250 kB\n'
            raise AssertionError(path)
        with patch.object(Path, 'read_text', read), patch.object(agent.time, 'sleep'), patch.object(agent.shutil, 'disk_usage', return_value=SimpleNamespace(total=1000, used=400)):
            metrics = agent.collect()
        self.assertEqual(metrics, dict(cpu_percent=15.0, memory_percent=75.0, disk_percent=40.0))

    def test_network_excludes_loopback_and_service_has_no_shell(self):
        calls = []
        def read(path):
            if path.as_posix() == '/proc/net/dev':
                return 'header\nheader\nlo: 100 0 0 0 0 0 0 0 100 0 0 0 0 0 0 0\neth0: 500 0 0 0 0 0 0 0 700 0 0 0 0 0 0 0\n'
            if path.as_posix() == '/proc/uptime':
                return '12345.67 0.0'
            raise AssertionError(path)
        def run(command, **kwargs):
            calls.append((command, kwargs))
            return SimpleNamespace(stdout='nginx.service loaded active running Web server\n',returncode=0)
        with patch.object(Path, 'read_text', read), patch.object(agent.subprocess, 'run', side_effect=run), patch.object(agent, 'collect_telemetry', return_value={}):
            info = agent.details(['nginx', ';bad-command'])
        self.assertEqual(info['network_rx_bytes'], 500)
        self.assertEqual(info['network_tx_bytes'], 700)
        self.assertEqual(info['uptime_seconds'], 12345)
        self.assertEqual(info['services'], {'nginx': 'active'})
        self.assertEqual(calls[0][0], ['systemctl', 'list-units', '--type=service', '--all', '--plain', '--no-pager', '--no-legend'])
        self.assertNotIn('shell', calls[0][1])

    def test_optional_sensors_and_io_use_interval_deltas(self):
        agent._previous_disk_io = None
        step = [0]
        def read(path):
            if 'temp1_input' in path.as_posix():
                return '65000'
            if path.as_posix() == '/proc/diskstats':
                return '8 0 sda 10 0 20 100 10 0 40 100 0 100 100' if step[0] == 0 else '8 0 sda 20 0 40 200 20 0 80 200 0 200 200'
            raise FileNotFoundError(str(path))
        with patch.object(Path, 'glob', return_value=[Path('/sys/class/hwmon/hwmon0/temp1_input')]), patch.object(Path, 'read_text', read), patch.object(Path, 'exists', return_value=True), patch.object(agent.time, 'monotonic', side_effect=[100,110]):
            first=agent.collect_telemetry();step[0]=1;second=agent.collect_telemetry()
        self.assertEqual(first, {'temperature_max_c':65})
        self.assertEqual(second['disk_await_ms'],10)
        self.assertEqual(second['disk_read_bytes_per_sec'],1024)
        self.assertEqual(second['disk_write_bytes_per_sec'],2048)
        agent._previous_disk_io=None

    def test_missing_sensors_and_diskstats_do_not_report_fake_zero(self):
        with patch.object(Path,'glob',return_value=[]),patch.object(Path,'read_text',side_effect=FileNotFoundError):
            self.assertEqual(agent.collect_telemetry(),{})

    def test_discovery_includes_more_than_twenty_and_transient_instances(self):
        installed='\n'.join('custom-'+str(i)+'.service enabled' for i in range(60))
        loaded='worker@7.service loaded active running Worker\n'
        with patch.object(agent.subprocess,'run',side_effect=[SimpleNamespace(stdout=installed),SimpleNamespace(stdout=loaded)]):
            found=agent.discover_services()
        self.assertEqual(len(found),61)
        self.assertIn('worker@7',found)

    def test_endpoint_requires_https_or_loopback_without_credentials(self):
        agent.validate_endpoint('https://monitor.example')
        agent.validate_endpoint('http://127.0.0.1:8080')
        for url in ['http://remote.example', 'https://user:password@monitor.example', 'https://monitor.example/api', 'https://monitor.example?token=secret', '']:
            with self.subTest(url=url), self.assertRaises(SystemExit):
                agent.validate_endpoint(url)

    def test_private_lan_http_requires_explicit_opt_in(self):
        for address in ('192.168.3.41', '10.0.0.5', '172.16.1.5'):
            with self.subTest(address=address):
                with self.assertRaises(SystemExit):
                    agent.validate_endpoint('http://' + address + ':8080')
                agent.validate_endpoint('http://' + address + ':8080', allow_lan_http=True)
        for address in ('8.8.8.8', '169.254.1.1', '172.32.0.1', 'remote.example'):
            with self.subTest(address=address), self.assertRaises(SystemExit):
                agent.validate_endpoint('http://' + address, allow_lan_http=True)


if __name__ == '__main__':
    unittest.main()
