import { createSupabaseClient } from "@/lib/supabase";
import { readString } from "./guards";
import {
  CONNECT_CHALLENGE_ACTION_TYPES,
  CONNECT_CHALLENGE_ACTIVE_REQUEST_STATUSES,
  CONNECT_CHALLENGE_ACTIVE_RUN_STATUSES,
  evaluateConnectChallengeChainActive,
  findActiveVerificationAction,
  isStaleConnectChallengeAccountStatus,
  POST_CANCEL_LOGIN_STATUS,
  POST_CANCEL_ONBOARDING_STATUS,
  POST_CANCEL_PROVISIONING_STATUS,
} from "./connect-challenge-chain";

type SupabaseLike = ReturnType<typeof createSupabaseClient>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function loadConnectChallengeChainSnapshot(
  supabase: SupabaseLike,
  accountId: string,
) {
  const [{ data: requestRows }, { data: runRows }, { data: actionRows }, { data: accountRow }] = await Promise.all([
    supabase
      .from("account_run_requests")
      .select("id,status,requested_run_type,run_id")
      .eq("account_id", accountId)
      .in("requested_run_type", ["login_provisioning", "login_email_code_resume"])
      .in("status", [...CONNECT_CHALLENGE_ACTIVE_REQUEST_STATUSES])
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("ig_runs")
      .select("id,status")
      .eq("account_id", accountId)
      .in("status", [...CONNECT_CHALLENGE_ACTIVE_RUN_STATUSES])
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("account_dashboard_actions")
      .select("id,action_type,status,metadata")
      .eq("account_id", accountId)
      .in("action_type", [...CONNECT_CHALLENGE_ACTION_TYPES])
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("client_instagram_accounts")
      .select("login_status,provisioning_status,onboarding_status")
      .eq("account_id", accountId)
      .limit(1)
      .maybeSingle(),
  ]);

  const actions = ((actionRows ?? []) as Record<string, unknown>[]);
  const activeAction = findActiveVerificationAction(actions);
  const metadata = isRecord(activeAction?.metadata) ? activeAction.metadata as Record<string, unknown> : {};
  const resumeRequestId = readString(metadata.resume_request_id);
  let resumeRequestStatus = "";
  if (resumeRequestId) {
    const { data: resumeRow } = await supabase
      .from("account_run_requests")
      .select("status")
      .eq("account_id", accountId)
      .eq("id", resumeRequestId)
      .eq("requested_run_type", "login_email_code_resume")
      .limit(1)
      .maybeSingle();
    resumeRequestStatus = readString((resumeRow as Record<string, unknown> | null)?.status);
  }

  const activeRequest = ((requestRows ?? []) as Record<string, unknown>[])[0] ?? null;
  const activeRun = ((runRows ?? []) as Record<string, unknown>[])[0] ?? null;
  const chainActive = evaluateConnectChallengeChainActive({
    requestStatus: readString(activeRequest?.status),
    runStatus: readString(activeRun?.status),
    activeAction,
    resumeRequestStatus,
  });

  return {
    chainActive,
    activeAction,
    activeRequest,
    activeRun,
    loginStatus: readString((accountRow as Record<string, unknown> | null)?.login_status),
    provisioningStatus: readString((accountRow as Record<string, unknown> | null)?.provisioning_status),
    onboardingStatus: readString((accountRow as Record<string, unknown> | null)?.onboarding_status),
    resumeRequestStatus,
  };
}

function hasStaleConnectChallengeProjection(snapshot: {
  loginStatus: string;
  provisioningStatus: string;
  onboardingStatus: string;
}) {
  const loginStatus = readString(snapshot.loginStatus).toLowerCase();
  const provisioningStatus = readString(snapshot.provisioningStatus).toLowerCase();
  return isStaleConnectChallengeAccountStatus({
    loginStatus: snapshot.loginStatus,
    provisioningStatus: snapshot.provisioningStatus,
  })
    || snapshot.onboardingStatus === "verification_pending"
    || (loginStatus === "logged_out" && provisioningStatus === "login_pending");
}

export async function clearStaleClientConnectChallengeProjection(
  supabase: SupabaseLike,
  accountId: string,
  reason = "client_connect_attempt_canceled",
) {
  const snapshot = await loadConnectChallengeChainSnapshot(supabase, accountId);
  if (snapshot.chainActive) {
    return {
      cleared: false,
      reason: "active_connect_challenge_chain",
      login_status: snapshot.loginStatus,
      provisioning_status: snapshot.provisioningStatus,
    };
  }

  if (!hasStaleConnectChallengeProjection({
    loginStatus: snapshot.loginStatus,
    provisioningStatus: snapshot.provisioningStatus,
    onboardingStatus: snapshot.onboardingStatus,
  })) {
    return {
      cleared: false,
      reason: "no_stale_challenge_status",
      login_status: snapshot.loginStatus,
      provisioning_status: snapshot.provisioningStatus,
    };
  }

  const now = new Date().toISOString();
  const body: Record<string, string> = {
    login_status: POST_CANCEL_LOGIN_STATUS,
    provisioning_status: POST_CANCEL_PROVISIONING_STATUS,
    updated_at: now,
  };
  if (snapshot.onboardingStatus === "verification_pending") {
    body.onboarding_status = POST_CANCEL_ONBOARDING_STATUS;
  }

  const { data, error } = await supabase
    .from("client_instagram_accounts")
    .update(body)
    .eq("account_id", accountId)
    .select("login_status,provisioning_status,onboarding_status")
    .maybeSingle();

  if (error) {
    throw new Error("client_connect_projection_cleanup_failed");
  }

  try {
    await supabase.from("ig_action_logs").insert({
      account_id: accountId,
      action_type: "client_connect_projection_cleared",
      status: "success",
      message: "Stale client connect challenge projection cleared after cancel.",
      created_at: now,
      metadata: {
        reason,
        previous_login_status: snapshot.loginStatus,
        previous_provisioning_status: snapshot.provisioningStatus,
        login_status: POST_CANCEL_LOGIN_STATUS,
        provisioning_status: POST_CANCEL_PROVISIONING_STATUS,
      },
    });
  } catch {
    // Audit log failure must not block projection cleanup response.
  }

  return {
    cleared: true,
    reason,
    login_status: readString((data as Record<string, unknown> | null)?.login_status, POST_CANCEL_LOGIN_STATUS),
    provisioning_status: readString((data as Record<string, unknown> | null)?.provisioning_status, POST_CANCEL_PROVISIONING_STATUS),
    previous_login_status: snapshot.loginStatus,
    previous_provisioning_status: snapshot.provisioningStatus,
  };
}
