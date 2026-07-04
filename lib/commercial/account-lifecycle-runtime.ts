import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTIVE_IG_RUN_STATUSES,
  getActiveRunRequestWithClient,
  reconcileLinkedIgRunTerminal,
} from "@/lib/instagram-dashboard/run-control";
import { ACTIVE_RUN_REQUEST_STATUSES } from "@/lib/instagram-dashboard/run-request-statuses.ts";
import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";

type Row = Record<string, unknown>;

export type RuntimeQuiesceResult = {
  quiesced: boolean;
  canceledRequestIds: string[];
  stoppedRunIds: string[];
  stillActive: boolean;
  reason: string | null;
};

async function cancelRunRequest(
  supabase: SupabaseClient,
  input: { requestId?: string; accountId?: string; reason: string },
) {
  const args = input.requestId
    ? { p_request_id: input.requestId, p_reason: input.reason }
    : { p_account_id: input.accountId, p_reason: input.reason };
  const { error } = await supabase.rpc("cancel_account_run_request", args);
  if (error) throw new Error(error.message || "cancel_account_run_request_failed");
}

export async function cancelPendingRunRequestsForAccount(
  supabase: SupabaseClient,
  accountId: string,
  reason: string,
) {
  const { data, error } = await supabase
    .from("account_run_requests")
    .select("id,status,source_surface,metadata_safe")
    .eq("account_id", accountId)
    .in("status", [...ACTIVE_RUN_REQUEST_STATUSES.filter((s) => s !== "running")])
    .limit(100);

  if (error) throw new Error(error.message || "account_run_requests_unavailable");

  const canceled: string[] = [];
  for (const row of (data ?? []) as SupabaseRecord[]) {
    const requestId = readString(row.id);
    if (!requestId) continue;
    try {
      await cancelRunRequest(supabase, { requestId, reason });
      canceled.push(requestId);
    } catch {
      // Best effort per request.
    }
  }
  return canceled;
}

export async function stopActiveAccountRuntime(
  supabase: SupabaseClient,
  accountId: string,
  reason: string,
): Promise<{ stoppedRunIds: string[]; canceledRequestIds: string[] }> {
  const stoppedRunIds: string[] = [];
  const canceledRequestIds: string[] = [];

  const activeRequest = await getActiveRunRequestWithClient(supabase, accountId);
  if (activeRequest) {
    await cancelRunRequest(supabase, { accountId, reason });
    canceledRequestIds.push(readString(activeRequest.id));
    const linkedRunId = readString(activeRequest.run_id);
    if (linkedRunId) {
      const reconcile = await reconcileLinkedIgRunTerminal(linkedRunId, "stopped", supabase);
      if (reconcile.reconciled) stoppedRunIds.push(linkedRunId);
    }
  }

  const { data: activeRuns } = await supabase
    .from("ig_runs")
    .select("id,status")
    .eq("account_id", accountId)
    .in("status", [...ACTIVE_IG_RUN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(5);

  for (const run of (activeRuns ?? []) as SupabaseRecord[]) {
    const runId = readString(run.id);
    if (!runId) continue;
    const reconcile = await reconcileLinkedIgRunTerminal(runId, "stopped", supabase);
    if (reconcile.reconciled) stoppedRunIds.push(runId);
  }

  return { stoppedRunIds, canceledRequestIds };
}

export async function accountHasActiveRuntime(
  supabase: SupabaseClient,
  accountId: string,
) {
  const activeRequestStatuses = ["queued", "claimed", "starting", "running"];
  const activeRunStatuses = ["queued", "pending", "starting", "running", "in_progress", "active"];
  const [{ data: requests }, { data: runs }] = await Promise.all([
    supabase.from("account_run_requests").select("id").eq("account_id", accountId).in("status", activeRequestStatuses).limit(1),
    supabase.from("ig_runs").select("id").eq("account_id", accountId).in("status", activeRunStatuses).limit(1),
  ]);
  return Boolean((requests ?? []).length || (runs ?? []).length);
}

export async function quiesceAccountRuntime(
  supabase: SupabaseClient,
  accountId: string,
  reason: string,
): Promise<RuntimeQuiesceResult> {
  const pendingCanceled = await cancelPendingRunRequestsForAccount(supabase, accountId, reason);
  const { stoppedRunIds, canceledRequestIds } = await stopActiveAccountRuntime(supabase, accountId, reason);
  const stillActive = await accountHasActiveRuntime(supabase, accountId);
  return {
    quiesced: !stillActive,
    canceledRequestIds: [...pendingCanceled, ...canceledRequestIds],
    stoppedRunIds,
    stillActive,
    reason: stillActive ? "runtime_still_active" : null,
  };
}
