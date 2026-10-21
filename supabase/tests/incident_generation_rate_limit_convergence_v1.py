#!/usr/bin/env python3
"""Exact captured SQL bodies in disposable PG17; no DSN or network option.

The table projection uses unchanged canonical baseline DDL/keys. This tests the
V3 composition and its real V1/V2/preflight/runtime dependencies, not the full
deployed trigger graph. No SQL function is mocked. All cases roll back.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@17/bin')
EVIDENCE = Path('/Users/admin/Projects/phonefarm-52-delta-convergence-20261019/SQL_52_BOUNDED_DECODED.json')
LINEAGE = Path('/Users/admin/Projects/phonefarm-golden-production-convergence-20261019/FRESH_SQL_DECODED.json')
MIGRATION = ROOT / 'supabase/migrations/20261020104937_incident_generation_rate_limit_convergence_v1.sql'
IDENTITY = 'public.transition_account_incident_human_review_v3(uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid)'
EXPECTED = 'e7133eccab42da4087608031940e2ea7aa1dd82d452000ddda2e0513b15d5cdf'
PARAMS = 'p_incident_id uuid,p_action text,p_expected_version bigint,p_actor_type text,p_actor_id uuid,p_source text,p_note text,p_resolution_reason text,p_idempotency_key text,p_expected_worker_sha text,p_cause_fixed_version text,p_channel text default null,p_notification_id uuid default null'
TABLES = ('account_incidents', 'account_dashboard_actions', 'account_incident_review_events',
          'account_incident_notifications', 'incident_notification_channel_settings',
          'account_session_resume_plans', 'incident_resume_authorizations', 'ig_account_settings',
          'ig_action_logs', 'account_assignments', 'account_run_requests', 'ig_runs',
          'auto_restart_device_locks', 'instagram_account_restriction_holds')
A = '10000000-0000-4000-8000-000000000001'
I = '20000000-0000-4000-8000-000000000001'
S = '20000000-0000-4000-8000-000000000002'
RUN = '30000000-0000-4000-8000-000000000001'
PLAN = '40000000-0000-4000-8000-000000000001'
AUTH = '50000000-0000-4000-8000-000000000001'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    output = args.output.resolve()
    if output.exists() or output.is_relative_to(ROOT):
        raise ValueError('new_external_evidence_directory_required')
    output.mkdir()
    env = {'PATH': str(PG) + ':/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1', 'LC_ALL': 'C'}
    captured = json.loads(EVIDENCE.read_text())[0]['functions']
    lineage = json.loads(LINEAGE.read_text())[0]['functions']
    functions = {f.get('identity', f.get('function_identity')).split('(')[0]: f for f in [*captured, *lineage]}
    # The latest bounded capture wins for V3; lineage capture supplies V1/V2.
    functions['transition_account_incident_human_review_v3'] = next(f for f in captured if f['name'] == 'transition_account_incident_human_review_v3')
    assert digest(functions['transition_account_incident_human_review_v3']['decoded_prosrc'].encode()) == EXPECTED
    # This unchanged helper is retained in canonical source, not in the bounded
    # live catalogue selection. Do not present its fixture body as a live capture.
    rate_source = (ROOT / 'supabase/migrations/20260829153834_instagram_action_rate_limit_incident_only_v2.sql').read_text()
    rate_body = rate_source.split('create or replace function public.instagram_action_rate_limit_next_tick_eligibility_v2(', 1)[1].split('as $$', 1)[1].split('$$;', 1)[0]
    functions['instagram_action_rate_limit_next_tick_eligibility_v2'] = {
        'identity': 'instagram_action_rate_limit_next_tick_eligibility_v2(uuid,uuid)',
        'decoded_prosrc': rate_body, 'prosrc_sha256': digest(rate_body.encode()),
        'authority': 'unchanged canonical migration source; not a fresh live capture'}
    baseline = (ROOT / 'supabase/baseline/20260728001632_public_schema.sql').read_text()
    schema = "create role anon; create role authenticated; create role service_role;\n"
    # Table CHECK constraints call this unchanged canonical guard.
    for guard in ('jsonb_has_forbidden_safe_metadata_key', 'run_control_metadata_is_safe'):
        metadata_guard = re.search(r'CREATE OR REPLACE FUNCTION "public"\."' + guard + r'".*?\n\$\$;', baseline, re.S)
        if not metadata_guard:
            raise ValueError('canonical_metadata_guard_missing:' + guard)
        schema += metadata_guard[0] + '\n'
    for table in TABLES:
        pattern = r'CREATE TABLE IF NOT EXISTS "public"\."' + re.escape(table) + r'" \(.*?\n\);'
        match = re.search(pattern, baseline, re.S)
        if not match:
            raise ValueError('canonical_table_DDL_missing:' + table)
        schema += match[0] + '\n'
    for statement in re.findall(r'ALTER TABLE ONLY "public"\."[^"\n]+"\s+ADD CONSTRAINT.*?;', baseline, re.S):
        table = re.search(r'"public"\."([^"\n]+)"', statement)[1]
        if table in TABLES and ('PRIMARY KEY' in statement or 'UNIQUE' in statement):
            schema += statement + '\n'
    aug7 = (ROOT / 'supabase/migrations/20260807132013_incident_resolution_resume_authorization_v2.sql').read_text()
    schema += aug7[aug7.index('alter table public.incident_resume_authorizations'):aug7.index(';') + 1] + '\n'
    installed = []
    specs = {
        'transition_account_incident_human_review_v1': (PARAMS.replace(',p_expected_worker_sha text,p_cause_fixed_version text', ''), 'plpgsql'),
        'transition_account_incident_human_review_v2': (PARAMS, 'plpgsql'),
        'transition_account_incident_human_review_v3': (PARAMS, 'plpgsql'),
        'restore_resolved_operator_review_runtime_v3': ('p_account_id uuid,p_incident_id uuid,p_source text', 'plpgsql'),
        'incident_resume_authorization_preflight_v2': ('p_authorization_id uuid', 'plpgsql'),
        'instagram_action_rate_limit_next_tick_eligibility_v2': ('p_account_id uuid,p_incident_id uuid', 'sql'),
    }
    for name, (params, language) in specs.items():
        f = functions[name]
        body = f['decoded_prosrc']
        assert digest(body.encode()) == f['prosrc_sha256']
        schema += f'create or replace function public.{name}({params}) returns jsonb language {language} security definer set search_path=public,pg_temp as $body${body}$body$;\n'
        signature = f.get('identity', f.get('function_identity'))
        schema += f'revoke all on function public.{signature} from public,anon,authenticated; grant execute on function public.{signature} to service_role;\n'
        installed.append({'identity': signature, 'prosrc_sha256': digest(body.encode()),
                          'authority': f.get('authority', 'retained exact live catalogue capture')})
    (output / 'exact_fixture_schema.sql').write_text(schema)
    results = []
    with tempfile.TemporaryDirectory(prefix='incident-convergence-pg17-', dir='/private/tmp') as tmp:
        t = Path(tmp)
        init = subprocess.run([str(PG/'initdb'), '-D', str(t/'db'), '-A', 'trust', '-U', 'postgres', '--no-locale'], env=env, capture_output=True, text=True)
        (output/'initdb.stdout.log').write_text(init.stdout)
        (output/'initdb.stderr.log').write_text(init.stderr)
        if init.returncode:
            raise RuntimeError('isolated_initdb_failed:' + init.stderr)
        log = (output / 'postgres.log').open('w')
        server = subprocess.Popen([str(PG/'postgres'), '-D', str(t/'db'), '-k', tmp, '-p', '55489', '-c', 'listen_addresses='], env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(100):
                if (t/'.s.PGSQL.55489').exists():
                    break
                if server.poll() is not None:
                    raise RuntimeError('isolated_postgres_failed')
                time.sleep(.05)
            command = [str(PG/'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', tmp, '-p', '55489', '-U', 'postgres', '-d', 'postgres']

            def sql(text, expected_error=None):
                r = subprocess.run(command, input=text, env=env, capture_output=True, text=True, timeout=15)
                if expected_error:
                    assert r.returncode != 0 and expected_error in r.stderr, (expected_error, r.stdout, r.stderr)
                else:
                    assert r.returncode == 0, (r.stdout, r.stderr)
                return r.stdout.strip()

            sql(schema)
            before = sql("select jsonb_object_agg(proname, encode(sha256(convert_to(prosrc,'UTF8')),'hex')) from pg_proc where pronamespace='public'::regnamespace")
            raw = MIGRATION.read_text()
            sql(raw)
            after = json.loads(sql("select jsonb_object_agg(proname, encode(sha256(convert_to(prosrc,'UTF8')),'hex')) from pg_proc where pronamespace='public'::regnamespace"))
            before_map = json.loads(before)
            assert [k for k in before_map if before_map[k] != after[k]] == ['transition_account_incident_human_review_v3']
            results.append({'case': 'exact_predecessor_and_only_V3_changes', 'PASS': True})
            sql(raw, 'incident_generation_predecessor_prosrc_mismatch')
            results.append({'case': 'second_apply_and_predecessor_drift_refused', 'PASS': True})
            rights = sql("select pg_get_userbyid(proowner)||'|'||prosecdef||'|'||proacl::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='"+IDENTITY+"'::regprocedure")
            assert rights == 'postgres|true|{postgres=X/postgres,service_role=X/postgres}|search_path=public, pg_temp', rights
            for role in ['anon', 'authenticated']:
                sql(f"set role {role};select {IDENTITY.split('(')[0]}(null,null,null,null,null,null,null,null,null,null,null,null,null);", 'permission denied')
            results.append({'case': 'owner_ACL_securitydefiner_searchpath_and_unprivileged_refusal', 'PASS': True})
            seed = f"""
insert into public.account_incidents(id,account_id,run_id,dedupe_key,incident_type,status,severity,reason,lifecycle_version)
values ('{I}','{A}','{RUN}','anchor','operator_review','open','error','same cause',1),
('{S}','{A}','{RUN}','sibling','operator_review','open','error',' SAME CAUSE ',1);
insert into public.account_dashboard_actions(id,account_id,incident_id,action_type,status,blocking_campaign,title,dedupe_key)
values(gen_random_uuid(),'{A}','{I}','operator_review_required','pending',true,'Fixture anchor','anchor-action'),
(gen_random_uuid(),'{A}','{S}','operator_review_required','pending',true,'Fixture sibling','sibling-action');
insert into public.ig_account_settings(account_id,account_status) values('{A}','paused_manual_review');
insert into public.account_session_resume_plans(id,account_id,run_id,resume_state,restart_allowed)
values('{PLAN}','{A}','{RUN}','awaiting_human_resume_authorization',false);
"""

            def call(**kwargs):
                p = dict(incident=I, action='resolve', version='1', actor='ops', source='botapp_relay', sha='a'*40, fixed='qualified-v1', reason='verified', key='resolve-one')
                p.update(kwargs)
                return f"public.transition_account_incident_human_review_v3('{p['incident']}','{p['action']}',{p['version']},'{p['actor']}',null,'{p['source']}',null,'{p['reason']}','{p['key']}','{p['sha']}','{p['fixed']}',null,null)"

            def case(name, setup, assertions, expression=None):
                expr = expression or call()
                text = 'begin;'+seed+setup+f"create temp table result as select {expr} as value;"+assertions+'rollback;'
                sql(text)
                results.append({'case': name, 'PASS': True})

            def require(expr):
                return f"do $check$ begin if not ({expr}) then raise exception 'test_assertion_failed: {expr.replace(chr(39), chr(39)*2)}'; end if; end $check$;"

            case('generic_equivalent_generation_restores_runtime_without_admission', '',
                 require("(select count(*)=2 from account_incidents where status='resolved')")+
                 require("(select account_status='active' from ig_account_settings)")+
                 require("(select not (value->>'next_tick_eligible')::boolean and value->>'blocked_reason'='resume_authorization_pending_scheduled_assignment' from result)")+
                 require("(select count(*)=0 from account_run_requests)")+
                 require("(select count(*)=0 from ig_runs)")+
                 require("(select count(*)=0 from incident_resume_authorizations)")+
                 require("(select count(*)=2 from account_incident_review_events)"))
            case('replay_idempotence_no_second_generation_event', '',
                 'select '+call()+';'+require("(select count(*)=2 from account_incident_review_events)")+
                 require("(select count(*)=1 from ig_action_logs where action_type='operator_review_runtime_reactivated')"))
            for label, patch in [('other_account', "account_id='10000000-0000-4000-8000-000000000002'"),
                                 ('other_type', "incident_type='other_review'"), ('other_cause', "reason='different'"),
                                 ('security_flag', "metadata='{\"security_incident\":true}'"),
                                 ('security_type', "incident_type='security_review'"), ('archived', 'archived_at=now()')]:
                case('independent_'+label, f"update account_incidents set {patch} where id='{S}';",
                     require(f"(select status='open' from account_incidents where id='{S}')"))
            case('independent_blocker_prevents_runtime_restore', f"update account_incidents set reason='different' where id='{S}';",
                 require("(select account_status='paused_manual_review' from ig_account_settings)")+
                 require("(select not (value->>'next_tick_eligible')::boolean from result)"))
            for label, kwargs, error in [('worker', {'sha':'bad'}, 'expected_worker_sha_invalid'),
                                         ('cause_fixed', {'fixed':''}, 'cause_fixed_version_invalid'),
                                         ('version', {'version':'999'}, 'incident_version_conflict'),
                                         ('actor', {'actor':'client'}, 'incident_human_review_actor_invalid'),
                                         ('action', {'action':'unsupported'}, 'incident_human_review_action_invalid')]:
                sql('begin;'+seed+'select '+call(**kwargs)+';rollback;', error)
                results.append({'case':'unchanged_V2_or_V1_refusal_'+label,'PASS':True})
            # Exact current specialized branch remains independent of V2 worker/cause admission.
            rate = f"update account_incidents set reason='instagram_action_rate_limit',metadata='{{\"incident_only_blocker_v2\":true}}' where id='{I}';update account_incidents set status='ignored' where id='{S}';update account_dashboard_actions set status='resolved',blocking_campaign=false where incident_id='{S}';"
            case('current_rate_limit_specialization_preserved_no_authorization', rate,
                 require("(select value->>'special_resume_path_created'='false' and value->>'resume_authorization_created'='false' from result)")+
                 require("(select count(*)=0 from incident_resume_authorizations)")+
                 require("(select account_status='paused_manual_review' from ig_account_settings)"),call(sha='bad',fixed=''))
            auth_seed = f"""
insert into public.incident_resume_authorizations(id,incident_id,account_id,run_id,resume_plan_id,resume_window_key,scheduled_window_end,status,expected_worker_sha,cause_fixed_version)
values('{AUTH}','{I}','{A}','{RUN}','{PLAN}','fixture-window',now()+interval '1 hour','armed',repeat('a',40),'qualified-v1');
insert into public.account_assignments(id,client_id,subscription_id,subscription_account_id,account_id,device_id,app_instance_id,assignment_type,slot_kind,status,starts_at,ends_at,schedule_mode)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'{A}',gen_random_uuid(),gen_random_uuid(),'outreach_only','outreach_40m','active',now()-interval '1 hour',now()+interval '1 hour','scheduled');
"""
            case('same_existing_authorization_requalified_after_runtime_restore', auth_seed,
                 require("(select (value->>'next_tick_eligible')::boolean from result)")+
                 require("(select count(*)=1 from incident_resume_authorizations)")+
                 require("(select status='armed' from incident_resume_authorizations)"))
            for label, patch in [('consumed', "update incident_resume_authorizations set status='consumed';"),
                                 ('revoked', "update incident_resume_authorizations set status='revoked';"),
                                 ('expired', "update incident_resume_authorizations set expires_at=now()-interval '1 hour';"),
                                 ('manual_only', "update account_assignments set schedule_mode='manual_only',slot_kind='manual_only',starts_at=null,ends_at=null;")]:
                case('admission_refusal_preserved_'+label, auth_seed+patch,
                     require("(select not (value->>'next_tick_eligible')::boolean from result)")+
                     require("(select count(*)=1 from incident_resume_authorizations)"))
            # A real lock acquired by another connection must prevent this composition.
            sql(seed)
            lock = subprocess.Popen(command, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            lock.stdin.write(f"begin;select id from account_incidents where id='{I}' for update;select pg_sleep(1);rollback;");lock.stdin.close();time.sleep(.2)
            try:
                sql("set lock_timeout='100ms';select "+call()+';', 'lock timeout')
            finally:
                lock.wait(timeout=5)
            results.append({'case':'real_concurrent_anchor_lock_refused','PASS':True})
            sql('truncate '+','.join(TABLES)+' cascade;')
            assert sql('select count(*) from account_incidents') == '0'
            results.append({'case':'all_case_transactions_rollback_and_fixture_empty','PASS':True})
            report = {'status':'PASS','tests':len(results),'passed':len(results),'failed':0,'errors':0,'skipped':0,
                      'results':results,'migration_sha256':digest(MIGRATION.read_bytes()),'exact_captured_dependencies':installed,
                      'fixture_schema_sha256':digest(schema.encode()),'scope':'Exact function bodies with canonical table projection/keys; full deployed trigger graph NOT certified by this fixture',
                      'PostgreSQL':sql('show server_version'),'live_SQL_calls':0,'provider_calls':0,'device_actions':0,
                      'function_prosrc_before':before_map,'function_prosrc_after':after,'SQL_installations_in_production':0}
            (output/'RESULT.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report,indent=2))
        finally:
            subprocess.run([str(PG/'pg_ctl'),'-D',str(t/'db'),'-m','immediate','stop'],env=env,capture_output=True)
            server.wait(timeout=5)
            log.close()


if __name__ == '__main__':
    main()
