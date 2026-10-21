import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { ingestFollowup } from "@/lib/commercial/followup-service";
import { commercialJson } from "../_response";
import { followupApiError as commercialApiError } from "@/lib/commercial/followup-errors";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await requireCommercialCrmAccess();
    const text = await request.text();
    if (text.length > 30000)
      return commercialJson({ error: "payload_too_large" }, 413);
    return commercialJson(await ingestFollowup(JSON.parse(text)));
  } catch (e) {
    return commercialApiError(e);
  }
}
