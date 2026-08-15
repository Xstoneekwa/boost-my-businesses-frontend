import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { mutateCommercialOutreachItem, parseCommercialOutreachMutation } from "@/lib/commercial/outreach-service";
import { commercialApiError, commercialJson } from "../../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    await requireCommercialCrmAccess();
    const mutation = parseCommercialOutreachMutation(await request.json());
    const { itemId } = await params;
    return commercialJson(await mutateCommercialOutreachItem(itemId, mutation));
  } catch (error) {
    return commercialApiError(error);
  }
}
