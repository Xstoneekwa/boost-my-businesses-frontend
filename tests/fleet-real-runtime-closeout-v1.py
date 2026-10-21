"""Closeout witnesses using canonical policy/owner RPCs and real isolated children.

No phones are accessed. Admission is the explicit persisted precondition shared
with the cap harness, not an assertion that a synthetic admission is production.
"""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import threading
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = runpy.run_path(str(ROOT / 'tests/fleet-canonical-cap-e2e-v1.py'))


class RuntimeCloseout(FIXTURE['CanonicalCapE2E']):
    def prepared(self):
        case = self.seed('runtime',0,120)
        # The cap fixture records prior-day activity without closing those runs.
        # Runtime convergence needs the real admission precondition: only this
        # attempt is running, and historical attempts are completed.
        binding = case['binding']
        self.sql("UPDATE ig_runs SET status=CASE WHEN id='" + binding['attempt_id']
                 + "' THEN 'running' ELSE 'completed' END WHERE account_id='"
                 + binding['account_id'] + "'")
        mapping = dict(cancel='fleet_cancel_execution_attempt_v1',
                       reconcile='fleet_reconcile_execution_attempt_v1',
                       runtime_ack='fleet_ack_runtime_revision_v1',cap_ack='fleet_ack_cap_revision_v1')
        case['session'].rpc = lambda operation,payload: self.rpc(mapping[operation],payload)
        return case

    def hold(self, case):
        result = self.mutation(case,'hold',1)
        self.assertEqual(result['current_policy']['hold_state'],'REQUESTED')
        self.refresh(case,2)

    def state(self, case):
        return self.scalar("SELECT hold_state||':'||revision FROM fleet_account_policy_v1 WHERE account_id='"
                           + case['binding']['account_id'] + "'")

    def child(self):
        child = subprocess.Popen([sys.executable,'-I','-B','-c','import time; time.sleep(40)'],
                                  start_new_session=True,stdin=subprocess.DEVNULL,
                                  stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

        def cleanup():
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)

        self.addCleanup(cleanup)
        return child

    def finish_hold(self, case, unstarted=False, orphan_proof=None):
        case['session'].request_canonical_cancel()
        case['session'].reconcile(unstarted=unstarted,orphan_proof=orphan_proof)
        self.assertEqual(self.state(case),'ACTIVE:2')

    def test_unstarted_owner_remains_fail_closed_without_process_proof(self):
        case = self.prepared()
        self.hold(case)
        starts = []
        with self.assertRaises(self.runtime.FleetBlocked):
            case['session'].spawn(lambda: starts.append(True))
        self.assertEqual(starts,[])
        case['session'].request_canonical_cancel()
        with self.assertRaisesRegex(AssertionError,'fleet_terminal_process_proof_required'):
            case['session'].reconcile(unstarted=True)
        self.assertEqual(self.state(case),'REQUESTED:2')
        release = self.mutation(case,'release',2)
        self.assertEqual(release['current_policy']['hold_state'],'RELEASING')
        # A participating execution cannot take the idle proof shortcut.
        self.assertEqual(self.state(case),'RELEASING:3')
        self.assertEqual(self.scalar("SELECT count(*) FROM fleet_runtime_acks_v1 WHERE account_id='"
                                    + case['binding']['account_id'] + "'"),'0')
        print('REGISTERED_UNSTARTED_OWNER=SAFE_FAIL_CLOSED_V1_LIMITATION; NO_FABRICATED_PROCESS_PROOF')

    def test_spawn_wins_policy_change_during_local_barrier(self):
        case = self.prepared()
        entered, allow_return = threading.Event(),threading.Event()
        children, errors = [],[]

        def callback():
            child = self.child()
            children.append(child)
            entered.set()
            if not allow_return.wait(10):
                raise AssertionError('fixture release missing')
            return child

        def spawn():
            try:
                case['session'].spawn(callback)
            except Exception as error:
                errors.append(error)

        thread = threading.Thread(target=spawn)
        thread.start()
        try:
            self.assertTrue(entered.wait(10))
            self.mutation(case,'hold',1)
            self.assertEqual(self.state(case),'REQUESTED:2')
        finally:
            allow_return.set()
            thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors,[])
        self.assertEqual(len(children),1)
        case['session'].register_child(children[0])
        self.refresh(case,2)
        case['session'].request_canonical_cancel()
        with self.assertRaises(self.runtime.FleetBlocked):
            case['session'].reconcile()
        self.assertEqual(self.state(case),'REQUESTED:2')
        case['session'].terminate_process_group(graceful_timeout_seconds=1)
        self.finish_hold(case)
        print('SPAWN_WINS_HOLD_RACE_REAL_PROCESS_RPC=PASS')

    def test_restart_orphan_uses_exact_process_group_and_backend_reconciliation(self):
        case = self.prepared()
        child = case['session'].spawn(self.child)
        case['session'].register_child(child)
        self.hold(case)
        case['session'].request_canonical_cancel()
        case['session'].terminate_process_group(graceful_timeout_seconds=1)
        current = self.rpc('fleet_register_execution_attempt_v1',dict(case['binding'],revision=2,
                           registration_intent='REGISTER_OR_RETRY'))
        restarted = self.runtime.FleetConsumerSession(binding=case['binding'],authority=current['authority'],
                         root=self.channel_root,rpc=case['session'].rpc)
        with self.assertRaises(self.runtime.FleetBlocked):
            restarted.reconcile()
        self.assertEqual(self.state(case),'REQUESTED:2')
        restarted.reconcile(orphan_proof=dict(binding=case['binding'],pid=child.pid,
                                             process_group_absent=True,heartbeat_expiry_used=False))
        self.assertEqual(self.state(case),'ACTIVE:2')
        print('RESTART_ORPHAN_REAL_PROCESS_RPC=PASS')

    def test_database_unavailable_cannot_ack_or_open_hold(self):
        case = self.prepared()
        self.hold(case)
        original = case['session'].rpc

        def disconnected(operation,payload):
            raise ConnectionError('controlled local transport disconnect')

        case['session'].rpc = disconnected
        with self.assertRaises(ConnectionError):
            case['session'].request_canonical_cancel()
        self.assertEqual(self.state(case),'REQUESTED:2')
        with self.assertRaises(self.runtime.FleetBlocked):
            case['session'].spawn(self.child)
        case['session'].rpc = original
        cancellation = case['session'].request_canonical_cancel()
        self.assertEqual(cancellation['id'],case['binding']['request_id'])
        self.assertEqual(self.state(case),'REQUESTED:2')
        print('DATABASE_UNAVAILABLE=SAFE_FAIL_CLOSED_V1_LIMITATION; CANONICAL_CANCELLATION_RETRIES_AFTER_RECONNECT')

    def test_worker_unavailable_release_does_not_invent_ack(self):
        case = self.prepared()
        self.hold(case)
        release = self.mutation(case,'release',2)
        self.assertEqual(release['current_policy']['hold_state'],'RELEASING')
        self.assertEqual(self.scalar("SELECT count(*) FROM fleet_runtime_acks_v1 WHERE account_id='"
                                    + case['binding']['account_id'] + "'"),'0')
        self.assertEqual(self.state(case),'RELEASING:3')
        print('WORKER_UNAVAILABLE=SAFE_FAIL_CLOSED_V1_LIMITATION; RELEASE_WAITS_FOR_REAL_OWNER_PROOF')


if __name__ == '__main__':
    names = [name for name in RuntimeCloseout.__dict__ if name.startswith('test_')]
    suite = unittest.TestSuite(RuntimeCloseout(name) for name in names)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
