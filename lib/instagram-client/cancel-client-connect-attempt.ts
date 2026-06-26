import { createSupabaseClient } from "@/lib/supabase";
import {
  ACTIVE_IG_RUN_STATUSES,
  reconcileLinkedIgRunTerminal,
} from "@/lib/instagram-dashboard/run-control";
import { clearStaleClientConnectChallengeProjection } from "./clear-stale-client-connect-projection";
import {
  CONNECT_CHALLENGE_ACTIVE_REQUEST_STATUSES,
} from "./connect-challenge-chain";
import { readString } from "./guards";

type SupabaseLike = ReturnType<typeof createSupabaseClient>;

const LOGIN_REQUEST_TYPES = ["login_provisioning", "login_email_code_resume"] as const;
const CHALLENGE_ACTION_TYPES = [
  "enter_email_verification_code",
  "complete_two_factor",
  "resolve_checkpoint",
  "review_login_challenge",
  "update_instagram_password",
] as const;
const DISMISSABLE_ACTION_STATUSES = [
  "pending",
  "acknowledged",
  "pending_verification",
  "code_submitted",
  "open",
] as const;

async function cancelActiveLoginRequests(
  supabase: SupabaseLike,
  accountId: string,
  reason: string,
) {
  const { data: activeRequests, error } = await supabase
    .from("account_run_requests")
    .select("id,status,requested_run_type,run_id")
    .eq("account_id", accountId)
    .in("requested_run_type", [...LOGIN_REQUEST_TYPES])
    .in("status", [...CONNECT_CHALLENGE_ACTIVE_REQUEST_STATUSES])
    .order("created_at", { ascending: false });

  if (error) throw new Error("client_connect_cancel_requests_unavailable");

  const requests = ((activeRequests ?? []) as Record<string, unknown>[]);
  const resumeRequests = requests.filter((row) => readString(row.requested_run_type) === "login_email_code_resume");
  const provisioningRequests = requests.filter((row) => readString(row.requested_run_type) === "login_provisioning");
  const cancelOrder = [...resumeRequests, ...provisioningRequests];

  const canceledRequestIds: string[] = [];
  const runIds = new Set<string>();

  for (const request of cancelOrder) {
    const requestId = readString(request.id);
    const runId = readString(request.run_id);
    if (!requestId) continue;
    if (runId) runIds.add(runId);

    const { data, error: cancelError } = await supabase.rpc("cancel_account_run_request", {
      p_request_id: requestId,
      p_reason: reason,
    });
    if (cancelError) continue;

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const status = readString(row?.status, readString(request.status)).toLowerCase();
    if (status === "canceled" || readString(row?.cancel_requested_at)) {
      canceledRequestIds.push(requestId);
    }

    if (status === "running" || status === "claimed" || status === "starting") {
      const now = new Date().toISOString();
      await supabase
        .from("account_run_requests")
        .update({
          status: "canceled",
          canceled_at: now,
          cancel_reason: reason,
          cancel_requested_at: now,
          updated_at: now,
        })
        .eq("id", requestId)
        .in("status", ["queued", "claimed", "starting", "running"]);
      if (!canceledRequestIds.includes(requestId)) canceledRequestIds.push(requestId);
    }
  }

  const { data: activeRuns } = await supabase
    .from("ig_runs")
    .select("id")
    .eq("account_id", accountId)
    .in("status", [...ACTIVE_IG_RUN_STATUSES]);

  for (const run of ((activeRuns ?? []) as Record<string, unknown>[])) {
    const runId = readString(run.id);
    if (runId) runIds.add(runId);
  }

  for (const runId of runIds) {
    await reconcileLinkedIgRunTerminal(runId, "stopped");
  }

  return { canceledRequestIds, runIds: [...runIds] };
}

async function dismissChallengeActions(
  supabase: SupabaseLike,
  accountId: string,
  runIds: string[],
) {
  const now = new Date().toISOString();
  let dismissed = 0;

  const { data: actionRows } = await supabase
    .from("account_dashboard_actions")
    .select("id,metadata")
    .eq("account_id", accountId)
    .in("action_type", [...CHALLENGE_ACTION_TYPES])
    .in("status", [...DISMISSABLE_ACTION_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(20);

  for (const row of ((actionRows ?? []) as Record<string, unknown>[])) {
    const actionId = readString(row.id);
    if (!actionId) continue;
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    const linkedRunId = readString(metadata.run_id);
    if (runIds.length > 0 && linkedRunId && !runIds.includes(linkedRunId)) continue;

    const { error } = await supabase
      .from("account_dashboard_actions")
      .update({ status: "dismissed", updated_at: now })
      .eq("id", actionId)
      .eq("account_id", accountId)
      .in("status", [...DISMISSABLE_ACTION_STATUSES]);

    if (!error) dismissed += 1;
  }

  return dismissed;
}

export async function cancelClientConnectAttempt(input: {
  accountId: string;
  reason?: string;
  actorUserId?: string | null;
}) {
  const accountId = readString(input.accountId);
  if (!accountId) throw new Error("account_id_required");

  const reason = readString(input.reason, "client_connect_cancel_restart").slice(0, 160) || "client_connect_cancel_restart";
  const supabase = createSupabaseClient();
  const { canceledRequestIds, runIds } = await cancelActiveLoginRequests(supabase, accountId, reason);
  const dismissedActions = await dismissChallengeActions(supabase, accountId, runIds);
  const projection = await clearStaleClientConnectChallengeProjection(supabase, accountId, reason);
  const now = new Date().toISOString();

  try {
    await supabase.from("ig_action_logs").insert({
      account_id: accountId,
      action_type: "client_connect_attempt_canceled",
      status: "success",
      message: "Client connect attempt canceled from dashboard.",
      created_at: now,
      metadata: {
        reason,
        actor_user_id: readString(input.actorUserId, "") || null,
        canceled_request_ids: canceledRequestIds,
        dismissed_actions: dismissedActions,
        projection_cleared: projection.cleared === true,
      },
    });
  } catch {
    // Audit log failure must not block cancel response.
  }

  return {
    canceled: canceledRequestIds.length > 0 || projection.cleared === true || dismissedActions > 0,
    canceled_request_ids: canceledRequestIds,
    dismissed_actions: dismissedActions,
    projection_cleared: projection.cleared === true,
    login_status: projection.login_status ?? null,
    provisioning_status: projection.provisioning_status ?? null,
  };
}
