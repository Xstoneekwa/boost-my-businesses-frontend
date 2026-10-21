"""Complete Phase A DDL transaction on the captured empty PostgreSQL 17 schema.

Surrounding schema is the existing read-only catalog fixture; no business data,
phones, production credentials, or existing local database is modified.
"""
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import runpy
import uuid

ROOT=Path(__file__).resolve().parents[1]
PG=Path('/opt/homebrew/opt/postgresql@17/bin')
E=Path('/Users/admin/Projects/fleet-control-v1-evidence/phase-a-compatibility-20260908')


class Bundle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='fleet-phase-a-bundle-',dir='/private/tmp')
        cls.directory=Path(cls.tmp.name)
        cls.data=cls.directory/'data'
        cls.started=False
        cls.addClassCleanup(cls.cleanup)
        subprocess.run([str(PG/'initdb'),'-D',str(cls.data),'--auth=trust','--no-locale','-E','UTF8'],check=True,stdout=subprocess.DEVNULL)
        subprocess.run([str(PG/'pg_ctl'),'-D',str(cls.data),'-l',str(cls.directory/'server.log'),'-o',f"-k {cls.directory} -h '' -p 55485",'-w','start'],check=True,stdout=subprocess.DEVNULL)
        cls.started=True
        cls.sql((ROOT/'tests/fixtures/warmup-real-schema-20260906.sql').read_text())
        baseline=(ROOT/'supabase/baseline/20260728001632_public_schema.sql').read_text()
        for name in ('device_ui_lease_events','auto_restart_tick_locks','tenant_users'):
            match=re.search(r'CREATE TABLE IF NOT EXISTS "public"\."'+name+r'" \(.*?\n\);',baseline,re.S)
            assert match,name
            cls.sql(match[0])
            defaults=re.findall(r'ALTER TABLE ONLY "public"\."'+name+r'" ALTER COLUMN .*?;',baseline,re.S)
            if defaults: cls.sql('\n'.join(defaults))
        cls.sql((ROOT/'tests/fixtures/fleet-phase-a-live-boundaries-20260908.sql').read_text())
        cls.sql((ROOT/'tests/fixtures/fleet-phase-a-live-legacy-20260908.sql').read_text())
        cls.sql((ROOT/'tests/fixtures/fleet-phase-a-live-acl-20260908.sql').read_text())
        cls.sql('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);')
        cls.sql((Path('/Users/admin/Projects/boost-ai-frontend/supabase/migrations')/'20260822120024_phonefarm_storage_apply_admission_barrier_v2.sql').read_text())
        cls.lease=runpy.run_path(str(ROOT/'tests/fleet-phase-a-compatibility-v1.py'))

    @classmethod
    def cleanup(cls):
        if cls.started:
            subprocess.run([str(PG/'pg_ctl'),'-D',str(cls.data),'-m','fast','-w','stop'],check=True,stdout=subprocess.DEVNULL)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls,source,check=True):
        result=subprocess.run([str(PG/'psql'),'-X','-qAt','-h',str(cls.directory),'-p','55485','-d','postgres','-v','ON_ERROR_STOP=1'],input=source,text=True,capture_output=True,timeout=150)
        if check and result.returncode: raise AssertionError(result.stderr)
        return result

    def test_complete_phase_a_atomic_apply_and_exact_retry(self):
        bundle=(E/'phase-a-atomic-apply.sql').read_text()
        inventory=json.loads((E/'migration-inventory.json').read_text())['phase_a']
        self.assertEqual(self.sql("select to_regclass('fleet_account_policy_v1') is null;").stdout.strip(),'t')
        self.cycle('baseline',tokenized=False)
        self.sql(bundle)
        self.assertEqual(self.sql('select count(*) from supabase_migrations.schema_migrations;').stdout.strip(),str(len(inventory)))
        self.sql(bundle)
        for m in inventory:
            result=self.sql("select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version='"+m['version']+"';")
            self.assertEqual(result.stdout.strip(),m['sha256'])
        self.assertEqual(self.sql("select count(*) from pg_constraint where conname='fleet_device_lease_request_required_v1';").stdout.strip(),'0')
        bad=self.sql("select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'auto_restart_%device_lock%' or p.proname in ('admit_account_run_attempt_v1','begin_device_activity_v1','certify_zero_work_and_enqueue_recovery_v1','create_account_run_request','consume_resume_authorization_and_create_request_v2','consume_resume_authorization_and_create_request_v3','consume_resume_authorization_and_create_request_v4')) and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')); ")
        self.assertEqual(bad.stdout.strip(),'')
        self.cycle('old_after_phase_a',tokenized=False)
        helper=self.helper()
        self.assertTrue(helper.rpc('acquire_phonefarm_storage_apply_barrier_v2',dict(p_owner_token='complete-phase-a-local',p_ttl_seconds=60,p_metadata_safe={}))['acquired'])
        self.sql("update phonefarm_runtime_barriers set expires_at=clock_timestamp()-interval '1 second';")
        self.assertFalse(helper.rpc('renew_phonefarm_storage_apply_barrier_v2',dict(p_owner_token='complete-phase-a-local',p_ttl_seconds=60))['renewed'])
        self.cycle('old_after_expiry',tokenized=False)
        self.controller_rehearsal(bundle)
        self.cycle('new_after_phase_a',tokenized=True)
        self.cycle('old_after_rollback',tokenized=False)
        subprocess.run([str(PG/'pg_ctl'),'-D',str(self.data),'-m','immediate','-w','stop'],check=True,stdout=subprocess.DEVNULL)
        subprocess.run([str(PG/'pg_ctl'),'-D',str(self.data),'-l',str(self.directory/'server.log'),'-o',f"-k {self.directory} -h '' -p 55485",'-w','start'],check=True,stdout=subprocess.DEVNULL)
        self.sql(bundle)
        self.cycle('old_after_crash',tokenized=False)
        self.cycle('new_after_crash',tokenized=True)

    def controller_rehearsal(self,bundle):
        import hashlib
        import sys
        from contextlib import ExitStack
        from unittest import mock
        controller=Path('/Library/Application Support/Follow60-ControllerWorkV1-promotion-two-phase-v1-5ad4b1d0-955a-4a77-a20a-8c72cd262217/envelope/candidate')
        sys.path.insert(0,str(controller))
        import phonefarm_runtime_control as ctl
        from startup_tick_skip_token import consume_startup_skip_token
        writer=runpy.run_path(str(controller/'tests/test_phonefarm_runtime_control.py'))['_worker_release']
        base=self.directory/'controller'
        old=base/'releases/old';new=base/'releases/new'
        writer(old);writer(new)
        current=base/'current';current.symlink_to(old)
        runtime=base/'runtime';(runtime/'run/run-control-dispatcher').mkdir(parents=True)
        paths=ctl.RuntimePaths(current,base/'releases',runtime,base/'legacy')
        old_sha='feb5086cb329e295c195cc2c35b879a1a48fd684'
        new_sha='520624439a5bb199d5e486483d94baf594932a8a'
        plan=dict(candidate_root=str(new),previous_root=str(old),candidate_sha=new_sha,previous_sha=old_sha,
            phase_a_sql=dict(sha256=hashlib.sha256(bundle.encode()).hexdigest()),phase_b='DEFERRED')
        events=[]
        def rpc(name,payload,p):
            events.append(name)
            return self.helper().rpc(name,payload)
        def apply(p,sql,paths):
            self.assertEqual(hashlib.sha256(sql).hexdigest(),p['phase_a_sql']['sha256'])
            self.sql(sql.decode())
            events.append('phase_a_committed')
            return dict(status='PASS',sha256=p['phase_a_sql']['sha256'])
        def restart(component,command,**kwargs):
            self.assertEqual(current.resolve(),new)
            events.append('restart_'+component)
            if component=='dispatcher':
                consumed=consume_startup_skip_token(paths.run_dir/'run-control-dispatcher'/ctl.TOKEN_FILENAME,runtime)
                self.assertTrue(consumed['consumed'],consumed)
            return {'ok':True}
        zero=dict(ok=True,counts=dict(account_run_requests=0,ig_runs=0,auto_restart_device_locks=0,auto_restart_tick_locks=0))
        # Only external certification/OS process/registry boundaries are simulated.
        # Real controller flow, SQL barrier, SQL commit, symlink, receipt bytes,
        # startup token inode consumption and exact verification all execute.
        with ExitStack() as stack:
            patches=dict(runtime_paths=mock.Mock(return_value=paths),DEFAULT_CURRENT_LINK=current,
                DEFAULT_RELEASES_DIR=base/'releases',DEFAULT_RUNTIME_HOME=runtime,
                _two_phase_plan=mock.Mock(return_value=(plan,bundle.encode())),
                _two_phase_rpc=rpc,_two_phase_apply=apply,
                _git_full_commit=lambda p:new_sha if p==new else old_sha,
                _git_commit=lambda p:new_sha if p==new else old_sha,
                verify_deployment_candidate=mock.Mock(return_value={'ok':True,'manifest_sha256':'fixture'}),
                _validate_release_evidence=mock.Mock(return_value=dict(ok=True,candidate_sha=new_sha,
                    build={'protected_diff_status':'PASS'},migration={'applied_versions':['fixture']},lineage={'validated_migrations':[]})),
                _promotion_service_context=mock.Mock(return_value={'uid':501,'user':'admin','home':'/Users/admin'}),
                deployment_zero_gate=mock.Mock(return_value=zero),
                _atomic_update_worker_registry=mock.Mock(),_canonical_registry_path=lambda:base/'registry.json',
                _publish_immutable_receipt=lambda staged,final:staged.replace(final),
                _run_canonical_controller=restart,
                canonical_service_snapshot=mock.Mock(return_value=dict(ok=True,active_root=str(new),active_sha=new_sha,services={})))
            for name,value in patches.items():stack.enter_context(mock.patch.object(ctl,name,value))
            stack.enter_context(mock.patch('follow60_external_deployment_lock_v2.DeploymentTransaction'))
            result=ctl.promote_two_phase()
            self.assertTrue(result['ok'],result)
            self.assertTrue(result['serviceConvergence']['startupTokenGate']['ok'])
            self.assertEqual(current.resolve(),new)
            receipt=json.loads(Path(result['promotionReceipt']).read_text())
            self.assertEqual(receipt['two_phase']['phase_a']['sha256'],plan['phase_a_sql']['sha256'])
            self.assertEqual(events[0],'acquire_phonefarm_storage_apply_barrier_v2')
            self.assertLess(events.index('phase_a_committed'),events.index('restart_dispatcher'))
            self.assertEqual(events[-1],'release_phonefarm_storage_apply_barrier_v2')
            # No schema rollback: only the disposable current link returns old.
            ctl._atomic_switch_runtime_root(current,str(old))
            self.assertEqual(current.resolve(),old)

    def helper(self):
        h=self.lease['PhaseA']('test_feb5086_acquire_bind_renew_transfer_release')
        h.h=self
        return h

    def cycle(self,tag,tokenized):
        seed=(ROOT/'tests/fixtures/warmup-real-cases.sql').read_text()
        if self.sql('select count(*) from commercial_packages;').stdout.strip()!='0':
            seed=seed[:seed.index('SET LOCAL ROLE service_role;')]
        self.sql('begin;'+seed+f"reset role;select pg_temp.seed_account('{tag}','pro',120,false);commit;")
        account,device,instance=[self.sql(f"select md5('{kind}:{tag}')::uuid;").stdout.strip() for kind in ('account','device','app')]
        h=self.helper()
        caller=h.caller(self.lease['NEW'] if tokenized else self.lease['OLD'])
        if not tokenized:
            result=caller['acquire_device_lock'](device_id=device,worker_id='fixture-dispatcher',account_id=account,app_instance_id=instance)
            self.assertTrue(result['acquired'],result)
        args=dict(p_account_id=account,p_source_surface='instagram_dashboard',p_idempotency_key=str(uuid.uuid4()),p_metadata_safe=dict(worker_id='fixture-dispatcher',device_lock_lease_seconds=900))
        sql_args=','.join(k+'=>'+h.quote(v) for k,v in args.items())
        row=json.loads(self.sql('set role service_role; select to_jsonb(create_account_run_request('+sql_args+'));').stdout)
        self.sql("update account_run_requests set status='claimed',claimed_by='consumer' where id='"+row['id']+"';")
        move=dict(device_id=device,request_id=row['id'],new_worker_id='consumer')
        if tokenized:
            b=row['metadata_safe']['device_lock_binding']
            move.update(previous_worker_id=b['worker_id'],expected_lease_id=b['lease_id'],account_id=account,lease_seconds=900)
        else:
            self.assertTrue(caller['bind_device_lock_to_request'](device_id=device,worker_id='fixture-dispatcher',request_id=row['id'])['bound'])
        result=caller['transfer_device_lock'](**move)
        self.assertTrue(result['transferred'],result)
        args=dict(device_id=device,worker_id='consumer',request_id=row['id'])
        if tokenized: args.update(expected_lease_id=result['lease_id'],account_id=account)
        self.assertTrue(caller['renew_device_lock'](**args)['renewed'])
        self.assertTrue(caller['release_device_lock'](**args)['released'])
        self.sql("update account_run_requests set status='completed' where id='"+row['id']+"';")


if __name__=='__main__':unittest.main(verbosity=2)
