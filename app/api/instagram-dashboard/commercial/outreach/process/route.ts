import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { processCommercialOutreachBatch } from "@/lib/commercial/outreach-processor";
import { commercialApiError, commercialJson } from "../../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    await requireCommercialCrmAccess();
    return commercialJson(await processCommercialOutreachBatch({ batchLimit: 10 }));
  } catch (error) {
    return commercialApiError(error);
  }
}
