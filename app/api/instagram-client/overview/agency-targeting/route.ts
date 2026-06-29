import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { loadClientAgencyTargetingOverview } from "@/lib/instagram-client/load-agency-targeting-overview";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireClientInstagramSession();
  if (!session.ok) return jsonError(session.error, session.status);

  const overview = await loadClientAgencyTargetingOverview(session.clientId);
  if (!overview) {
    return jsonError("Agency targeting overview is not available for this workspace.", 404, {
      code: "agency_targeting_unavailable",
    });
  }

  return jsonOk(overview);
}
