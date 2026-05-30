import { getDashboardUserContext } from "@/lib/restaurant-analytics/session";
import {
  DEFAULT_ALLOWED_RUN_TYPES,
  evaluateRunStartEligibility,
  insertManualRunAudit,
  runStartBlockMessage,
  sanitizeRunControlReason,
} from "@/lib/instagram-dashboard/run-control";
import { getAccountId, jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin, validateAccountId } from "../../_utils";

export const dynamic = "force-dynamic";

type StartBody = {
  account_id?: unknown;
  requested_run_type?: unknown;
  idempotency_key?: unknown;
};

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<StartBody>(request);
    const accountId = readString(body?.account_id, getAccountId(request));
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const requestedRunType = readString(body?.requested_run_type, DEFAULT_ALLOWED_RUN_TYPES[0]).toLowerCase();
    const idempotencyKey = readString(body?.idempotency_key, "").slice(0, 200) || null;
    const eligibility = await evaluateRunStartEligibility(accountId, requestedRunType);

    if (!eligibility.ok) {
      await insertManualRunAudit(
        accountId,
        "manual_run_blocked",
        "blocked",
        runStartBlockMessage(eligibility.reason),
        { reason: eligibility.reason, requested_run_type: requestedRunType },
      ).catch(() => undefined);

      const status =
        eligibility.reason === "already_running" || eligibility.reason === "already_requested" ? 409 : 403;

      return jsonError(runStartBlockMessage(eligibility.reason), status);
    }

    const adminContext = await getDashboardUserContext();
    const actorId = adminContext?.userId ?? null;
    const effectiveIdempotencyKey =
      idempotencyKey ??
      `dashboard:${accountId}:${requestedRunType}:${actorId ?? "admin"}:${Date.now()}`;

    const { createSupabaseClient } = await import("@/lib/supabase");
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.rpc("create_account_run_request", {
      p_account_id: accountId,
      p_requested_by: actorId,
      p_actor_type: "admin",
      p_source_surface: "instagram_dashboard",
      p_requested_run_type: eligibility.normalizedRunType,
      p_idempotency_key: effectiveIdempotencyKey,
      p_priority: 0,
      p_metadata_safe: {
        requested_from: "instagram_dashboard",
        requested_run_type: eligibility.normalizedRunType,
      },
    });

    if (error) {
      const message = sanitizeRunControlReason(error.message, "Could not create run request.");
      if (/account_already_running/i.test(error.message)) {
        return jsonError("A run is already active for this account.", 409);
      }
      if (/account_run_already_requested/i.test(error.message)) {
        return jsonError("A manual run is already requested for this account.", 409);
      }
      return jsonError(message, 500);
    }

    const requestRow = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const requestId = readString(requestRow?.id, "");
    const requestStatus = readString(requestRow?.status, "queued");

    await insertManualRunAudit(
      accountId,
      "manual_run_requested",
      "success",
      "Manual run request accepted by runtime dispatcher path.",
      {
        request_id: requestId,
        requested_run_type: eligibility.normalizedRunType,
        request_status: requestStatus,
      },
    ).catch(() => undefined);

    return jsonOk({
      started: true,
      message: "Run starting.",
      request_id: requestId,
      status: requestStatus,
      requested_run_type: eligibility.normalizedRunType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the run.";
    return jsonError(sanitizeRunControlReason(message, "Could not start the run."), 500);
  }
}
