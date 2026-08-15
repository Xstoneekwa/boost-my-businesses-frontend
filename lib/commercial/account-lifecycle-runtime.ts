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
  canceledJobCounts: Record<string, number>;
  stillActive: boolean;
  reason: string | null;
};

const PENDING_JOB_STATUSES = [
  "pending",
  "queued",
  "scheduled",
  "ready",
  "retryable",
  "waiting",
  "created",
];

const ACTIVE_JOB_STATUSES = [
  "claimed",
  "processing",
  "running",
  "in_progress",
  "sending",
];

type JobCancelSpec = {
  table: string;
  statusColumn: string;
  cancelStatus: string;
  extraPatch?: Row;
};

const JOB_CANCEL_SPECS: JobCancelSpec[] = [
  { table: "ig_dm_jobs", statusColumn: "status", cancelStatus: "canceled" },
  { table: "ct_target_verification_jobs", statusColumn: "status", cancelStatus: "canceled" },
  { table: "client_email_send_intents", statusColumn: "status", cancelStatus: "canceled" },
  { table: "auto_restart_decisions", statusColumn: "status", cancelStatus: "canceled" },
];

function emailIntentClaimIsLive(row: SupabaseRecord, nowMs = Date.now()) {
  if (readString(row.status).toLowerCase() !== "claimed") return false;
  const expiresAtMs = Date.parse(readString(row.claim_expires_at));
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

async function cancelExpiredEmailIntentClaimsForAccount(
  supabase: SupabaseClient,
  accountId: string,
) {
  if (!await tableExists(supabase, "client_email_send_intents")) return 0;
  let reconciled = 0;
  while (true) {
    const { data, error } = await supabase
      .from("client_email_send_intents")
      .select("id,status,claim_expires_at")
      .eq("account_id", accountId)
      .eq("status", "claimed")
      .limit(500);
    if (error) throw new Error(error.message || "client_email_send_intents_unavailable");

    const nowMs = Date.now();
    const expiredIds = ((data ?? []) as SupabaseRecord[])
      .filter((row) => !emailIntentClaimIsLive(row, nowMs))
      .map((row) => readString(row.id))
      .filter(Boolean);
    if (!expiredIds.length) return reconciled;

    const { error: updateError } = await supabase
      .from("client_email_send_intents")
      .update({
        status: "canceled",
        dispatch_last_error_code: "lifecycle_quiesce_expired_claim",
        claim_token: null,
        claimed_at: null,
        claim_expires_at: null,
      })
      .in("id", expiredIds);
    if (updateError) throw new Error(updateError.message || "client_email_send_intents_reconciliation_failed");
    reconciled += expiredIds.length;
  }
}

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

async function tableExists(supabase: SupabaseClient, table: string) {
  const { error } = await supabase.from(table).select("id").limit(1);
  if (!error) return true;
  const message = readString(error.message).toLowerCase();
  return !(message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"));
}

async function cancelPendingJobsForAccount(
  supabase: SupabaseClient,
  accountId: string,
  reason: string,
) {
  const counts: Record<string, number> = {};
  counts.client_email_send_intents_expired_claims = await cancelExpiredEmailIntentClaimsForAccount(
    supabase,
    accountId,
  );
  for (const spec of JOB_CANCEL_SPECS) {
    if (!await tableExists(supabase, spec.table)) continue;
    const { data } = await supabase
      .from(spec.table)
      .select("id")
      .eq("account_id", accountId)
      .in(spec.statusColumn, PENDING_JOB_STATUSES)
      .limit(500);
    const ids = ((data ?? []) as SupabaseRecord[]).map((row) => readString(row.id)).filter(Boolean);
    if (!ids.length) {
      counts[spec.table] = 0;
      continue;
    }
    const patch: Row = {
      [spec.statusColumn]: spec.cancelStatus,
      updated_at: new Date().toISOString(),
      ...spec.extraPatch,
    };
    const { error } = await supabase
      .from(spec.table)
      .update(patch)
      .in("id", ids);
    counts[spec.table] = error ? 0 : ids.length;
  }
  return counts;
}

export async function accountHasActiveJobs(
  supabase: SupabaseClient,
  accountId: string,
) {
  for (const spec of JOB_CANCEL_SPECS) {
    if (!await tableExists(supabase, spec.table)) continue;
    const selectedColumns = spec.table === "client_email_send_intents"
      ? "id,status,claim_expires_at"
      : `id,${spec.statusColumn}`;
    const { data } = await supabase
      .from(spec.table)
      .select(selectedColumns)
      .eq("account_id", accountId)
      .in(spec.statusColumn, ACTIVE_JOB_STATUSES)
      .limit(500);
    const rows = (data ?? []) as unknown as SupabaseRecord[];
    if (spec.table === "client_email_send_intents") {
      if (rows.some((row) => readString(row.status).toLowerCase() !== "claimed" || emailIntentClaimIsLive(row))) {
        return true;
      }
      continue;
    }
    if (rows.length > 0) return true;
  }
  return false;
}

export async function quiesceAccountRuntime(
  supabase: SupabaseClient,
  accountId: string,
  reason: string,
): Promise<RuntimeQuiesceResult> {
  const pendingCanceled = await cancelPendingRunRequestsForAccount(supabase, accountId, reason);
  const canceledJobCounts = await cancelPendingJobsForAccount(supabase, accountId, reason);
  const { stoppedRunIds, canceledRequestIds } = await stopActiveAccountRuntime(supabase, accountId, reason);
  const stillActive = await accountHasActiveRuntime(supabase, accountId)
    || await accountHasActiveJobs(supabase, accountId);
  return {
    quiesced: !stillActive,
    canceledRequestIds: [...pendingCanceled, ...canceledRequestIds],
    stoppedRunIds,
    canceledJobCounts,
    stillActive,
    reason: stillActive ? "runtime_still_active" : null,
  };
}
