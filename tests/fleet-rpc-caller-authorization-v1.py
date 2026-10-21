"""Real-role renewal security tests on disposable PostgreSQL; no production access."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fleet_token_cases', ROOT / 'tests/fleet-device-lock-callers-v1.py')
cases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases)
SIGNATURE = 'public.auto_restart_renew_device_lock(uuid,text,uuid,integer,uuid,uuid)'
MIGRATION = ROOT / 'supabase/migrations/20260907171458_fleet_mutation_rpc_caller_authorization_v1.sql'


class RenewalCallerAuthorization(cases.CanonicalAdmissionRecoveryTests):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        sql = cases.f.f.f.HumanResumeAligned.sql
        sql(MIGRATION.read_text())
        sql(MIGRATION.read_text())  # Reapplying must not duplicate the guard.
        sql('CREATE ROLE fixture_public_only NOLOGIN;')

    def invoke(self, role, binding, *, grant_for_guard_probe=False):
        def quote(value):
            return "'" + str(value).replace("'", "''") + "'"
        values = [quote(binding['device_id']) + '::uuid', quote(binding['worker_id']),
                  quote(binding['request_id']) + '::uuid', '600',
                  quote(binding['lease_id']) + '::uuid', quote(binding['account_id']) + '::uuid']
        grant = ('GRANT EXECUTE ON FUNCTION ' + SIGNATURE + ' TO ' + role + ';') if grant_for_guard_probe else ''
        return self.t.sql('BEGIN;' + grant + 'SET LOCAL ROLE ' + role + ';'
                         "SET LOCAL request.jwt.claim.role='service_role';"
                         "SELECT 'ROLE_RESULT:' || public.auto_restart_renew_device_lock("
                         + ','.join(values) + ')::text;ROLLBACK;', check=False)

    def payload(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(next(line.split('ROLE_RESULT:', 1)[1] for line in result.stdout.splitlines()
                               if line.startswith('ROLE_RESULT:')))

    def test_public_anon_authenticated_cannot_execute_or_disclose(self):
        binding = self.new_binding()
        wrong = '00000000-0000-4000-8000-000000009999'
        for role in ('fixture_public_only', 'anon', 'authenticated'):
            errors = []
            for field in (None, 'device_id', 'lease_id', 'request_id', 'account_id'):
                with self.subTest(role=role, field=field):
                    supplied = dict(binding)
                    if field:
                        supplied[field] = wrong
                    result = self.invoke(role, supplied)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('permission denied for function auto_restart_renew_device_lock', result.stderr)
                    self.assertNotIn('ROLE_RESULT:', result.stdout)
                    self.assertNotIn(binding['lease_id'], result.stderr + result.stdout)
                    errors.append(result.stderr)
            self.assertEqual(len(set(errors)), 1)

    def test_internal_role_guard_even_if_execute_temporarily_granted(self):
        binding = self.new_binding()
        for role in ('anon', 'authenticated', 'fixture_public_only'):
            result = self.invoke(role, binding, grant_for_guard_probe=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('service_role_required', result.stderr)
            self.assertNotIn('ROLE_RESULT:', result.stdout)

    def test_authorized_current_binding_renews(self):
        self.assertTrue(self.payload(self.invoke('service_role', self.new_binding()))['renewed'])

    def test_authorized_wrong_bindings_remain_rejected(self):
        binding = self.new_binding()
        for field in ('lease_id', 'request_id', 'account_id', 'device_id'):
            supplied = dict(binding, **{field: '00000000-0000-4000-8000-000000009999'})
            self.assertFalse(self.payload(self.invoke('service_role', supplied))['renewed'])

    def test_role_metadata_search_path_and_idempotent_migration(self):
        query = """SELECT 'ROLE_RESULT:' || json_build_object(
          'public',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                         WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
          'anon',has_function_privilege('anon',p.oid,'execute'),
          'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
          'service',has_function_privilege('service_role',p.oid,'execute'),
          'definer',p.prosecdef,'config',p.proconfig,
          'guard_count',(length(p.prosrc)-length(replace(p.prosrc,'fleet_renewal_caller_authorization_v1','')))
                         /length('fleet_renewal_caller_authorization_v1'))::text
          FROM pg_proc p WHERE oid='""" + SIGNATURE + "'::regprocedure;"
        row = self.payload(self.t.sql(query))
        self.assertEqual(row, {'public': False, 'anon': False, 'authenticated': False,
                              'service': True, 'definer': True,
                              'config': ['search_path=pg_catalog, pg_temp'], 'guard_count': 1})

    def test_enqueue_replacement_preserves_server_only_baseline_acl(self):
        binding = self.new_binding()
        for role in ('fixture_public_only', 'anon', 'authenticated'):
            result = self.t.sql("BEGIN; SET LOCAL ROLE " + role + "; SELECT public.create_account_run_request('"
                                + binding['account_id'] + "'::uuid); ROLLBACK;", check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('permission denied for function create_account_run_request', result.stderr)
            self.assertNotIn(binding['lease_id'], result.stdout + result.stderr)

    def test_peer_mutation_rpc_privileges(self):
        signatures = [
            SIGNATURE,
            'public.create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb)',
            'public.auto_restart_release_device_lock(uuid,text,uuid,uuid,uuid)',
            'public.auto_restart_transfer_device_lock(uuid,uuid,text,text,uuid,uuid,integer)',
            'public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,uuid)',
            'public.begin_device_activity_v1(uuid,uuid,text,uuid)',
            'public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer,uuid)',
            *['public.consume_resume_authorization_and_create_request_' + version + '(uuid,text,uuid,jsonb)'
              for version in ('v2', 'v3', 'v4')],
        ]
        for signature in signatures:
            query = "SELECT 'ROLE_RESULT:' || json_build_object('definer',p.prosecdef," \
                    "'public',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')," \
                    "'anon',has_function_privilege('anon',p.oid,'execute')," \
                    "'authenticated',has_function_privilege('authenticated',p.oid,'execute')," \
                    "'service',has_function_privilege('service_role',p.oid,'execute'))::text " \
                    "FROM pg_proc p WHERE oid='" + signature + "'::regprocedure;"
            with self.subTest(signature=signature):
                self.assertEqual(self.payload(self.t.sql(query)),
                                 {'definer': True, 'public': False, 'anon': False,
                                  'authenticated': False, 'service': True})

    def test_concurrent_renew_release_transfer_preserves_successor(self):
        import concurrent.futures
        import threading
        for pair in (('renew', 'release'), ('renew', 'transfer'), ('release', 'transfer'),
                     ('renew', 'renew'), ('transfer', 'transfer')):
            for iteration in range(5):
                with self.subTest(pair=pair, iteration=iteration):
                    self.setUp()
                    binding = self.new_binding()
                    transfer_args = self.transfer_args(binding) if 'transfer' in pair else None
                    start = threading.Barrier(2)

                    def operation(name):
                        start.wait(timeout=10)
                        args = transfer_args if name == 'transfer' else self.release_args(binding)
                        return self.python_namespace[name + '_device_lock'](**args)

                    def observe():
                        result = self.t.sql("SELECT 'ROLE_RESULT:' || coalesce((SELECT row_to_json(l)::text "
                                            "FROM public.auto_restart_device_locks l WHERE device_id='"
                                            + binding['device_id'] + "'),'null');")
                        return self.payload(result)

                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                        futures = [pool.submit(operation, name) for name in pair]
                        results = [future.result(timeout=20) for future in futures]
                    self.assertNotIn('40P01', str(results))
                    self.assertNotIn('deadlock', str(results).lower())
                    moved = [row for row in results if row.get('transferred')]
                    current = observe()
                    if moved:
                        self.assertEqual(len({row['lease_id'] for row in moved}), 1)
                        self.assertEqual(current['lease_id'], moved[0]['lease_id'])
                        self.assertNotEqual(current['lease_id'], binding['lease_id'])
                        for name, flag in (('renew', 'renewed'), ('release', 'released')):
                            self.assertFalse(self.python_namespace[name + '_device_lock'](
                                **self.release_args(binding)).get(flag))
                        self.assertEqual(observe()['lease_id'], current['lease_id'])
                    elif any(row.get('released') for row in results):
                        self.assertIsNone(current)
                    else:
                        self.assertEqual(current['lease_id'], binding['lease_id'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
