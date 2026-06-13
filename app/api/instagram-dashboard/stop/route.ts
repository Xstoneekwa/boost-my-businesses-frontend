import { createSupabaseClient } from "@/lib/supabase";
import {
  ACTIVE_IG_RUN_STATUSES,
  getActiveRunRequest,
  insertManualRunAudit,
  reconcileLinkedIgRunTerminal,
  sanitizeRunControlReason,
} from "@/lib/instagram-dashboard/run-control";
import { getAccountId, jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin, validateAccountId, type SupabaseRecord } from "../_utils";
import { relayAuthStatus, verifyCompassRelayKey } from "../compass/relay-auth";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = [...ACTIVE_IG_RUN_STATUSES];

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Run stop relay authentication failed.", relayAuthStatus(relayAuth.reason), { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<{ account_id?: unknown }>(request);
    const accountId = typeof body?.account_id === "string" ? body.account_id.trim() : getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const canceledRequest = await getActiveRunRequest(accountId);
    let canceledRequestId: string | null = null;
    let canceledRequestStatus: string | null = null;
    let linkedRunId: string | null = null;

    if (canceledRequest) {
      const { data: cancelData, error: cancelError } = await supabase.rpc("cancel_account_run_request", {
        p_account_id: accountId,
        p_reason: "manual_stop",
      });

      if (cancelError) {
        return jsonError(sanitizeRunControlReason(cancelError.message, "Could not cancel run request."), 500);
      }

      const cancelRow = (Array.isArray(cancelData) ? cancelData[0] : cancelData) as SupabaseRecord | null;
      canceledRequestId = readString(cancelRow?.id, "") || readString(canceledRequest.id, "") || null;
      canceledRequestStatus = readString(cancelRow?.status, readString(canceledRequest.status, ""));
      linkedRunId =
        readString(cancelRow?.run_id, "") || readString(canceledRequest.run_id, "") || null;

      await insertManualRunAudit(
        accountId,
        "manual_run_canceled",
        "success",
        "Manual run request canceled from dashboard stop.",
        {
          request_id: canceledRequestId,
          request_status: canceledRequestStatus,
        },
        linkedRunId,
      ).catch(() => undefined);
    }

    let runId = linkedRunId;
    let runStopped = false;
    let orphanReconciled = false;

    if (linkedRunId) {
      const reconcileResult = await reconcileLinkedIgRunTerminal(linkedRunId, "stopped");
      runStopped = reconcileResult.reconciled;
      orphanReconciled = reconcileResult.reconciled;
      if (reconcileResult.reconciled) {
        await insertManualRunAudit(
          accountId,
          "orphan_running_run_reconciled",
          "success",
          "Linked ig_runs row reconciled from dashboard stop.",
          {
            request_id: canceledRequestId,
            previous_status: reconcileResult.previousStatus,
            terminal_status: reconcileResult.terminalStatus,
          },
          linkedRunId,
        ).catch(() => undefined);
      }
    } else {
      const { data: activeRuns, error: runError } = await supabase
        .from("ig_runs")
        .select("id,status")
        .eq("account_id", accountId)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1);

      if (runError) {
        return jsonError(runError.message, 500);
      }

      const activeRun = ((activeRuns ?? []) as SupabaseRecord[])[0];
      const runRowId = activeRun ? readString(activeRun.id, "") : "";
      runId = activeRun ? runRowId : "";

      if (runId) {
        const reconcileResult = await reconcileLinkedIgRunTerminal(runId, "stopped");
        runStopped = reconcileResult.reconciled;
        orphanReconciled = reconcileResult.reconciled;
      }
    }

    if (canceledRequestId && linkedRunId) {
      const { error: cancelRunningError } = await supabase.rpc("cancel_account_run_request", {
        p_request_id: canceledRequestId,
        p_reason: "manual_stop_running",
      });
      if (cancelRunningError) {
        return jsonError(sanitizeRunControlReason(cancelRunningError.message, "Could not cancel running request."), 500);
      }
    }

    const { error: logError } = await supabase.from("ig_action_logs").insert({
      account_id: accountId,
      run_id: runId || null,
      action_type: "run_stopped",
      status: "success",
      message: runId
        ? "Run stop requested from dashboard."
        : canceledRequestId
          ? "Queued run request canceled from dashboard."
          : "No active run found. Stop log added.",
      created_at: new Date().toISOString(),
    });

    if (logError) {
      return jsonError(logError.message, 500);
    }

    return jsonOk({
      stopped: runStopped || Boolean(runId),
      canceled_request: Boolean(canceledRequestId),
      request_status: canceledRequestStatus,
      orphan_reconciled: orphanReconciled,
      message: runStopped
        ? "Run stop requested."
        : canceledRequestId
          ? "Queued run request canceled."
          : "No active run found. Stop log added.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not stop the run.";
    return jsonError(sanitizeRunControlReason(message, "Could not stop the run."), 500);
  }
}
