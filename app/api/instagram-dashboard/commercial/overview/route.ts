import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { getCommercialDashboardReadModel } from "@/lib/commercial/dashboard-read-model";
import { parseCommercialDashboardFilters } from "@/lib/commercial/dashboard-query";
import { commercialApiError, commercialJson } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    // Route-level guard is intentional even though the service repeats it.
    await requireCommercialCrmAccess();
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const filters = parseCommercialDashboardFilters(params);
    const model = await getCommercialDashboardReadModel(filters);
    return commercialJson(model);
  } catch (error) {
    return commercialApiError(error);
  }
}
