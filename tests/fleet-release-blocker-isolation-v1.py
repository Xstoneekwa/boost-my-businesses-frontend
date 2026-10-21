"""Real Hold/Release RPC composed with unchanged canonical SQL blockers."""
import json
import pathlib
import re
import runpy
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = runpy.run_path(str(ROOT / 'tests/fleet-prospective-hold-participation-v1.py'))


class ReleaseBlockerIsolation(FIXTURE['ProspectiveHold']):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.db.sql("""
          CREATE TABLE account_incidents(id uuid PRIMARY KEY,account_id uuid,incident_type text,
            reason text,failure_reason text,severity text,metadata jsonb DEFAULT '{}',status text,
            archived_at timestamptz,resolved_at timestamptz,created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now());
          CREATE TABLE account_dashboard_actions(id uuid PRIMARY KEY,account_id uuid,incident_id uuid,
            action_type text,blocking_campaign boolean,status text,created_at timestamptz,updated_at timestamptz);
          ALTER TABLE client_instagram_accounts ADD COLUMN id uuid DEFAULT gen_random_uuid(),
            ADD COLUMN active boolean DEFAULT true, ADD COLUMN login_identity_proof_status text,
            ADD COLUMN login_status text, ADD COLUMN provisioning_status text;
        """)
        for filename, name in [
            ('20260901104203_canonical_operational_blocker_v1.sql','canonical_active_blocking_incidents_v1'),
            ('20260901175903_incident_dashboard_action_effective_blocker_v1.sql','canonical_active_operational_blockers_v1'),
            ('20260810111500_login_identity_readiness_gate_v1.sql','evaluate_login_identity_gate_v1'),
        ]:
            source = (ROOT / 'supabase/migrations' / filename).read_text()
            matches = list(re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+public\.' + name + r'\s*\(.*?\bas\s+\$(\w*)\$.*?\$\1\$\s*;',source,re.I|re.S))
            if len(matches) != 1:
                raise AssertionError('canonical blocker missing or ambiguous: ' + name)
            cls.db.sql(matches[0].group(0))

    def release_idle(self):
        self.decoded('hold', None)
        release = self.decoded('release', 1)
        self.assertEqual(release['current_policy']['hold_state'], 'CLEARED')

    def test_release_independent_incident_preserved(self):
        incident = str(uuid.uuid4())
        self.db.sql(f"INSERT INTO account_incidents(id,account_id,incident_type,severity,status,reason) VALUES('{incident}','{self.account}','instagram_account_restriction','critical','open','independent_restriction');")
        snapshot = f"SELECT to_jsonb(i) FROM account_incidents i WHERE id='{incident}';"
        before = self.scalar(snapshot)
        query = f"SELECT source_id FROM canonical_active_operational_blockers_v1(ARRAY['{self.account}'::uuid]);"
        self.assertEqual(self.scalar(query), incident)
        self.release_idle()
        self.assertEqual(self.scalar(snapshot), before)
        self.assertEqual(self.scalar(query), incident)

    def test_release_identity_guard_preserved(self):
        self.db.sql(f"UPDATE client_instagram_accounts SET login_status='connected',provisioning_status='ready',login_identity_proof_status='failed' WHERE account_id='{self.account}';")
        snapshot = f"SELECT to_jsonb(c) FROM client_instagram_accounts c WHERE account_id='{self.account}';"
        before = self.scalar(snapshot)
        query = f"SELECT evaluate_login_identity_gate_v1('{self.account}');"
        original = json.loads(self.scalar(query))
        self.assertFalse(original['ok'])
        self.assertEqual(original['reason'], 'login_identity_not_verified')
        self.release_idle()
        self.assertEqual(self.scalar(snapshot), before)
        self.assertEqual(json.loads(self.scalar(query)), original)


if __name__ == '__main__':
    suite = unittest.TestSuite(ReleaseBlockerIsolation(name) for name in (
        'test_release_independent_incident_preserved', 'test_release_identity_guard_preserved'))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
