import { getStructuredPoc } from "@/lib/commercial/structured-discovery-service";
import { commercialBusinessView } from "@/lib/commercial/business-review-model";
import CommercialIdentityWorkspace from "./CommercialIdentityWorkspace";
import { CommercialCrmAccessError } from "@/lib/commercial/crm-access";
import CommercialAccessState from "./CommercialAccessState";
import type { BusinessAliasOccurrence } from "@/lib/commercial/business-aliases-v2";
export default async function CommercialIdentityReview({market}:{market?:string}){
  let data:Awaited<ReturnType<typeof getStructuredPoc>>;
  try{data=await getStructuredPoc();}catch(error){
    if(error instanceof CommercialCrmAccessError)return <CommercialAccessState status={error.status} retryPath="/instagram-dashboard/commercial"/>;
    return <section role="status">Business identity results are temporarily unavailable. No discovery or scoring was started.</section>;
  }
  const summary=data.state?.summary as {resolver_v2?:{status?:string};alias_v3a?:{status?:string;calls?:Array<{itemId:string;outcome:string;schema:string;aliases?:BusinessAliasOccurrence[]}>}}|undefined;
  const items=data.items.filter(i=>i.business_id).map(i=>commercialBusinessView(i));
  const aliasObservations=Object.fromEntries((summary?.alias_v3a?.calls??[]).filter(c=>c.outcome==="SUCCESS"&&c.schema==="PASS").map(c=>[c.itemId,c.aliases??[]]));
  return <CommercialIdentityWorkspace items={items} runStatus={summary?.resolver_v2?.status??"not_started"} market={market} aliasObservations={aliasObservations} aliasDiagnosticStatus={summary?.alias_v3a?.status}/>;
}
