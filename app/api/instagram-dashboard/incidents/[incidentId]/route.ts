import { loadIncidentDetail } from "@/lib/instagram-dashboard/incident-detail";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ incidentId: string }> },
) {
  const unauthorized = await requireRelayOrAdmin(request, "Incident detail");
  if (unauthorized) return unauthorized;

  const { incidentId } = await context.params;
  const normalizedId = String(incidentId || "").trim();
  if (!UUID.test(normalizedId)) {
    return jsonError("Invalid incident id.", 400, { code: "INCIDENT_ID_INVALID" });
  }

  try {
    const detail = await loadIncidentDetail(normalizedId);
    if (!detail) return jsonError("Incident not found.", 404, { code: "INCIDENT_NOT_FOUND" });
    return jsonOk(detail);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "incident_detail_failed";
    const storageUnavailable = reason.includes("account_incident_review_events") || reason.includes("42P01") || reason.includes("42703");
    return jsonError(
      storageUnavailable ? "Incident detail storage is not installed." : "Incident detail is temporarily unavailable.",
      storageUnavailable ? 503 : 500,
      { code: storageUnavailable ? "INCIDENT_DETAIL_STORAGE_MISSING" : "INCIDENT_DETAIL_QUERY_FAILED" },
    );
  }
}
