import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { getHumanReviewFeedback } from "@/lib/commercial/human-review-feedback-service";
import { commercialApiError, commercialJson } from "../_response";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await requireCommercialCrmAccess(); return commercialJson(await getHumanReviewFeedback()); }
  catch (error) { return commercialApiError(error); }
}
