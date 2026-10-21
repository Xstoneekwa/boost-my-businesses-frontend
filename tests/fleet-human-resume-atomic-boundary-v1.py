"""Local regression evidence for the human-resume/atomic-enqueue boundary.

Runs the real V2 resume function and candidate atomic enqueue migration.
Surrounding eligibility tables and the preserved inner enqueue are fixtures;
this does not certify the complete production admission graph.
"""
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
PG = pathlib.Path('/opt/homebrew/opt/postgresql@17/bin')
A = '20000000-0000-0000-0000-000000000001'
D = '10000000-0000-0000-0000-000000000001'
AUTH = '30000000-0000-0000-0000-000000000001'
INCIDENT = '40000000-0000-0000-0000-000000000001'
PLAN = '50000000-0000-0000-0000-000000000001'
RUN = '60000000-0000-0000-0000-000000000001'


class HumanResumeAtomicBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = pathlib.Path(tempfile.mkdtemp(prefix='fleet-human-resume-', dir='/private/tmp')).resolve()
        cls.started = False
        cls.addClassCleanup(cls.cleanup)
        subprocess.run([str(PG / 'initdb'), '-D', str(cls.tmp / 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cls.tmp / 'data'), '-l', str(cls.tmp / 'postgres.log'), '-o', "-k %s -p 55484 -c listen_addresses=''" % cls.tmp, '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
        cls.started = True
        cls.sql('''
          CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
          CREATE TABLE ig_accounts(id uuid PRIMARY KEY);
          CREATE TABLE account_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid, device_id uuid, app_instance_id uuid, status text, created_at timestamptz DEFAULT now());
          CREATE TABLE account_run_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid, requested_by uuid, actor_type text, source_surface text, requested_run_type text, idempotency_key text UNIQUE, priority integer, metadata_safe jsonb, status text DEFAULT 'queued');
          CREATE TABLE auto_restart_device_locks(device_id uuid PRIMARY KEY, worker_id text, account_id uuid, app_instance_id uuid, request_id uuid REFERENCES account_run_requests(id), lease_id uuid NOT NULL DEFAULT gen_random_uuid(), lease_expires_at timestamptz, reason text, owner_kind text, operation_phase text, heartbeat_at timestamptz, updated_at timestamptz DEFAULT now());
          CREATE TABLE incident_resume_authorizations(id uuid PRIMARY KEY, incident_id uuid, account_id uuid, run_id uuid, resume_plan_id uuid, status text, test boolean, scheduled_window_start timestamptz, scheduled_window_end timestamptz, consumed_by_request_id uuid, retry_generation integer DEFAULT 0, consumed_at timestamptz, consume_error text, frozen_phase_plan jsonb, updated_at timestamptz);
          CREATE TABLE account_incidents(id uuid PRIMARY KEY, account_id uuid, status text, metadata jsonb, updated_at timestamptz);
          CREATE TABLE account_session_resume_plans(id uuid PRIMARY KEY, account_id uuid, run_id uuid, resume_state text, plan jsonb, last_updated_at timestamptz);
          CREATE FUNCTION _device_ui_lease_audit(uuid,uuid,text,text,text,uuid,uuid,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
          CREATE FUNCTION create_account_run_request(p_account_id uuid,p_requested_by uuid DEFAULT NULL,p_actor_type text DEFAULT 'admin',p_source_surface text DEFAULT 'instagram_dashboard',p_requested_run_type text DEFAULT 'account_session',p_idempotency_key text DEFAULT NULL,p_priority integer DEFAULT 0,p_metadata_safe jsonb DEFAULT '{}') RETURNS account_run_requests LANGUAGE plpgsql AS $$
          DECLARE r account_run_requests; BEGIN
          INSERT INTO account_run_requests(account_id,requested_by,actor_type,source_surface,requested_run_type,idempotency_key,priority,metadata_safe)
          VALUES(p_account_id,p_requested_by,p_actor_type,p_source_surface,p_requested_run_type,p_idempotency_key,p_priority,p_metadata_safe) RETURNING * INTO r; RETURN r; END $$;
        ''')
        source = (ROOT / 'supabase/migrations/20260727014500_resolved_incident_phase_plan_retry_v2.sql').read_text()
        for name in ['auto_restart_phase_plan_v2_error', 'consume_resume_authorization_and_create_request_v2']:
            match = re.search(r'create or replace function public\.' + name + r'\(.*?\n\$\$;', source, re.S | re.I)
            if not match:
                raise AssertionError('canonical function missing: ' + name)
            cls.sql(match.group(0))
        cls.sql((ROOT / 'supabase/migrations/20260907124340_fleet_atomic_request_device_lease_v1.sql').read_text())

    @classmethod
    def cleanup(cls):
        if cls.started:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cls.tmp / 'data'), '-m', 'fast', '-w', 'stop'], check=True, stdout=subprocess.DEVNULL)
        shutil.rmtree(cls.tmp)

    @classmethod
    def sql(cls, sql, check=True):
        result = subprocess.run([str(PG / 'psql'), '-X', '-h', str(cls.tmp), '-p', '55484', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', "SET statement_timeout='5s'; " + sql], text=True, capture_output=True)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result

    def setUp(self):
        self.sql('TRUNCATE auto_restart_device_locks,account_run_requests,account_assignments,ig_accounts,incident_resume_authorizations,account_incidents,account_session_resume_plans;')
        self.sql(f"""
          INSERT INTO ig_accounts VALUES('{A}');
          INSERT INTO account_assignments(account_id,device_id,status) VALUES('{A}','{D}','active');
          INSERT INTO account_incidents(id,account_id,status) VALUES('{INCIDENT}','{A}','resolved');
          INSERT INTO account_session_resume_plans(id,account_id,run_id,resume_state) VALUES('{PLAN}','{A}','{RUN}','awaiting_human_resume_authorization');
          INSERT INTO incident_resume_authorizations(id,incident_id,account_id,run_id,resume_plan_id,status,test,scheduled_window_start,scheduled_window_end)
          VALUES('{AUTH}','{INCIDENT}','{A}','{RUN}','{PLAN}','armed',false,now()-interval '1 hour',now()+interval '1 hour');
        """)
        self.metadata = json.dumps({'incident_id': INCIDENT, 'authorization_id': AUTH, 'worker_id': 'fixture-worker', 'device_lock_lease_seconds': 600, 'resume_plan': {'schema': 'AUTO_RESTART_RESUME_PLAN_V2', 'plan_version': 2, 'account_id': A, 'package_contract_ready': True, 'phase_order': ['welcome', 'follow', 'unfollow'], 'phases_to_run': {'welcome': False, 'follow': True, 'unfollow': False}, 'quota_remaining': {'follow': 20}}})

    def resume(self):
        return self.sql(f"SELECT consume_resume_authorization_and_create_request_v2('{AUTH}','fixture-worker','{D}','{self.metadata}'::jsonb);", check=False)

    def test_free_device_rejected_before_atomic_enqueue(self):
        result = self.resume()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('resume_device_lock_missing', result.stderr)
        state = self.sql("SELECT json_build_object('requests',(SELECT count(*) FROM account_run_requests),'leases',(SELECT count(*) FROM auto_restart_device_locks),'authorization',(SELECT status FROM incident_resume_authorizations));").stdout.strip().splitlines()[-1]
        self.assertEqual(json.loads(state), {'requests': 0, 'leases': 0, 'authorization': 'armed'})

    def test_existing_bound_lease_passes_resume_check_but_atomic_enqueue_refuses(self):
        self.sql(f"""
          INSERT INTO account_run_requests(id,account_id,idempotency_key,status,metadata_safe) VALUES('{RUN}','{A}','fixture-prior-request','completed','{{}}');
          INSERT INTO auto_restart_device_locks(device_id,worker_id,account_id,request_id,lease_expires_at)
          VALUES('{D}','fixture-worker','{A}','{RUN}',now()+interval '10 minutes');
        """)
        result = self.resume()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('device_lock_held', result.stderr)
        state = self.sql("SELECT json_build_object('requests',(SELECT count(*) FROM account_run_requests),'leases',(SELECT count(*) FROM auto_restart_device_locks),'authorization',(SELECT status FROM incident_resume_authorizations));").stdout.strip().splitlines()[-1]
        self.assertEqual(json.loads(state), {'requests': 1, 'leases': 1, 'authorization': 'armed'})


class HumanResumeAligned(HumanResumeAtomicBoundary):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sql('''
          ALTER TABLE incident_resume_authorizations ADD COLUMN metadata_safe jsonb DEFAULT '{}';
          ALTER TABLE account_session_resume_plans ADD COLUMN run_request_id uuid;
          ALTER TABLE account_run_requests ADD COLUMN root_business_session_id uuid;
          ALTER TABLE account_run_requests ADD COLUMN execution_attempt_no integer DEFAULT 1;
          ALTER TABLE account_run_requests ADD COLUMN retry_index integer DEFAULT 0;
          ALTER TABLE account_incidents ADD COLUMN incident_type text;
          CREATE TABLE instagram_account_restriction_holds(id uuid,account_id uuid,incident_id uuid,status text);
          CREATE SCHEMA auth;
          CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
          GRANT USAGE ON SCHEMA auth TO service_role,anon,authenticated;
        ''')
        for version, filename in [
            ('v3', '20260727160438_instagram_restriction_preflight_auto_restart_v1.sql'),
            ('v4', '20260901180552_autom_atism_resume_lineage_v1.sql'),
        ]:
            source = (ROOT / 'supabase/migrations' / filename).read_text()
            name = 'consume_resume_authorization_and_create_request_' + version
            match = re.search(r'create or replace function public\.' + name + r'\(.*?\n\$\$;', source, re.S | re.I)
            if not match:
                raise AssertionError('canonical wrapper missing: ' + name)
            cls.sql(match.group(0))
            cls.sql('REVOKE ALL ON FUNCTION ' + name + '(uuid,text,uuid,jsonb) FROM public,anon,authenticated; GRANT EXECUTE ON FUNCTION ' + name + '(uuid,text,uuid,jsonb) TO service_role;')
        cls.sql((ROOT / 'supabase/migrations/20260907133415_fleet_human_resume_atomic_alignment_v1.sql').read_text())

    def call_wrapper(self, version='v3', role='service_role', metadata=None, db_role='service_role', authorization=AUTH):
        payload = self.metadata if metadata is None else metadata
        claims = json.dumps({'role': role})
        return self.sql(f"SET ROLE {db_role}; SET request.jwt.claims='{claims}'; SELECT consume_resume_authorization_and_create_request_{version}('{authorization}','fixture-worker','{D}','{payload}'::jsonb);", check=False)

    def prepare_v4(self):
        self.sql(f"INSERT INTO account_run_requests(id,account_id,idempotency_key,status,metadata_safe,root_business_session_id) VALUES('{RUN}','{A}','fixture-source','completed','{{}}','{RUN}'); UPDATE account_session_resume_plans SET run_request_id='{RUN}' WHERE id='{PLAN}';")

    def outcome(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout.strip().splitlines()[-1])

    def assert_armed_without_new_work(self):
        state = self.sql(f"SELECT json_build_object('requests',(SELECT count(*) FROM account_run_requests WHERE id<>'{RUN}'),'leases',(SELECT count(*) FROM auto_restart_device_locks),'authorization',(SELECT status FROM incident_resume_authorizations));").stdout.strip().splitlines()[-1]
        self.assertEqual(json.loads(state), {'requests': 0, 'leases': 0, 'authorization': 'armed'})

    def test_free_device_rejected_before_atomic_enqueue(self):
        result = self.outcome(self.call_wrapper())
        binding = result['device_lock_binding']
        self.assertEqual(binding['request_id'], result['request_id'])
        self.assertEqual(binding['account_id'], A)
        self.assertEqual(binding['device_id'], D)
        state = self.sql("SELECT json_build_object('requests',(SELECT count(*) FROM account_run_requests),'leases',(SELECT count(*) FROM auto_restart_device_locks),'authorization',(SELECT status FROM incident_resume_authorizations));").stdout.strip().splitlines()[-1]
        self.assertEqual(json.loads(state), {'requests': 1, 'leases': 1, 'authorization': 'consumed'})

    def test_existing_bound_lease_passes_resume_check_but_atomic_enqueue_refuses(self):
        super().test_existing_bound_lease_passes_resume_check_but_atomic_enqueue_refuses()

    def test_role_order_and_exact_replay_v3_v4(self):
        for version in ['v3', 'v4']:
            with self.subTest(version=version):
                self.setUp()
                if version == 'v4':
                    self.prepare_v4()
                first = self.outcome(self.call_wrapper(version))
                replay = self.outcome(self.call_wrapper(version))
                self.assertTrue(replay['idempotent'])
                self.assertEqual(first['request_id'], replay['request_id'])
                self.assertEqual(first['device_lock_binding'], replay['device_lock_binding'])
                conflict = json.loads(self.metadata)
                conflict['device_lock_lease_seconds'] = 1200
                conflict = json.dumps(conflict)
                for claims_role in ['anon', 'authenticated', '']:
                    for payload in [self.metadata, conflict]:
                        denied = self.call_wrapper(version, role=claims_role, metadata=payload)
                        self.assertNotEqual(denied.returncode, 0)
                        self.assertIn('service_role_required', denied.stderr)
                        self.assertNotIn('resume_idempotency_payload_conflict', denied.stderr)
                        self.assertNotIn(first['request_id'], denied.stdout)
                        self.assertNotIn(first['device_lock_binding']['lease_id'], denied.stdout)
                        self.assertNotIn('fleet_lock_human_resume_v1', denied.stderr)
                for database_role in ['anon', 'authenticated']:
                    denied = self.call_wrapper(version, db_role=database_role)
                    self.assertNotEqual(denied.returncode, 0)
                    self.assertIn('permission denied', denied.stderr)
                wrong_payload = self.call_wrapper(version, metadata=conflict)
                self.assertNotEqual(wrong_payload.returncode, 0)
                self.assertIn('resume_idempotency_payload_conflict', wrong_payload.stderr)

    def test_authorization_failure_precedes_missing_receipt(self):
        for version in ['v3', 'v4']:
            denied = self.call_wrapper(version, role='anon', authorization=RUN)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn('service_role_required', denied.stderr)
            self.assertNotIn('resume_authorization_missing', denied.stderr)

    def test_expiration_preserves_armed_authorization(self):
        self.sql("UPDATE incident_resume_authorizations SET scheduled_window_end=now()-interval '1 minute';")
        result = self.call_wrapper()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('resume_authorization_expired', result.stderr)
        self.assert_armed_without_new_work()

    def test_insert_failure_rolls_back_authorization(self):
        self.sql("ALTER TABLE account_run_requests ADD CONSTRAINT fixture_request_failure CHECK(false) NOT VALID;")
        try:
            result = self.call_wrapper()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('fixture_request_failure', result.stderr)
            self.assert_armed_without_new_work()
        finally:
            self.sql('ALTER TABLE account_run_requests DROP CONSTRAINT fixture_request_failure;')

    def test_lease_failure_rolls_back_request_and_authorization(self):
        self.sql("ALTER TABLE auto_restart_device_locks ADD CONSTRAINT fixture_lease_failure CHECK(false) NOT VALID;")
        try:
            result = self.call_wrapper()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('fixture_lease_failure', result.stderr)
            self.assert_armed_without_new_work()
        finally:
            self.sql('ALTER TABLE auto_restart_device_locks DROP CONSTRAINT fixture_lease_failure;')


if __name__ == '__main__':
    unittest.main(verbosity=2)
