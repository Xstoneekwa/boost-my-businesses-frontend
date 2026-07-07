import { createSupabaseClient } from "@/lib/supabase";
import { mapIncidentRow } from "@/lib/instagram-dashboard/incident-operations";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ incidentId: string }> },
) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Incident detail");
    if (unauthorizedResponse) return unauthorizedResponse;

    const { incidentId } = await context.params;
    const id = String(incidentId ?? "").trim();
    if (!id) return jsonError("Missing incident id.", 400);

    const supabase = createSupabaseClient();
    const { data: incidentRow, error } = await supabase
      .from("account_incidents")
      .select(
        "id,status,severity,incident_type,reason,failure_reason,action_required,admin_message,assistant_message,account_id,account_username,run_id,occurrence_count,first_seen_at,last_seen_at,resolved_at,source,metadata",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) return jsonError(error.message, 500);
    if (!incidentRow) return jsonError("Incident not found.", 404);

    const { data: outboxRows, error: outboxError } = await supabase
      .from("account_incident_notifications")
      .select("incident_id,channel,status,attempt_count,delivered_at,last_error,created_at")
      .eq("incident_id", id)
      .order("created_at", { ascending: false });
    if (outboxError) return jsonError(outboxError.message, 500);

    const model = mapIncidentRow(incidentRow, outboxRows ?? []);
    return jsonOk({
      incident: {
        ...model,
        // BotApp drawer contract: `reason` carries the stable reason code.
        reason: model.reasonCode,
        requestId: model.runRequestId,
      },
      notifications: model.deliveries.map((delivery) => ({
        channel: delivery.channel,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        deliveredAt: delivery.deliveredAt,
        lastError: delivery.lastError,
      })),
      timeline: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load incident.";
    return jsonError(message, 500);
  }
}
