import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin, type SupabaseRecord } from "../../_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type PatchBody = {
  account_id?: string;
  ids?: string[];
  actor_type?: "admin" | "client" | "system";
  mode?: "reset_state_only" | "reset_and_requeue_verification";
};

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Targets reset relay authentication failed.", relayAuthStatus(compassRelayAuthFailureReason(relayAuth)), { reason: compassRelayAuthFailureReason(relayAuth) });
  }
  return requireInstagramAdmin();
}

function isArchivedOrDeleted(row: SupabaseRecord) {
  const status = readString(row.status, "").toLowerCase();
  return status === "archived" || status === "deleted" || Boolean(readString(row.archived_at, "") || readString(row.deleted_at, ""));
}

async function tryRecordTargetResetAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    targetId: string;
    actorType: "admin" | "client" | "system";
    previousStatus: string;
    jobsQueued: number;
  },
) {
  try {
    await supabase.from("ct_target_audit_events").insert({
      account_id: input.accountId,
      target_id: input.targetId,
      operation: "target_reset",
      result: "accepted",
      reason: input.jobsQueued > 0 ? "manual_reset_requeued" : "manual_reset_state_only",
      actor_type: input.actorType,
      metadata_safe: {
        source: "target_reset",
        source_surface: "admin_dashboard",
        previous_status: input.previousStatus,
        next_status: "pending_verification",
        jobs_queued: input.jobsQueued,
      },
    });
  } catch {
    // CT audit is best-effort until every environment has the CT-4 migration.
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<PatchBody>(request);
    if (!body) return jsonError("Invalid JSON body.", 400);

    const accountId = readString(body.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);
    const actorType = body.actor_type === "client" ? "client" : "admin";
    const mode = body.mode === "reset_state_only" ? "reset_state_only" : "reset_and_requeue_verification";

    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => readString(id, "").trim()).filter(Boolean)
      : [];

    if (ids.length === 0) return jsonError("Missing ids.", 400);

    const supabase = createSupabaseClient();

    const { data: owned, error: selError } = await supabase
      .from("ig_targets")
      .select("id, account_id, target_username, normalized_username, batch_id, status, archived_at, deleted_at")
      .eq("account_id", accountId)
      .in("id", ids);

    if (selError) return jsonError(selError.message, 500);

    const ownedIds = new Set((owned ?? []).map((r: SupabaseRecord) => readString(r.id, "")));
    for (const id of ids) {
      if (!ownedIds.has(id)) {
        return jsonError("One or more targets do not belong to this account.", 400);
      }
    }
    if (((owned ?? []) as SupabaseRecord[]).some(isArchivedOrDeleted)) {
      return jsonError("Archived or deleted targets must be restored before reset.", 409);
    }

    const now = new Date().toISOString();
    const resetReason = mode === "reset_and_requeue_verification" ? "manual_reset_requeued" : "manual_reset";
    const { data: resetRows, error } = await supabase
      .from("ig_targets")
      .update({
        status: "pending_verification",
        verification_status: "pending",
        verification_reason: resetReason,
        quality_status: "unknown",
        rejected_reason: null,
        updated_at: now,
      })
      .eq("account_id", accountId)
      .in("id", ids)
      .select("id, status");

    if (error) return jsonError(error.message, 500);
    let jobsQueued = 0;
    if (mode === "reset_and_requeue_verification") {
      const jobRows = ((owned ?? []) as SupabaseRecord[]).map((row) => ({
        target_id: readString(row.id, ""),
        account_id: accountId,
        batch_id: readString(row.batch_id, "") || null,
        normalized_username: readString(row.normalized_username, readString(row.target_username, "")),
        status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        locked_at: null,
        locked_by: null,
        last_error_code: null,
        last_error_message: null,
        provider_status: "pending",
        metadata_safe: { source: "target_reset", mode },
        updated_at: now,
      })).filter((row) => row.target_id && row.account_id && row.normalized_username);
      if (jobRows.length > 0) {
        const { error: jobError } = await supabase
          .from("ct_target_verification_jobs")
          .upsert(jobRows, { onConflict: "target_id" });
        if (jobError) return jsonError("Targets were reset, but verification could not be queued.", 500);
        jobsQueued = jobRows.length;
      }
    }
    await Promise.all(((resetRows ?? []) as SupabaseRecord[]).map((row) => {
      const original = ((owned ?? []) as SupabaseRecord[]).find((candidate) => readString(candidate.id, "") === readString(row.id, ""));
      return tryRecordTargetResetAudit(supabase, {
        accountId,
        targetId: readString(row.id, ""),
        actorType,
        previousStatus: readString(original?.status, "unknown"),
        jobsQueued,
      });
    }));
    return jsonOk({ reset: ids.length, mode, jobs_queued: jobsQueued });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset targets.";
    return jsonError(message, 500);
  }
}
