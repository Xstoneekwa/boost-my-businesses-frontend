import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

/**
 * P2 scope: status-only operator actions. No action here may create a run,
 * a run request or any scheduling side effect. `manual_retry` and any
 * resume-after-human-intervention flow are explicitly reserved for the next
 * checkpoint and rejected.
 */
const ALLOWED_ACTIONS = new Set(["acknowledge", "resolve", "keep_paused"]);

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
      .select("id,status,metadata")
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
