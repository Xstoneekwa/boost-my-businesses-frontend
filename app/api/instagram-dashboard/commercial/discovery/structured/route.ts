import { after } from "next/server";
import { getStructuredPoc, startStructuredPoc, executeStructuredPoc } from "@/lib/commercial/structured-discovery-service";
import { commercialApiError, commercialJson } from "../../_response";
import { STRUCTURED_POC_KEY } from "@/lib/commercial/structured-discovery-contract";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(){try{return commercialJson(await getStructuredPoc());}catch(error){return commercialApiError(error);}}
export async function POST(request:Request){
  try {
    if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"same_origin_required"},{status:403});
    const body=await request.json();if(body?.authorizationKey!==STRUCTURED_POC_KEY)return Response.json({error:"invalid_authorization_key"},{status:400});
    const result=await startStructuredPoc();
    if(!result.replay)after(()=>executeStructuredPoc(result.runId,result.actorId));
    return commercialJson({runId:result.runId,replay:result.replay},202);
  }catch(error){return commercialApiError(error);}
}
