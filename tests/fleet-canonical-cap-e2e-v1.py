"""Policy RPC -> persisted owner -> consumer/channel -> actual Runner boundary -> ACK RPC.

The admitted request is an explicit fixture precondition. Normal caps and daily
counts are calculated by canonical SQL, never replaced with constant providers.
All database writes are confined to a disposable clone of the local warmup fixture.
"""
from __future__ import annotations

import ast
from datetime import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import uuid
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
WORKER = Path('/Library/Application Support/PhoneFarm-Follow60-WorkV1-FullHistory-20260906/'
              'fleet-control-v1-692838b7-d682-40b7-ac61-4cc6ab124a08')
PG = '/opt/homebrew/opt/postgresql@17/bin/'
SOCKET = '/private/tmp/botapp-warmup-representative-v2'
EVIDENCE = Path('/Users/admin/Projects/fleet-control-v1-evidence/'
                'admission-claim-metadata-20260907.IMzMoc')


def quoted(value):
    return "'" + str(value).replace("'", "''") + "'"


def function_sql(source, name):
    matches = list(re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+public\.'
                              + re.escape(name) + r'\b.*?\bas\s+\$(\w*)\$.*?\$\1\$\s*;',
                              source, re.I | re.S))
    if len(matches) != 1:
        raise AssertionError('exact canonical function required: ' + name)
    return matches[0][0]


class CanonicalCapE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = 'fleet_cap_e2e_' + uuid.uuid4().hex[:12]
        cls.pg_args = ['-h', SOCKET, '-U', 'admin']
        subprocess.run([PG + 'createdb', *cls.pg_args, '-T', 'warmup_real_matrix', cls.database], check=True)
        cls.addClassCleanup(lambda: subprocess.run([PG + 'dropdb', *cls.pg_args, cls.database], check=True))
        if cls.scalar('SELECT count(*) FROM ig_accounts') != '0':
            raise AssertionError('fixture template must contain no accounts')
        metadata = json.loads(EVIDENCE.read_text())
        definitions = runpy.run_path(str(ROOT / 'tests/fleet-hold-enqueue-serialization-v1.py'))['DEFINITIONS']
        cls.sql('\n'.join(row['definition'] + ';' for row in definitions + metadata['functions']))
        for name in ['20260906171034_fleet_admission_authority_v1.sql',
                     '20260907193846_fleet_policy_mutation_caller_v1.sql']:
            if 'policy_mutation' in name:
                cls.sql('CREATE TABLE tenant_users(user_id uuid,tenant_id uuid,role text);')
            cls.sql((ROOT / 'supabase/migrations' / name).read_text())
        counts = (ROOT / 'supabase/migrations/20260727160438_instagram_restriction_preflight_auto_restart_v1.sql').read_text()
        cls.sql(function_sql(counts, 'auto_restart_daily_action_counts_v1'))
        cls.temporary = tempfile.TemporaryDirectory(prefix='fleet-cap-e2e-')
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.channel_root = Path(cls.temporary.name).resolve()
        spec = importlib.util.spec_from_file_location('fleet_runtime_barrier', WORKER / 'fleet_runtime_barrier.py')
        cls.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.runtime)
        runtime_artifacts = types.ModuleType('runtime_artifacts')

        def runtime_artifact_path(namespace, token):
            if namespace != 'fleet-control-v1' or not re.fullmatch('[0-9a-f]{64}', token):
                raise AssertionError('outside fixture artifact request')
            return cls.channel_root / token

        runtime_artifacts.runtime_artifact_path = runtime_artifact_path
        cls.modules = patch.dict(sys.modules, {'fleet_runtime_barrier': cls.runtime,
                                               'runtime_artifacts': runtime_artifacts})
        cls.modules.start()
        cls.addClassCleanup(cls.modules.stop)
        adapter_source = ast.parse((WORKER / 'supabase_client.py').read_text())
        adapter = [n for n in adapter_source.body if isinstance(n, ast.FunctionDef)
                   and n.name == 'fleet_follow_boundary_local_v1']
        if len(adapter) != 1:
            raise AssertionError('actual Runner adapter missing')
        future = ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)
        module = ast.fix_missing_locations(ast.Module(body=[future, *adapter], type_ignores=[]))
        cls.adapter_globals = dict(os=os, re=re, json=json, datetime=datetime,
                                   BUSINESS_TIMEZONE=ZoneInfo('Africa/Johannesburg'),
                                   _FLEET_RUNNER_BOUNDARIES_V1={})
        exec(compile(module, str(WORKER / 'supabase_client.py'), 'exec'), cls.adapter_globals)
        cls.adapter = types.SimpleNamespace(fleet_follow_boundary_local_v1=cls.adapter_globals['fleet_follow_boundary_local_v1'])
        runner = ast.parse((WORKER / 'runner.py').read_text())
        slices = []
        for parent in ast.walk(runner):
            body = getattr(parent, 'body', None)
            if not isinstance(body, list):
                continue
            for index, statement in enumerate(body[:-1]):
                if (isinstance(statement, ast.Assign) and any(isinstance(t, ast.Name)
                        and t.id == '_fleet_cap_boundary' for t in statement.targets)):
                    slices.append(body[index:index + 2])
        if len(slices) != 1 or not isinstance(slices[0][1], ast.If):
            raise AssertionError('exact actual Runner safe-boundary slice required')
        cls.runner_slice = slices[0]
        cls.rpc_calls = {}

    @classmethod
    def sql(cls, statement, check=True):
        result = subprocess.run([PG + 'psql', '-X', '-qAt', *cls.pg_args, '-d', cls.database,
                                 '-v', 'ON_ERROR_STOP=1'], input=statement, text=True,
                                capture_output=True, timeout=30)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result

    @classmethod
    def scalar(cls, statement):
        return cls.sql(statement).stdout.strip().splitlines()[-1]

    @classmethod
    def rpc(cls, name, payload, check=True):
        cls.rpc_calls[name] = cls.rpc_calls.get(name, 0) + 1
        result = cls.sql("BEGIN; SET LOCAL ROLE service_role; "
                         "SET LOCAL request.jwt.claim.role='service_role'; SELECT public."
                         + name + '(' + quoted(json.dumps(payload)) + '::jsonb); COMMIT;', check)
        if result.returncode:
            return result
        return json.loads(result.stdout.strip().splitlines()[-1])

    def seed(self, tag, consumed, normal, prior_days=3, override=None):
        tag += '_' + uuid.uuid4().hex[:8]
        setup = (ROOT / 'tests/fixtures/warmup-real-cases.sql').read_text()
        # Shared package rows are already seeded after the first scenario.
        setup = setup[:setup.index('SET LOCAL ROLE service_role;')]
        packages = self.scalar('SELECT count(*) FROM commercial_packages')
        if packages == '0':
            setup = (ROOT / 'tests/fixtures/warmup-real-cases.sql').read_text()
        aid = self.scalar("SELECT md5('account:" + tag + "')::uuid")
        rid, qid, actor = (str(uuid.uuid4()) for _ in range(3))
        instance, boot = 'cap-instance-' + uuid.uuid4().hex, 'cap-boot-' + uuid.uuid4().hex
        override_sql = 'NULL' if override is None else str(override)
        statement = 'BEGIN; ' + setup + f"""
          SELECT pg_temp.seed_account('{tag}','pro',120,false,{override_sql});
          SELECT pg_temp.seed_verified_follow_days('{aid}',{prior_days});
          INSERT INTO ig_runs(id,account_id) VALUES('{rid}','{aid}');
          INSERT INTO ig_interacted_users(account_id,run_id,username,interaction_type,was_successful,followed_at)
            SELECT '{aid}','{rid}','cap_today_'||i,'follow',true,now() FROM generate_series(1,{consumed}) i;
          INSERT INTO ig_interaction_events(account_id,run_id,username,event_type,event_status,interaction_type,interaction_status,event_at)
            SELECT '{aid}','{rid}','cap_today_'||i,'follow_verified_persisted_v1','success','follow','success',now()
            FROM generate_series(1,{consumed}) i;
          RESET ROLE;
          INSERT INTO tenant_users(user_id,tenant_id,role)
            SELECT '{actor}',client_id,'superadmin' FROM client_instagram_accounts WHERE account_id='{aid}';
          COMMIT;
        """
        self.sql(statement)
        contract = json.loads(self.scalar(f"SELECT account_package_runtime_contract_status('{aid}')"))
        self.assertTrue(contract['ok'], contract)
        self.assertEqual(contract['settings']['follow_day']['effective'], normal)
        tenant = self.scalar(f"SELECT client_id FROM client_instagram_accounts WHERE account_id='{aid}'")
        policy = self.rpc('fleet_mutate_policy_v1', dict(actor_id=actor,account_id=aid,tenant_id=tenant,
                          request_id=str(uuid.uuid4()),action='set_cap',expected_revision=None,cap=60))
        self.assertEqual(policy['current_policy']['revision'], 1)
        binding = dict(account_id=aid,request_id=qid,attempt_id=rid,
                       consumer_instance_id=instance,consumer_boot_id=boot)
        # Only admission is a fixture precondition. All cap/count inputs are SQL-derived.
        self.sql(f"""INSERT INTO account_run_requests(id,account_id,requested_run_type,status,
          idempotency_key,run_id,claimed_by,root_business_session_id,execution_attempt_no,retry_index,fleet_runtime_v1)
          SELECT '{qid}','{aid}','full_cycle','claimed','cap-e2e-{qid}','{rid}','{instance}','{qid}',1,0,
          jsonb_build_object('schema','FLEET_EXECUTION_AUTHORITY_V1','execution_registered',false,
            'tenant_id','{tenant}','account_id','{aid}','request_id','{qid}','attempt_id','{rid}',
            'consumer_instance_id','{instance}','consumer_boot_id',NULL,'attempt_revision',1,'revision',1,
            'business_day',(now() AT TIME ZONE 'Africa/Johannesburg')::date::text,
            'normal_effective_day_cap',account_package_runtime_contract_status('{aid}')#>'{{settings,follow_day,effective}}',
            'canonical_follows_before_run',(SELECT coalesce(max(follow_done),0) FROM auto_restart_daily_action_counts_v1(
              ARRAY['{aid}'::uuid],((now() AT TIME ZONE 'Africa/Johannesburg')::date)::timestamp AT TIME ZONE 'Africa/Johannesburg')),
            'hold','CLEARED','emergency_cap',60);""")
        registered = self.rpc('fleet_register_execution_attempt_v1',
                              dict(binding,revision=1,registration_intent='REGISTER_OR_RETRY'))
        self.assertEqual(registered['authority']['canonical_follows_before_run'], consumed)

        def send(operation, payload):
            self.assertEqual(operation, 'cap_ack')
            return self.rpc('fleet_ack_cap_revision_v1', payload)

        session = self.runtime.FleetConsumerSession(binding=binding,authority=registered['authority'],
                                                   root=self.channel_root,rpc=send)
        return dict(binding=binding,session=session,actor=actor,tenant=tenant,consumed=consumed,normal=normal)

    def mutation(self, case, action, revision, cap=None):
        payload = dict(actor_id=case['actor'],account_id=case['binding']['account_id'],tenant_id=case['tenant'],
                       request_id=str(uuid.uuid4()),action=action,expected_revision=revision)
        if cap is not None:
            payload['cap'] = cap
        return self.rpc('fleet_mutate_policy_v1', payload)

    def boundary(self, case, remaining):
        before = sum(self.rpc_calls.values())
        env = dict(case['session'].environment())
        globals_ = dict(supabase_client=self.adapter,account_id=case['binding']['account_id'],
                        run_request_id=case['binding']['request_id'],_RUNTIME_FOLLOW_COUNT=0,
                        _mark_global_follow_cap_reached=lambda **kw: None,candidate_selected=False)
        selected = ast.parse('candidate_selected = True').body
        loop = ast.For(target=ast.Name(id='_fixture_once',ctx=ast.Store()),
                       iter=ast.Tuple(elts=[ast.Constant(value=1)],ctx=ast.Load()),
                       body=self.runner_slice + selected,orelse=[])
        module = ast.fix_missing_locations(ast.Module(body=[loop],type_ignores=[]))
        with patch.dict(os.environ, env):
            exec(compile(module,str(WORKER / 'runner.py'),'exec'),globals_)
        self.assertEqual(sum(self.rpc_calls.values()), before, 'no per-candidate RPC')
        self.assertEqual(globals_['_fleet_cap_boundary']['remaining'], remaining)
        self.assertEqual(globals_['candidate_selected'], remaining > 0)
        self.assertTrue(case['session'].flush_cap_ack())
        revision = globals_['_fleet_cap_boundary']['revision']
        aid = case['binding']['account_id']
        self.assertEqual(self.scalar(f"""SELECT count(*)>0 AND bool_and(EXISTS(
          SELECT 1 FROM fleet_cap_acks_v1 a WHERE a.account_id=o.account_id AND a.request_id=o.request_id
          AND a.attempt_id=o.attempt_id AND a.consumer_instance_id=o.consumer_instance_id
          AND a.consumer_boot_id=o.consumer_boot_id AND a.revision={revision}))
          FROM fleet_runtime_owners_v1 o WHERE account_id='{aid}' AND NOT retired"""), 't')
        return globals_['_fleet_cap_boundary']

    def refresh(self, case, revision):
        registered = self.rpc('fleet_register_execution_attempt_v1',
                             dict(case['binding'],revision=revision,registration_intent='REGISTER_OR_RETRY'))
        case['session'].observe(registered['authority'])

    def test_real_cap_chain(self):
        case = self.seed('normal',52,120)
        self.boundary(case,8)
        old_ack = case['session'].channel.read('cap-ack.json')
        self.mutation(case,'set_cap',1,55)
        stale = self.rpc('fleet_ack_cap_revision_v1',dict(case['binding'],revision=1,boundary_ack=old_ack),False)
        self.assertNotEqual(stale.returncode,0)
        self.assertIn('fleet_stale_owner_revision',stale.stderr)
        self.refresh(case,2)
        self.boundary(case,3)
        self.mutation(case,'remove_cap',2)
        self.refresh(case,3)
        self.assertEqual(self.boundary(case,68)['effective_day_cap'],120)
        self.boundary(self.seed('consumed',65,120),0)
        for tag,prior,override in [('manual',3,20),('warmup',1,None)]:
            case = self.seed(tag,0,20,prior,override)
            aid = case['binding']['account_id']
            snapshot_sql = f"""SELECT jsonb_build_object(
              'settings',(SELECT to_jsonb(s) FROM ig_account_settings s WHERE account_id='{aid}'),
              'warmup',(SELECT to_jsonb(w) FROM account_warmup_settings w WHERE account_id='{aid}'),
              'package',(SELECT jsonb_agg(to_jsonb(p)) FROM account_commercial_packages p WHERE account_id='{aid}'))"""
            before = self.scalar(snapshot_sql)
            self.assertEqual(self.boundary(case,20)['effective_day_cap'],20)
            self.mutation(case,'remove_cap',1)
            self.refresh(case,2)
            self.assertEqual(self.boundary(case,20)['effective_day_cap'],20)
            self.assertEqual(self.scalar(snapshot_sql),before)
        print(json.dumps(dict(EMERGENCY_CAP_E2E='PASS',CAP_REVISION_FENCING='PASS',
              CAP_BELOW_CONSUMED='PASS',MANUAL_OVERRIDE_PRESERVED='PASS',WARMUP_PRESERVED='PASS',
              CLEAR_CAP_RESTORES_NORMAL_EFFECTIVE='PASS',RPC_CALLS=self.rpc_calls,
              NETWORK_READ_PER_CANDIDATE=0,ADMISSION='explicit persisted fixture precondition',
              RUNNER_BOUNDARY='unmodified actual callsite and adapter',
              BACKEND_CONVERGENCE='all persisted current owners have exact current-revision cap ACKs')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
