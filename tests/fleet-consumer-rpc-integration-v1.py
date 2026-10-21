"""Real local consumer/process-group/owner-RPC boundary, never phone execution.

Run after fleet-local-postgres-v1.sh with FLEET_TEST_PG_ROOT=$D.
Surrounding account/package/count inputs remain explicit dependency fixtures;
this test does not assert complete package-cap E2E or integrated 27/27.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


BACKEND = Path(__file__).resolve().parents[1]
WORKER = Path('/Library/Application Support/PhoneFarm-Follow60-WorkV1-FullHistory-20260906/fleet-control-v1-692838b7-d682-40b7-ac61-4cc6ab124a08')
PG = '/opt/homebrew/opt/postgresql@17/bin/psql'
socket = Path(os.environ['FLEET_TEST_PG_ROOT'])
assert socket == socket.resolve() and str(socket).startswith('/private/tmp/fleet-successor-rpc.')
spec = importlib.util.spec_from_file_location('integrated_fleet', WORKER / 'fleet_runtime_barrier.py')
fleet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fleet)


def sql(statement):
    result = subprocess.run(
        [PG, '-h', str(socket), '-p', '55483', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
        input="SET statement_timeout='5s';\n" + statement, text=True,
        capture_output=True, timeout=10)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


calls = []
rpc_names = {
    'register': 'fleet_register_execution_attempt_v1',
    'cancel': 'fleet_cancel_execution_attempt_v1',
    'reconcile': 'fleet_reconcile_execution_attempt_v1',
    'runtime_ack': 'fleet_ack_runtime_revision_v1',
    'cap_ack': 'fleet_ack_cap_revision_v1',
}


def rpc(operation, payload):
    calls.append(operation)
    output = sql("BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role'; "
                 "SELECT 'RPC_RESULT:' || public." + rpc_names[operation] + '(' + literal(payload) + ')::text; COMMIT;')
    return json.loads(next(line[len('RPC_RESULT:'):] for line in output.splitlines()
                           if line.startswith('RPC_RESULT:')))


def main():
    # Reuse the exact owner-RPC account/context fixtures, not their assertions.
    seed = (BACKEND / 'tests/fleet-owner-rpcs-v1.sql').read_text().split('set local role service_role;', 1)[0]
    seed = seed.replace("1,'REQUESTED'", "1,'CLEARED'").replace('"hold":"REQUESTED"', '"hold":"CLEARED"')
    sql(seed + '\nCOMMIT;')
    binding = dict(account_id='00000000-0000-0000-0000-000000000401',
                   request_id='00000000-0000-0000-0000-000000000403',
                   attempt_id='00000000-0000-0000-0000-000000000404',
                   consumer_instance_id='fixture-owner', consumer_boot_id='INTEGRATED-B1')
    registration = dict(binding, revision=1, registration_intent='REGISTER_OR_RETRY', child_pid=None)
    registered = rpc('register', registration)
    assert registered['ok'] is True
    assert rpc('register', registration) == registered
    child = None
    with tempfile.TemporaryDirectory(prefix='fleet-real-consumer-', dir='/private/tmp') as temporary:
        session = fleet.FleetConsumerSession(binding=binding, authority=registered['authority'],
                                             root=Path(temporary).resolve(), rpc=rpc)
        try:
            child = session.spawn(lambda: subprocess.Popen(
                [sys.executable, '-I', '-B', '-c', 'import time; time.sleep(30)'],
                start_new_session=True, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            session.register_child(child)
            assert os.getpgid(child.pid) == child.pid
            assert session.process_group_quiescent() is False
            sql("UPDATE public.fleet_account_policy_v1 SET revision=2,hold_state='REQUESTED',"
                "policy_payload=policy_payload || '{\"hold\":true}'::jsonb "
                "WHERE account_id='" + binding['account_id'] + "';")
            current = rpc('register', dict(registration, revision=2))
            session.observe(current['authority'])
            cancellation = session.request_canonical_cancel()
            assert cancellation['id'] == binding['request_id']
            try:
                session.reconcile()
            except fleet.FleetBlocked as error:
                assert str(error) == 'child_unknown_or_alive', str(error)
            else:
                raise AssertionError('live_group_must_prevent_ack')
            assert 'runtime_ack' not in calls
            assert sql("SELECT hold_state FROM public.fleet_account_policy_v1 WHERE account_id='"
                       + binding['account_id'] + "';") == 'REQUESTED'
            session.terminate_process_group(graceful_timeout_seconds=1)
            assert session.process_group_quiescent() is True
            session.reconcile()
            assert 'reconcile' in calls and 'runtime_ack' in calls
            assert sql("SELECT hold_state || ':' || revision FROM public.fleet_account_policy_v1 WHERE account_id='"
                       + binding['account_id'] + "';") == 'ACTIVE:2'
            try:
                rpc('runtime_ack', dict(binding, revision=1))
            except RuntimeError:
                pass
            else:
                raise AssertionError('stale_ack_accepted')
            print(json.dumps(dict(
                REAL_CONSUMER_PROCESS_GROUP_RPC='PASS', HOLD_AFTER_SPAWN='PASS',
                LIVE_GROUP_PREVENTS_ACK='PASS', CANONICAL_CANCEL_RPC='PASS',
                TERMINAL_RECONCILIATION_RPC='PASS', EXACT_REVISION_CONVERGENCE='PASS',
                STALE_ACK_REJECTED='PASS', RPC_CALLS=calls,
                DEVICE_ACTIONS=0, PRODUCTION_CHANGED='NO', FULL_RUNTIME_MATRIX='NOT_ASSERTED')))
        finally:
            # This test spawns only this direct child, which cannot spawn descendants.
            if child is not None and child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)


if __name__ == '__main__':
    main()
