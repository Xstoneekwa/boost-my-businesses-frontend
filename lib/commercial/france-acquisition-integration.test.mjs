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
  const contract=load("./discovery-contract.ts",{"./market-config.ts":market});
  const portfolio=load("./discovery-query-portfolio.ts",{"./market-config.ts":market,"./discovery-contract.ts":contract});
  const requests=[];
  const provider=load("./discovery-provider.ts",{
    "@/lib/instagram-client/target-ai-google-serp-discovery":{runTargetAiGoogleSerpDiscovery:async input=>{requests.push(input);return {candidates:[],queriesExecuted:0,queriesSucceeded:0,queriesFailed:0,pagesFetched:0,organicResultsScanned:0,extractedCandidatesCount:0,rejectedNonProfileCount:0,stoppedReason:"offline"};}},
    "./discovery-query-portfolio":portfolio,"./france-query-diagnostics":load("./france-query-diagnostics.ts",{}),
    "./france-profile-first":{runFranceProfileFirst:forbidden},"./france-acquisition":triage
  });
  await provider.discoverCommercialCandidates({countryCode:"FR",city:"Annecy",maxCandidates:10,fetcher:forbidden});
  await provider.discoverCommercialCandidates({countryCode:"ZA",city:"Cape Town",maxCandidates:10,fetcher:forbidden});
  assert.equal(typeof requests[0].candidateFilter,"function");
  assert.equal(requests[0].candidateFilter(fixture.candidates[0]),true);
  assert.equal(requests[0].candidateFilter(fixture.candidates.find(c=>c.username==="policy")),false);
  assert.equal("candidateFilter" in requests[1],false);
  assert.equal(requests[0].maxCandidates,10);assert.equal(requests[1].maxCandidates,40);
  assert.equal(requests[0].pagesPerQuery,1);assert.equal(requests[1].pagesPerQuery,2);
  assert.equal(requests[0].queries.length,contract.COMMERCIAL_DISCOVERY_SUBSEGMENTS.length);
  for(const r of requests){assert.equal(r.maxQueriesToExecute,r.queries.length);assert.equal(r.maxDurationMs,110000);}
});

function realProviderFixture() {
  const market = load("./market-config.ts", {});
  const contract = load("./discovery-contract.ts", { "./market-config.ts": market });
  const portfolio = load("./discovery-query-portfolio.ts", { "./market-config.ts": market, "./discovery-contract.ts": contract });
  const requests = [];
  const provider = load("./discovery-provider.ts", {
    "@/lib/instagram-client/target-ai-google-serp-discovery": { runTargetAiGoogleSerpDiscovery: input => {
      requests.push(input); return loop.runTargetAiGoogleSerpDiscovery({ ...input, pageDelayMs: 0 });
    } },
    "./discovery-query-portfolio": portfolio,
    "./france-query-diagnostics": load("./france-query-diagnostics.ts", {}),
    "./france-profile-first": { runFranceProfileFirst: forbidden }, "./france-acquisition": triage,
  });
  return { provider, requests, contract };
}
for (const city of ["Paris", "Marseille", "Lyon", "Annecy"]) test(`actual broad FR provider/loop ${city}: twelve families, first page only, no external transport`, async () => {
  const f = realProviderFixture(), observed = [];
  const result = await f.provider.discoverCommercialCandidates({ countryCode: "FR", city, subsegment: null, maxCandidates: 10,
    fetcher: async input => {
      const u = new URL(input); observed.push({ query: u.searchParams.get("q"), page: u.searchParams.get("page") ?? "1" });
      return Response.json({ organic_results: [] });
    } });
  assert.equal(f.requests[0].pagesPerQuery, 1); assert.equal(f.requests[0].maxCandidates, 10);
  assert.equal(f.requests[0].earlyStopCandidateCount, 10); assert.equal(f.requests[0].maxDurationMs, 110000);
  assert.equal(result.queries.length, f.contract.COMMERCIAL_DISCOVERY_SUBSEGMENTS.length);
  assert.equal(observed.length, 12); assert.ok(observed.every(r => r.page === "1"));
  assert.deepEqual(observed.map(r => r.query), Array.from(result.queries));
  assert.equal(result.diagnostic.pagesFetched, 12);
  assert.equal(result.diagnostic.queryDiagnostics.length, 12);
});
for (const [countryCode, city, subsegment] of [["FR", "Paris", "Skin Clinic"], ["FR", "Annecy", "Hair Stylist"], ["ZA", "Cape Town", null], ["ZA", "Johannesburg", "Hair Salon"], ["FR", "France", null]]) {
  test(`historical pagination retained outside city broad: ${countryCode}/${city}/${subsegment}`, async () => {
    const f = realProviderFixture(), pages = [];
    await f.provider.discoverCommercialCandidates({ countryCode, city, subsegment, maxCandidates: 10,
      fetcher: async input => { pages.push(new URL(input).searchParams.get("page") ?? "1"); return Response.json({ organic_results: [] }); } });
    assert.equal(f.requests[0].pagesPerQuery, 2); assert.ok(pages.includes("2"));
    assert.equal(f.requests[0].maxCandidates, countryCode === "FR" ? 10 : 40);
  });
}
test("broad FR still stops at its existing candidate cap; portfolio coverage is not fabricated executed-provider coverage", async () => {
  const f = realProviderFixture(); let calls = 0;
  const result = await f.provider.discoverCommercialCandidates({ countryCode: "FR", city: "Paris", maxCandidates: 10,
    fetcher: async () => { calls++; return Response.json({ organic_results: Array.from({ length: 20 }, (_, i) => ({
      link: `https://instagram.com/institutfixture${i}/`, title: `Institut de beauté Rubis ${i}`, snippet: "Paris France",
    })) }); } });
  assert.equal(calls, 1); assert.equal(result.candidates.length, 10);
  assert.equal(result.queries.length, 12); assert.equal(result.diagnostic.queriesExecuted, 1);
});
