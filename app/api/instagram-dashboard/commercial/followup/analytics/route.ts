import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { getFollowupQueue } from "@/lib/commercial/followup-service";
import { followupAnalytics } from "@/lib/commercial/followup-analytics";
import { commercialJson, commercialApiError } from "../../_response";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireCommercialCrmAccess();
    const queue = await getFollowupQueue();
    return commercialJson(followupAnalytics(queue.items));
  } catch (error) {
    return commercialApiError(error);
  }
}
