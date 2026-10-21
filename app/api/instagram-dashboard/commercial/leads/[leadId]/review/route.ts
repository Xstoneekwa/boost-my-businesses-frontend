import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { parseCommercialReviewMutation, reviewCommercialLead } from "@/lib/commercial/lead-review";
import { commercialApiError, commercialJson } from "../../../_response";
import { after } from "next/server";
import { processCommercialOutreachBatch } from "@/lib/commercial/outreach-processor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

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
    if (mutation.action === "approve") after(async () => {
      try { await processCommercialOutreachBatch(); }
      catch { console.error("commercial_outreach_post_approval_retry_via_cron"); }
    });
    return commercialJson(result);
  } catch (error) {
    return commercialApiError(error);
  }
}
