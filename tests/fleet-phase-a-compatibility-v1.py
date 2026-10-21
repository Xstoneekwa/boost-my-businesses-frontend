"""Phase A RPC coexistence on disposable PostgreSQL 17. No production writes.

Actual feb5086 and 5206244 Python lease callers and captured legacy SQL bodies.
Eligibility remains the existing guarded enqueue fixture: no Fleet runtime re-audit.
"""
import ast
import concurrent.futures
import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import types
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
M = ROOT / 'supabase/migrations'
spec = importlib.util.spec_from_file_location('atomic', ROOT/'tests/fleet-atomic-request-lease-v1.py')
atomic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(atomic)
A, B, D = atomic.A, atomic.B, atomic.DEVICE
OLD = Path('/Users/admin/phonefarm-worker-releases/feb5086-ct-resume-profile-tabs-d-only-v1')
NEW = Path('/Users/admin/phonefarm-worker-releases/5206244-fleet-control-v1')


class PhaseA(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = atomic.AtomicRequestLeaseTests
        cls.addClassCleanup(cls.h.doClassCleanups)
        cls.h.setUpClass()
        cls.h.sql('''
          alter table auto_restart_device_locks add column metadata_safe jsonb default '{}';
          alter table account_run_requests add column claimed_by text, add column run_id uuid;
          create table ig_runs(id uuid primary key,account_id uuid,status text);
          create table device_ui_lease_events(id uuid default gen_random_uuid(),lease_id uuid,
            device_id uuid,event_type text,owner_kind text,worker_id text,request_id uuid,
            run_id uuid,reason text,metadata_safe jsonb,created_at timestamptz default now());
          create function _device_ui_lease_audit(uuid,uuid,text,text,text,uuid,uuid,text,jsonb)
            returns void language sql as $$ insert into device_ui_lease_events
            (lease_id,device_id,event_type,owner_kind,worker_id,request_id,run_id,reason,metadata_safe)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9) $$;
        ''')
        cls.h.sql((ROOT/'tests/fixtures/fleet-phase-a-live-legacy-20260908.sql').read_text())
        source = (M/'20260906171034_fleet_admission_authority_v1.sql').read_text()
        for name in ('fleet_runtime_owners_v1','fleet_terminal_receipts_v1'):
            match = re.search(r'create table public\.'+name+r' \(.*?\n\);',source,re.S)
            assert match, name
            cls.h.sql(match[0])
        for pattern in (r'create function public\.fleet_terminal_receipt_valid_v1\(.*?\n\$\$;',
                        r'create or replace function public\.auto_restart_renew_device_lock\(.*?\$device_renew_fenced\$;'):
            match = re.search(pattern,source,re.S)
            assert match, pattern
            cls.h.sql(match[0])
        for name in ('20260907135729_fleet_safe_expired_lease_reclaim_v1.sql',
                     '20260907140225_fleet_device_lease_release_transfer_fencing_v1.sql',
                     '20260907142233_fleet_device_lock_exact_operation_receipts_v1.sql',
                     '20260908112814_fleet_phase_a_legacy_compatibility_v1.sql'):
            cls.h.sql((M/name).read_text())
        # Renewal caller hardening is exact; unrelated resume ACL targets are
        # outside this lease fixture and are tested by their existing harness.
        hardening=(M/'20260907171458_fleet_mutation_rpc_caller_authorization_v1.sql').read_text()
        cls.h.sql(hardening.split('-- The baseline explicitly')[0]+'commit;')
        cls.h.sql('create role fixture_public_only;')
        cls.h.sql('create table auto_restart_tick_locks(status text);')
        cls.h.sql((Path('/Users/admin/Projects/boost-ai-frontend/supabase/migrations') /
            '20260822120024_phonefarm_storage_apply_admission_barrier_v2.sql').read_text())

    def setUp(self):
        self.h.sql('truncate phonefarm_runtime_barriers,auto_restart_tick_locks,device_ui_lease_events,fleet_runtime_owners_v1,fleet_terminal_receipts_v1,ig_runs,auto_restart_device_locks,account_run_requests,account_assignments,ig_accounts,fixture_lease_audit; update fixture_policy set hold=false;')
        self.h.sql(f"insert into ig_accounts values('{A}'),('{B}'); insert into account_assignments(account_id,device_id,status) values('{A}','{D}','active'),('{B}','{D}','active');")
        self.old = self.caller(OLD)
        self.new = self.caller(NEW)

    def sql(self,s,check=True):
        return self.h.sql(s,check)

    def caller(self,root):
        tree=ast.parse((root/'auto_restart_device_lock.py').read_text())
        nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
        rpc=types.SimpleNamespace(call_rpc=self.rpc,call_rpc_once=self.rpc)
        ns=dict(os=os,uuid=uuid,UUID=uuid.UUID,datetime=datetime.datetime,timezone=datetime.timezone,
                timedelta=datetime.timedelta,Any=object,log=lambda *a,**k:None,
                supabase_client=rpc,call_rpc=self.rpc,call_rpc_once=self.rpc)
        exec('from __future__ import annotations\n',ns)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0)]+nodes,type_ignores=[])),str(root/'auto_restart_device_lock.py'),'exec'),ns)
        ns['_load_device_lock']=lambda *a,**k: (_ for _ in ()).throw(AssertionError('No fallback ownership lookup'))
        return ns

    @staticmethod
    def quote(v):
        if v is None: return 'NULL'
        if isinstance(v,int): return str(v)
        if isinstance(v,(dict,list)): v=json.dumps(v)
        return "'"+str(v).replace("'","''")+"'"

    def rpc(self,name,params,**kwargs):
        args=','.join(k+'=>'+self.quote(v) for k,v in params.items())
        result=self.sql('set role service_role; select '+name+'('+args+');')
        return json.loads(result.stdout.strip())

    def enqueue(self,account=A,key='phase-a',metadata=None):
        return json.loads(self.sql(atomic.AtomicRequestLeaseTests.enqueue(account,key,metadata)).stdout)

    def acquire(self,account=A):
        return self.old['acquire_device_lock'](device_id=D,worker_id='fixture-dispatcher',account_id=account,app_instance_id=None)

    def old_cycle(self):
        acquired=self.acquire()
        self.assertTrue(acquired['acquired'])
        self.assertEqual(self.sql('select request_id is null from auto_restart_device_locks;').stdout.strip(),'t')
        row=self.enqueue()
        self.assertEqual(row['metadata_safe']['device_lock_binding']['lease_id'],acquired['lease_id'])
        kw=dict(device_id=D,worker_id='fixture-dispatcher',request_id=row['id'])
        self.assertTrue(self.old['bind_device_lock_to_request'](**kw)['bound'])
        self.assertTrue(self.old['renew_device_lock'](**kw)['renewed'])
        self.sql("update account_run_requests set status='claimed',claimed_by='consumer';")
        self.assertTrue(self.old['transfer_device_lock'](device_id=D,request_id=row['id'],new_worker_id='consumer')['transferred'])
        kw['worker_id']='consumer'
        self.assertTrue(self.old['release_device_lock'](**kw)['released'])
        return row

    def test_feb5086_acquire_bind_renew_transfer_release(self):
        self.old_cycle()

    def test_legacy_duration_omission(self):
        self.acquire()
        q=atomic.AtomicRequestLeaseTests.enqueue().replace(', "device_lock_lease_seconds": 900','')
        self.assertTrue(json.loads(self.sql(q).stdout)['id'])

    def test_new_atomic_renew_transfer_release_exact_callers(self):
        row=self.enqueue();b=row['metadata_safe']['device_lock_binding']
        kw=dict(device_id=D,worker_id=b['worker_id'],request_id=row['id'],expected_lease_id=b['lease_id'],account_id=A)
        self.assertTrue(self.new['renew_device_lock'](**kw)['renewed'])
        self.sql("update account_run_requests set status='claimed',claimed_by='consumer';")
        moved=self.new['transfer_device_lock'](device_id=D,request_id=row['id'],new_worker_id='consumer',previous_worker_id=b['worker_id'],expected_lease_id=b['lease_id'],account_id=A,lease_seconds=900)
        self.assertTrue(moved['transferred']);self.assertNotEqual(moved['lease_id'],b['lease_id'])
        kw.update(worker_id='consumer',expected_lease_id=moved['lease_id'])
        self.assertTrue(self.new['release_device_lock'](**kw)['released'])

    def test_stale_token_same_request_same_owner_rejected(self):
        b=self.enqueue()['metadata_safe']['device_lock_binding']
        self.sql("update account_run_requests set status='claimed',claimed_by='fixture-dispatcher';")
        moved=self.rpc('auto_restart_transfer_device_lock',dict(p_device_id=D,p_request_id=b['request_id'],p_new_worker_id=b['worker_id'],p_previous_worker_id=b['worker_id'],p_expected_lease_id=b['lease_id'],p_account_id=A,p_lease_seconds=900))
        self.assertTrue(moved['transferred'])
        kw=dict(device_id=D,worker_id=b['worker_id'],request_id=b['request_id'],expected_lease_id=b['lease_id'],account_id=A)
        self.assertFalse(self.new['renew_device_lock'](**kw).get('renewed'))
        self.assertFalse(self.new['release_device_lock'](**kw).get('released'))

    def test_same_device_old_new_race_one_owner(self):
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            old=pool.submit(self.acquire)
            new=pool.submit(self.sql,atomic.AtomicRequestLeaseTests.enqueue(B,'other'),False)
            a,b=old.result(),new.result()
        self.assertEqual(int(bool(a.get('acquired')))+int(b.returncode==0),1)
        self.assertEqual(self.sql('select count(*) from auto_restart_device_locks').stdout.strip(),'1')

    def test_no_cross_account_acquire_rebind(self):
        self.assertTrue(self.acquire()['acquired'])
        self.assertFalse(self.acquire(B)['acquired'])
        self.assertEqual(self.sql('select account_id from auto_restart_device_locks').stdout.strip(),A)

    def test_no_request_rebind(self):
        row=self.enqueue()
        self.sql("insert into account_run_requests(id,account_id,status) values('30000000-0000-0000-0000-000000000099','"+A+"','queued');")
        result=self.old['bind_device_lock_to_request'](device_id=D,worker_id='fixture-dispatcher',request_id='30000000-0000-0000-0000-000000000099')
        self.assertFalse(result['bound'])
        self.assertEqual(self.sql('select request_id from auto_restart_device_locks').stdout.strip(),row['id'])

    def test_legacy_renew_cannot_bind_other_account(self):
        self.acquire()
        request='30000000-0000-0000-0000-000000000098'
        self.sql(f"insert into account_run_requests(id,account_id,status) values('{request}','{B}','claimed');")
        self.assertFalse(self.old['renew_device_lock'](device_id=D,worker_id='fixture-dispatcher',request_id=request)['renewed'])
        self.assertEqual(self.sql('select request_id is null from auto_restart_device_locks').stdout.strip(),'t')

    def test_legacy_manual_renew_binds_matching_claim(self):
        self.acquire()
        request='30000000-0000-0000-0000-000000000098'
        self.sql(f"insert into account_run_requests(id,account_id,status,claimed_by) values('{request}','{A}','claimed','fixture-dispatcher');")
        self.assertTrue(self.old['renew_device_lock'](device_id=D,worker_id='fixture-dispatcher',request_id=request)['renewed'])

    def test_legacy_handoff_exact_terminal_source(self):
        self.acquire()
        source='30000000-0000-0000-0000-000000000097'
        target='30000000-0000-0000-0000-000000000098'
        self.sql(f"insert into account_run_requests(id,account_id,status) values('{source}','{A}','completed'),('{target}','{A}','queued'); update auto_restart_device_locks set request_id='{source}';")
        result=self.rpc('handoff_preflight_device_lock_to_request',dict(p_device_id=D,p_preflight_request_id=source,p_scheduler_request_id=target,p_new_worker_id='scheduler'))
        self.assertTrue(result['transferred'],result)
        self.assertEqual(self.sql('select request_id from auto_restart_device_locks').stdout.strip(),target)

    def test_legacy_handoff_cannot_rebind_tokenized_source(self):
        row=self.enqueue()
        target='30000000-0000-0000-0000-000000000098'
        self.sql(f"update account_run_requests set status='completed'; insert into account_run_requests(id,account_id,status) values('{target}','{A}','queued');")
        result=self.rpc('handoff_preflight_device_lock_to_request',dict(p_device_id=D,p_preflight_request_id=row['id'],p_scheduler_request_id=target,p_new_worker_id='scheduler'))
        self.assertFalse(result['transferred'],result)

    def test_old_worker_can_consume_new_queued_request_after_rollback(self):
        row=self.enqueue()
        self.sql("update account_run_requests set status='claimed',claimed_by='consumer';")
        self.assertTrue(self.old['transfer_device_lock'](device_id=D,request_id=row['id'],new_worker_id='consumer')['transferred'])
        kw=dict(device_id=D,worker_id='consumer',request_id=row['id'])
        self.assertTrue(self.old['renew_device_lock'](**kw)['renewed'])
        self.assertTrue(self.old['release_device_lock'](**kw)['released'])

    def test_legacy_transfer_fences_prior_new_token_and_recovers_crash(self):
        row=self.enqueue();b=row['metadata_safe']['device_lock_binding']
        self.sql("update account_run_requests set status='claimed',claimed_by='fixture-dispatcher';")
        self.assertTrue(self.old['transfer_device_lock'](device_id=D,request_id=row['id'],new_worker_id='fixture-dispatcher')['transferred'])
        self.assertFalse(self.new['renew_device_lock'](device_id=D,request_id=row['id'],worker_id='fixture-dispatcher',expected_lease_id=b['lease_id'],account_id=A)['renewed'])
        self.sql("update account_run_requests set status='completed'; update auto_restart_device_locks set lease_expires_at=clock_timestamp()-interval '1 second';")
        self.assertEqual(self.old['reconcile_stale_device_ui_leases']()['reconciled'],1)

    def test_tokenless_null_request_cannot_release_bound_lease(self):
        self.enqueue()
        self.assertFalse(self.old['release_device_lock'](device_id=D,worker_id='fixture-dispatcher')['released'])

    def test_committed_transfer_response_loss_recovers_exact_receipt(self):
        b=self.enqueue()['metadata_safe']['device_lock_binding']
        self.sql("update account_run_requests set status='claimed',claimed_by='consumer';")
        calls=[]
        def lose(name,params,**kwargs):
            calls.append(name)
            result=self.rpc(name,params)
            if name=='auto_restart_transfer_device_lock': raise TimeoutError('local committed-response loss')
            return result
        self.new['supabase_client']=types.SimpleNamespace(call_rpc_once=lose)
        moved=self.new['transfer_device_lock'](device_id=D,request_id=b['request_id'],
            new_worker_id='consumer',previous_worker_id=b['worker_id'],expected_lease_id=b['lease_id'],
            account_id=A,lease_seconds=900)
        self.assertTrue(moved['transferred'],moved)
        self.assertTrue(moved['reconciled'])
        self.assertEqual(calls,['auto_restart_transfer_device_lock','fleet_device_lock_operation_receipt_v1'])

    def test_acl_all_privileged_overloads(self):
        rows=json.loads(self.sql("select json_agg(json_build_object('signature',p.oid::regprocedure::text,'public',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('auto_restart_acquire_device_lock','auto_restart_bind_device_lock_to_request','auto_restart_renew_device_lock','auto_restart_release_device_lock','auto_restart_transfer_device_lock','create_account_run_request','reconcile_stale_device_ui_leases','handoff_preflight_device_lock_to_request');").stdout)
        self.assertGreaterEqual(len(rows),11)
        for row in rows:
            self.assertFalse(row['public'] or row['anon'] or row['authenticated'],row)

    def test_unauthorized_real_calls(self):
        for role in ('fixture_public_only','anon','authenticated'):
            result=self.sql("set role "+role+"; select auto_restart_acquire_device_lock('"+D+"','fixture-dispatcher','"+A+"',NULL);",False)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('permission denied',result.stderr)

    def test_hold_guard_and_atomic_failure_preserved(self):
        self.acquire()
        self.sql('update fixture_policy set hold=true;')
        result=self.sql(atomic.AtomicRequestLeaseTests.enqueue(),False)
        self.assertIn('fleet_hold_requested',result.stderr)
        self.assertEqual(self.sql('select request_id is null from auto_restart_device_locks').stdout.strip(),'t')

    def test_expired_tokenized_lease_without_receipt_not_reclaimed_by_legacy(self):
        row=self.enqueue()
        self.sql("update account_run_requests set status='completed'; update auto_restart_device_locks set lease_expires_at=now()-interval '1 minute';")
        self.assertFalse(self.acquire()['acquired'])
        self.assertEqual(self.old['reconcile_stale_device_ui_leases']()['reconciled'],0)
        self.assertEqual(self.sql('select request_id from auto_restart_device_locks').stdout.strip(),row['id'])

    def test_old_terminal_before_release_crash_can_recover(self):
        self.acquire()
        row=self.enqueue()
        self.sql("update account_run_requests set status='claimed',claimed_by='consumer';")
        self.assertTrue(self.old['transfer_device_lock'](device_id=D,request_id=row['id'],new_worker_id='consumer')['transferred'])
        # feb5086 can persist terminal state then crash before its release RPC.
        self.sql("update account_run_requests set status='completed'; update auto_restart_device_locks set lease_expires_at=clock_timestamp()-interval '1 second';")
        self.assertEqual(self.old['reconcile_stale_device_ui_leases']()['reconciled'],1)

    def test_tokenized_transfer_retires_legacy_reclaim_provenance(self):
        self.acquire()
        row=self.enqueue();b=row['metadata_safe']['device_lock_binding']
        self.assertEqual(b['phase_a_legacy_generation'],b['lease_id'])
        self.sql("update account_run_requests set status='claimed',claimed_by='consumer';")
        moved=self.new['transfer_device_lock'](device_id=D,request_id=row['id'],new_worker_id='consumer',
            previous_worker_id=b['worker_id'],expected_lease_id=b['lease_id'],account_id=A,lease_seconds=900)
        self.assertTrue(moved['transferred'])
        self.sql("update account_run_requests set status='completed'; update auto_restart_device_locks set lease_expires_at=clock_timestamp()-interval '1 second';")
        self.assertEqual(self.old['reconcile_stale_device_ui_leases']()['reconciled'],0)
        self.assertEqual(self.sql('select lease_id from auto_restart_device_locks').stdout.strip(),moved['lease_id'])

    def test_rollback_old_callers_after_new_completed(self):
        self.test_new_atomic_renew_transfer_release_exact_callers()
        self.sql('truncate auto_restart_device_locks,account_run_requests,fleet_runtime_owners_v1,fleet_terminal_receipts_v1;')
        self.old_cycle()

    def test_barrier_expiry_leaves_legacy_schema_compatible(self):
        params=dict(p_owner_token='phase-a-local-test',p_ttl_seconds=60,p_metadata_safe={})
        self.assertTrue(self.rpc('acquire_phonefarm_storage_apply_barrier_v2',params)['acquired'])
        blocked=self.sql(atomic.AtomicRequestLeaseTests.enqueue(),False)
        self.assertIn('storage_apply_active',blocked.stderr)
        self.sql("update phonefarm_runtime_barriers set expires_at=clock_timestamp()-interval '1 second';")
        self.assertFalse(self.rpc('renew_phonefarm_storage_apply_barrier_v2',dict(p_owner_token='phase-a-local-test',p_ttl_seconds=60))['renewed'])
        self.old_cycle()
        self.assertTrue(self.rpc('release_phonefarm_storage_apply_barrier_v2',dict(p_owner_token='phase-a-local-test',p_reason='completed'))['released'])

    def test_phase_a_postgres_crash_recovery_preserves_legacy_and_new(self):
        import subprocess
        # PostgreSQL crash, not an application mock; no phone/production process.
        subprocess.run([str(atomic.PG/'pg_ctl'),'-D',str(self.h.data),'-m','immediate','-w','stop'],check=True,stdout=subprocess.DEVNULL)
        subprocess.run([str(atomic.PG/'pg_ctl'),'-D',str(self.h.data),'-l',str(self.h.directory/'server.log'),
            '-o',"-F -k %s -h '' -p 55483" % self.h.directory,'-w','start'],check=True,stdout=subprocess.DEVNULL)
        self.old_cycle()
        self.sql('truncate auto_restart_device_locks,account_run_requests,fleet_runtime_owners_v1,fleet_terminal_receipts_v1;')
        self.test_new_atomic_renew_transfer_release_exact_callers()


if __name__=='__main__': unittest.main(verbosity=2)
