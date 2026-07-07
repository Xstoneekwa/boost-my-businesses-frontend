import { createSupabaseClient } from "@/lib/supabase";
import {
  ACTIVE_IG_RUN_STATUSES,
  getActiveRunRequest,
  insertManualRunAudit,
  sanitizeRunControlReason,
} from "@/lib/instagram-dashboard/run-control";
import { clearStaleClientConnectChallengeProjection } from "@/lib/instagram-client/clear-stale-client-connect-projection";
import {
  createOperatorStopSuppression,
  getStopCleanupState,
  OPERATOR_STOP_SUPPRESSED_REASON,
} from "@/lib/instagram-dashboard/operator-stop-suppression";
import { releaseDeviceUiLeaseForCanceledRequest } from "@/lib/instagram-dashboard/device-ui-lease";
import { resolveAccountDeviceContext } from "@/lib/instagram-dashboard/device-session-lock";
import { getAccountId, jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin, validateAccountId, type SupabaseRecord } from "../_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "../compass/relay-auth";

export const dynamic = "force-dynamic";

const IMMEDIATE_CANCEL_STATUSES = new Set(["queued", "claimed", "starting"]);

function normalizeStopSource(value: unknown) {
  return readString(value, "instagram_dashboard")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .slice(0, 80) || "instagram_dashboard";
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Run stop relay authentication failed.", relayAuthStatus(compassRelayAuthFailureReason(relayAuth)), { reason: compassRelayAuthFailureReason(relayAuth) });
  }
  return requireInstagramAdmin();
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<{ account_id?: unknown; reason?: unknown; source?: unknown }>(request);
    const accountId = typeof body?.account_id === "string" ? body.account_id.trim() : getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;
    const stopReason = readString(body?.reason, "operator_stop_requested").slice(0, 160) || "operator_stop_requested";
    const sourceSurface = normalizeStopSource(body?.source);

    const supabase = createSupabaseClient();
    const cleanupBefore = await getStopCleanupState(supabase as never, accountId);
    if (cleanupBefore.inProgress) {
      return jsonOk({
        stopping: true,
        idempotent: true,
        canceled_request: Boolean(cleanupBefore.requestId),
        request_status: cleanupBefore.phase,
        operator_stop_suppressed: true,
        message: cleanupBefore.phase === "stop_requires_attention"
          ? "Stop requires attention."
          : "Stop already in progress.",
      });
    }

    const activeRequest = await getActiveRunRequest(accountId);
    let canceledRequestId: string | null = null;
    let canceledRequestStatus: string | null = null;
    let linkedRunId: string | null = null;
    let stopping = false;

    if (activeRequest) {
      const priorStatus = readString(activeRequest.status, "").toLowerCase();
      const { data: cancelData, error: cancelError } = await supabase.rpc("cancel_account_run_request", {
        p_account_id: accountId,
        p_reason: stopReason,
      });

      if (cancelError) {
        return jsonError(sanitizeRunControlReason(cancelError.message, "Could not cancel run request."), 500);
      }

      const cancelRow = (Array.isArray(cancelData) ? cancelData[0] : cancelData) as SupabaseRecord | null;
      canceledRequestId = readString(cancelRow?.id, "") || readString(activeRequest.id, "") || null;
      canceledRequestStatus = readString(cancelRow?.status, readString(activeRequest.status, ""));
      linkedRunId = readString(cancelRow?.run_id, "") || readString(activeRequest.run_id, "") || null;
      stopping = priorStatus === "running" || Boolean(readString(cancelRow?.cancel_requested_at, readString(activeRequest.cancel_requested_at, "")));

      await insertManualRunAudit(
        accountId,
        "operator_run_stop_requested",
        "success",
        "Operator stop requested for active run control request.",
        {
          request_id: canceledRequestId,
          request_status: canceledRequestStatus,
          reason: stopReason,
          source_surface: sourceSurface,
        },
        linkedRunId,
      ).catch(() => undefined);

      if (IMMEDIATE_CANCEL_STATUSES.has(priorStatus) && canceledRequestId) {
        const deviceContext = await resolveAccountDeviceContext(supabase as never, accountId).catch(() => null);
        if (deviceContext?.deviceId) {
          await releaseDeviceUiLeaseForCanceledRequest(supabase as never, {
            deviceId: deviceContext.deviceId,
            requestId: canceledRequestId,
            releaseReason: "operator_stop_canceled_before_worker",
          }).catch(() => undefined);
        }
      }
    } else {
      const { data: activeRuns, error: runError } = await supabase
        .from("ig_runs")
        .select("id,status")
        .eq("account_id", accountId)
        .in("status", [...ACTIVE_IG_RUN_STATUSES])
        .order("created_at", { ascending: false })
        .limit(1);

      if (runError) {
        return jsonError(runError.message, 500);
      }

      const activeRun = ((activeRuns ?? []) as SupabaseRecord[])[0];
      linkedRunId = activeRun ? readString(activeRun.id, "") : "";
      stopping = Boolean(linkedRunId);
    }

    let suppression = null;
    try {
      suppression = await createOperatorStopSuppression(supabase as never, {
        accountId,
        requestId: canceledRequestId,
        runId: linkedRunId || null,
        sourceSurface,
        metadataSafe: {
          stop_reason: stopReason,
          request_status: canceledRequestStatus,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "operator_stop_suppression_failed";
      if (canceledRequestId || linkedRunId) {
        return jsonError(sanitizeRunControlReason(message, "Stop requested but suppression could not be recorded."), 500);
      }
    }

    const { error: logError } = await supabase.from("ig_action_logs").insert({
      account_id: accountId,
      run_id: linkedRunId || null,
      action_type: "run_stopped",
      status: "success",
      message: stopping
        ? "Operator stop requested. Worker cleanup in progress."
        : canceledRequestId
          ? "Queued run request canceled by operator."
          : "No active run found. Operator stop suppression recorded.",
      created_at: new Date().toISOString(),
      metadata: {
        reason: stopReason,
        source_surface: sourceSurface,
        operator_stop_suppressed: true,
        suppression_id: suppression?.id ?? null,
      },
    });

    if (logError) {
      return jsonError(logError.message, 500);
    }

    const projectionCleanup = await clearStaleClientConnectChallengeProjection(
      supabase,
      accountId,
      stopReason,
    ).catch(() => ({
      cleared: false,
      reason: "projection_cleanup_failed",
      login_status: null,
      provisioning_status: null,
    }));

    const cleanupAfter = await getStopCleanupState(supabase as never, accountId);

    return jsonOk({
      stopped: stopping || Boolean(canceledRequestId),
      stopping,
      canceled_request: Boolean(canceledRequestId),
      request_status: canceledRequestStatus,
      operator_stop_suppressed: true,
      suppression_reason: OPERATOR_STOP_SUPPRESSED_REASON,
      suppression_id: suppression?.id ?? null,
      cleanup_phase: cleanupAfter.phase,
      client_connect_projection_cleared: projectionCleanup.cleared === true,
      client_login_status: projectionCleanup.login_status ?? null,
      client_provisioning_status: projectionCleanup.provisioning_status ?? null,
      message: stopping
        ? "Stopping…"
        : canceledRequestId
          ? "Queued run request canceled."
          : suppression
            ? "Stopped by operator — manual restart required."
            : "No active run found. Stop log added.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not stop the run.";
    return jsonError(sanitizeRunControlReason(message, "Could not stop the run."), 500);
  }
}
