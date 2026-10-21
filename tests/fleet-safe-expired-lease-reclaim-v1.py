"""Real canonical receipt predicate + atomic enqueue in isolated PostgreSQL.

Receipt rows are representative persisted fixtures, not new runtime evidence.
"""
import concurrent.futures
import importlib.util
import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('resume_fixture', ROOT / 'tests/fleet-human-resume-atomic-boundary-v1.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
ATTEMPT = '70000000-0000-0000-0000-000000000001'
LEASE = '80000000-0000-0000-0000-000000000001'


class SafeReclaim(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = f.HumanResumeAligned
        cls.addClassCleanup(cls.h.doClassCleanups)
        cls.h.setUpClass()
        cls.h.sql('ALTER TABLE account_run_requests ADD COLUMN run_id uuid, ADD COLUMN claimed_by text; ALTER TABLE auto_restart_device_locks ADD COLUMN run_id uuid; CREATE TABLE ig_runs(id uuid PRIMARY KEY,account_id uuid,status text);')
        source = (ROOT / 'supabase/migrations/20260906171034_fleet_admission_authority_v1.sql').read_text()
        for name in ['fleet_runtime_owners_v1', 'fleet_terminal_receipts_v1']:
            match = re.search(r'create table public\.' + name + r' \(.*?\n\);', source, re.S)
            if not match:
                raise AssertionError('canonical schema missing: ' + name)
            cls.h.sql(match.group(0))
            cls.h.sql('ALTER TABLE '+name+' ENABLE ROW LEVEL SECURITY; REVOKE ALL ON '+name+' FROM public,anon,authenticated,service_role; GRANT SELECT ON '+name+' TO service_role;')
        match = re.search(r'create function public\.fleet_terminal_receipt_valid_v1\(.*?\n\$\$;', source, re.S)
        if not match:
            raise AssertionError('canonical receipt validator missing')
        cls.h.sql(match.group(0))
        cls.h.sql((ROOT / 'supabase/migrations/20260907135729_fleet_safe_expired_lease_reclaim_v1.sql').read_text())

    def setUp(self):
        self.h.sql('TRUNCATE fleet_terminal_receipts_v1,fleet_runtime_owners_v1,ig_runs,auto_restart_device_locks,account_run_requests,account_assignments,ig_accounts,incident_resume_authorizations,account_incidents,account_session_resume_plans;')
        self.t = self.h('test_free_device_rejected_before_atomic_enqueue')
        # Seed the same canonical authorization inputs without changing guards.
        self.h.sql(f"""
          INSERT INTO ig_accounts VALUES('{f.A}');
          INSERT INTO account_assignments(account_id,device_id,status) VALUES('{f.A}','{f.D}','active');
          INSERT INTO account_incidents(id,account_id,status) VALUES('{f.INCIDENT}','{f.A}','resolved');
          INSERT INTO account_session_resume_plans(id,account_id,run_id,resume_state) VALUES('{f.PLAN}','{f.A}','{f.RUN}','awaiting_human_resume_authorization');
          INSERT INTO incident_resume_authorizations(id,incident_id,account_id,run_id,resume_plan_id,status,test,scheduled_window_start,scheduled_window_end)
          VALUES('{f.AUTH}','{f.INCIDENT}','{f.A}','{f.RUN}','{f.PLAN}','armed',false,now()-interval '1 hour',now()+interval '1 hour');
        """)
        self.t.metadata = json.dumps({'incident_id':f.INCIDENT,'authorization_id':f.AUTH,'worker_id':'fixture-worker','device_lock_lease_seconds':600,'resume_plan':{'schema':'AUTO_RESTART_RESUME_PLAN_V2','plan_version':2,'account_id':f.A,'package_contract_ready':True,'phase_order':['welcome','follow','unfollow'],'phases_to_run':{'follow':True},'quota_remaining':{'follow':20}}})
        binding = {'lease_id':LEASE,'generation':LEASE,'device_id':f.D,'account_id':f.A,'request_id':f.RUN,'worker_id':'old-owner'}
        self.h.sql(f"""
          INSERT INTO ig_runs VALUES('{ATTEMPT}','{f.A}','stopped');
          INSERT INTO account_run_requests(id,account_id,status,idempotency_key,metadata_safe,run_id,claimed_by)
          VALUES('{f.RUN}','{f.A}','canceled','old-request','{json.dumps({'device_lock_binding':binding})}','{ATTEMPT}','old-owner');
          INSERT INTO auto_restart_device_locks(device_id,account_id,request_id,run_id,worker_id,lease_id,lease_expires_at,owner_kind)
          VALUES('{f.D}','{f.A}','{f.RUN}','{ATTEMPT}','old-owner','{LEASE}',now()-interval '1 minute','worker');
        """)

    def proof(self):
        b = {'account_id':f.A,'request_id':f.RUN,'attempt_id':ATTEMPT,'consumer_instance_id':'old-owner','consumer_boot_id':'boot-old'}
        receipt = dict(b, termination_source='fleet_control',termination_reason='fleet_hold')
        evidence = dict(b,process_generation='process-old',terminal_state='stopped',process_group_absent=True,termination_source='fleet_control')
        self.h.sql(f"""
          INSERT INTO fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,registered_revision,terminal_reconciled,process_group_absent,isolation_version,process_generation)
          VALUES('{f.A}','old-owner','boot-old','{f.RUN}','{ATTEMPT}',1,true,true,'isolated_process_group_v1','process-old');
          INSERT INTO fleet_terminal_receipts_v1 VALUES('{f.A}','old-owner','boot-old','{f.RUN}','{ATTEMPT}','process-old','stopped','{json.dumps(receipt)}','{json.dumps(evidence)}',encode(sha256(convert_to(('{json.dumps(evidence)}'::jsonb)::text,'UTF8')),'hex'));
        """)

    def enqueue(self, key='new-request'):
        return self.h.sql(f"SELECT to_jsonb(create_account_run_request(p_account_id=>'{f.A}',p_source_surface=>'auto_restart_tick',p_idempotency_key=>'{key}',p_metadata_safe=>'{{\"worker_id\":\"new-owner\",\"device_lock_lease_seconds\":600}}'));",check=False)

    def blocked(self):
        result = self.enqueue()
        self.assertNotEqual(result.returncode,0)
        self.assertIn('device_lock_held',result.stderr)
        self.assertEqual(self.h.sql('SELECT lease_id FROM auto_restart_device_locks;').stdout.strip().splitlines()[-1],LEASE)

    def test_no_receipt_terminal_alone_blocked(self):
        self.blocked()

    def test_fleet_off_valid_proof_creates_new_generation(self):
        self.proof()
        self.assertEqual(self.h.sql("SELECT to_regclass('public.fleet_account_policy_v1') IS NULL;").stdout.strip().splitlines()[-1],'t')
        result = self.enqueue()
        self.assertEqual(result.returncode,0,result.stderr)
        row = json.loads(result.stdout.strip().splitlines()[-1])
        b = row['metadata_safe']['device_lock_binding']
        self.assertNotEqual(b['lease_id'],LEASE)
        self.assertEqual(b['generation'],b['lease_id'])
        self.assertEqual(b['request_id'],row['id'])

    def test_live_request_blocked_even_if_expired(self):
        self.proof()
        self.h.sql("UPDATE account_run_requests SET status='running';")
        self.blocked()

    def test_unexpired_terminal_blocked(self):
        self.proof()
        self.h.sql("UPDATE auto_restart_device_locks SET lease_expires_at=now()+interval '10 minutes';")
        self.blocked()

    def test_unresolved_group_blocked(self):
        self.proof()
        self.h.sql('UPDATE fleet_runtime_owners_v1 SET process_group_absent=false;')
        self.blocked()

    def test_retired_owner_blocked(self):
        self.proof()
        self.h.sql('UPDATE fleet_runtime_owners_v1 SET retired=true;')
        self.blocked()

    def test_misbound_lease_generation_blocked(self):
        self.proof()
        self.h.sql("UPDATE auto_restart_device_locks SET lease_id=gen_random_uuid();")
        result = self.enqueue()
        self.assertNotEqual(result.returncode,0)
        self.assertIn('device_lock_held',result.stderr)

    def test_enqueue_failure_restores_old_lease(self):
        self.proof()
        self.h.sql(f"ALTER TABLE account_run_requests ADD CONSTRAINT fixture_after_reclaim_failure CHECK(id='{f.RUN}') NOT VALID;")
        try:
            result = self.enqueue()
            self.assertNotEqual(result.returncode,0)
            self.assertIn('fixture_after_reclaim_failure',result.stderr)
            self.assertEqual(self.h.sql('SELECT lease_id FROM auto_restart_device_locks;').stdout.strip().splitlines()[-1],LEASE)
        finally:
            self.h.sql('ALTER TABLE account_run_requests DROP CONSTRAINT fixture_after_reclaim_failure;')

    def test_two_contenders_one_winner(self):
        self.proof()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(self.enqueue,['contender-a','contender-b']))
        self.assertEqual(sum(r.returncode==0 for r in results),1,[r.stderr for r in results])
        self.assertTrue(all(not r.returncode or 'device_lock_held' in r.stderr for r in results))
        self.assertTrue(all('deadlock detected' not in r.stderr for r in results))

    def test_human_resume_consumption_composes_with_reclaim(self):
        self.proof()
        result=self.t.call_wrapper()
        self.assertEqual(result.returncode,0,result.stderr)
        row=json.loads(result.stdout.strip().splitlines()[-1])
        self.assertNotEqual(row['device_lock_binding']['lease_id'],LEASE)
        self.assertEqual(row['device_lock_binding']['request_id'],row['request_id'])
        self.assertEqual(self.h.sql('SELECT status FROM incident_resume_authorizations;').stdout.strip().splitlines()[-1],'consumed')


if __name__ == '__main__':
    unittest.main(verbosity=2)
