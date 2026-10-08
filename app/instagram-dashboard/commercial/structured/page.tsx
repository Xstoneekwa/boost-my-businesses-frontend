import { redirect } from "next/navigation";
import { CommercialCrmAccessError, requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import CommercialAccessState from "../CommercialAccessState";
export const dynamic="force-dynamic";
/** Legacy POC deep links now land in the canonical Commercial product. */
export default async function StructuredDiscoveryPage(){
  try{await requireCommercialCrmAccess();}catch(error){
    if(error instanceof CommercialCrmAccessError)return <CommercialAccessState status={error.status} retryPath="/instagram-dashboard/commercial/structured"/>;
    throw error;
  }
  redirect("/instagram-dashboard/commercial?country=FR#identity-review");
}
