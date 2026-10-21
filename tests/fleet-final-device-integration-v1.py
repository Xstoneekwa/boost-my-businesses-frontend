"""Joint real Fleet owner RPC + atomic device lock + process-group qualification.

Historical eligibility and cap providers are explicit context fixtures, not
certification of Release blockers, package formulas, or the whole 27-case matrix.
All processes and databases are disposable and local. No phone action is run.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
WORKER = Path('/Library/Application Support/PhoneFarm-Follow60-WorkV1-FullHistory-20260906/fleet-control-v1-692838b7-d682-40b7-ac61-4cc6ab124a08')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


foundation = load('atomic_foundation', ROOT / 'tests/fleet-atomic-request-lease-v1.py')
fleet = load('real_fleet', WORKER / 'fleet_runtime_barrier.py')


class Combined(foundation.AtomicRequestLeaseTests):
    @classmethod
    def sql(cls, statement, check=True):
        if statement == foundation.MIGRATION.read_text():
            parent = super().sql
            parent('''
              ALTER TABLE account_run_requests ADD COLUMN run_id uuid,
                ADD COLUMN claimed_by text, ADD COLUMN cancel_requested_at timestamptz,
                ADD COLUMN cancel_reason text;
              CREATE TABLE client_instagram_accounts(account_id uuid,client_id uuid);
              CREATE TABLE ig_runs(id uuid PRIMARY KEY,account_id uuid,status text);
              GRANT SELECT,UPDATE ON ig_accounts,client_instagram_accounts,ig_runs,account_run_requests TO service_role;
              CREATE FUNCTION admit_account_run_attempt_v1(p_request_id uuid,p_worker text,
                p_assignment uuid,p_device uuid,p_instance uuid,p_package text,
                p_start timestamptz,p_end timestamptz,p_lease integer)
              RETURNS jsonb LANGUAGE plpgsql AS $$
              DECLARE v_plan record; v_account_id uuid:=p_request_id;
              BEGIN SELECT 1 AS zero_work_contract_version INTO v_plan;
  if v_plan.zero_work_contract_version = 1 then
                RETURN '{"ok":true}'::jsonb; END IF; RETURN '{"ok":false}'::jsonb;
              END $$;
              DO $fixture$ DECLARE d text; BEGIN
                d:=pg_get_functiondef('create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb)'::regprocedure);
                EXECUTE replace(d,'insert into account_run_requests(', 'insert into public.account_run_requests (');
              END $fixture$;
            ''')
            parent((ROOT / 'supabase/migrations/20260906171034_fleet_admission_authority_v1.sql').read_text())
        return super().sql(statement, check)


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def result(statement):
    output = Combined.sql("BEGIN;SET LOCAL ROLE service_role;SET LOCAL request.jwt.claim.role='service_role';"
                          "SELECT 'RESULT:' || (" + statement + ")::text;COMMIT;").stdout
    return json.loads(next(line[len('RESULT:'):] for line in output.splitlines() if line.startswith('RESULT:')))


RPC = {'register': 'fleet_register_execution_attempt_v1', 'cancel': 'fleet_cancel_execution_attempt_v1',
       'reconcile': 'fleet_reconcile_execution_attempt_v1', 'runtime_ack': 'fleet_ack_runtime_revision_v1',
       'cap_ack': 'fleet_ack_cap_revision_v1'}
rpc_calls = []


def rpc(operation, payload):
    rpc_calls.append(operation)
    return result('public.' + RPC[operation] + '(' + literal(payload) + ')')


def lock_rpc(operation, binding, **extra):
    values = dict(p_device_id=binding['device_id'], p_request_id=binding['request_id'],
                  p_expected_lease_id=binding['lease_id'], p_account_id=binding['account_id'])
    if operation == 'transfer':
        values.update(p_previous_worker_id=binding['worker_id'], p_new_worker_id=binding['worker_id'], p_lease_seconds=600)
    else:
        values['p_worker_id'] = binding['worker_id']
        if operation == 'renew':
            values['p_lease_seconds'] = 600
    values.update(extra)
    args = ','.join(key + '=>' + (str(value) if isinstance(value, int) else "'" + value.replace("'", "''") + "'")
                    for key, value in values.items())
    return result('public.auto_restart_' + operation + '_device_lock(' + args + ')')


def enqueue(account, key, owner):
    metadata = dict(worker_id=owner, device_lock_lease_seconds=600)
    return result("to_jsonb(public.create_account_run_request('" + account
                  + "',null,'system','auto_restart_tick','account_session','" + key
                  + "',0," + literal(metadata) + '))')


def start(row, temporary, children):
    binding = row['metadata_safe']['device_lock_binding']
    attempt = str(uuid.uuid4())
    owner = binding['worker_id']
    execution = dict(account_id=row['account_id'], request_id=row['id'], attempt_id=attempt,
                     consumer_instance_id=owner, consumer_boot_id=uuid.uuid4().hex)
    authority = dict(execution, schema='FLEET_EXECUTION_AUTHORITY_V1',
                     tenant_id='30000000-0000-0000-0000-000000000099', consumer_boot_id=None,
                     execution_registered=False, revision=1, attempt_revision=1,
                     normal_effective_day_cap=120, canonical_follows_before_run=52,
                     business_day='2026-09-07', hold='CLEARED')
    Combined.sql("INSERT INTO ig_runs VALUES('" + attempt + "','" + row['account_id'] + "','running');"
                 "UPDATE account_run_requests SET status='running',claimed_by='" + owner
                 + "',run_id='" + attempt + "',fleet_runtime_v1=" + literal(authority)
                 + " WHERE id='" + row['id'] + "';")
    request = dict(execution, revision=1, registration_intent='REGISTER_OR_RETRY', child_pid=None)
    registered = rpc('register', request)
    session = fleet.FleetConsumerSession(binding=execution, authority=registered['authority'],
                                         root=Path(temporary).resolve(), rpc=rpc)
    def launch():
        child = subprocess.Popen([sys.executable, '-I', '-B', '-c', 'import time; time.sleep(60)'],
                                 start_new_session=True, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        children.append(child)
        return child
    child = session.spawn(launch)
    session.register_child(child)
    assert child.pid == os.getpgid(child.pid)
    return session, request


def terminate(session, registration):
    account = registration['account_id']
    Combined.sql("UPDATE fleet_account_policy_v1 SET revision=2,hold_state='REQUESTED',"
                 "policy_payload=policy_payload || '{\"hold\":true}' WHERE account_id='" + account + "';")
    current = rpc('register', dict(registration, revision=2))
    session.observe(current['authority'])
    session.request_canonical_cancel()
    assert not session.process_group_quiescent()
    session.terminate_process_group(graceful_timeout_seconds=1)
    assert session.process_group_quiescent()
    session.reconcile()


def main():
    children = []
    try:
        Combined.setUpClass()
        Combined.sql((ROOT / 'supabase/migrations/20260907140225_fleet_device_lease_release_transfer_fencing_v1.sql').read_text())
        # The real privilege migration also references Human Resume V2. Its
        # canonical implementation is outside this fixture; enforce renewal ACL
        # by applying only its exact renewal statements, not a permissive guard.
        security = (ROOT / 'supabase/migrations/20260907171458_fleet_mutation_rpc_caller_authorization_v1.sql').read_text()
        Combined.sql(security.split('-- The baseline explicitly', 1)[0] + '\nCOMMIT;')
        provider = (ROOT / 'tests/fleet-owner-rpcs-v1.sql').read_text()
        for name in ('fleet_test_caps', 'fleet_test_follows'):
            declaration = re.search(r'create table public\.' + name + r'\(.*?;', provider, re.S)
            assert declaration is not None, name
            Combined.sql(declaration.group(0))
        for name in ('account_package_runtime_contract_status', 'auto_restart_daily_action_counts_v1'):
            declaration = re.search(r'create function public\.' + name + r'\(.*?\n\$\$;', provider, re.S)
            assert declaration is not None, name
            Combined.sql(declaration.group(0))
        for account in (foundation.A, foundation.B):
            Combined.sql("INSERT INTO ig_accounts VALUES('" + account + "');"
                         "INSERT INTO account_assignments(account_id,device_id,status) VALUES('" + account
                         + "','" + foundation.DEVICE + "','active');"
                         "INSERT INTO client_instagram_accounts VALUES('" + account + "','30000000-0000-0000-0000-000000000099');"
                         "INSERT INTO fleet_account_policy_v1(account_id,client_id,revision,hold_state,policy_payload) VALUES('"
                         + account + "','30000000-0000-0000-0000-000000000099',1,'CLEARED','{}');"
                         "INSERT INTO fleet_test_caps VALUES('" + account + "',120);"
                         "INSERT INTO fleet_test_follows SELECT '" + account + "'::uuid,clock_timestamp() FROM generate_series(1,52);")
        with tempfile.TemporaryDirectory(prefix='fleet-same-device-runtime-', dir='/private/tmp') as temporary:
            row_a = enqueue(foundation.A, 'same-device-A', 'owner-A')
            a = row_a['metadata_safe']['device_lock_binding']
            session_a, registration_a = start(row_a, temporary, children)
            try:
                enqueue(foundation.B, 'same-device-B-blocked', 'owner-B')
            except AssertionError as error:
                assert 'device_lock_held' in str(error), str(error)
            else:
                raise AssertionError('second_account_acquired_live_device')
            for operation, flag in [('renew', 'renewed'), ('release', 'released'), ('transfer', 'transferred')]:
                assert lock_rpc(operation, a, p_account_id=foundation.B).get(flag) is not True
            assert len(children) == 1 and children[0].poll() is None
            assert Combined.sql('SELECT count(*) FROM fleet_runtime_owners_v1 WHERE NOT terminal_reconciled;').stdout.strip() == '1'
            terminate(session_a, registration_a)
            assert lock_rpc('release', a)['released'] is True
            row_b = enqueue(foundation.B, 'same-device-B', 'owner-B')
            b = row_b['metadata_safe']['device_lock_binding']
            assert a['lease_id'] != b['lease_id'] and b['generation'] == b['lease_id']
            assert children[0].poll() is not None and session_a.process_group_quiescent()
            session_b, registration_b = start(row_b, temporary, children)
            assert sum(child.poll() is None for child in children) == 1
            for operation, flag in [('renew', 'renewed'), ('release', 'released'), ('transfer', 'transferred')]:
                assert lock_rpc(operation, a).get(flag) is not True
            assert Combined.sql('SELECT lease_id FROM auto_restart_device_locks;').stdout.strip() == b['lease_id']
            assert Combined.sql('SELECT count(*) FROM fleet_runtime_owners_v1 WHERE NOT terminal_reconciled;').stdout.strip() == '1'
            terminate(session_b, registration_b)
            assert lock_rpc('release', b)['released'] is True
            assert Combined.sql('SELECT count(*) FROM auto_restart_device_locks;').stdout.strip() == '0'
            print(json.dumps(dict(SAME_DEVICE_OWNER_AND_PROCESS_BOUNDARY='PASS',
                NO_DOUBLE_OWNER='YES', NO_DOUBLE_PROCESS_GROUP='YES', NO_LOCK_REBIND='YES',
                OLD_RENEW_RELEASE_TRANSFER='REJECTED', PROCESS_GROUPS_STARTED=len(children),
                RPC_CALLS=rpc_calls, DEVICE_ACTIONS=0, PRODUCTION_CHANGED='NO',
                HISTORICAL_ELIGIBILITY='EXPLICIT_CONTEXT_FIXTURE',
                RECOVERY_MUTATION='ACQUIRED_SEPARATE_TESTS', FULL_RUNTIME_MATRIX='NOT_ASSERTED')))
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
        Combined.doClassCleanups()


if __name__ == '__main__':
    main()
