"""Captured-token callers exercised against real local PostgreSQL RPCs."""
import ast
import importlib.util
import json
import pathlib
import re
import types
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stale_token_fixture',ROOT/'tests/fleet-stale-token-after-reclaim-v1.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

class DeviceLockCallerTests(f.StaleTokenAfterReclaim):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        baseline=(ROOT/'supabase/baseline/20260728001632_public_schema.sql').read_text()
        table=re.search(r'CREATE TABLE IF NOT EXISTS "public"\."device_ui_lease_events" \(.*?\n\);',baseline,re.S)
        writer=re.search(r'CREATE OR REPLACE FUNCTION "public"\."_device_ui_lease_audit".*?\$\$;',baseline,re.S)
        assert table and writer
        # Replace only the inherited eight-argument no-op fixture, not a real
        # schema object: production has the canonical nine-argument default.
        cls.h.sql('DROP FUNCTION _device_ui_lease_audit(uuid,uuid,text,text,text,uuid,uuid,text);')
        cls.h.sql(table.group(0)+'\n'+writer.group(0))
        cls.h.sql((ROOT/'supabase/migrations/20260907142233_fleet_device_lock_exact_operation_receipts_v1.sql').read_text())

    def setUp(self):
        super().setUp()
        self.h.sql('TRUNCATE device_ui_lease_events;')
        self.calls=[]
        self.python_namespace['supabase_client']=types.SimpleNamespace(call_rpc_once=self.record_rpc)
        self.python_namespace['_load_device_lock']=lambda *a,**kw: (_ for _ in ()).throw(AssertionError('current-token lookup forbidden'))

    def sql_rpc(self,name,params,**kwargs):
        def literal(value):
            if value is None:return 'NULL'
            if isinstance(value,(dict,list)):value=json.dumps(value)
            if type(value) is int:return str(value)
            return "'"+str(value).replace("'","''")+"'"
        result=self.h.sql("SET ROLE service_role; SET request.jwt.claim.role='service_role'; SELECT "+name+'('+','.join(k+'=>'+literal(v) for k,v in params.items())+');')
        return json.loads(result.stdout.strip().splitlines()[-1])

    def record_rpc(self,name,params,**kwargs):
        self.calls.append((name,dict(params)))
        return self.sql_rpc(name,params,**kwargs)

    def release_args(self,b):
        return dict(device_id=b['device_id'],worker_id=b['worker_id'],request_id=b['request_id'],
                    expected_lease_id=b['lease_id'],account_id=b['account_id'])

    def transfer_args(self,b):
        self.h.sql("UPDATE account_run_requests SET status='claimed',claimed_by='dispatcher' WHERE id='"+b['request_id']+"';")
        return dict(device_id=b['device_id'],request_id=b['request_id'],new_worker_id='dispatcher',
                    previous_worker_id=b['worker_id'],expected_lease_id=b['lease_id'],
                    account_id=b['account_id'],lease_seconds=b['lease_seconds'])

    def test_python_full_acquire_transfer_renew_release(self):
        b=self.new_binding()
        moved=self.python_namespace['transfer_device_lock'](**self.transfer_args(b))
        self.assertTrue(moved['transferred'],moved)
        self.assertNotEqual(moved['lease_id'],b['lease_id'])
        self.assertTrue(self.python_namespace['renew_device_lock'](**self.release_args(moved))['renewed'])
        self.assertFalse(self.python_namespace['release_device_lock'](**self.release_args(b))['released'])
        self.assertTrue(self.python_namespace['release_device_lock'](**self.release_args(moved))['released'])
        self.assertEqual(len(self.calls),4)

    def test_no_token_means_no_rpc(self):
        b=self.new_binding(); args=self.release_args(b);args.pop('expected_lease_id')
        self.assertFalse(self.python_namespace['release_device_lock'](**args)['released'])
        self.assertFalse(self.python_namespace['renew_device_lock'](**args)['renewed'])
        self.assertFalse(self.python_namespace['release_device_lock_for_request'](**args)['released'])
        self.assertEqual(self.calls,[])

    def test_release_for_request_never_adopts_successor(self):
        b=self.new_binding()
        self.assertFalse(self.python_namespace['release_device_lock_for_request'](**self.release_args(self.old_binding()))['released'])
        self.assertTrue(self.python_namespace['release_device_lock_for_request'](**self.release_args(b))['released'])

    def lose_response(self,operation):
        def call(name,params,**kwargs):
            result=self.record_rpc(name,params,**kwargs)
            if name=='auto_restart_'+operation+'_device_lock':raise TimeoutError('committed response lost')
            return result
        self.python_namespace['supabase_client']=types.SimpleNamespace(call_rpc_once=call)

    def test_release_lost_response_exact_receipt_no_second_mutation(self):
        b=self.new_binding();self.lose_response('release')
        result=self.python_namespace['release_device_lock'](**self.release_args(b))
        self.assertTrue(result['released'],result);self.assertTrue(result['reconciled'])
        self.assertEqual([c[0] for c in self.calls],['auto_restart_release_device_lock','fleet_device_lock_operation_receipt_v1'])
        self.assertEqual(self.h.sql("SELECT count(*) FROM device_ui_lease_events WHERE event_type='released';").stdout.strip().splitlines()[-1],'1')

    def test_transfer_lost_response_exact_receipt(self):
        b=self.new_binding();args=self.transfer_args(b);self.lose_response('transfer')
        result=self.python_namespace['transfer_device_lock'](**args)
        self.assertTrue(result['transferred'],result);self.assertTrue(result['reconciled'])
        self.assertEqual(len(self.calls),2)
        self.assertNotEqual(result['lease_id'],b['lease_id'])

    def test_receipt_recovery_rejects_wrong_owner_and_replaced_generation(self):
        b=self.new_binding();self.lose_response('transfer')
        result=self.python_namespace['transfer_device_lock'](**self.transfer_args(b))
        params=self.calls[0][1]
        forged={**params,'p_previous_worker_id':'other-owner'}
        self.assertFalse(self.sql_rpc('fleet_device_lock_operation_receipt_v1',{'p_operation':'transfer','p_expected':forged})['ok'])
        self.assertTrue(self.release(result)['released'])
        self.assertFalse(self.sql_rpc('fleet_device_lock_operation_receipt_v1',{'p_operation':'transfer','p_expected':params})['ok'])

    def test_binding_is_exact_and_copied(self):
        b=self.new_binding();request={'metadata_safe':{'device_lock_binding':b}}
        reader=self.python_namespace['device_lock_binding_from_request']
        result=reader(request,account_id=b['account_id'],request_id=b['request_id'],device_id=b['device_id'])
        self.assertEqual(result,b);self.assertIsNot(result,b)
        with self.assertRaises(ValueError):reader(request,account_id='wrong',request_id=b['request_id'])
        request['metadata_safe']['device_lock_binding']={**b,'generation':'wrong'}
        with self.assertRaises(ValueError):reader(request,account_id=b['account_id'],request_id=b['request_id'])

    def test_all_worker_mutation_calls_supply_captured_token(self):
        for filename in ('account_run_request_consumer.py','scheduled_session_preflight_control.py'):
            tree=ast.parse((f.WORKER/filename).read_text())
            for node in ast.walk(tree):
                if isinstance(node,ast.Call) and isinstance(node.func,ast.Name):
                    if node.func.id in ('renew_device_lock','release_device_lock','release_device_lock_for_request','transfer_device_lock'):
                        names={k.arg for k in node.keywords}
                        self.assertIn('expected_lease_id',names,(filename,node.lineno))
                        self.assertIn('account_id',names,(filename,node.lineno))
                    self.assertNotEqual(node.func.id,'acquire_device_lock',(filename,node.lineno))

    def test_receipt_rpc_and_writer_not_callable_by_public_roles(self):
        result=self.h.sql("SELECT has_function_privilege('anon','fleet_device_lock_operation_receipt_v1(text,jsonb)','execute'),has_function_privilege('authenticated','_device_ui_lease_audit(uuid,uuid,text,text,text,uuid,uuid,text,jsonb)','execute');")
        self.assertEqual(result.stdout.strip().splitlines()[-1],'f|f')

class CanonicalAdmissionRecoveryTests(DeviceLockCallerTests):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.h.sql('''
          ALTER TABLE ig_accounts ADD COLUMN admin_lifecycle_status text DEFAULT 'active',ADD COLUMN username text;
          ALTER TABLE account_assignments ADD COLUMN starts_at timestamptz,ADD COLUMN ends_at timestamptz;
          CREATE TABLE phone_devices(id uuid PRIMARY KEY,status text);
          CREATE TABLE phone_app_instances(id uuid PRIMARY KEY,device_id uuid,is_launchable boolean,usable_for_auto_login boolean,status text,package_name text);
          ALTER TABLE account_run_requests ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
            ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,ADD COLUMN IF NOT EXISTS cancel_reason text,
            ADD COLUMN IF NOT EXISTS execution_attempt_no smallint DEFAULT 1,ADD COLUMN IF NOT EXISTS retry_index integer DEFAULT 0,
            ADD COLUMN IF NOT EXISTS root_business_session_id uuid,ADD COLUMN IF NOT EXISTS started_at timestamptz,
            ADD COLUMN IF NOT EXISTS updated_at timestamptz,ADD COLUMN IF NOT EXISTS completed_at timestamptz,
            ADD COLUMN IF NOT EXISTS error_code text,ADD COLUMN IF NOT EXISTS error_message_safe text;
          ALTER TABLE ig_runs ADD COLUMN started_at timestamptz,ADD COLUMN updated_at timestamptz,
            ADD COLUMN finished_at timestamptz,ADD COLUMN completed_at timestamptz;
          ALTER TABLE ig_runs ALTER COLUMN id SET DEFAULT gen_random_uuid();
          ALTER TABLE account_session_resume_plans ALTER COLUMN id SET DEFAULT gen_random_uuid();
          ALTER TABLE account_session_resume_plans ADD COLUMN IF NOT EXISTS run_request_id uuid,
            ADD COLUMN IF NOT EXISTS assignment_id uuid,ADD COLUMN IF NOT EXISTS device_id uuid,
            ADD COLUMN IF NOT EXISTS app_instance_id uuid,ADD COLUMN IF NOT EXISTS expected_username text,
            ADD COLUMN IF NOT EXISTS expected_package text,ADD COLUMN IF NOT EXISTS scheduled_window_start timestamptz,
            ADD COLUMN IF NOT EXISTS scheduled_window_end timestamptz,ADD COLUMN IF NOT EXISTS source_surface text,
            ADD COLUMN IF NOT EXISTS run_trigger text,ADD COLUMN IF NOT EXISTS resume_stage text,
            ADD COLUMN IF NOT EXISTS restart_allowed boolean,ADD COLUMN IF NOT EXISTS restart_block_reason text,
            ADD COLUMN IF NOT EXISTS attempts_in_window integer,ADD COLUMN IF NOT EXISTS zero_work_contract_version smallint,
            ADD COLUMN IF NOT EXISTS irreversible_work_state text,ADD COLUMN IF NOT EXISTS zero_work_certified_at timestamptz,
            ADD COLUMN IF NOT EXISTS terminal_reason_code text,ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
          ALTER TABLE auto_restart_device_locks ADD COLUMN metadata_safe jsonb,ADD COLUMN created_at timestamptz DEFAULT now();
          ALTER TABLE account_incidents ADD COLUMN IF NOT EXISTS severity text,ADD COLUMN IF NOT EXISTS incident_type text;
          CREATE OR REPLACE FUNCTION account_package_runtime_contract_status(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true}'::jsonb $$;
          CREATE OR REPLACE FUNCTION evaluate_account_schedule_gate(uuid,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('ok',true,'assignment_id',id) FROM account_assignments WHERE account_id=$1 LIMIT 1 $$;
        ''')
        source=(f.WORKER/'supabase/migrations/20260826021814_control_plane_reliability_v1.sql').read_text()
        for name in ('admit_account_run_attempt_v1','begin_device_activity_v1','mark_pre_device_safe_stop_v1','certify_zero_work_and_enqueue_recovery_v1'):
            match=re.search(r'create or replace function public\.'+name+r'\(.*?\n\$\$;',source,re.S)
            assert match,name
            cls.h.sql(match.group(0))
        cls.h.sql((ROOT/'supabase/migrations/20260907143123_fleet_admission_recovery_token_binding_v1.sql').read_text())

    def prepared_binding(self):
        b=self.new_binding();moved=self.python_namespace['transfer_device_lock'](**self.transfer_args(b))
        self.assertTrue(moved['transferred'],moved)
        instance='90000000-0000-0000-0000-000000000001'
        self.h.sql("TRUNCATE phone_devices,phone_app_instances;INSERT INTO phone_devices VALUES('"+b['device_id']+"','online');INSERT INTO phone_app_instances VALUES('"+instance+"','"+b['device_id']+"',true,true,'active','com.instagram.android');UPDATE account_assignments SET app_instance_id='"+instance+"',starts_at=now()-interval '1 hour',ends_at=now()+interval '1 hour';UPDATE account_run_requests SET requested_run_type='account_session',lease_expires_at=now()+interval '10 minutes',root_business_session_id=id WHERE id='"+b['request_id']+"';")
        assignment=self.h.sql('SELECT id FROM account_assignments LIMIT 1;').stdout.strip().splitlines()[-1]
        return moved,dict(p_request_id=moved['request_id'],p_worker_id=moved['worker_id'],
            p_assignment_id=assignment,p_device_id=moved['device_id'],p_app_instance_id=instance,
            p_expected_package='com.instagram.android',p_scheduled_window_start=None,p_scheduled_window_end=None,
            p_lease_seconds=300,p_expected_lease_id=moved['lease_id'])

    def test_real_admission_and_device_gate_reject_old_token(self):
        b,args=self.prepared_binding()
        self.assertFalse(self.sql_rpc('admit_account_run_attempt_v1',{**args,'p_expected_lease_id':f.f.LEASE})['ok'])
        admitted=self.sql_rpc('admit_account_run_attempt_v1',args)
        self.assertTrue(admitted['ok'],admitted)
        gate=dict(p_run_id=admitted['run_id'],p_request_id=b['request_id'],p_worker_id=b['worker_id'],p_expected_lease_id=f.f.LEASE)
        self.assertFalse(self.sql_rpc('begin_device_activity_v1',gate)['ok'])
        self.assertTrue(self.sql_rpc('begin_device_activity_v1',{**gate,'p_expected_lease_id':b['lease_id']})['ok'])

    def stopped_source(self):
        b,args=self.prepared_binding();a=self.sql_rpc('admit_account_run_attempt_v1',args)
        self.assertTrue(a['ok'],a)
        stopped=self.sql_rpc('mark_pre_device_safe_stop_v1',dict(p_run_id=a['run_id'],p_request_id=b['request_id'],p_worker_id=b['worker_id'],p_reason_code='PRE_DEVICE_SAFE_STOP'))
        self.assertTrue(stopped['ok'],stopped)
        return b,dict(p_source_run_id=a['run_id'],p_source_request_id=b['request_id'],
                      p_worker_id=b['worker_id'],p_lease_seconds=600,p_expected_lease_id=b['lease_id'])

    def test_real_recovery_rotates_and_exact_replay_is_non_mutating(self):
        b,args=self.stopped_source()
        self.assertFalse(self.sql_rpc('certify_zero_work_and_enqueue_recovery_v1',{**args,'p_expected_lease_id':f.f.LEASE})['ok'])
        result=self.sql_rpc('certify_zero_work_and_enqueue_recovery_v1',args)
        self.assertTrue(result['ok'],result)
        self.assertNotEqual(result['device_lock_binding']['lease_id'],b['lease_id'])
        replay=self.sql_rpc('certify_zero_work_and_enqueue_recovery_v1',args)
        self.assertTrue(replay['deduplicated'],replay)
        self.assertEqual(replay['device_lock_binding'],result['device_lock_binding'])
        self.assertFalse(self.python_namespace['renew_device_lock'](**self.release_args(b))['renewed'])
        self.assertFalse(self.python_namespace['release_device_lock'](**self.release_args(b))['released'])

    def test_worker_admission_and_runner_send_captured_token(self):
        for file,name,keyword in (('account_run_request_consumer.py','_admit_account_session_v1','device_lock_binding'),
                                  ('runner.py','begin_device_activity_v1','expected_lease_id')):
            tree=ast.parse((f.WORKER/file).read_text())
            calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and (isinstance(n.func,ast.Name) and n.func.id==name or isinstance(n.func,ast.Attribute) and n.func.attr==name)]
            self.assertTrue(calls,file)
            for call in calls:self.assertIn(keyword,{k.arg for k in call.keywords},(file,call.lineno))

if __name__=='__main__':unittest.main(verbosity=2)
