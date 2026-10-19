import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/france-acquisition-v5.json", import.meta.url), "utf8"));
const forbidden = () => { throw new Error("No real provider allowed in acquisition regression tests"); };
function load(path, imports) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const m={exports:{}};
  runInNewContext(code,{module:m,exports:m.exports,require(id){if(!(id in imports))throw new Error(`Unmocked import ${id}`);return imports[id];},
    process:{env:{TARGET_AI_SEARCHAPI_KEY:"offline-fixture-not-a-key",TARGET_AI_DISCOVERY_SEARCH_URL:"https://provider.invalid/search"}},
    URL,AbortController,Response,Date,setTimeout,clearTimeout,fetch:forbidden});
  return m.exports;
}
const triage=load("./france-acquisition.ts",{});
const url=load("../instagram-client/target-ai-instagram-url.ts",{"../instagram-targets.ts":{normalizeTargetUsername:s=>/^[a-z0-9._]{1,30}$/i.test(s)?s.toLowerCase():null}});
const extractor=load("../instagram-client/target-ai-serp-extractor.ts",{"./target-ai-instagram-url.ts":url});
const loop=load("../instagram-client/target-ai-google-serp-discovery.ts",{"./target-ai-serp-extractor.ts":extractor});
const rows=fixture.candidates.map(c=>({link:c.profileUrl,title:c.title,snippet:c.snippet}));

test("real shared discovery loop filters before its early-stop/cap and continues for useful candidates",async()=>{
  let calls=0;
  const result=await loop.runTargetAiGoogleSerpDiscovery({queries:["first-query","next-vertical"],maxCandidates:10,earlyStopCandidateCount:10,pagesPerQuery:1,pageDelayMs:0,maxQueriesToExecute:2,
    candidateFilter:c=>triage.assessFranceSerpCandidate(c).keep,fetcher:async()=>{
      calls++;
      return new Response(JSON.stringify({organic_results:calls===1?rows:Array.from({length:8},(_,i)=>({link:`https://instagram.com/salon${i}/`,title:`Institut de beauté ${i}`,snippet:"Prestations locales"}))}));
    }});
  assert.equal(calls,2);assert.equal(result.queriesExecuted,2);assert.equal(result.candidates.length,10);
  assert.ok(result.candidates.every(c=>triage.assessFranceSerpCandidate(c).keep));
  assert.ok(result.candidates.some(c=>c.username==="mhaesthetic.clinic"));
});
test("same shared discovery without an opt-in filter retains its legacy behavior",async()=>{
  let calls=0;
  const result=await loop.runTargetAiGoogleSerpDiscovery({queries:["first","second"],maxCandidates:10,earlyStopCandidateCount:10,pagesPerQuery:1,pageDelayMs:0,fetcher:async()=>{calls++;return new Response(JSON.stringify({organic_results:rows}));}});
  assert.equal(calls,1);assert.equal(result.candidates.length,10);assert.ok(result.candidates.some(c=>c.username==="policy"));
});
test("production provider opts France in before profile work, but never ZA; bounds unchanged",async()=>{
  const market=load("./market-config.ts",{});
  const portfolio=load("./discovery-query-portfolio.ts",{"./market-config.ts":market});
  const requests=[];
  const provider=load("./discovery-provider.ts",{
    "@/lib/instagram-client/target-ai-google-serp-discovery":{runTargetAiGoogleSerpDiscovery:async input=>{requests.push(input);return {candidates:[],queriesExecuted:0,queriesSucceeded:0,queriesFailed:0,pagesFetched:0,organicResultsScanned:0,extractedCandidatesCount:0,rejectedNonProfileCount:0,stoppedReason:"offline"};}},
    "./discovery-query-portfolio":portfolio,"./france-query-diagnostics":{franceDiagnosticFetcher:f=>f},
    "./france-profile-first":{runFranceProfileFirst:forbidden},"./france-acquisition":triage
  });
  await provider.discoverCommercialCandidates({countryCode:"FR",city:"Annecy",maxCandidates:10,fetcher:forbidden});
  await provider.discoverCommercialCandidates({countryCode:"ZA",city:"Cape Town",maxCandidates:10,fetcher:forbidden});
  assert.equal(typeof requests[0].candidateFilter,"function");
  assert.equal(requests[0].candidateFilter(fixture.candidates[0]),true);
  assert.equal(requests[0].candidateFilter(fixture.candidates.find(c=>c.username==="policy")),false);
  assert.equal("candidateFilter" in requests[1],false);
  assert.equal(requests[0].maxCandidates,10);assert.equal(requests[1].maxCandidates,40);
  for(const r of requests){assert.equal(r.pagesPerQuery,2);assert.equal(r.maxQueriesToExecute,r.queries.length);assert.equal(r.maxDurationMs,110000);}
});
