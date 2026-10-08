import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCommercialCrmAccess } from "./crm-access";
import { SireneProvider, SIRENE_QUERY } from "./sirene-provider";
import { CommercialInstagramResolver, enforceChainSafety, structuredScoringAllowed, type SearchHit } from "./structured-instagram-resolver";
import { fetchOfficialSite, safeSiteGet } from "./structured-site-fetch";
import { selectNationalCohort, STRUCTURED_POC_KEY, type CallKind, type StructuredCandidate } from "./structured-discovery-contract";
import { lookupInstagramPublicProfile } from "@/lib/instagram-public-profile-lookup";
import { analyzeCommercialProspect } from "./discovery-ai";
import { scoreCommercialProspect } from "./discovery-scoring";
import { COMMERCIAL_AI_PROMPT_VERSION } from "./discovery-contract";

type Row = Record<string,unknown>;
const row=(v:unknown):Row=>v&&typeof v==="object"&&!Array.isArray(v)?v as Row:{};
const text=(v:unknown)=>typeof v==="string"?v:"";
const db=()=>createSupabaseAdminClient();
async function checked<T>(operation:PromiseLike<{data:T;error:unknown}>) {const result=await operation;if(result.error)throw new Error("structured_database_operation_failed");return result.data;}
export async function getStructuredPoc() {
  await requireCommercialCrmAccess();
  const state=await checked(db().from("commercial_structured_run_state").select("run_id,summary,calls").eq("authorization_key",STRUCTURED_POC_KEY).maybeSingle());
  if(!state)return {run:null,items:[],sireneConfigured:Boolean(process.env.SIRENE_API_KEY?.trim())};
  const run=await checked(db().from("commercial_discovery_runs").select("id,status,started_at,completed_at,error_summary_safe").eq("id",state.run_id).single());
  const items=await checked(db().from("commercial_discovery_items").select("id,status,business_id,lead_id,source_snapshot_safe,enrichment_snapshot_safe,analysis_snapshot_safe,error_code").eq("run_id",state.run_id).order("candidate_rank"));
  return {run,items:items??[],state,sireneConfigured:Boolean(process.env.SIRENE_API_KEY?.trim())};
}
export async function startStructuredPoc() {
  const actor=await requireCommercialCrmAccess();
  if(!process.env.SIRENE_API_KEY?.trim())throw new Error("sirene_configuration_missing");
  const registry=await checked(db().from("commercial_identity_providers").select("provider_key,country,identity_mode,source_policy").eq("provider_key","sirene").single());
  const policy=row(registry?.source_policy);
  if(registry?.country!=="FR"||registry.identity_mode!=="structured"||policy.discovery_enabled!==true||policy.authorization_key!==STRUCTURED_POC_KEY||policy.max_candidates!==15)throw new Error("structured_provider_policy_denied");
  const result=row(await checked(db().rpc("start_structured_commercial_poc_v1",{p_actor_user_id:actor.userId})));
  return {runId:text(result.runId),replay:result.replay===true,actorId:actor.userId};
}

async function parallelBounded<T,R>(values:T[],callback:(v:T)=>Promise<R>):Promise<R[]> {
  const results:R[]=[];let index=0;
  const settled=await Promise.allSettled(Array.from({length:Math.min(3,values.length)},async()=>{while(index<values.length){const i=index++;results[i]=await callback(values[i]);}}));
  const failed=settled.find(r=>r.status==="rejected");if(failed?.status==="rejected")throw failed.reason;return results;
}

/** Invoked only for a newly reserved owner run, never by cron or a replay. */
export async function executeStructuredPoc(runId:string,actorId:string) {
  const started=Date.now(), supabase=db();
  const provider=new SireneProvider(), resolver=new CommercialInstagramResolver();
  const pool:StructuredCandidate[]=[], exclusions:unknown[]=[];
  let sireneResults=0;
  async function call<T>(kind:CallKind,key:string,purpose:string,fn:()=>Promise<{value:T;status:string;count:number}>):Promise<T> {
    if(Date.now()-started>240_000)throw new Error("structured_time_budget_exhausted");
    const reserved=await checked(supabase.rpc("reserve_structured_call_v1",{p_actor_user_id:actorId,p_run_id:runId,p_kind:kind,p_key:key,p_purpose:purpose.slice(0,500)}));
    if(!reserved)throw new Error("structured_call_budget_or_replay_blocked");
    const start=Date.now();let status="ERROR",count=0;
    try {const result=await fn();status=result.status;count=result.count;return result.value;}
    catch(error){if(error instanceof Error&&/^sirene_http_\d{3}$/.test(error.message))status=error.message.slice(-3);throw error;}
    finally {await checked(supabase.rpc("finish_structured_call_v1",{p_actor_user_id:actorId,p_run_id:runId,p_kind:kind,p_key:key,p_status:status,p_duration_ms:Date.now()-start,p_result_count:count}));}
  }
  const updateItem=async(id:string,fields:Row)=>checked(supabase.from("commercial_discovery_items").update(fields).eq("id",id).select("id").single());
  try {
    let cursor="*";
    for(let page=1;page<=2;page++) {
      if(page>1)await new Promise(r=>setTimeout(r,2200));
      const observedAt=new Date().toISOString();
      const result=await call("sirene",String(page),JSON.stringify({page,cursor,query:SIRENE_QUERY}),async()=>{
        const normalized=await provider.fetchPage(process.env.SIRENE_API_KEY!.trim(),observedAt,cursor);
        return {value:normalized,status:"200",count:normalized.resultCount};
      });
      sireneResults+=result.resultCount;pool.push(...result.candidates);exclusions.push(...result.excluded);
      if(pool.length>=15 || !result.nextCursor || result.nextCursor===cursor)break;
      cursor=result.nextCursor;
    }
    const cohort=selectNationalCohort(pool);
    await checked(supabase.from("commercial_structured_run_state").update({summary:{provider:"sirene",scope:"NATIONAL",query:SIRENE_QUERY,received:sireneResults,eligiblePool:pool.length,excluded:exclusions,candidates:cohort.length}}).eq("run_id",runId).select("run_id").single());
    const items=cohort.length ? await checked(supabase.from("commercial_discovery_items").insert(cohort.map((candidate,index)=>({run_id:runId,provider:candidate.provider,provider_external_id:candidate.externalId,source_url:candidate.source.url,source_query:SIRENE_QUERY,status:"processing",stage:"PRECHECKED",selected_for_processing:false,candidate_rank:index+1,idempotency_key:candidate.externalId,source_snapshot_safe:candidate,max_attempts:1,attempt_count:1,location_country:candidate.country,location_city:candidate.city,location_confidence:"HIGH"}))).select("id,provider_external_id")) : [];
    const itemIds=new Map((items??[]).map(i=>[i.provider_external_id,i.id]));
    const resolved=await parallelBounded(cohort,async candidate=>{
      let siteCalls=0;
      const match=await resolver.resolve(candidate,{
        search:async query=>call("search",candidate.externalId,query,async()=>{
          const apiKey=process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY?.trim()||process.env.TARGET_AI_SEARCHAPI_KEY?.trim();
          if(!apiKey)throw new Error("search_configuration_missing");
          const url=new URL("https://www.searchapi.io/api/v1/search");url.search=new URLSearchParams({engine:"google",q:query,api_key:apiKey}).toString();
          const response=await fetch(url,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});
          if(!response.ok)return {value:[] as SearchHit[],status:String(response.status),count:0};
          const payload=row(await response.json());if(!Array.isArray(payload.organic_results))return {value:[] as SearchHit[],status:"INVALID_PAYLOAD",count:0};
          const hits:SearchHit[]=payload.organic_results.slice(0,10).map(value=>{const r=row(value);return {url:text(r.link),title:text(r.title).slice(0,500),snippet:text(r.snippet).slice(0,1500)};});
          return {value:hits,status:"200",count:hits.length};
        }).catch(()=>[]),
        site:async url=>fetchOfficialSite(url,async target=>call("site",`${candidate.externalId}:${++siteCalls}`,new URL(target).origin,async()=>{
          const value=await safeSiteGet(target);return {value,status:String(value.status),count:value.status===200?1:0};
        })),
      });
      return {candidate,match};
    });
    // Resolve the entire cohort first: a later shared handle must not retroactively invalidate a scored lead.
    const safeMatches=enforceChainSafety(resolved);
    await parallelBounded(safeMatches,async({candidate,match})=>{
      const itemId=itemIds.get(candidate.externalId)!;
      await updateItem(itemId,{enrichment_snapshot_safe:{match}});
      // Cross-provider collision remains a hold. Never fall back to handle/domain merge.
      const identity=row(await checked(supabase.rpc("create_structured_commercial_business_v1",{p_actor_user_id:actorId,p_provider:candidate.provider,p_external_id:candidate.externalId,p_business_name:candidate.businessName,p_country:candidate.country,p_city:candidate.city,p_address:candidate.address,p_instagram_handle:match.confidence==="HIGH"?match.matchedHandle:null})));
      if(!identity.business_id){await updateItem(itemId,{status:"possible_duplicate",error_code:"structured_identity_review_hold",completed_at:new Date().toISOString()});return;}
      await updateItem(itemId,{business_id:identity.business_id});
      if(identity.created===true)await checked(supabase.from("commercial_businesses").update({metadata_safe:{structured_discovery:candidate,instagram_match:match},location_confidence:"HIGH",location_evidence_safe:[{provider:candidate.provider,external_id:candidate.externalId,city:candidate.city,department:candidate.department,source:candidate.source.url}],business_status:"open"}).eq("id",identity.business_id).select("id").single());
      if(match.confidence!=="HIGH"||!match.matchedHandle){await updateItem(itemId,{status:match.confidence==="MEDIUM"?"possible_duplicate":"rejected",error_code:match.reason,completed_at:new Date().toISOString()});return;}
      // Existing structured establishments sharing this account also force manual review.
      const shared=await checked(supabase.from("commercial_businesses").select("id").eq("identity_mode","structured").eq("instagram_handle_normalized",match.matchedHandle).neq("id",identity.business_id).limit(1));
      if(shared?.length){await updateItem(itemId,{status:"possible_duplicate",error_code:"SHARED_BRAND_PROFILE",enrichment_snapshot_safe:{match:{...match,confidence:"MEDIUM",reason:"SHARED_BRAND_PROFILE"}}});return;}
      const profile=await call("enrichment",candidate.externalId,"existing_instagram_profile_lookup",async()=>{const value=await lookupInstagramPublicProfile(match.matchedHandle!,{timeoutMs:7000});return {value,status:value.status,count:value.status==="found"?1:0};});
      await updateItem(itemId,{enrichment_snapshot_safe:{match,profile}});
      if(!structuredScoringAllowed(candidate,match,profile)){await updateItem(itemId,{status:"rejected",error_code:"enrichment_not_verified_public_profile"});return;}
      const analysis=await call("scoring",candidate.externalId,"existing_BMB_scoring_no_retry",async()=>{const value=await analyzeCommercialProspect({market:"FR",city:candidate.city,evidence:{business:candidate,instagram_match:match,profile},timeoutMs:18000});return {value,status:value.ok?"PASS":value.errorCode,count:value.ok?1:0};});
      if(!analysis.ok){await updateItem(itemId,{status:"failed",error_code:analysis.errorCode});return;}
      const score=scoreCommercialProspect({analysis:analysis.analysis,isPrivate:profile.is_private,profileFound:true,businessStatus:"open",deterministicLocationConfidence:"HIGH"});
      await checked(supabase.rpc("persist_structured_scored_lead_v1",{p_actor_user_id:actorId,p_item_id:itemId,p_payload:{...score,...analysis.analysis,model:analysis.model,promptVersion:COMMERCIAL_AI_PROMPT_VERSION,usage:analysis.usage}}));
    });
    const finalItems=await checked(supabase.from("commercial_discovery_items").select("status,lead_id,analysis_snapshot_safe,enrichment_snapshot_safe").eq("run_id",runId));
    const count=(key:string,value:string)=>(finalItems??[]).filter(i=>row(i.analysis_snapshot_safe)[key]===value).length;
    await checked(supabase.from("commercial_discovery_runs").update({status:(finalItems??[]).some(i=>i.status==="failed")?"completed_with_errors":"completed",completed_at:new Date().toISOString(),discovered_count:cohort.length,created_count:(finalItems??[]).filter(i=>i.lead_id).length,enriched_count:(finalItems??[]).filter(i=>row(row(i.enrichment_snapshot_safe).profile).status==="found").length,scored_count:(finalItems??[]).filter(i=>i.lead_id).length,qualified_count:count("qualificationStatus","qualified"),p1_count:count("scorePriority","P1"),p2_count:count("scorePriority","P2"),p3_count:count("scorePriority","P3"),provider_diagnostic_safe:{duration_ms:Date.now()-started,live_send_eligible:false,auto_approval:false}}).eq("id",runId).select("id").single());
  } catch(error) {
    const safe=/^(sirene_http_\d{3}|sirene_payload_invalid|sirene_network_failure|structured_[a-z_]+)$/.test(error instanceof Error?error.message:"")?(error as Error).message:"structured_execution_failed";
    await checked(supabase.from("commercial_discovery_runs").update({status:"failed",completed_at:new Date().toISOString(),error_summary_safe:{code:safe,no_automatic_retry:true},provider_diagnostic_safe:{duration_ms:Date.now()-started}}).eq("id",runId).select("id").single());
  }
}
