"""Disposable PostgreSQL 17 atomic-enqueue tests; no production credentials.

The retained enqueue dependency is a guarded fixture, not a certification of
historical eligibility or the full Fleet runtime. Tests execute the migration's
real transaction, constraints, ACLs, and concurrent PostgreSQL locks.
"""
import concurrent.futures
import json
import pathlib
import subprocess
import tempfile
import unittest

PG = pathlib.Path('/opt/homebrew/opt/postgresql@17/bin')
ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20260907124340_fleet_atomic_request_device_lease_v1.sql'
A = '20000000-0000-0000-0000-000000000001'
B = '20000000-0000-0000-0000-000000000002'
DEVICE = '10000000-0000-0000-0000-000000000001'

SETUP = """
create role anon; create role authenticated; create role service_role;
create table ig_accounts(id uuid primary key);
create table account_assignments(id uuid primary key default gen_random_uuid(), account_id uuid,
  device_id uuid, app_instance_id uuid, status text, created_at timestamptz default now());
create table account_run_requests(id uuid primary key default gen_random_uuid(), account_id uuid,
  requested_by uuid, actor_type text, source_surface text, requested_run_type text,
  idempotency_key text unique, priority integer, status text, metadata_safe jsonb);
create table auto_restart_device_locks(device_id uuid primary key, worker_id text, account_id uuid,
  app_instance_id uuid, request_id uuid references account_run_requests(id), run_id uuid,
  lease_id uuid not null default gen_random_uuid(), lease_expires_at timestamptz,
  reason text, owner_kind text, operation_phase text, heartbeat_at timestamptz, updated_at timestamptz);
create table fixture_policy(hold boolean); insert into fixture_policy values(false);
create table fixture_lease_audit(lease_id uuid, request_id uuid);
create function _device_ui_lease_audit(uuid,uuid,text,text,text,uuid,uuid,text) returns void language sql
  as 'insert into fixture_lease_audit values($1,$6)';
create function create_account_run_request(p_account_id uuid,p_requested_by uuid default null,
  p_actor_type text default 'admin',p_source_surface text default 'instagram_dashboard',
  p_requested_run_type text default 'account_session',p_idempotency_key text default null,
  p_priority integer default 0,p_metadata_safe jsonb default '{}') returns account_run_requests
  language plpgsql security definer set search_path=public as $$
declare r account_run_requests;
begin
  if (select hold from fixture_policy) then raise exception 'fleet_hold_requested'; end if;
  insert into account_run_requests(account_id,requested_by,actor_type,source_surface,
    requested_run_type,idempotency_key,priority,status,metadata_safe)
  values(p_account_id,p_requested_by,p_actor_type,p_source_surface,p_requested_run_type,
    p_idempotency_key,p_priority,'queued',p_metadata_safe) returning * into r;
  if p_metadata_safe ? 'fixture_fail_request' then raise exception 'fixture_request_insert_failure'; end if;
  return r;
end $$;
revoke all on function create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb) from public;
grant execute on function create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb) to service_role;
create function fixture_lease_failure() returns trigger language plpgsql as $$
begin
  if exists(select 1 from account_run_requests where id=new.request_id
    and metadata_safe ? 'fixture_fail_lease') then raise exception 'fixture_lease_insert_failure'; end if;
  return new;
end $$;
create trigger fixture_lease_failure before insert on auto_restart_device_locks
  for each row execute function fixture_lease_failure();
"""


class AtomicRequestLeaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='fleet-atomic-enqueue-', dir='/private/tmp')
        cls.directory = pathlib.Path(cls.tmp.name)
        cls.data = cls.directory / 'data'
        subprocess.run([str(PG/'initdb'), '-D', str(cls.data), '--auth=trust', '--no-locale', '-E', 'UTF8'], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([str(PG/'pg_ctl'), '-D', str(cls.data), '-l', str(cls.directory/'server.log'),
            '-o', "-F -k %s -h '' -p 55483" % cls.directory, '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
        cls.addClassCleanup(cls.cleanup)
        cls.sql(SETUP)
        cls.sql(MIGRATION.read_text())

    @classmethod
    def cleanup(cls):
        subprocess.run([str(PG/'pg_ctl'), '-D', str(cls.data), '-m', 'immediate', '-w', 'stop'], check=True, stdout=subprocess.DEVNULL)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, statement, check=True):
        result = subprocess.run([str(PG/'psql'), '-h', str(cls.directory), '-p', '55483',
            '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
            input="set statement_timeout='5s';\n" + statement, text=True, capture_output=True)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result

    def setUp(self):
        self.sql('truncate auto_restart_device_locks, account_run_requests, account_assignments, ig_accounts, fixture_lease_audit; update fixture_policy set hold=false;')
        self.sql("insert into ig_accounts values('%s'),('%s'); insert into account_assignments(account_id,device_id,status) values('%s','%s','active'),('%s','%s','active');" % (A, B, A, DEVICE, B, DEVICE))

    @staticmethod
    def enqueue(account=A, key='fixture-key', metadata=None):
        payload = json.dumps({'worker_id': 'fixture-dispatcher', 'device_lock_lease_seconds': 900, **(metadata or {})}).replace("'", "''")
        return "set role service_role; select row_to_json(public.create_account_run_request('%s',null,'system','auto_restart_tick','account_session','%s',0,'%s'::jsonb));" % (account, key, payload)

    def counts(self):
        return self.sql('select (select count(*) from account_run_requests),(select count(*) from auto_restart_device_locks);').stdout.strip()

    def test_commit_exact_binding(self):
        row = json.loads(self.sql(self.enqueue()).stdout)
        lease = json.loads(self.sql('select row_to_json(l) from auto_restart_device_locks l;').stdout)
        self.assertEqual(self.counts(), '1|1')
        self.assertEqual(lease['request_id'], row['id'])
        self.assertEqual(lease['account_id'], row['account_id'])
        self.assertEqual(lease['lease_id'], row['metadata_safe']['device_lock_binding']['generation'])

    def test_request_failure_rolls_back_both(self):
        result = self.sql(self.enqueue(metadata={'fixture_fail_request': True}), check=False)
        self.assertIn('fixture_request_insert_failure', result.stderr)
        self.assertEqual(self.counts(), '0|0')

    def test_lease_failure_rolls_back_request(self):
        result = self.sql(self.enqueue(metadata={'fixture_fail_lease': True}), check=False)
        self.assertIn('fixture_lease_insert_failure', result.stderr)
        self.assertEqual(self.counts(), '0|0')

    def test_hold_guard_retained(self):
        self.sql('update fixture_policy set hold=true;')
        self.assertIn('fleet_hold_requested', self.sql(self.enqueue(), check=False).stderr)
        self.assertEqual(self.counts(), '0|0')

    def test_retry_same_identity_no_extra_audit(self):
        first = json.loads(self.sql(self.enqueue()).stdout)
        retry = json.loads(self.sql(self.enqueue()).stdout)
        self.assertEqual(first, retry)
        self.assertEqual(self.counts(), '1|1')
        self.assertEqual(self.sql('select count(*) from fixture_lease_audit;').stdout.strip(), '1')

    def test_same_key_different_payload_rejected(self):
        self.sql(self.enqueue())
        result = self.sql(self.enqueue(metadata={'different': True}), check=False)
        self.assertIn('device_enqueue_idempotency_conflict', result.stderr)
        self.assertEqual(self.counts(), '1|1')

    def test_competing_acquire_one_owner(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.sql, self.enqueue(account, key), False)
                for account, key in ((A, 'fixture-A'), (B, 'fixture-B'))]
            results = [f.result() for f in futures]
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        self.assertTrue(any('device_lock_held' in r.stderr for r in results))
        self.assertTrue(all('deadlock detected' not in r.stderr for r in results))
        self.assertEqual(self.counts(), '1|1')

    def test_null_request_lease_forbidden(self):
        result = self.sql("insert into auto_restart_device_locks(device_id) values('%s');" % DEVICE, check=False)
        self.assertIn('fleet_device_lease_request_required_v1', result.stderr)
        self.assertEqual(self.counts(), '0|0')

    def test_internal_guard_not_callable(self):
        result = self.sql("set role service_role; select public.fleet_enqueue_guarded_internal_v1('%s');" % A, check=False)
        self.assertIn('permission denied', result.stderr)
        self.assertEqual(self.counts(), '0|0')

    def test_configured_durations_exact(self):
        for duration in (60, 600, 900, 1200, 3600):
            with self.subTest(duration=duration):
                self.setUp()
                row = json.loads(self.sql(self.enqueue(metadata={'device_lock_lease_seconds': duration})).stdout)
                elapsed = self.sql('select extract(epoch from lease_expires_at-heartbeat_at) from auto_restart_device_locks;').stdout.strip()
                self.assertEqual(float(elapsed), duration)
                self.assertEqual(row['metadata_safe']['device_lock_binding']['lease_seconds'], duration)

    def test_invalid_durations_leave_no_objects(self):
        for duration in (None, True, '600', 'invalid', 59, 3601, -1, 600.5, {}, []):
            with self.subTest(duration=duration):
                result = self.sql(self.enqueue(metadata={'device_lock_lease_seconds': duration}), check=False)
                self.assertIn('device_lock_lease_duration_invalid', result.stderr)
                self.assertEqual(self.counts(), '0|0')

    def test_auto_restart_missing_duration_rejected(self):
        statement = self.enqueue().replace(', "device_lock_lease_seconds": 900', '')
        self.assertIn('device_lock_lease_duration_required', self.sql(statement, check=False).stderr)
        self.assertEqual(self.counts(), '0|0')

    def test_duration_retry_preserves_expiry(self):
        statement = self.enqueue(metadata={'device_lock_lease_seconds': 600})
        first = json.loads(self.sql(statement).stdout)
        expiry = self.sql('select lease_id,lease_expires_at from auto_restart_device_locks;').stdout
        self.assertEqual(json.loads(self.sql(statement).stdout), first)
        self.assertEqual(self.sql('select lease_id,lease_expires_at from auto_restart_device_locks;').stdout, expiry)
        self.assertEqual(self.counts(), '1|1')

    def test_changed_duration_same_key_conflicts(self):
        self.sql(self.enqueue(metadata={'device_lock_lease_seconds': 600}))
        result = self.sql(self.enqueue(metadata={'device_lock_lease_seconds': 1200}), check=False)
        self.assertIn('device_enqueue_idempotency_conflict', result.stderr)
        self.assertEqual(float(self.sql('select extract(epoch from lease_expires_at-heartbeat_at) from auto_restart_device_locks;').stdout), 600)

    def test_different_durations_concurrent_owner_is_exact(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.sql, self.enqueue(account, key, {'device_lock_lease_seconds': duration}), False)
                for account, key, duration in ((A, 'fixture-A', 600), (B, 'fixture-B', 1200))]
            results = [f.result() for f in futures]
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        self.assertTrue(all('deadlock detected' not in r.stderr for r in results))
        self.assertEqual(self.counts(), '1|1')
        winner = json.loads(next(r.stdout for r in results if r.returncode == 0))
        duration = 600 if winner['account_id'] == A else 1200
        self.assertEqual(float(self.sql('select extract(epoch from lease_expires_at-heartbeat_at) from auto_restart_device_locks;').stdout), duration)

    def test_real_caller_duration_matches_postgres_expiry(self):
        result = subprocess.run(['/Users/admin/.nvm/versions/node/v22.22.2/bin/node',
            str(ROOT/'tests/fleet-lease-duration-caller-v1.cjs')], check=True, capture_output=True, text=True)
        cases = json.loads(result.stdout)['cases']
        self.assertEqual(len(cases), 16)
        for case in cases:
            with self.subTest(raw=case['raw'], producer=case['producer']):
                self.setUp()
                self.sql(self.enqueue(metadata={'device_lock_lease_seconds': case['transported']}))
                seconds = float(self.sql('select extract(epoch from lease_expires_at-heartbeat_at) from auto_restart_device_locks;').stdout)
                self.assertEqual(seconds, case['historical'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
