import { FRANCE_BEAUTY_QUERY_TERMS } from "./market-config.ts";
import { extractSerpProfilesFromOrganicResults, type SerpOrganicRow, type SerpProfileCandidate } from "../instagram-client/target-ai-serp-extractor.ts";

export const FR_PROFILE_FIRST_KEY = "commercial-france-profile-first-v2-canary";
export const FR_QUERY_VERSION = "fr-profile-first-v2";
export const FR_PATH_EXCLUSIONS = " -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ -inurl:/stories/ -inurl:/tv/";
export type Arm = "control" | "candidate";
export type Query = { query_id: string; query: string; arm: Arm; family: string; query_set_version: string };
export function franceQueryPairs(): Query[] {
  return FRANCE_BEAUTY_QUERY_TERMS.flatMap((family, index) => {
    const arms: Arm[] = index % 2 ? ["candidate", "control"] : ["control", "candidate"];
    return arms.map(arm => ({ query_id: `f${index + 1}-${arm}`, query: `site:instagram.com/ "${family}" "France"${arm === "candidate" ? FR_PATH_EXCLUSIONS : ""}`, arm, family, query_set_version: FR_QUERY_VERSION }));
  });
}
export type UrlClass = "ROOT_IG_PROFILE" | "IG_POST" | "IG_REEL" | "IG_OTHER" | "DIRECTORY" | "WEBSITE" | "ARTICLE" | "OTHER";
export function classifyFranceSerpUrl(value: string): UrlClass {
  try {
    const u = new URL(value); if (!["https:", "http:"].includes(u.protocol)) return "OTHER";
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);
    if (host === "instagram.com") {
      if (parts[0] === "p") return "IG_POST";
      if (["reel", "reels"].includes(parts[0])) return "IG_REEL";
      if (parts.length === 1 && /^[a-z0-9._]{1,30}$/i.test(parts[0]) && !["explore","stories","accounts","tv","tags","directory","about","legal","developer","api","direct","nametag","business","help","privacy","terms","press","jobs","popular","instagram"].includes(parts[0].toLowerCase())) return "ROOT_IG_PROFILE";
      return "IG_OTHER";
    }
    if (["pagesjaunes.fr", "yelp.com", "yelp.fr"].includes(host)) return "DIRECTORY";
    if (/\/(?:blog|articles?|actualites?)\//i.test(u.pathname)) return "ARTICLE";
    return "WEBSITE";
  } catch { return "OTHER"; }
}
export function minimizeSerpText(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u001f]/g, " ")
    .replace(/https?:\/\/[^\s]+/gi, match => minimizeSerpUrl(match))
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email omitted]")
    .replace(/(?:\+?\d[\d .()-]{8,}\d)/g, "[phone omitted]").slice(0, 2000) : "";
}
export function minimizeSerpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try { const u = new URL(value); if (!["http:","https:"].includes(u.protocol)) return "";
    u.username = ""; u.password = ""; u.search = ""; u.hash = "";
    return u.toString().replace(/[\w.+-]+%40[\w.-]+/gi,"[contact]").slice(0,2000);
  } catch { return ""; }
}
export type Snapshot = { query_id: string; page: number; position: number; url: string; title: string; snippet: string; displayed_link: string; url_class: UrlClass; commercial_tag: string; commercial_evidence: string | null };
export type PageRecord = Query & { run_id: string; page: number; provider: string; engine: string; started_at: string; ended_at: string | null; duration_ms: number; timeout_ms: number; http_status: number | null; status: string; error_category: string | null; raw_result_count: number; unique_link_count: number; root_profile_count: number; accepted_candidate_count: number; new_unique_profile_count: number; duplicate_count: number; rejected_count: number; skip_reason: string | null; snapshots: Snapshot[]; accepted_handles: string[] };
export type PersistPage = (record: PageRecord, phase: "start" | "capture" | "finish" | "skip") => Promise<void>;
function snapshot(row: SerpOrganicRow, q: Query, page: number, index: number): Snapshot {
  const title = minimizeSerpText(row.title), snippet = minimizeSerpText(row.snippet);
  // Conservative annotations only. They do not alter the existing business prefilter.
  const combined = `${title} ${snippet}`;
  const brand = combined.match(/(?:\+?\d+\s+instituts?\s+en\s+France|réseau\s+(?:de\s+)?(?:salons|instituts))/iu);
  const training = combined.match(/(?:collège international de médecine esthétique|\d+\s+médecins formés|formations? certifiées? QUALIOPI)/iu);
  return { query_id:q.query_id,page,position:index+1,url:minimizeSerpUrl(row.link),title,snippet,displayed_link:minimizeSerpUrl(row.displayed_link),url_class:classifyFranceSerpUrl(minimizeSerpUrl(row.link)),commercial_tag:brand?"BRAND":training?"TRAINING_ORG":"UNKNOWN",commercial_evidence:brand?.[0]??training?.[0]??null };
}

/** Dedicated, one-shot France experiment. Shared SA search/extractor is untouched. */
export async function runFranceProfileFirst(input: { runId: string; apiKey: string; endpoint: string; persist: PersistPage; fetcher?: typeof fetch; now?: () => number; sleep?: (ms:number)=>Promise<void> }) {
  if (!input.apiKey || !input.runId || !input.persist) throw new Error("fr_experiment_not_configured");
  const now = input.now ?? Date.now, sleep = input.sleep ?? (ms => new Promise(r=>setTimeout(r,ms)));
  const started = now(), timeoutMs = 8000, budgetMs = 110000;
  const queries = franceQueryPairs(), pages: PageRecord[] = [], candidates = new Map<string, SerpProfileCandidate>();
  const attributions: Record<string, Array<{query_id:string;arm:Arm;page:number;family:string}>> = {};
  let consecutiveTimeouts=0, breaker=false, stopReason="completed", page2Calls=0;
  const usefulPage1 = new Set<string>();
  const base=(q:Query,page:number):PageRecord=>({...q,run_id:input.runId,page,provider:"searchapi",engine:"google",started_at:new Date(now()).toISOString(),ended_at:null,duration_ms:0,timeout_ms:timeoutMs,http_status:null,status:"STARTED",error_category:null,raw_result_count:0,unique_link_count:0,root_profile_count:0,accepted_candidate_count:0,new_unique_profile_count:0,duplicate_count:0,rejected_count:0,skip_reason:null,snapshots:[],accepted_handles:[]});
  const globalSkip=()=>breaker?"SKIPPED_CIRCUIT_BREAKER":candidates.size>=30?"SKIPPED_TARGET_REACHED":now()-started+timeoutMs+280>budgetMs?"SKIPPED_BUDGET":null;
  async function execute(q:Query,page:number,extraSkip:string|null=null) {
    const record=base(q,page), skip=globalSkip()??extraSkip;
    if(skip){record.status="SKIPPED";record.skip_reason=skip;record.ended_at=record.started_at;await input.persist(record,"skip");pages.push(record);if(!extraSkip)stopReason=skip;return;}
    await sleep(280);
    // Durable unique STARTED reservation is required BEFORE calling the provider.
    await input.persist(record,"start");
    if(now()-started+timeoutMs>budgetMs){record.status="SKIPPED";record.skip_reason="SKIPPED_BUDGET";record.ended_at=new Date(now()).toISOString();await input.persist(record,"finish");pages.push(record);stopReason="SKIPPED_BUDGET";return;}
    if(page===2)page2Calls++;
    const requestStart=now();record.started_at=new Date(requestStart).toISOString();
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    let rows:SerpOrganicRow[]=[];
    try {
      const url=new URL(input.endpoint);url.searchParams.set("engine","google");url.searchParams.set("q",q.query);url.searchParams.set("api_key",input.apiKey);if(page>1)url.searchParams.set("page",String(page));
      const response=await (input.fetcher??fetch)(url.toString(),{cache:"no-store",signal:controller.signal});record.http_status=response.status;
      if(!response.ok){record.status="ERROR";record.error_category=response.status===429?"RATE_LIMITED":"PROVIDER_HTTP_ERROR";if(response.status===429)breaker=true;}
      else {
        const payload=await response.json();const raw=payload.organic_results??payload.results??payload.items;
        if(payload.error||payload.errors||!Array.isArray(raw)){record.status="ERROR";record.error_category="PROVIDER_PAYLOAD_ERROR";}
        else {rows=raw;record.status="CAPTURED";}
      }
    } catch(error){record.status="ERROR";record.error_category=error instanceof Error&&error.name==="AbortError"?"TIMEOUT":error instanceof SyntaxError?"MALFORMED_JSON":"NETWORK_OR_PROVIDER_ERROR";}
    finally {clearTimeout(timer);record.ended_at=new Date(now()).toISOString();record.duration_ms=now()-requestStart;}
    consecutiveTimeouts=record.error_category==="TIMEOUT"?consecutiveTimeouts+1:0;
    if(consecutiveTimeouts>=2)breaker=true;
    if(record.status==="CAPTURED"){
      // The minimized rows are committed before any extractor invocation on this response.
      record.snapshots=rows.map((r,i)=>snapshot(r??{},q,page,i));record.raw_result_count=rows.length;
      await input.persist(record,"capture");
      const links=new Set(record.snapshots.map(s=>s.url||s.displayed_link).filter(Boolean));record.unique_link_count=links.size;
      const roots=record.snapshots.filter(s=>s.url_class==="ROOT_IG_PROFILE");
      record.root_profile_count=new Set(roots.map(s=>s.url.toLowerCase())).size;
      const newRoot = roots.some(s=>!candidates.has(new URL(s.url).pathname.split("/").filter(Boolean)[0].toLowerCase()));
      const extracted=extractSerpProfilesFromOrganicResults({rows:record.snapshots.map(s=>({link:s.url,displayed_link:s.displayed_link,title:s.title,snippet:s.snippet})),sourceQuery:q.query});
      record.accepted_candidate_count=extracted.length;record.accepted_handles=extracted.map(c=>c.username.toLowerCase());
      record.rejected_count=record.snapshots.filter(s=>!extractSerpProfilesFromOrganicResults({rows:[{link:s.url,displayed_link:s.displayed_link,title:s.title,snippet:s.snippet}],sourceQuery:q.query}).length).length;
      for(const candidate of extracted){const key=candidate.username.toLowerCase();(attributions[key]??=[]).push({query_id:q.query_id,arm:q.arm,page,family:q.family});
        if(candidates.has(key)){record.duplicate_count++;continue;}
        if(candidates.size<30){candidates.set(key,candidate);record.new_unique_profile_count++;}
      }
      record.status="SUCCESS";
      if(page===1&&newRoot&&record.new_unique_profile_count>0)usefulPage1.add(q.query_id);
    }
    await input.persist(record,"finish");pages.push(record);
  }
  try {
    for(const q of queries)await execute(q,1);
    const eligible=queries.filter(q=>usefulPage1.has(q.query_id));
    for(const q of queries){const useful=eligible.includes(q);await execute(q,2,!useful?"SKIPPED_NO_NEW_PROFILE":page2Calls>=2?"SKIPPED_BUDGET":null);}
  } catch {breaker=true;stopReason="CAPTURE_AUDIT_FAILURE";throw new Error("fr_capture_audit_failure");}
  return {candidates:[...candidates.values()],queries:queries.map(q=>q.query),attributions,diagnostic:{query_set_version:FR_QUERY_VERSION,queryDiagnostics:pages.map(({snapshots,...p})=>({...p,snapshot_count:snapshots.length})),queriesExecuted:pages.filter(p=>p.page===1&&p.status!=="SKIPPED").length,queriesSucceeded:pages.filter(p=>p.page===1&&p.status==="SUCCESS").length,queriesFailed:pages.filter(p=>p.page===1&&p.status==="ERROR").length,pagesFetched:pages.filter(p=>p.status!=="SKIPPED").length,organicResultsScanned:pages.reduce((n,p)=>n+p.raw_result_count,0),extractedCandidatesCount:candidates.size,rejectedNonProfileCount:pages.reduce((n,p)=>n+p.rejected_count,0),stoppedReason:stopReason}};
}

export function compareFrancePairs(pages: PageRecord[]) {
  return FRANCE_BEAUTY_QUERY_TERMS.map(family=>{
    const control=pages.find(p=>p.family===family&&p.arm==="control"&&p.page===1),candidate=pages.find(p=>p.family===family&&p.arm==="candidate"&&p.page===1);
    return {family,verdict:control?.status!=="SUCCESS"||candidate?.status!=="SUCCESS"?"NON_COMPARABLE":candidate.root_profile_count>control.root_profile_count?"CANDIDATE_WINS":candidate.root_profile_count<control.root_profile_count?"CONTROL_WINS":"TIE"};
  });
}
