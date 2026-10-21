"""Impacted admission/recovery and resume coexistence, local PostgreSQL only."""
import json
from pathlib import Path
import runpy
import unittest

ROOT=Path(__file__).resolve().parents[1]
base=runpy.run_path(str(ROOT/'tests/fleet-device-lock-callers-v1.py'))
C=base['CanonicalAdmissionRecoveryTests']
human=runpy.run_path(str(ROOT/'tests/fleet-human-resume-atomic-boundary-v1.py'))
H=human['HumanResumeAligned']


class AdmissionCompatibility(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.addClassCleanup(C.doClassCleanups)
        C.setUpClass()

    def setUp(self):
        self.t=C('test_real_admission_and_device_gate_reject_old_token')
        self.t.setUp()

    def test_new_admission_and_device_gate(self):
        self.t.test_real_admission_and_device_gate_reject_old_token()

    def test_new_recovery_and_exact_replay(self):
        self.t.test_real_recovery_rotates_and_exact_replay_is_non_mutating()

    def test_old_named_admission_and_device_gate_without_token(self):
        b,args=self.t.prepared_binding()
        args.pop('p_expected_lease_id')
        admitted=self.t.sql_rpc('admit_account_run_attempt_v1',args)
        self.assertTrue(admitted['ok'],admitted)
        result=self.t.sql_rpc('begin_device_activity_v1',dict(p_run_id=admitted['run_id'],
            p_request_id=b['request_id'],p_worker_id=b['worker_id']))
        self.assertTrue(result['ok'],result)

    def test_old_zero_work_recovery_without_token(self):
        b,args=self.t.stopped_source()
        args.pop('p_expected_lease_id')
        result=self.t.sql_rpc('certify_zero_work_and_enqueue_recovery_v1',args)
        self.assertTrue(result['ok'],result)


class HumanCompatibility(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.addClassCleanup(H.doClassCleanups)
        H.setUpClass()
        H.sql('alter table auto_restart_device_locks add column run_id uuid;')

    def setUp(self):
        self.t=H('test_role_order_and_exact_replay_v3_v4')
        self.t.setUp()

    def test_new_resume_and_exact_retry(self):
        self.t.test_role_order_and_exact_replay_v3_v4()

    def test_old_resume_prelease_and_exact_retry(self):
        a,d=human['A'],human['D']
        H.sql(f"insert into auto_restart_device_locks(device_id,worker_id,account_id,lease_expires_at) values('{d}','fixture-worker','{a}',now()+interval '10 minutes');")
        lease=H.sql('select lease_id from auto_restart_device_locks;').stdout.strip().splitlines()[-1]
        first=self.t.outcome(self.t.call_wrapper('v3'))
        self.assertEqual(first['device_lock_binding']['lease_id'],lease)
        retry=self.t.outcome(self.t.call_wrapper('v3'))
        self.assertTrue(retry['idempotent'])
        self.assertEqual(first['request_id'],retry['request_id'])


def load_tests(loader, tests, pattern):
    # Imported fixture classes also inherit TestCase; exclude their unrelated
    # historical suites and Phase B expectations from this scoped matrix.
    return unittest.TestSuite(loader.loadTestsFromTestCase(c)
        for c in (AdmissionCompatibility,HumanCompatibility))


if __name__=='__main__': unittest.main(verbosity=2)
