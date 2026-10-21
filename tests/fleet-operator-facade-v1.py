"""Disposable PG17 qualification: real Fleet SQL, explicit package/account fixtures.

Only local socket connections. Setup runs as database owner; operator RPCs run
as service_role and enforce the actual superadmin guard. No production access.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
PG = Path('/opt/homebrew/opt/postgresql@17/bin')
ADMIN = 'fa000000-0000-4000-8000-000000000001'
TENANT = 'fa000000-0000-4000-8000-000000000002'
DEVICE = 'fa000000-0000-4000-8000-000000000003'


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


class OperatorFacade(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = Path(tempfile.mkdtemp(prefix='fleet-operator-', dir='/private/tmp')).resolve()
        subprocess.run([str(PG / 'initdb'), '-D', str(cls.temp / 'data'), '--auth=trust', '--no-locale', '-E', 'UTF8'], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cls.temp / 'data'), '-l', str(cls.temp / 'postgres.log'), '-o', f"-F -k {cls.temp} -h '' -p 55487", '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
        cls.addClassCleanup(cls.cleanup)
        # Reuse the established admission fixture without collecting its tests.
        source = (ROOT / 'tests/fleet-local-postgres-v1.sh').read_text()
        match = re.search(r"<<\s*['\"]?SQL['\"]?\n(.*?)\nSQL", source, re.S)
        if not match:
            raise AssertionError('canonical_local_fixture_heredoc_not_found')
        cls.sql(match.group(1))
        cls.migrate('20260906171034_fleet_admission_authority_v1.sql')
        cls.sql('''
          create table public.tenant_users(user_id uuid,tenant_id uuid,role text);
          create table public.ig_action_logs(account_id uuid,run_id uuid,target_username text,
            action_type text,status text,message text,payload jsonb,created_at timestamptz default now());
          alter table public.ig_accounts add column username text;
          alter table public.ig_accounts add column lifecycle_status text default 'active';
          create table public.fixture_package_contract(account_id uuid primary key,contract jsonb);
          create function public.account_package_runtime_contract_status(uuid) returns jsonb
            language sql stable as $$select contract from public.fixture_package_contract where account_id=$1$$;
          create table public.ig_account_settings(account_id uuid primary key,max_actions_per_day integer);
          create table public.account_package_summary(account_id uuid primary key,effective_caps_preview jsonb,package_caps jsonb);
        ''')
        cls.sql(f"insert into public.tenant_users values('{ADMIN}','{TENANT}','superadmin')")
        cap_source = (ROOT / 'supabase/migrations/20260804195414_follow60_canonical_effective_follow_limit_v1.sql').read_text()
        cap = re.search(r'create(?: or replace)? function public\.resolve_authoritative_follow_day_limit_v1\(.*?\$function\$;', cap_source, re.S | re.I)
        if not cap:
            raise AssertionError('canonical_cap_resolver_not_found')
        cls.sql(cap.group(0))
        cls.migrate('20260907193846_fleet_policy_mutation_caller_v1.sql')
        cls.migrate('20260907233046_fleet_operator_facade_v1.sql')

    @classmethod
    def cleanup(cls):
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cls.temp / 'data'), '-m', 'immediate', '-w', 'stop'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if cls.temp.parent == Path('/private/tmp') and cls.temp.name.startswith('fleet-operator-'):
            shutil.rmtree(cls.temp)

    @classmethod
    def sql(cls, query, check=True):
        result = subprocess.run([str(PG / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(cls.temp), '-p', '55487', '-d', 'postgres'], input=query, text=True, capture_output=True)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip() if check else result

    @classmethod
    def migrate(cls, filename):
        cls.sql((ROOT / 'supabase/migrations' / filename).read_text())

    def account(self, package='pro', normal=120, configured=None, lifecycle='active', bound=True):
        account = str(uuid.uuid4())
        contract = {'ok': True, 'reason': 'ready', 'commercial_package_code': package, 'assignment': {'device_id': DEVICE}}
        self.sql(f"""insert into ig_accounts(id,username,lifecycle_status) values('{account}','fixture-{account[:8]}',{literal(lifecycle)});
          insert into fixture_package_contract values('{account}',{literal(json.dumps(contract))}::jsonb);
          insert into ig_account_settings values('{account}',{normal if configured is None else configured});
          insert into account_package_summary values('{account}','{{"follow_day":{normal}}}','{{"follow_day":{normal}}}');""")
        if bound:
            self.sql(f"insert into client_instagram_accounts values('{account}','{TENANT}')")
        return account

    def rpc(self, name, payload, role='service_role', actor=ADMIN, check=True):
        self.assertIn(role, ['service_role', 'anon', 'authenticated'])
        result = self.sql(f"begin; set local role {role}; select public.fleet_operator_{name}_v1('{actor}',{literal(json.dumps(payload))}::jsonb); commit;", check=check)
        return json.loads(result) if check else result

    def change(self, accounts, operation='HOLD', cap=None):
        result = {'operation': operation, 'scope': {'kind': 'SELECTED_ACCOUNTS', 'account_ids': accounts}}
        if cap is not None:
            result['cap'] = cap
        return result

    def apply(self, change, preview=None, bulk=None, check=True):
        preview = preview or self.rpc('preview', change)
        payload = {'bulk_action_id': bulk or str(uuid.uuid4()), 'preview_hash': preview['preview_hash'], 'change': change}
        return self.rpc('apply', payload, check=check), payload

    def test_01_read_all(self):
        a = self.account()
        rows = self.rpc('targets', {'kind': 'ALL'})
        self.assertIn(a, [r['account_id'] for r in rows])

    def test_02_plan_scopes(self):
        for plan in ['growth', 'pro', 'premium']:
            with self.subTest(plan=plan):
                a = self.account(package=plan)
                rows = self.rpc('targets', {'kind': plan.upper()})
                self.assertIn(a, [r['account_id'] for r in rows])
                self.assertTrue(all(r['package'] == plan for r in rows))

    def test_03_device_scope(self):
        a = self.account()
        rows = self.rpc('targets', {'kind': 'DEVICE', 'device_id': DEVICE})
        self.assertIn(a, [r['account_id'] for r in rows])

    def test_04_selected_exact(self):
        a = self.account()
        self.account()
        self.assertEqual([r['account_id'] for r in self.rpc('targets', {'kind': 'SELECTED_ACCOUNTS', 'account_ids': [a]})], [a])

    def test_05_canonical_lower_cap(self):
        a = self.account(configured=20)
        preview = self.rpc('preview', self.change([a], 'SET_CAP', 60))
        self.assertEqual(preview['targets'][0]['normal_effective_cap'], 20)
        self.assertEqual(preview['targets'][0]['proposed_effective_cap'], 20)

    def test_06_preview_readonly(self):
        a = self.account()
        before = self.sql('select count(*) from fleet_account_policy_v1; select count(*) from ig_action_logs')
        p = self.rpc('preview', self.change([a]))
        self.assertEqual(p['targets'][0]['classification'], 'WILL_CHANGE')
        self.assertEqual(before, self.sql('select count(*) from fleet_account_policy_v1; select count(*) from ig_action_logs'))

    def test_07_release_preview(self):
        a = self.account()
        self.assertEqual(self.rpc('preview', self.change([a], 'RELEASE'))['targets'][0]['classification'], 'NO_CHANGE')

    def test_08_clear_preview(self):
        a = self.account()
        self.assertEqual(self.rpc('preview', self.change([a], 'CLEAR_CAP'))['targets'][0]['classification'], 'NO_CHANGE')

    def test_09_ambiguous_fail_closed(self):
        a = self.account(bound=False)
        p = self.rpc('preview', self.change([a]))
        self.assertEqual(p['targets'][0]['classification'], 'AMBIGUOUS')
        result, _ = self.apply(self.change([a]), p)
        self.assertEqual(result['receipt']['outcomes'][0]['result'], 'BLOCKED')
        self.assertEqual(self.sql(f"select count(*) from fleet_account_policy_v1 where account_id='{a}'"), '0')

    def test_10_inactive_skipped(self):
        a = self.account(lifecycle='archived')
        self.assertEqual(self.rpc('preview', self.change([a]))['targets'][0]['classification'], 'SKIPPED')

    def test_11_hold_apply(self):
        a = self.account()
        result, _ = self.apply(self.change([a]))
        self.assertEqual(result['receipt']['outcomes'][0]['state'], 'REQUESTED')

    def test_12_release_apply(self):
        a = self.account()
        self.apply(self.change([a]))
        result, _ = self.apply(self.change([a], 'RELEASE'))
        self.assertEqual(result['receipt']['outcomes'][0]['state'], 'RELEASING')

    def test_13_cap_apply_clear(self):
        a = self.account()
        self.apply(self.change([a], 'SET_CAP', 60))
        scope = self.change([a])['scope']
        self.assertEqual(self.rpc('targets', scope)[0]['resulting_effective_cap'], 60)
        self.apply(self.change([a], 'CLEAR_CAP'))
        self.assertEqual(self.rpc('targets', scope)[0]['resulting_effective_cap'], 120)

    def test_14_exact_replay(self):
        a = self.account()
        first, payload = self.apply(self.change([a]))
        again = self.rpc('apply', payload)
        self.assertEqual(first['receipt'], again['receipt'])
        self.assertTrue(again['replayed'])
        self.assertEqual(self.sql(f"select revision from fleet_account_policy_v1 where account_id='{a}'"), '1')

    def test_15_conflicting_replay(self):
        a = self.account()
        _, payload = self.apply(self.change([a]))
        payload['change'] = self.change([a], 'RELEASE')
        self.assertIn('fleet_bulk_replay_conflict', self.rpc('apply', payload, check=False).stderr)

    def test_16_stale_preview(self):
        a = self.account()
        change = self.change([a])
        p = self.rpc('preview', change)
        self.apply(self.change([a], 'SET_CAP', 60))
        result, _ = self.apply(change, p, check=False)
        self.assertIn('fleet_preview_stale', result.stderr)

    def test_17_history_pagination(self):
        for _ in range(3):
            self.apply(self.change([self.account()]))
        first = self.rpc('history', {'limit': 2})
        second = self.rpc('history', {'limit': 2, **first['next_cursor']})
        self.assertEqual(len(first['items']), 2)
        self.assertFalse({r['bulk_action_id'] for r in first['items']} & {r['bulk_action_id'] for r in second['items']})
        self.assertTrue(all('outcomes' not in r for r in first['items']))

    def test_18_unauthorized_all_boundaries(self):
        for name, payload in [('targets', {'kind': 'ALL'}), ('preview', self.change([])), ('apply', {}), ('history', {})]:
            for role in ['anon', 'authenticated']:
                with self.subTest(name=name, role=role):
                    self.assertNotEqual(self.rpc(name, payload, role=role, check=False).returncode, 0)

    def test_19_wrong_actor_before_input(self):
        for name in ['targets', 'preview', 'apply', 'history']:
            self.assertIn('fleet_policy_actor_forbidden', self.rpc(name, {}, actor=str(uuid.uuid4()), check=False).stderr)

    def test_20_actor_injection(self):
        a = self.account()
        change = self.change([a])
        change['actor_id'] = ADMIN
        self.assertNotEqual(self.rpc('preview', change, check=False).returncode, 0)

    def test_21_append_only(self):
        self.apply(self.change([self.account()]))
        self.assertNotEqual(self.sql('update fleet_bulk_receipts_v1 set actor_id=actor_id', check=False).returncode, 0)
        self.assertNotEqual(self.sql('delete from fleet_bulk_receipts_v1', check=False).returncode, 0)

    def test_22_receipts_private(self):
        for role in ['anon', 'authenticated', 'service_role']:
            self.assertNotEqual(self.sql(f'set role {role}; select * from fleet_bulk_receipts_v1', check=False).returncode, 0)

    def test_23_overlapping_bulk_concurrency(self):
        a, b = self.account(), self.account()
        c1, c2 = self.change([a, b], 'SET_CAP', 60), self.change([b, a], 'SET_CAP', 55)
        p1, p2 = self.rpc('preview', c1), self.rpc('preview', c2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(self.apply, c, p, None, False) for c, p in [(c1, p1), (c2, p2)]]
            results = [j.result()[0] for j in jobs]
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        self.assertTrue(all('deadlock' not in r.stderr for r in results))
        self.assertEqual(sum('fleet_preview_stale' in r.stderr for r in results), 1)

    def test_24_missing_selection_rejected(self):
        result = self.rpc('targets', {'kind': 'SELECTED_ACCOUNTS', 'account_ids': [str(uuid.uuid4())]}, check=False)
        self.assertNotEqual(result.returncode, 0)

    def test_25_noop_no_revision_increment(self):
        a = self.account()
        self.apply(self.change([a]))
        self.apply(self.change([a]))
        self.assertEqual(self.sql(f"select revision from fleet_account_policy_v1 where account_id='{a}'"), '1')


if __name__ == '__main__':
    unittest.main(verbosity=2, failfast=True)
