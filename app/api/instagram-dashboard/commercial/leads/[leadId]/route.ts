import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { getCommercialLeadDetail } from "@/lib/commercial/dashboard-read-model";
import { commercialApiError, commercialJson } from "../../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    // Route-level guard is intentional even though the service repeats it.
    await requireCommercialCrmAccess();
    const { leadId } = await params;
    const detail = await getCommercialLeadDetail(leadId);
    if (!detail) return commercialJson({ found: false }, 404);
    return commercialJson({ found: true, lead: detail });
  } catch (error) {
    return commercialApiError(error);
  }
}
