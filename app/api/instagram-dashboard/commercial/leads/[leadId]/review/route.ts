import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { parseCommercialReviewMutation, reviewCommercialLead } from "@/lib/commercial/lead-review";
import { commercialApiError, commercialJson } from "../../../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    // Public entry point: authenticate and authorize before parsing or mutation.
    await requireCommercialCrmAccess();
    const mutation = parseCommercialReviewMutation(await request.json());
    const { leadId } = await params;
    const result = await reviewCommercialLead(leadId, mutation);
    return commercialJson(result);
  } catch (error) {
    return commercialApiError(error);
  }
}
