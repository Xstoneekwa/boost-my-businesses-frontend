import { createSupabaseClient } from "@/lib/supabase";
import {
  READY_TO_RESUME_ACTION,
  armReadyToResume,
} from "@/lib/instagram-dashboard/incident-resume-authorization";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

/**
 * Status/recovery operator actions only. No action here may create a run,
 * a run request or any scheduling side effect. `manual_retry` remains
 * rejected. P3 adds `ready_to_resume` ("Prêt à relancer"): it arms one
 * durable, audited authorization that ONLY the Auto Restart tick may
 * consume; the click itself never launches anything.
 */
const ALLOWED_ACTIONS = new Set([
  "acknowledge",
  "resolve",
  "keep_paused",
  READY_TO_RESUME_ACTION,
]);

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Incident action");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const incidentId = String(body?.incident_id ?? "").trim();
    const action = String(body?.action ?? "").trim().toLowerCase();
    const resolutionNote = String(body?.resolution_note ?? "").trim().slice(0, 500);

    if (!incidentId) return jsonError("Missing incident id.", 400);
    if (!ALLOWED_ACTIONS.has(action)) {
      return jsonError(`Action not available: ${action || "unknown"}.`, 400, {
        reason: "action_reserved_for_next_checkpoint",
      });
    }

    const supabase = createSupabaseClient();
    const { data: incidentRow, error } = await supabase
      .from("account_incidents")
      .select("id,status,metadata,account_id,run_id,incident_type,reason,failure_reason")
      .eq("id", incidentId)
      .maybeSingle();
    if (error) return jsonError(error.message, 500);
    if (!incidentRow) return jsonError("Incident not found.", 404);

    const nowIso = new Date().toISOString();
    const previousMetadata =
      incidentRow.metadata && typeof incidentRow.metadata === "object" && !Array.isArray(incidentRow.metadata)
        ? incidentRow.metadata as Record<string, unknown>
        : {};
    const auditEntry = {
      action,
      source: "botapp_relay",
      at: nowIso,
      ...(resolutionNote ? { resolution_note: resolutionNote } : {}),
    };

    if (action === READY_TO_RESUME_ACTION) {
      // Recovery-only action: arms one durable authorization. It never
      // creates a run and never forces a tick; the Auto Restart tick is the
      // single consumer. Unavailable states return a stable, safe reason.
      const armResult = await armReadyToResume(supabase, {
        incidentRow: incidentRow as Record<string, unknown>,
        armedBy: null,
        armedSource: "botapp_relay",
        resolutionNote,
      });
      const recoveryMetadata = {
        ...previousMetadata,
        last_operator_action: auditEntry,
        ...(armResult.ok
          ? {
            recovery: {
              ...(previousMetadata.recovery && typeof previousMetadata.recovery === "object"
                ? previousMetadata.recovery as Record<string, unknown>
                : {}),
              state: "ready_to_resume",
              authorization_id: armResult.authorizationId,
              armed_at: nowIso,
            },
          }
          : {}),
      };
      const { error: recoveryUpdateError } = await supabase
        .from("account_incidents")
        .update({ updated_at: nowIso, metadata: recoveryMetadata })
        .eq("id", incidentId)
        .select("id")
        .maybeSingle();
      if (recoveryUpdateError) return jsonError(recoveryUpdateError.message, 500);
      if (!armResult.ok) {
        return jsonError(`Prêt à relancer indisponible: ${armResult.reason}.`, 409, {
          reason: armResult.reason,
          recoveryState: armResult.state,
          runCreated: false,
        });
      }
      return jsonOk({
        incidentId,
        action,
        status: incidentRow.status,
        recoveryState: armResult.state,
        authorizationId: armResult.authorizationId,
        runCreated: false,
      });
    }

    const update: Record<string, unknown> = {
      updated_at: nowIso,
      metadata: { ...previousMetadata, last_operator_action: auditEntry },
    };
    if (action === "acknowledge") {
      update.status = "acknowledged";
      update.acknowledged_at = nowIso;
    } else if (action === "resolve") {
      update.status = "resolved";
      update.resolved_at = nowIso;
    }
    // keep_paused: metadata audit only, status unchanged.

    const { data: updatedRow, error: updateError } = await supabase
      .from("account_incidents")
      .update(update)
      .eq("id", incidentId)
      .select("id,status")
      .maybeSingle();
    if (updateError) return jsonError(updateError.message, 500);

    return jsonOk({
      incidentId,
      action,
      status: updatedRow?.status ?? incidentRow.status,
      runCreated: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Incident action failed.";
    return jsonError(message, 500);
  }
}
