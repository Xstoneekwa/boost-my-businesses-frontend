import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as core from '../lib/instagram-dashboard/compass-v2.ts';
const require=createRequire(import.meta.url);
const ts=require('../../boost-ai-frontend/node_modules/typescript');
const dataSource=readFileSync(new URL('../lib/instagram-dashboard/compass-v2-data.ts',import.meta.url),'utf8');
const exports={};
vm.runInNewContext(ts.transpileModule(dataSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:(id)=>id==='./compass-v2'?core:id==='./incidents-data'?{getIncidentsOverview:()=>{throw Error('USE_INJECTED_INCIDENTS')}}:id==='@/lib/supabase'?{createSupabaseClient:()=>{throw Error('USE_INJECTED_DB')}}:require(id),Date,Set,Map,Promise,Error,JSON,Number,String,Array,console});
const NOW='2026-09-09T12:00:00.000Z';
const signal=(id,more={})=>({id,source:'reddit',source_family:'reddit',source_native_id:id,url:`https://www.reddit.com/r/Instagram/comments/${id}`,retrieved_at:NOW,published_at:'2026-09-09T11:30:00.000Z',publication_date_confidence:'HIGH',first_seen:NOW,last_seen:NOW,platform:'INSTAGRAM',signal_type:'USER_REPORT',action_family:'FOLLOW',symptom_family:'FOLLOW_BLOCKED',geography:null,platform_version:null,source_credibility:'MEDIUM',access_status:'LIMITED',freshness:'CURRENT',volume:1,velocity:0,official_confirmation:false,content_hash:id,dedupe_key:id,cluster_id:null,exclusion_reason:[],raw_reference:`sha256:${id}`,author_key:id,summary:id,...more});
const incident=(more={})=>({id:'i',incident_type:'instagram_action_rate_limit',restriction_evidence:'confirmed_ui',reason_code:'FOLLOW_BLOCKED',account_id:'a',occurred_at:NOW,severity:'error',...more});
const cluster=(signals=[signal('a')],more={})=>({...core.buildSignalClusters(signals,{now:NOW})[0],...more});
const assess=(c,i=[incident()])=>{const corr=core.correlateFleet(c,i,['a']);const risk=core.assessRisk(c,corr);return {c,corr,risk,rec:core.recommend(c,corr,risk,NOW)};};
function pythonNormalize(items) {
  return JSON.parse(execFileSync('/usr/bin/python3',['-B','-c',`import sys,json; sys.path.insert(0,'scripts/instagram-action-limits-watch'); from normalize import normalize; print(json.dumps([normalize(x,collected_at='${NOW}') for x in json.load(sys.stdin)]))`],{cwd:new URL('..',import.meta.url),input:JSON.stringify(items),encoding:'utf8'}));
}
const evidence=(more={})=>({source:'reddit',source_url:'https://www.reddit.com/r/Instagram/comments/abc/title',published_at:'2026-09-09T11:30:00Z',title:'I cannot follow',text_or_excerpt:'I cannot follow any profiles on Instagram today.',author_reference:'one',...more});

test('SCENARIO A exact FOLLOW rejects UNFOLLOW and version conflict',()=>{
 const c=cluster([signal('a',{platform_version:'2'})]);
 const mismatch=core.correlateFleet(c,[incident({reason_code:'UNFOLLOW_BLOCKED',instagram_version:'1'})]);
 assert.equal(mismatch.matched_incidents.length,0);assert.equal(mismatch.internal_evidence_strength,'NONE');
 assert.equal(mismatch.compatibility.i.version,'CONFLICT');
 assert.equal(core.correlateFleet(c,[incident({instagram_version:'1'})]).matched_incidents.length,0);
 assert.equal(core.correlateFleet(c,[incident()]).compatibility.i.version,'UNKNOWN');
});
test('SCENARIO B no external retains isolated preventive internal signal',()=>{
 const i=incident({incident_type:'preventive_follow_restriction',restriction_evidence:'preventive'});
 const [c]=core.includeInternalOnly([], [i], NOW); const a=assess(c,[i]);
 assert.equal(c.internal_only,true);assert.equal(c.state,'ISOLATED');assert.equal(a.corr.internal_evidence_strength,'WEAK');assert.equal(a.corr.confirmed_platform_rate_limit,false);assert.equal(a.rec.action,'MONITOR');
});
test('SCENARIO C LIMITED unobserved disabled source is degraded',()=>{
 assert.equal(core.realCoverage([{source:'meta',checked_at:NOW,access_status:'LIMITED',observed:false,coverage_status:'DEGRADED'}],NOW).coverageDegraded,true);
 assert.equal(core.realCoverage([{source:'reddit',checked_at:NOW,observed:true,collection_success:true,last_success_at:NOW,coverage_status:'PARTIAL'}],NOW).coverageDegraded,false);
});
test('SCENARIO D old posts cannot be refreshed by retrieval',()=>{
 const c=cluster(['a','b','c'].map(id=>signal(id,{published_at:'2026-08-01T12:00:00Z'})));
 assert.equal(c.freshness,'STALE');assert.equal(c.state,'RESOLVED');
});
test('SCENARIO E crossposts and single source cannot accelerate',()=>{
 const shared=['a','b','c'].map(id=>signal(id,{origin_group_id:'original'}));
 assert.equal(core.deduplicateSignals(shared).length,1);
 const c=cluster(['a','b','c'].map(id=>signal(id)));assert.equal(c.unique_source_family_count,1);assert.notEqual(c.state,'ACCELERATING');
});
test('INTEGRATION F Python boundary DTO provenance through recommendation',async()=>{
 const [a,b]=pythonNormalize([evidence(),evidence({source_url:'https://www.reddit.com/r/InstagramMarketing/comments/def/title',crosspost_parent_url:'https://www.reddit.com/r/Instagram/comments/abc/title',author_reference:'two',text_or_excerpt:'My Instagram following stopped and I cannot follow another user.'})]);
 let batch;
 const db={rpc:async(name,args)=>{assert.equal(name,'ingest_compass_collection_v1');batch=args;return {error:null};}};
 await exports.persistCompassCollection({signals:[a,b]},db);
 assert.equal(batch.p_signals[0].origin_group_id,a.origin_group_id);assert.equal(batch.p_signals[0].native_id,a.native_id);assert.equal(batch.p_signals[0].canonical_url,a.canonical_url);
 const c=cluster(batch.p_signals);assert.equal(c.unique_signal_count,1);
 const result=assess(c);assert.equal(result.corr.internal_evidence_strength,'CONFIRMED');assert.ok(result.rec.why.length);assert.equal(core.prepareFleetHandoff(c,result.corr,result.risk,result.rec,NOW).actions_executable,false);
});
test('SCENARIO G forged Meta provenance rejected',()=>assert.throws(()=>core.validateExternalSignal(signal('a',{source_family:'meta',source_credibility:'HIGH',official_confirmation:true,signal_type:'OFFICIAL_STATUS'})),/PROVENANCE/));
test('INTEGRATION H official guidance survives Python and Backend eligibility',()=>{
 const [s]=pythonNormalize([evidence({source:'Meta',source_url:'https://metastatus.com/instagram',evidence_kind:'OFFICIAL_GUIDANCE',author_reference:undefined,text_or_excerpt:'We are investigating action blocked errors.',title:'Instagram action blocked'})]);
 const c=cluster([s]);assert.equal(c.signals[0].official_confirmation,true);assert.equal(c.unique_source_family_count,1);
});
test('UNIT I identical logical evaluation has stable identity',()=>{
 const a=assess(cluster());const id=core.evaluationIdentity(a.c,a.corr,a.risk,a.rec);
 assert.equal(id,core.evaluationIdentity({...a.c,evaluated_at:'2026-09-09T12:01:00Z'},a.corr,a.risk,{...a.rec,recheck_at:'2026-09-09T13:01:00Z'}));
});
test('UNIT I2 evaluation identity ignores incident and nested object insertion order',()=>{
 const rows=[incident({id:'a',account_id:'a'}),incident({id:'b',account_id:'b'})];
 const c=core.includeInternalOnly([],rows,NOW)[0];
 const first=assess(c,rows), second=assess(c,[...rows].reverse());
 const reversedCompatibility=Object.fromEntries(Object.entries(second.corr.compatibility).reverse().map(([id,value])=>[id,Object.fromEntries(Object.entries(value).reverse())]));
 const reorderedRisk={...second.risk,risk_factors:Object.fromEntries(Object.entries(second.risk.risk_factors).reverse())};
 const identityA=core.evaluationIdentity(first.c,first.corr,first.risk,first.rec);
 const identityB=core.evaluationIdentity(second.c,{...second.corr,compatibility:reversedCompatibility},reorderedRisk,second.rec);
 assert.equal(identityA,identityB);
 assert.equal(`${identityA}:correlation`,`${identityB}:correlation`);
 assert.equal(`${identityA}:risk`,`${identityB}:risk`);
 assert.equal(`${identityA}:recommendation`,`${identityB}:recommendation`);
});
test('SCENARIO L expired idempotent handoff fails closed',async()=>{
 const a=assess(cluster());const h=core.prepareFleetHandoff(a.c,a.corr,a.risk,a.rec,NOW);
 const db={from:()=>({insert:async()=>({error:{code:'23505'}}),select:()=>({eq:()=>({single:async()=>({data:{payload:h},error:null})})})})};
 await assert.rejects(exports.persistPreparedHandoff({cluster:a.c,correlation:a.corr,risk:a.risk,recommendation:a.rec,recommendationId:'r'},'2026-09-09T15:00:00Z',db),/HANDOFF_EXPIRED/);
});
test('SCENARIO N read truncation always degrades confidence',()=>{
 assert.equal(core.realCoverage([{source:'reddit',checked_at:NOW,observed:true,collection_success:true,last_success_at:NOW,coverage_status:'PARTIAL'}],NOW,true).coverageTruncated,true);
 const a=assess(cluster(undefined,{coverage_status:'DEGRADED'}));assert.ok(a.risk.confidence<=55);
});
test('SCENARIO O CRITICAL unknown scope never suggests scope pause',()=>{
 const a=assess(cluster(),[incident({account_id:null})]);const r=core.recommend(a.c,a.corr,{...a.risk,level:'CRITICAL'},NOW);
 assert.equal(r.action,'NEEDS_MORE_EVIDENCE');
});
test('SCENARIO P temporal episodes separate old evidence',()=>{
 const list=core.buildSignalClusters([signal('old',{published_at:'2026-08-01T12:00:00Z'}),signal('new')],{now:NOW});assert.equal(list.length,2);
 const current=list.find(c=>c.freshness==='CURRENT');assert.equal(core.correlateFleet(current,[incident({occurred_at:'2026-08-01T12:00:00Z'})]).matched_incidents.length,0);
});
test('UNIT risk exposes every applied cap and exact final score',()=>{
 const c=cluster(undefined,{state:'ACCELERATING',coverage_status:'DEGRADED'});const a=assess(c,Array.from({length:5},(_,i)=>incident({id:String(i),account_id:String(i),severity:'critical'})));
 assert.equal(a.risk.raw_score,Object.values(a.risk.risk_factors).reduce((n,x)=>n+x,0));
 assert.equal(a.risk.final_score,Math.min(a.risk.raw_score,...a.risk.caps_applied.map(x=>x.ceiling)));assert.equal(a.risk.score,a.risk.final_score);
});
test('UNIT declining with no recent internal evidence stays monitoring',()=>{
 const a=assess(cluster(undefined,{state:'DECLINING'}),[]);assert.equal(core.recommend(a.c,a.corr,{...a.risk,level:'CRITICAL'},NOW).action,'MONITOR');
});
test('UNIT known device and run type conflicts exclude matching',()=>{
 const c=cluster([signal('a',{device_id:'d1',run_type:'manual'})]);
 const r=core.correlateFleet(c,[incident({device_id:'d2',run_type:'auto'})]);assert.equal(r.matched_incidents.length,0);assert.equal(r.compatibility.i.device,'CONFLICT');assert.equal(r.compatibility.i.run_type,'CONFLICT');
});
test('INTEGRATION data layer preserves internal-only result and batches RPC',async()=>{
 const calls=[];
 const chain=()=>{const q={select:()=>q,gte:()=>q,order:()=>q,limit:()=>q,in:()=>q,then:resolve=>resolve({data:[],error:null})};return q;};
 const db={from:chain,rpc:async(name,args)=>{calls.push(name);return {data:args.p_assessments.map(a=>({ok:true,current_evaluation:a.cluster.current_evaluation})),error:null};}};
 const result=await exports.runCompassIntelligence({now:NOW},db,async()=>({incidents:[{id:'i',incidentType:'preventive_follow_restriction',lastSeenAt:NOW,accountId:'a',evidence:{restriction_evidence:'preventive'}}]}));
 assert.equal(result.results.length,1);assert.equal(result.results[0].recommendation.action,'MONITOR');assert.equal(result.coverageStatus,'COVERAGE_DEGRADED');assert.deepEqual(calls,['persist_compass_assessment_batch_v1']);
});
test('INTEGRATION actual signal read limit marks truncated and degraded',async()=>{
 const rows=Array.from({length:1000},(_,i)=>signal(String(i)));
 const chain=(table)=>{const q={select:()=>q,gte:()=>q,order:()=>q,limit:()=>q,in:()=>q,then:resolve=>resolve({data:table==='compass_external_signals'?rows:[],error:null})};return q;};
 const db={from:chain,rpc:async(name,args)=>({data:args.p_assessments.map(a=>({ok:true,current_evaluation:a.cluster.current_evaluation})),error:null})};
 const result=await exports.runCompassIntelligence({now:NOW},db,async()=>({incidents:[]}));
 assert.equal(result.coverageTruncated,true);assert.equal(result.coverageStatus,'COVERAGE_DEGRADED');
});
