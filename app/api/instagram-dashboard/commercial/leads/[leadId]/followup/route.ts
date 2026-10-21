import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { getFollowup, mutateFollowup } from "@/lib/commercial/followup-service";
import { commercialJson } from "../../../_response";
import { followupApiError as commercialApiError } from "@/lib/commercial/followup-errors";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ leadId: string }> };
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireCommercialCrmAccess();
    return commercialJson(await getFollowup((await params).leadId));
  } catch (e) {
    return commercialApiError(e);
  }
}
export async function POST(request: Request, { params }: Params) {
  try {
    await requireCommercialCrmAccess();
    const text = await request.text();
    if (text.length > 30000)
      return commercialJson({ error: "payload_too_large" }, 413);
    return commercialJson(
      await mutateFollowup((await params).leadId, JSON.parse(text)),
    );
  } catch (e) {
    return commercialApiError(e);
  }
}
