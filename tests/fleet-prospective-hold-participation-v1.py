"""Prospective Hold epochs: real mutation RPC, guards and immutable SQL evidence."""
import json
import pathlib
import runpy
import uuid
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = runpy.run_path(str(ROOT / "tests/fleet-hold-enqueue-serialization-v1.py"))


class ProspectiveHold(FIXTURE["HoldEnqueueRace"]):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.legacy = tuple(str(uuid.uuid4()) for _ in range(3))
        account, tenant, actor = cls.legacy
        cls.db.sql(f"""
          INSERT INTO ig_accounts VALUES('{account}');
          INSERT INTO client_instagram_accounts(account_id,client_id) VALUES('{account}','{tenant}');
          INSERT INTO tenant_users(user_id,tenant_id,role) VALUES('{actor}','{tenant}','superadmin');
          INSERT INTO fleet_account_policy_v1(account_id,client_id,revision,hold_state,policy_payload)
            VALUES('{account}','{tenant}',1,'REQUESTED','{{}}');
        """)
        cls.db.sql((ROOT / "supabase/migrations/20260907205851_fleet_prospective_hold_participation_v1.sql").read_text())

    def decoded(self, action, revision, **extra):
        r = self.mutation(self.mutation_sql(action, revision, str(uuid.uuid4()), **extra))
        return json.loads(r.stdout.strip().splitlines()[-1])

    def proof(self, revision):
        return json.loads(self.scalar(f"SELECT to_jsonb(p) FROM fleet_hold_participation_v1 p WHERE account_id='{self.account}' AND revision={revision};"))

    def race(self, hold_first, iteration):
        super().race(hold_first, iteration)
        expected = 'NO_EXECUTION_PARTICIPATED' if hold_first else 'EXECUTION_PARTICIPATED'
        self.assertEqual(self.proof(1)['classification'], expected)

    def test_fresh_idle_release_current_state_and_no_synthetic_ack(self):
        hold = self.decoded('hold', None)
        self.assertEqual(hold['current_policy']['hold_state'], 'REQUESTED')
        self.assertEqual(self.proof(1)['classification'], 'NO_EXECUTION_PARTICIPATED')
        release_sql = self.mutation_sql('release', 1, str(uuid.uuid4()))
        released = json.loads(self.mutation(release_sql).stdout.strip().splitlines()[-1])
        self.assertEqual(released['current_policy']['hold_state'], 'CLEARED')
        self.assertEqual(released['current_policy']['revision'], 2)
        self.assertEqual(released['receipt']['after'], released['current_policy'])
        retry = json.loads(self.mutation(release_sql).stdout.strip().splitlines()[-1])
        self.assertTrue(retry['replayed'])
        self.assertEqual(released['receipt'], retry['receipt'])
        self.assertEqual(self.scalar(f"SELECT count(*) FROM fleet_runtime_acks_v1 WHERE account_id='{self.account}';"), '0')
        self.assertEqual(self.scalar(f"SELECT count(*) FROM fleet_runtime_owners_v1 WHERE account_id='{self.account}';"), '0')

    def test_cap_revision_carries_origin_without_promoting_hold_active(self):
        self.decoded('hold', None)
        capped = self.decoded('set_cap', 1, cap=60)
        self.assertEqual(capped['current_policy']['hold_state'], 'REQUESTED')
        self.assertEqual(capped['current_policy']['revision'], 2)
        self.assertEqual(self.proof(2)['epoch_revision'], 1)
        self.assertEqual(self.proof(2)['evidence']['origin_sha256'], self.proof(1)['evidence_sha256'])
        self.assertEqual(self.decoded('release', 2)['current_policy']['hold_state'], 'CLEARED')

    def test_existing_execution_cannot_use_idle_release(self):
        self.db.sql(self.enqueue_sql('participating-' + self.account))
        self.decoded('hold', None)
        self.assertEqual(self.proof(1)['classification'], 'EXECUTION_PARTICIPATED')
        release = self.decoded('release', 1)
        self.assertEqual(release['current_policy']['hold_state'], 'RELEASING')
        self.assertEqual(self.scalar(f"SELECT fleet_idle_release_proven_v1('{self.account}',2);"), 'f')
        self.assertEqual(self.scalar(f"SELECT count(*) FROM fleet_runtime_acks_v1 WHERE account_id='{self.account}';"), '0')

    def test_legacy_empty_epoch_is_unknown_not_backfilled(self):
        self.account, self.tenant, self.actor = self.legacy
        self.assertEqual(self.scalar(f"SELECT count(*) FROM fleet_hold_participation_v1 WHERE account_id='{self.account}';"), '0')
        release = self.decoded('release', 1)
        self.assertEqual(release['current_policy']['hold_state'], 'RELEASING')
        self.assertEqual(self.proof(2)['classification'], 'UNKNOWN')

    def test_proof_immutable_and_not_caller_writable(self):
        self.decoded('hold', None)
        for sql in [
            f"UPDATE fleet_hold_participation_v1 SET classification='UNKNOWN' WHERE account_id='{self.account}';",
            f"DELETE FROM fleet_hold_participation_v1 WHERE account_id='{self.account}';",
        ]:
            r = self.db.sql(sql, check=False)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('fleet_hold_participation_immutable', r.stderr)
        r = self.mutation(f"SELECT * FROM fleet_hold_participation_v1 WHERE account_id='{self.account}';", check=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('permission denied', r.stderr)

    def test_proof_failure_rolls_back_policy_and_audit(self):
        self.db.sql(f"ALTER TABLE fleet_hold_participation_v1 ADD CONSTRAINT proof_failure CHECK(account_id<>'{self.account}'::uuid) NOT VALID;")
        try:
            r = self.mutation(self.hold_sql(), check=False)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('proof_failure', r.stderr)
            self.assertEqual(self.scalar(f"SELECT count(*) FROM fleet_account_policy_v1 WHERE account_id='{self.account}';"), '0')
            self.assertEqual(self.scalar(f"SELECT count(*) FROM ig_action_logs WHERE account_id='{self.account}';"), '0')
        finally:
            self.db.sql('ALTER TABLE fleet_hold_participation_v1 DROP CONSTRAINT proof_failure;')

    def test_later_execution_cannot_be_erased_from_epoch(self):
        self.db.sql(self.enqueue_sql('participating-' + self.account))
        self.decoded('hold', None)
        # Fixture cleanup cannot turn the durable original participation into idle.
        self.db.sql(f"DELETE FROM auto_restart_device_locks WHERE account_id='{self.account}'; DELETE FROM account_run_requests WHERE account_id='{self.account}';")
        self.assertEqual(self.decoded('release', 1)['current_policy']['hold_state'], 'RELEASING')
        self.assertEqual(self.proof(2)['classification'], 'EXECUTION_PARTICIPATED')

    def test_new_epoch_after_idle_release_has_new_origin(self):
        self.decoded('hold', None)
        self.decoded('release', 1)
        self.decoded('hold', 2)
        self.assertEqual(self.proof(3)['epoch_revision'], 3)
        self.assertNotEqual(self.proof(1)['evidence_sha256'], self.proof(3)['evidence_sha256'])
        self.assertEqual(self.decoded('release', 3)['current_policy']['hold_state'], 'CLEARED')


if __name__ == '__main__':
    unittest.main(verbosity=2)
