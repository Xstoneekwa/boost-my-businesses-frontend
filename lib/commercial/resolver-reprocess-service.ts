import "server-only";
import { requireCommercialCrmAccess } from "./crm-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CommercialInstagramResolver, enforceChainSafety, type InstagramMatch } from "./structured-instagram-resolver";
import { fetchOfficialSite, safeSiteGet } from "./structured-site-fetch";
import { targetedSearch, type SearchResult } from "./resolver-search";
import type { StructuredCandidate } from "./structured-discovery-contract";
import type { BusinessResolution } from "./business-resolution-v2";

export const RESOLVER_REPROCESS_KEY="commercial-existing-15-instagram-resolver-v2";
type Input={itemId:string;businessId:string;candidate:StructuredCandidate;previous:InstagramMatch};
async function control(actor:string,action:string,extra:Record<string,unknown>={}) {
  const {data,error}=await createSupabaseAdminClient().rpc("commercial_resolver_v2_control",{p_actor_user_id:actor,p_action:action,...extra});
  if(error)throw new Error("resolver_control_failed");return data as {replay:boolean;status:string;inputs:Input[]};
}
export async function startResolverReprocess(){const actor=await requireCommercialCrmAccess();const result=await control(actor.userId,"start");return {...result,actorId:actor.userId};}
/** No imports or routes to Sirene, AI, lead creation or transports. No automatic retry. */
export async function executeResolverReprocess(actor:string,inputs:Input[]){
  const resolver=new CommercialInstagramResolver(),results:Array<{itemId:string;businessId:string;resolution:BusinessResolution;search:SearchResult}>=[];
  const started=Date.now();
  try {
    // Three bounded workers per batch; wait for all reservations to settle before failing.
    // Inputs are ordered with the four historical MEDIUM candidates first.
    for(let offset=0;offset<inputs.length;offset+=3){
      const batch=await Promise.allSettled(inputs.slice(offset,offset+3).map(async input=>{
      if(Date.now()-started>240000)throw new Error("resolver_deadline");
      let search:SearchResult={outcome:"EMPTY_RESULTS",hits:[],reason:"not_called"};
      const robotsCache=new Map<string,{status:number;text:string}>();
      async function reserve(kind:string,key:string){await control(actor,"reserve",{p_item_id:input.itemId,p_kind:kind,p_key:key});}
      async function record(kind:string,key:string,payload:Record<string,unknown>){await control(actor,"record",{p_item_id:input.itemId,p_kind:kind,p_key:key,p_payload:payload});}
      const resolution=await resolver.resolveV2(input.candidate,{
        previous:input.previous,
        search:async query=>{
          await reserve("search",query);const t=Date.now();
          search=await targetedSearch(query,process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY?.trim()||process.env.TARGET_AI_SEARCHAPI_KEY?.trim()||"");
          await record("search",query,{outcome:search.outcome,reason:search.reason,httpStatus:search.httpStatus,durationMs:Date.now()-t});return search.hits;
        },
        site:async url=>fetchOfficialSite(url,async target=>{
          const kind=new URL(target).pathname==="/robots.txt"?"robots":"page";
          if(kind==="robots"&&robotsCache.has(target))return robotsCache.get(target)!;
          await reserve(kind,target);const t=Date.now();
          try {const response=await safeSiteGet(target);if(kind==="robots")robotsCache.set(target,response);await record(kind,target,{outcome:response.status===200?"SUCCESS":"HTTP_ERROR",httpStatus:response.status,reason:`http_${response.status}`,durationMs:Date.now()-t});return response;}
          catch(error){await record(kind,target,{outcome:error instanceof Error&&error.message==="site_timeout"?"TIMEOUT":"SITE_ERROR",reason:error instanceof Error&&/^site_[a-z_]+$/.test(error.message)?error.message:"network_failure",durationMs:Date.now()-t});throw error;}
        }),
      });
      return {itemId:input.itemId,businessId:input.businessId,resolution,search};
      }));
      if(batch.some(result=>result.status==="rejected"))throw new Error("resolver_batch_failed");
      for(const result of batch)if(result.status==="fulfilled")results.push(result.value);
    }
    const safe=enforceChainSafety(results.map((r,index)=>({candidate:inputs[index].candidate,match:r.resolution.match})));
    results.forEach((r,index)=>{r.resolution.match=safe[index].match;if(safe[index].match.reason==="SHARED_BRAND_PROFILE"){r.resolution.profileScope="SHARED_BRAND_PROFILE";r.resolution.evidence.push({type:"SHARED_BRAND_PROFILE",source:"cohort",reference:"same handle across distinct establishment identities",strength:"NEGATIVE",observed_at:new Date().toISOString()});}});
    await control(actor,"complete",{p_payload:{results}});
  } catch {await control(actor,"fail");}
}
