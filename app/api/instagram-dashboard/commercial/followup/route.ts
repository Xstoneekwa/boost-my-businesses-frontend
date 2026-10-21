import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { getFollowupQueue } from "@/lib/commercial/followup-service";
import { requireMarket } from "@/lib/commercial/followup-domain";
import { commercialJson, commercialApiError } from "../_response";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireCommercialCrmAccess();
    const m = new URL(request.url).searchParams.get("market");
    return commercialJson(
      await getFollowupQueue(m ? requireMarket(m) : undefined),
    );
  } catch (e) {
    return commercialApiError(e);
  }
}
