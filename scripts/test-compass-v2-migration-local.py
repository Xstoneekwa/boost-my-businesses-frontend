#!/usr/bin/env python3
"""Apply Compass V2 migration and exercise its atomic persistence RPC on scratch Postgres."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260909135410_compass_v2_signal_intelligence.sql"


def run(command, *, input_text=None):
    completed = subprocess.run(command, input=input_text, text=True, capture_output=True)
    if completed.returncode:
        raise RuntimeError(f"COMMAND_FAILED:{Path(command[0]).name}:{completed.stderr.strip()[:500]}")
    return completed.stdout.strip()


CLUSTER = '{"id":"cluster-1","platform":"INSTAGRAM","action_family":"FOLLOW","symptom_family":"TRY_AGAIN_LATER","state":"EMERGING","unique_signal_count":3,"unique_source_family_count":2,"first_seen":"2026-09-09T10:00:00Z","last_seen":"2026-09-09T11:00:00Z","velocity":2,"freshness":"CURRENT","coverage_status":"PARTIAL","external_confidence":70,"history_id":"history-1","observed_at":"2026-09-09T12:00:00Z"}'
CORRELATION = '{"id":"correlation-1","internal_evidence_strength":"CONFIRMED","confirmed_platform_rate_limit":true,"affected_accounts":["account-1"],"exposed_accounts":["account-1","account-2"],"matched_incident_ids":["incident-1"],"score":90,"factors":{"internal_evidence":25}}'
RISK = '{"id":"risk-1","score":76,"level":"CRITICAL","confidence":70,"coverage_status":"PARTIAL","risk_factors":{"internal_evidence":25}}'
RECOMMENDATION = '{"id":"recommendation-1","action":"PAUSE_SELECTED","why":["confirmed evidence"],"affected_scope":{"account_ids":["account-1"],"cluster_id":"cluster-1"},"confidence":70,"preconditions":["preview"],"recheck_at":"2026-09-09T12:30:00Z","recovery_checks":["no new incidents"]}'

def main():
    required = [shutil.which(name) for name in ("initdb", "pg_ctl", "psql")]
    if not all(required):
        raise SystemExit("POSTGRES_TEST_TOOLING_MISSING")
    with tempfile.TemporaryDirectory(prefix="compass-v2-pg-", dir="/private/tmp") as temporary:
        base = Path(temporary)
        data = base / "data"
        socket = base / "socket"
        socket.mkdir()
        run([required[0], "-D", str(data), "--auth=trust", "--no-locale", "--encoding=UTF8"])
        started = False
        try:
            run([required[1], "-D", str(data), "-l", str(base / "postgres.log"), "-o", f"-k {socket} -h ''", "start", "-w"])
            started = True
            psql = [required[2], "-h", str(socket), "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"]
            run(psql, input_text="create role anon; create role authenticated; create role service_role bypassrls;")
            # Mirror the grants observed on the real production public schema.
            run(psql, input_text="alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on functions to anon, authenticated, service_role; create table public.legacy_contract_probe(id uuid primary key, value text); insert into public.legacy_contract_probe values(gen_random_uuid(),'unchanged');")
            legacy_before = run(psql, input_text="select row_to_json(p) from public.legacy_contract_probe p;")
            run(psql, input_text=MIGRATION.read_text())
            def call(corr_id='correlation-1', observed='2026-09-09T12:00:00Z', cluster_id='cluster-1', risk_score=76):
                c, corr, risk, rec = json.loads(CLUSTER), json.loads(CORRELATION), json.loads(RISK), json.loads(RECOMMENDATION)
                c.update(id=cluster_id,observed_at=observed,history_id=corr_id+':history',current_evaluation={'identity':corr_id,'recommendationId':corr_id+':recommendation'})
                corr['id']=corr_id
                risk.update(id=corr_id+':risk',score=risk_score)
                rec['id']=corr_id+':recommendation'
                values=[c,[],corr,risk,rec]
                return "select public.persist_compass_assessment_v1("+','.join("$v$"+json.dumps(v)+"$v$::jsonb" for v in values)+");"
            def check(name,condition):
                if not condition:raise AssertionError(name)
                print('POSTGRES '+name+' PASS')
            def query(sql):return run(psql,input_text=sql)
            check('live_default_grants_neutralized', query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'compass_%' and c.relkind='r' and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))") == '0')
            check('all_compass_tables_rls', query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'compass_%' and c.relkind='r' and not c.relrowsecurity") == '0')
            check('rpc_invoker_grants', query("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%compass%' and (p.prosecdef or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE'))") == '0')
            check('all_indexes_valid', query("select count(*) from pg_index i join pg_class c on c.oid=i.indrelid where c.relname like 'compass_%' and not i.indisvalid") == '0')
            check('old_schema_rollback_surface_unchanged', query("select row_to_json(p) from public.legacy_contract_probe p;") == legacy_before)
            receipt=json.loads(query('set role service_role;'+call()))
            check('nominal',receipt['ok'])
            query(call())
            check('idempotence',query("select (select count(*) from public.compass_fleet_correlations)||','||(select count(*) from public.compass_risk_assessments)||','||(select count(*) from public.compass_recommendations);")=='1,1,1')
            query(call('new','2026-09-09T13:00:00Z'))
            old=json.loads(query(call('old','2026-09-09T11:00:00Z')))
            check('monotonic_old_after_new',old.get('stale_ignored') and query("select current_evaluation->>'identity' from public.compass_signal_clusters where id='cluster-1'")=='new')
            failed=subprocess.run(psql,input=call('late','2026-09-09T14:00:00Z','late-cluster',101),text=True,capture_output=True)
            check('late_failure_full_rollback',failed.returncode!=0 and query("select (select count(*) from public.compass_signal_clusters where id='late-cluster')+(select count(*) from public.compass_fleet_correlations where id='late')")=='0')
            denied=subprocess.run(psql,input='set role anon;'+call(),text=True,capture_output=True)
            check('anon_denied',denied.returncode!=0)
            # Concurrent sessions: newer update holds the row lock; older writer follows.
            writer=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            writer.stdin.write('begin;'+call('concurrent-new','2026-09-09T15:00:00Z')+'select pg_sleep(0.5);commit;')
            writer.stdin.close()
            import time
            time.sleep(.15)
            query(call('concurrent-old','2026-09-09T14:30:00Z'))
            writer.wait(timeout=10)
            check('concurrent_fencing',writer.returncode==0 and query("select current_evaluation->>'identity' from public.compass_signal_clusters where id='cluster-1'")=='concurrent-new')
            # Real normalized Python signal through the same SQL ingestion entrypoint.
            import sys
            sys.path.insert(0,str(ROOT/'scripts/instagram-action-limits-watch'))
            from normalize import normalize
            item=normalize({'source':'reddit','source_url':'https://www.reddit.com/r/Instagram/comments/retained/title','published_at':'2026-01-01T11:00:00Z','title':'I cannot follow','text_or_excerpt':'I cannot follow people.','author_reference':'one'},collected_at='2026-01-01T12:00:00Z')
            columns=set(query("select column_name from information_schema.columns where table_schema='public' and table_name='compass_external_signals'").splitlines())
            item={k:v for k,v in item.items() if k in columns}
            sql="select public.ingest_compass_collection_v1($v$"+json.dumps([item])+"$v$::jsonb,'[]'::jsonb);"
            query(sql);query(sql)
            check('ingestion_and_retention',query("select count(*) from public.compass_external_signals")=='0' and query("select count(*) from public.compass_cluster_history")!='0')
            check('history_preserved',query("select count(*) from public.compass_recommendations")!='0')
            from datetime import datetime, timezone, timedelta
            current=datetime.now(timezone.utc).isoformat()
            original=normalize({'source':'reddit','source_url':'https://www.reddit.com/r/Instagram/comments/replay/title','published_at':current,'title':'I cannot follow','text_or_excerpt':'I cannot follow profiles today.','author_reference':'one'},collected_at=current)
            node='/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
            boundary = r"""
import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import * as core from './lib/instagram-dashboard/compass-v2.ts';
const require=createRequire(import.meta.url), ts=require('../boost-ai-frontend/node_modules/typescript'), exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/instagram-dashboard/compass-v2-data.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:id=>id==='./compass-v2'?core:id==='./incidents-data'?{}:id==='@/lib/supabase'?{}:require(id),Date,Set,Map,Promise,Error,JSON,Number,String,Array});
const signal=JSON.parse(process.argv[1]);let batch;
await exports.persistCompassCollection({signals:[signal]}, {rpc:async(n,p)=>{batch=p;return {error:null}}});
console.log(JSON.stringify(batch));
"""
            batch=json.loads(run([node,'--input-type=module','-e',boundary,json.dumps(original)]))
            ingest="select public.ingest_compass_collection_v1($v$"+json.dumps(batch['p_signals'])+"$v$::jsonb,'[]'::jsonb);"
            query(ingest);query(ingest)
            stored=json.loads(query("select row_to_json(s) from public.compass_external_signals s where id='"+original['id']+"'"))
            engine=r"""
import * as c from './lib/instagram-dashboard/compass-v2.ts';
const s=JSON.parse(process.argv[1]), now=process.argv[2];
const cluster=c.buildSignalClusters([s],{now})[0];
const correlation=c.correlateFleet(cluster,[{id:'replay-incident',incident_type:'instagram_action_rate_limit',reason_code:'FOLLOW_BLOCKED',restriction_evidence:'confirmed_ui',account_id:'one',occurred_at:now}],['one']);
const risk=c.assessRisk(cluster,correlation), recommendation=c.recommend(cluster,correlation,risk,now),id=c.evaluationIdentity(cluster,correlation,risk,recommendation);
console.log(JSON.stringify([{cluster:{...cluster,observed_at:now,history_id:id+':history',current_evaluation:{identity:id,cluster,correlation,risk,recommendation,recommendationId:id+':recommendation'}},signal_ids:[s.id],correlation:{id:id+':correlation',...correlation,matched_incident_ids:correlation.matched_incidents.map(i=>i.id)},risk:{id:id+':risk',...risk},recommendation:{id:id+':recommendation',...recommendation}}]));
"""
            assessment=json.loads(run([node,'--input-type=module','-e',engine,json.dumps(stored),current]))
            committed=json.loads(query("select public.persist_compass_assessment_batch_v1($v$"+json.dumps(assessment)+"$v$::jsonb);"))
            check('python_backend_postgres_engine_replay',committed[0]['current_evaluation']['correlation']['internal_evidence_strength']=='CONFIRMED' and stored['origin_group_id']==original['origin_group_id'] and query("select count(*) from public.compass_external_signals where id='"+original['id']+"'")=='1')
            # Evidence linked to operator decisions remains after the long-term TTL.
            old_time=(datetime.now(timezone.utc)-timedelta(days=400)).isoformat()
            query(call('protected',old_time,'protected-cluster'))
            query("insert into public.compass_fleet_handoffs values('receipt','receipt','protected:recommendation',now(),now()+interval '2 hours','{}','PREPARED',false); insert into public.compass_operator_decisions values('decision','receipt',now(),'MONITOR','operator','reviewed'); select public.prune_compass_v1();")
            check('retention_preserves_operator_evidence',query("select count(*) from public.compass_signal_clusters where id='protected-cluster'")=='1' and query("select count(*) from public.compass_operator_decisions where id='decision'")=='1')

        finally:
            if started:
                subprocess.run([required[1], "-D", str(data), "stop", "-m", "fast", "-w"], check=False, capture_output=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
