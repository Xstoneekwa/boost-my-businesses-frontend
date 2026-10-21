import { createSupabaseClient } from "@/lib/supabase";
import { ACCOUNT_ID, annotationInput } from "@/lib/instagram-dashboard/account-annotation-contract";
import { jsonError,jsonOk,resolveInstagramDashboardActor } from "../_utils";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
 const auth=await resolveInstagramDashboardActor(request,"Account annotations");
 if(!auth.ok) return auth.response;
 const ids=[...new Set((new URL(request.url).searchParams.get("account_ids")||"").split(",").filter(Boolean))];
 if(!ids.length||ids.length>100||ids.some(id=>!ACCOUNT_ID.test(id))) return jsonError("Invalid account ids.",400);
 const db=createSupabaseClient();
 const [bindings,notes]=await Promise.all([
 db.from("client_instagram_accounts").select("account_id,client_id").in("account_id",ids),
 db.from("account_annotations").select("account_id,client_id,annotation,version,created_at,updated_at").in("account_id",ids)]);
 if(bindings.error||notes.error) return jsonError("Annotations unavailable.",503);
 const rows=ids.map(id=>{
  const owned=(bindings.data||[]).filter(b=>b.account_id===id);
  const note=(notes.data||[]).find(n=>n.account_id===id);
  if(owned.length!==1 || (note && note.client_id!==owned[0].client_id)) return {account_id:id,available:false};
  return note?{...note,available:true}:{account_id:id,client_id:owned[0].client_id,annotation:null,version:0,available:true};
 });
 return jsonOk({rows});
}
export async function PATCH(request:Request) {
 const auth=await resolveInstagramDashboardActor(request,"Account annotations");
 if(!auth.ok) return auth.response;
 let input;
 try { input=annotationInput(await request.json()); } catch { return jsonError("Invalid annotation.",400); }
 const db=createSupabaseClient();
 // Operator/admin authorization above; canonical ownership checked atomically in RPC.
 const result=await db.rpc("save_account_annotation_v1",{p_account_id:input.accountId,
 p_client_id:input.clientId,p_expected_version:input.version,p_annotation:input.text});
 if(result.error) return jsonError(result.error.code==="PT409"?"Annotation changed. Reload before saving.":"Annotation save failed.",
 result.error.code==="PT409"?409:result.error.code==="PT404"?404:503);
 return jsonOk(result.data);
}
