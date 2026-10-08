import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { franceQueryPairs, FR_PATH_EXCLUSIONS, runFranceProfileFirst, compareFrancePairs, classifyFranceSerpUrl, minimizeSerpText, minimizeSerpUrl, type PageRecord, type PersistPage } from "./france-profile-first.ts";
import { FRANCE_BEAUTY_QUERY_TERMS } from "./market-config.ts";

function harness(handler:(url:URL,index:number)=>Response|Promise<Response>, persistOverride?:PersistPage) {
 let time=0,calls=0; const events:Array<{phase:string;record:PageRecord}>=[];
 const persist:PersistPage=async(record,phase)=>{events.push({phase,record:structuredClone(record)});await persistOverride?.(record,phase);};
 return {events, count:()=>calls,run:()=>runFranceProfileFirst({runId:"fixture",apiKey:"SECRET",endpoint:"https://provider.invalid/search",now:()=>time,sleep:async ms=>{time+=ms;},persist,fetcher:async url=>handler(new URL(String(url)),++calls)}),advance:(ms:number)=>{time+=ms;}};
}
const response=(rows:unknown[]=[])=>new Response(JSON.stringify({organic_results:rows}));
const root=(id:string)=>({link:"https://www.instagram.com/"+id+"/",title:"Institut de beauté"});
test("20 exact paired queries; only path exclusions; alternating arms",()=>{
 const pairs=franceQueryPairs();assert.equal(pairs.length,20);
 FRANCE_BEAUTY_QUERY_TERMS.forEach((term,i)=>{
  const pair=pairs.slice(i*2,i*2+2);
  assert.equal(pair[0].arm,i%2?"candidate":"control");
  assert.equal(pair.find(q=>q.arm==="control")?.query,'site:instagram.com/ "'+term+'" "France"');
  assert.equal(pair.find(q=>q.arm==="candidate")?.query,pair.find(q=>q.arm==="control")?.query+FR_PATH_EXCLUSIONS);
 });
});
test("page1 first, max two useful page2, complete snapshots/diagnostics, attribution",async()=>{
 const h=harness((url,i)=>response([root(url.searchParams.get("page")?"second_"+i:"profile_"+i),{link:"https://www.instagram.com/p/abc/",snippet:"Call 06 11 22 33 44 or a@b.fr"}]));
 const result=await h.run();assert.equal(h.count(),22);
 const final=h.events.filter(e=>["finish","skip"].includes(e.phase)).map(e=>e.record);
 assert.equal(final.filter(p=>p.page===1&&p.status==="SUCCESS").length,20);
 assert.equal(final.filter(p=>p.page===2&&p.status==="SUCCESS").length,2);
 assert.ok(h.events.findIndex(e=>e.record.page===2)>h.events.findLastIndex(e=>e.record.page===1));
 assert.equal(compareFrancePairs(final).filter(p=>p.verdict==="TIE").length,10);
 const captured=h.events.filter(e=>e.phase==="capture");assert.equal(captured.length,22);
 for(const e of captured){assert.equal(e.record.accepted_candidate_count,0);assert.equal(e.record.snapshots.length,2);}
 assert.ok(!JSON.stringify(h.events).includes("SECRET"));assert.ok(!JSON.stringify(h.events).includes("06 11 22 33 44"));assert.ok(!JSON.stringify(h.events).includes("a@b.fr"));
 assert.equal(result.candidates.length,22);
 for(const p of final)for(const key of ["run_id","query_id","query_set_version","arm","family","provider","engine","started_at","ended_at","duration_ms","timeout_ms","http_status","status","error_category","raw_result_count","unique_link_count","root_profile_count","accepted_candidate_count","new_unique_profile_count","duplicate_count","rejected_count","skip_reason"])assert.ok(key in p,key);
});
test("no useful page1 means zero page2; full pairwise tie",async()=>{
 const h=harness(()=>response([{link:"https://www.instagram.com/p/abc/"}]));await h.run();assert.equal(h.count(),20);
 assert.ok(h.events.filter(e=>e.phase==="skip").every(e=>e.record.skip_reason==="SKIPPED_NO_NEW_PROFILE"));
});
test("two consecutive timeouts trip global breaker without retry",async()=>{
 const h=harness(()=>{throw new DOMException("timeout","AbortError");});await h.run();assert.equal(h.count(),2);
 const finals=h.events.filter(e=>["finish","skip"].includes(e.phase)).map(e=>e.record);
 assert.equal(compareFrancePairs(finals).filter(p=>p.verdict==="NON_COMPARABLE").length,10);
 assert.ok(finals.filter(p=>p.status==="SKIPPED").every(p=>p.skip_reason==="SKIPPED_CIRCUIT_BREAKER"));
});
test("429 trips immediately; malformed response is attributable",async()=>{
 const h=harness(()=>new Response("rate",{status:429}));await h.run();assert.equal(h.count(),1);
 const bad=harness(()=>new Response("not json"));await bad.run();assert.equal(bad.events.find(e=>e.phase==="finish")?.record.error_category,"MALFORMED_JSON");
});
test("insufficient time before next full timeout skips budget",async()=>{
 const h=harness(()=>{h.advance(103000);return response();});await h.run();assert.equal(h.count(),1);
 assert.ok(h.events.filter(e=>e.phase==="skip").every(e=>e.record.skip_reason==="SKIPPED_BUDGET"));
});
test("target 30 bounds candidates and stops next call, incomplete pairs not compared",async()=>{
 const h=harness(()=>response(Array.from({length:35},(_,i)=>root("business_"+i))));const r=await h.run();
 assert.equal(h.count(),1);assert.equal(r.candidates.length,30);
 assert.ok(h.events.filter(e=>e.phase==="skip").every(e=>e.record.skip_reason==="SKIPPED_TARGET_REACHED"));
});
test("capture failure stops before extraction or more provider work",async()=>{
 const h=harness(()=>response([root("x")]),async(_r,phase)=>{if(phase==="capture")throw new Error("DB down");});
 await assert.rejects(h.run,/fr_capture_audit_failure/);assert.equal(h.count(),1);
 assert.equal(h.events.filter(e=>e.phase==="finish").length,0);
 const pre=harness(()=>response(),async()=>{throw new Error("DB down");});await assert.rejects(pre.run);assert.equal(pre.count(),0);
});
test("same profile seen in both arms keeps all attribution without double enrichment",async()=>{
 const h=harness(()=>response([root("same")]));const r=await h.run();
 assert.equal(r.candidates.length,1);assert.ok(r.attributions.same.some(a=>a.arm==="control"));assert.ok(r.attributions.same.some(a=>a.arm==="candidate"));
 assert.equal(h.count(),21);
});
test("URL classes separated from commercial tag and contacts minimized",()=>{
 for(const [url,expected] of [["https://instagram.com/salon/","ROOT_IG_PROFILE"],["https://instagram.com/p/xx/","IG_POST"],["https://instagram.com/reel/xx/","IG_REEL"],["https://instagram.com/explore/tags/x/","IG_OTHER"],["https://pagesjaunes.fr/pros/x","DIRECTORY"],["https://site.fr/blog/a","ARTICLE"],["https://site.fr/","WEBSITE"],["invalid","OTHER"]])assert.equal(classifyFranceSerpUrl(url),expected);
 assert.equal(minimizeSerpUrl("https://user:password@site.fr/path?api_key=SECRET#token"),"https://site.fr/path");
 assert.ok(!minimizeSerpText("email a@b.fr telephone 06 22 33 44 55 https://site.fr/?token=SECRET").includes("SECRET"));
});
test("integration requires audited reservation and service-only schema",()=>{
 const processor=readFileSync(new URL("./discovery-processor.ts",import.meta.url),"utf8");
 assert.match(processor,/reserve_commercial_france_score_v2/);assert.match(processor,/experiment \? \{ .*await analyzeCommercialProspect\(request\), attempts: 1 \}/);
 assert.match(processor,/phase === "start" \|\| phase === "skip"/);
});
