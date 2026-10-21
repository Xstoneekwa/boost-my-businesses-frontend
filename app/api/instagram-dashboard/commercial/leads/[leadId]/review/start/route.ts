import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { startHumanReview } from "@/lib/commercial/human-review-feedback-service";
import { commercialApiError, commercialJson } from "../../../../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(_request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    await requireCommercialCrmAccess();
    return commercialJson(await startHumanReview((await params).leadId));
  } catch (error) { return commercialApiError(error); }
}
