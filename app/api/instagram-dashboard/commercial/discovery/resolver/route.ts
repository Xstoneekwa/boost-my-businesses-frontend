import { after } from "next/server";
import { startResolverReprocess, executeResolverReprocess, RESOLVER_REPROCESS_KEY } from "@/lib/commercial/resolver-reprocess-service";
import { commercialApiError, commercialJson } from "../../_response";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function POST(request:Request){
  try{
    if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"same_origin_required"},{status:403});
    const body=await request.json();if(body?.authorizationKey!==RESOLVER_REPROCESS_KEY)return Response.json({error:"authorization_key_required"},{status:400});
    const result=await startResolverReprocess();
    if(!result.replay)after(()=>executeResolverReprocess(result.actorId,result.inputs));
    return commercialJson({replay:result.replay,status:result.status},202);
  }catch(error){return commercialApiError(error);}
}
