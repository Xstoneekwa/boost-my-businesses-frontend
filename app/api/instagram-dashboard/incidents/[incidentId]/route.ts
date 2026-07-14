import { createSupabaseClient } from "@/lib/supabase";
import { mapIncidentRow } from "@/lib/instagram-dashboard/incident-operations";
import { findReviewableOperatorAction } from "@/lib/instagram-dashboard/incident-operator-review";
import { evaluateReadyToResume } from "@/lib/instagram-dashboard/incident-resume-authorization";
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
    const { data: operatorActionRows, error: operatorActionError } = await supabase
      .from("account_dashboard_actions")
      .select("id,account_id,incident_id,action_type,status,blocking_campaign,dedupe_key,metadata,metadata_safe,created_at")
      .eq("account_id", model.accountId)
      .eq("action_type", "operator_review_required")
      .in("status", ["pending", "acknowledged", "pending_verification", "code_submitted"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (operatorActionError) return jsonError(operatorActionError.message, 500);
    const operatorAction = findReviewableOperatorAction(operatorActionRows ?? [], {
      id,
      accountId: model.accountId ?? "",
      runId: model.runId,
      requestId: model.runRequestId,
    });
    // P3: recovery view for the "Prêt à relancer" workflow. Read-only here;
    // failures degrade to a safe "not evaluable" state, never to a 500.
    let recovery: Record<string, unknown> = {
      state: model.recoveryState ?? "none",
      eligible: false,
      reason: "recovery_state_unavailable",
      windowStart: null,
      windowEnd: null,
      windowActive: false,
      authorizationId: null,
      authorizationStatus: null,
    };
    try {
      const view = await evaluateReadyToResume(supabase, incidentRow as Record<string, unknown>);
      recovery = { ...view };
    } catch {
      // Keep the safe default above.
    }

    return jsonOk({
      incident: {
        ...model,
        // BotApp drawer contract: `reason` carries the stable reason code.
        reason: model.reasonCode,
        requestId: model.runRequestId,
        recovery,
      },
      recovery,
      operatorReviewAction: operatorAction ? {
        id: String(operatorAction.id ?? ""),
        accountId: String(operatorAction.account_id ?? ""),
        status: String(operatorAction.status ?? ""),
        blockingCampaign: operatorAction.blocking_campaign === true,
      } : null,
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
