import { createSupabaseClient } from "@/lib/supabase";
import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";

export const ACTIVE_IG_RUN_STATUSES = ["running", "queued", "pending", "in_progress", "active", "starting"] as const;
export const ACTIVE_RUN_REQUEST_STATUSES = ["queued", "claimed", "starting", "running"] as const;
export const DEFAULT_ALLOWED_RUN_TYPES = ["account_session", "outreach_session"] as const;
const TERMINAL_IG_RUN_STATUSES = new Set(["completed", "failed", "stopped", "canceled", "blocked", "aborted"]);

export type LinkedIgRunTerminalOutcome = "completed" | "failed" | "stopped" | "canceled";

export type LinkedIgRunReconcileResult = {
  reconciled: boolean;
  reason: string;
  runId: string | null;
  terminalStatus: string | null;
  previousStatus: string | null;
};

export type RunControlHealth = {
  healthy: boolean;
  playEnabled: boolean;
  dispatcherWorkerId: string | null;
  dispatcherStatus: string | null;
  lastSeenAt: string | null;
  reason: string;
};

export type RunStartBlockReason =
  | "dispatcher_unhealthy"
  | "play_disabled"
  | "account_archived"
  | "account_trashed"
  | "account_canceled"
  | "support_required"
  | "credentials_review_required"
  | "reauth_required"
  | "already_running"
  | "already_requested"
  | "invalid_run_type";

const BLOCKED_ACCOUNT_STATUSES = new Set(["archived", "trashed", "canceled", "deleted", "stopped"]);
const CREDENTIAL_REVIEW_ACTIONS = new Set(["review_credentials", "submit_instagram_credentials"]);
const CHECKPOINT_ACTIONS = new Set(["complete_two_factor", "review_checkpoint", "review_account_mismatch"]);

export function runControlPlayFeatureEnabled() {
  return process.env.INSTAGRAM_RUN_CONTROL_PLAY_ENABLED === "true";
}

export function runControlDispatcherWorkerId() {
  return process.env.INSTAGRAM_RUN_CONTROL_DISPATCHER_WORKER_ID?.trim() || null;
}

export function runControlDispatcherHealthMaxAgeSeconds() {
  const parsed = Number(process.env.INSTAGRAM_RUN_CONTROL_DISPATCHER_HEALTH_MAX_AGE_SECONDS ?? "60");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

export function sanitizeRunControlReason(value: unknown, fallback = "blocked") {
  const raw = readString(value, fallback).slice(0, 500);
  if (!raw) return fallback;
  if (/token|secret|authorization|cookie|service_role|vault|password|adb_serial|device_udid/i.test(raw)) {
    return fallback;
  }
  return raw;
}

export async function getRunControlHealth(): Promise<RunControlHealth> {
  const playEnabled = runControlPlayFeatureEnabled();
  const dispatcherWorkerId = runControlDispatcherWorkerId();

  if (!playEnabled) {
    return {
      healthy: false,
      playEnabled: false,
      dispatcherWorkerId,
      dispatcherStatus: null,
      lastSeenAt: null,
      reason: "play_disabled",
    };
  }

  if (!dispatcherWorkerId) {
    return {
      healthy: false,
      playEnabled,
      dispatcherWorkerId: null,
      dispatcherStatus: null,
      lastSeenAt: null,
      reason: "dispatcher_unconfigured",
    };
  }

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("worker_heartbeats")
    .select("worker_id,status,last_seen_at")
    .eq("worker_id", dispatcherWorkerId)
    .limit(1);

  if (error) {
    return {
      healthy: false,
      playEnabled,
      dispatcherWorkerId,
      dispatcherStatus: null,
      lastSeenAt: null,
      reason: "dispatcher_health_read_failed",
    };
  }

  const row = ((data ?? []) as SupabaseRecord[])[0];
  if (!row) {
    return {
      healthy: false,
      playEnabled,
      dispatcherWorkerId,
      dispatcherStatus: null,
      lastSeenAt: null,
      reason: "dispatcher_unhealthy",
    };
  }

  const dispatcherStatus = readString(row.status, "unknown");
  const lastSeenAt = readString(row.last_seen_at, "");
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  const ageSeconds = Number.isFinite(lastSeenMs) ? (Date.now() - lastSeenMs) / 1000 : Number.POSITIVE_INFINITY;
  const statusHealthy = ["starting", "idle", "running"].includes(dispatcherStatus);
  const fresh = ageSeconds <= runControlDispatcherHealthMaxAgeSeconds();
  const healthy = statusHealthy && fresh;

  return {
    healthy,
    playEnabled,
    dispatcherWorkerId,
    dispatcherStatus,
    lastSeenAt: lastSeenAt || null,
    reason: healthy ? "ready" : "dispatcher_unhealthy",
  };
}

export async function accountHasActiveIgRun(accountId: string) {
  const supabase = createSupabaseClient();
  const { count, error } = await supabase
    .from("ig_runs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .in("status", [...ACTIVE_IG_RUN_STATUSES]);

  if (error) {
    throw new Error("Could not verify active runs.");
  }

  return (count ?? 0) > 0;
}

function mapLinkedIgRunTerminalStatus(outcome: LinkedIgRunTerminalOutcome) {
  if (outcome === "canceled") return "stopped";
  return outcome;
}

export async function reconcileLinkedIgRunTerminal(
  runId: string,
  outcome: LinkedIgRunTerminalOutcome,
): Promise<LinkedIgRunReconcileResult> {
  const normalizedRunId = readString(runId, "");
  if (!normalizedRunId) {
    return {
      reconciled: false,
      reason: "no_run_id",
      runId: null,
      terminalStatus: null,
      previousStatus: null,
    };
  }

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_runs")
    .select("id,status")
    .eq("id", normalizedRunId)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      reconciled: false,
      reason: error ? "run_read_failed" : "run_not_found",
      runId: normalizedRunId,
      terminalStatus: null,
      previousStatus: null,
    };
  }

  const previousStatus = readString(data.status, "").toLowerCase();
  if (TERMINAL_IG_RUN_STATUSES.has(previousStatus)) {
    return {
      reconciled: false,
      reason: "already_terminal",
      runId: normalizedRunId,
      terminalStatus: previousStatus,
      previousStatus,
    };
  }

  if (!ACTIVE_IG_RUN_STATUSES.includes(previousStatus as (typeof ACTIVE_IG_RUN_STATUSES)[number])) {
    return {
      reconciled: false,
      reason: "not_active",
      runId: normalizedRunId,
      terminalStatus: previousStatus || null,
      previousStatus: previousStatus || null,
    };
  }

  const terminalStatus = mapLinkedIgRunTerminalStatus(outcome);
  const now = new Date().toISOString();
  const body: SupabaseRecord = {
    status: terminalStatus,
    updated_at: now,
    finished_at: now,
  };
  if (terminalStatus === "completed") {
    body.completed_at = now;
  }

  const { error: updateError } = await supabase.from("ig_runs").update(body).eq("id", normalizedRunId);
  if (updateError) {
    return {
      reconciled: false,
      reason: "update_failed",
      runId: normalizedRunId,
      terminalStatus: null,
      previousStatus,
    };
  }

  return {
    reconciled: true,
    reason: "reconciled",
    runId: normalizedRunId,
    terminalStatus,
    previousStatus,
  };
}

export async function getActiveRunRequest(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("account_run_requests")
    .select("id,status,requested_run_type,run_id,created_at")
    .eq("account_id", accountId)
    .in("status", [...ACTIVE_RUN_REQUEST_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error("Could not verify active run requests.");
  }

  return ((data ?? []) as SupabaseRecord[])[0] ?? null;
}

export async function evaluateRunStartEligibility(accountId: string, requestedRunType: string) {
  const normalizedRunType = requestedRunType.trim().toLowerCase();
  if (!DEFAULT_ALLOWED_RUN_TYPES.includes(normalizedRunType as (typeof DEFAULT_ALLOWED_RUN_TYPES)[number])) {
    return { ok: false as const, reason: "invalid_run_type" as RunStartBlockReason };
  }

  const health = await getRunControlHealth();
  if (!health.playEnabled || !health.healthy) {
    return { ok: false as const, reason: "dispatcher_unhealthy" as RunStartBlockReason, health };
  }

  const supabase = createSupabaseClient();
  const { data: accountRow, error: accountError } = await supabase
    .from("ig_accounts")
    .select("id,status,username")
    .eq("id", accountId)
    .limit(1)
    .maybeSingle();

  if (accountError || !accountRow) {
    return { ok: false as const, reason: "account_archived" as RunStartBlockReason, health };
  }

  const accountStatus = readString(accountRow.status, "active").toLowerCase();
  if (accountStatus === "archived") {
    return { ok: false as const, reason: "account_archived" as RunStartBlockReason, health };
  }
  if (accountStatus === "trashed") {
    return { ok: false as const, reason: "account_trashed" as RunStartBlockReason, health };
  }
  if (BLOCKED_ACCOUNT_STATUSES.has(accountStatus)) {
    return { ok: false as const, reason: "account_canceled" as RunStartBlockReason, health };
  }

  const { data: openActions, error: actionsError } = await supabase
    .from("account_dashboard_actions")
    .select("action_type,status,safe_client_message")
    .eq("account_id", accountId)
    .in("status", ["pending", "acknowledged", "pending_verification"])
    .limit(20);

  if (actionsError) {
    return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
  }

  for (const action of (openActions ?? []) as SupabaseRecord[]) {
    const actionType = readString(action.action_type, "").toLowerCase();
    if (CREDENTIAL_REVIEW_ACTIONS.has(actionType)) {
      return { ok: false as const, reason: "credentials_review_required" as RunStartBlockReason, health };
    }
    if (CHECKPOINT_ACTIONS.has(actionType)) {
      return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
    }
  }

  const { data: credentialRows, error: credentialError } = await supabase
    .from("account_credentials")
    .select("status,reauth_required")
    .eq("account_id", accountId)
    .order("credentials_version", { ascending: false })
    .limit(1);

  if (!credentialError) {
    const credential = ((credentialRows ?? []) as SupabaseRecord[])[0];
    if (credential) {
      const credentialStatus = readString(credential.status, "").toLowerCase();
      if (credentialStatus && credentialStatus !== "active") {
        return { ok: false as const, reason: "credentials_review_required" as RunStartBlockReason, health };
      }
      if (credential.reauth_required === true) {
        return { ok: false as const, reason: "reauth_required" as RunStartBlockReason, health };
      }
    }
  }

  if (await accountHasActiveIgRun(accountId)) {
    return { ok: false as const, reason: "already_running" as RunStartBlockReason, health };
  }

  const activeRequest = await getActiveRunRequest(accountId);
  if (activeRequest) {
    return { ok: false as const, reason: "already_requested" as RunStartBlockReason, health, activeRequest };
  }

  return { ok: true as const, health, normalizedRunType };
}

export async function insertManualRunAudit(
  accountId: string,
  actionType: string,
  status: string,
  message: string,
  payload: SupabaseRecord = {},
  runId?: string | null,
) {
  const supabase = createSupabaseClient();
  const { error } = await supabase.from("ig_action_logs").insert({
    account_id: accountId,
    run_id: runId ?? null,
    action_type: actionType,
    status,
    message: sanitizeRunControlReason(message, "Run control event."),
    payload,
    created_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(error.message);
  }
}

export function runStartBlockMessage(reason: RunStartBlockReason) {
  switch (reason) {
    case "dispatcher_unhealthy":
      return "Manual run requires a healthy runtime dispatcher.";
    case "play_disabled":
      return "Manual run is not enabled for this environment.";
    case "account_archived":
      return "Archived accounts cannot be started.";
    case "account_trashed":
      return "Trashed accounts cannot be started.";
    case "account_canceled":
      return "This account cannot be started.";
    case "support_required":
      return "Account requires support review before manual run.";
    case "credentials_review_required":
      return "Credentials review is required before manual run.";
    case "reauth_required":
      return "Credential re-authentication is required before manual run.";
    case "already_running":
      return "A run is already active for this account.";
    case "already_requested":
      return "A manual run is already requested for this account.";
    case "invalid_run_type":
      return "Requested run type is not allowed.";
    default:
      return "Manual run is blocked.";
  }
}
