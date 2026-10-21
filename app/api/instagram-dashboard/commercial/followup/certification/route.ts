import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { certifyFollowupFixtures } from "@/lib/commercial/followup-certification";
import { commercialJson, commercialApiError } from "../../_response";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireCommercialCrmAccess();
    return commercialJson(certifyFollowupFixtures());
  } catch (error) {
    return commercialApiError(error);
  }
}
