"""A/B evidence at the historical device-availability boundary, Fleet absent.

The historical database alone uses the pre-atomic nullable-request schema.
Candidate constraints remain enabled. This is not process-quiescence proof.
"""
import importlib.util
import json
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fleet_boundary_fixture', ROOT / 'tests/fleet-human-resume-atomic-boundary-v1.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class ExpiredTerminalLeaseParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.harness = fixture.HumanResumeAtomicBoundary
        cls.addClassCleanup(cls.harness.doClassCleanups)
        cls.harness.setUpClass()
        cls.harness.sql('ALTER TABLE auto_restart_device_locks ADD COLUMN run_id uuid;')
        subprocess.run([str(fixture.PG / 'createdb'), '-h', str(cls.harness.tmp), '-p', '55484', '-T', 'postgres', 'fleet_historical'], check=True, capture_output=True, text=True)
        cls.query('fleet_historical', 'ALTER TABLE auto_restart_device_locks DROP CONSTRAINT fleet_device_lease_request_required_v1;')
        cls.query('fleet_historical', (ROOT / 'supabase/migrations/20260722194000_auto_restart_recycle_terminal_request_device_locks.sql').read_text())

    @classmethod
    def query(cls, database, sql, check=True):
        result = subprocess.run([str(fixture.PG / 'psql'), '-X', '-h', str(cls.harness.tmp), '-p', '55484', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', "SET statement_timeout='5s'; " + sql], capture_output=True, text=True)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result

    def seed(self, status, expiry):
        for database in ['postgres', 'fleet_historical']:
            self.query(database, f"""
              TRUNCATE auto_restart_device_locks,account_run_requests,account_assignments,ig_accounts;
              INSERT INTO ig_accounts VALUES('{fixture.A}');
              INSERT INTO account_assignments(account_id,device_id,status) VALUES('{fixture.A}','{fixture.D}','active');
              INSERT INTO account_run_requests(id,account_id,idempotency_key,status,metadata_safe)
              VALUES('{fixture.RUN}','{fixture.A}','fixture-prior-request','{status}','{{}}');
              INSERT INTO auto_restart_device_locks(device_id,worker_id,account_id,request_id,lease_expires_at)
              VALUES('{fixture.D}','prior-dispatcher','{fixture.A}','{fixture.RUN}',now()+interval '{expiry}');
            """)

    def old_acquire(self):
        result = self.query('fleet_historical', f"SELECT auto_restart_acquire_device_lock('{fixture.D}','next-dispatcher','{fixture.A}',NULL,600,'auto_restart','worker','executing');")
        return json.loads(result.stdout.strip().splitlines()[-1])

    def new_enqueue(self):
        return self.query('postgres', f"SELECT to_jsonb(create_account_run_request(p_account_id=>'{fixture.A}',p_actor_type=>'system',p_source_surface=>'auto_restart_tick',p_idempotency_key=>'fixture-next-request',p_metadata_safe=>'{{\"worker_id\":\"next-dispatcher\",\"device_lock_lease_seconds\":600}}'));", check=False)

    def test_expired_terminal_reclamation_diverges(self):
        self.seed('completed', '-1 minute')
        old = self.old_acquire()
        self.assertTrue(old['acquired'])
        candidate = self.new_enqueue()
        self.assertNotEqual(candidate.returncode, 0)
        self.assertIn('device_lock_held', candidate.stderr)
        state = self.query('postgres', "SELECT json_build_object('requests',(SELECT count(*) FROM account_run_requests),'leases',(SELECT count(*) FROM auto_restart_device_locks),'owner',(SELECT worker_id FROM auto_restart_device_locks));")
        self.assertEqual(json.loads(state.stdout.strip().splitlines()[-1]), {'requests': 1, 'leases': 1, 'owner': 'prior-dispatcher'})

    def test_expired_active_request_remains_protected(self):
        self.seed('running', '-1 minute')
        self.assertFalse(self.old_acquire()['acquired'])
        candidate = self.new_enqueue()
        self.assertNotEqual(candidate.returncode, 0)
        self.assertIn('device_lock_held', candidate.stderr)

    def test_unexpired_terminal_lease_remains_protected(self):
        self.seed('completed', '10 minutes')
        self.assertFalse(self.old_acquire()['acquired'])
        candidate = self.new_enqueue()
        self.assertNotEqual(candidate.returncode, 0)
        self.assertIn('device_lock_held', candidate.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
