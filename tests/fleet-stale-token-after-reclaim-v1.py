"""Real SQL token mutations and Python renewal against local PostgreSQL only."""
import ast
import concurrent.futures
import datetime
import importlib.util
import json
import os
import pathlib
import re
import types
import unittest
import uuid

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('reclaim_fixture',ROOT/'tests/fleet-safe-expired-lease-reclaim-v1.py')
f=importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
WORKER=pathlib.Path('/Library/Application Support/PhoneFarm-Follow60-WorkV1-FullHistory-20260906/fleet-control-v1-692838b7-d682-40b7-ac61-4cc6ab124a08')


class StaleTokenAfterReclaim(f.SafeReclaim):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        source=(ROOT/'supabase/migrations/20260906171034_fleet_admission_authority_v1.sql').read_text()
        matches=list(re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+public\.auto_restart_renew_device_lock\(.*?\bas\s+\$(\w*)\$.*?\$\1\$;',source,re.S|re.I))
        matches=[m.group(0) for m in matches if 'p_expected_lease_id' in m.group(0)]
        if len(matches)!=1: raise AssertionError('canonical tokenized renewal missing/ambiguous')
        cls.h.sql(matches[0])
        cls.h.sql("CREATE FUNCTION auto_restart_release_device_lock(p_device_id uuid,p_worker_id text,p_request_id uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN DELETE FROM auto_restart_device_locks WHERE device_id=p_device_id; RETURN '{\"ok\":true,\"released\":true}'::jsonb; END $$;")
        cls.h.sql((ROOT/'supabase/migrations/20260907140225_fleet_device_lease_release_transfer_fencing_v1.sql').read_text())
        tree=ast.parse((WORKER/'auto_restart_device_lock.py').read_text())
        cls.python_namespace={'datetime':datetime.datetime,'timezone':datetime.timezone,'timedelta':datetime.timedelta,'os':os,'uuid':uuid,'UUID':uuid.UUID,'Any':object,'log':lambda *a,**kw:None}
        nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) or isinstance(n,ast.ImportFrom) and n.module=='__future__']
        exec(compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),'isolated-real-device-lock-functions','exec'),cls.python_namespace)

    def sql_rpc(self,name,params,**kwargs):
        def literal(value):
            if value is None:return 'NULL'
            if isinstance(value,int):return str(value)
            return "'"+str(value).replace("'","''")+"'"
        args=','.join(k+'=>'+literal(v) for k,v in params.items())
        result=self.h.sql('SELECT '+name+'('+args+');')
        return json.loads(result.stdout.strip().splitlines()[-1])

    def new_binding(self):
        self.proof(); result=self.enqueue()
        self.assertEqual(result.returncode,0,result.stderr)
        return json.loads(result.stdout.strip().splitlines()[-1])['metadata_safe']['device_lock_binding']

    def release(self,b):
        return self.sql_rpc('auto_restart_release_device_lock',{'p_device_id':b['device_id'],'p_worker_id':b['worker_id'],'p_request_id':b['request_id'],'p_expected_lease_id':b['lease_id'],'p_account_id':b['account_id']})

    def old_binding(self):
        return {'device_id':f.f.D,'worker_id':'old-owner','request_id':f.f.RUN,'lease_id':f.LEASE,'account_id':f.f.A}

    def test_real_python_renew_old_rejected_current_accepted(self):
        b=self.new_binding()
        self.python_namespace['call_rpc_once']=self.sql_rpc
        self.python_namespace['call_rpc']=self.sql_rpc
        self.python_namespace['supabase_client']=types.SimpleNamespace(call_rpc_once=self.sql_rpc)
        self.python_namespace['_load_device_lock']=lambda *a,**kw: (_ for _ in ()).throw(AssertionError('no token lookup allowed'))
        renew=self.python_namespace['renew_device_lock']
        old=self.old_binding()
        result=renew(device_id=old['device_id'],worker_id=old['worker_id'],request_id=old['request_id'],expected_lease_id=old['lease_id'],account_id=old['account_id'])
        self.assertFalse(result.get('renewed'),result)
        result=renew(device_id=b['device_id'],worker_id=b['worker_id'],request_id=b['request_id'],expected_lease_id=b['lease_id'],account_id=b['account_id'])
        self.assertTrue(result.get('renewed'),result)

    def test_old_release_cannot_remove_new_owner(self):
        b=self.new_binding()
        self.assertFalse(self.release(self.old_binding())['released'])
        self.assertEqual(self.h.sql('SELECT lease_id FROM auto_restart_device_locks;').stdout.strip().splitlines()[-1],b['lease_id'])
        self.assertTrue(self.release(b)['released'])

    def test_same_dispatcher_transfer_rotates_generation(self):
        b=self.new_binding()
        self.h.sql("UPDATE account_run_requests SET status='claimed',claimed_by='new-owner' WHERE id='"+b['request_id']+"';")
        args={'p_device_id':b['device_id'],'p_request_id':b['request_id'],'p_new_worker_id':'new-owner','p_previous_worker_id':'new-owner','p_expected_lease_id':b['lease_id'],'p_account_id':b['account_id'],'p_lease_seconds':600}
        moved=self.sql_rpc('auto_restart_transfer_device_lock',args)
        self.assertTrue(moved['transferred'])
        self.assertNotEqual(moved['lease_id'],b['lease_id'])
        self.assertFalse(self.sql_rpc('auto_restart_transfer_device_lock',args)['transferred'])
        self.assertFalse(self.release(b)['released'])
        self.assertTrue(self.release(moved)['released'])

    def test_legacy_release_overload_explicitly_closed(self):
        b=self.new_binding()
        result=self.h.sql("SELECT auto_restart_release_device_lock('"+b['device_id']+"','new-owner','"+b['request_id']+"','legacy');",check=False)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('device_lock_token_required',result.stderr)
        self.assertEqual(self.h.sql('SELECT lease_id FROM auto_restart_device_locks;').stdout.strip().splitlines()[-1],b['lease_id'])

    def test_reclaim_races_old_release_without_deleting_successor(self):
        self.proof()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            a=pool.submit(self.enqueue); b=pool.submit(self.release,self.old_binding())
            result=a.result(); b.result()
        self.assertEqual(result.returncode,0,result.stderr)
        binding=json.loads(result.stdout.strip().splitlines()[-1])['metadata_safe']['device_lock_binding']
        self.assertFalse(self.release(self.old_binding())['released'])
        self.assertEqual(self.h.sql('SELECT lease_id FROM auto_restart_device_locks;').stdout.strip().splitlines()[-1],binding['lease_id'])


if __name__=='__main__':unittest.main(verbosity=2)
