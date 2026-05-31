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
  dispatcherLaunchEnabled?: boolean | null;
  lastSeenAt: string | null;
  reason: string;
};

export type RunStartBlockReason =
  | "dispatcher_unhealthy"
  | "dispatcher_launch_disabled"
  | "play_disabled"
  | "account_archived"
  | "account_trashed"
  | "account_canceled"
  | "support_required"
  | "credentials_review_required"
  | "reauth_required"
  | "welcome_template_missing"
  | "welcome_real_send_disabled"
  | "welcome_cap_unproven"
  | "welcome_daily_cap_exceeded"
  | "outreach_entitlement_missing"
  | "outreach_disabled"
  | "outreach_template_missing"
  | "outreach_real_send_disabled"
  | "outreach_cap_unproven"
  | "outreach_daily_cap_exceeded"
  | "session_cap_exceeds_day_cap"
  | "dm_legacy_gate_mismatch"
  | "mini_run_welcome_cap_unproven"
  | "mini_run_follow_cap_unproven"
  | "mini_run_outreach_off_unproven"
  | "real_handoff_disabled"
  | "unfollow_any_not_supported"
  | "unfollow_cap_unproven"
  | "no_safe_unfollow_strategy"
  | "already_running"
  | "already_requested"
  | "invalid_run_type";

const BLOCKED_ACCOUNT_STATUSES = new Set(["archived", "trashed", "canceled", "deleted", "stopped"]);
const CREDENTIAL_REVIEW_ACTIONS = new Set(["review_credentials", "submit_instagram_credentials"]);
const CHECKPOINT_ACTIONS = new Set(["complete_two_factor", "review_checkpoint", "review_account_mismatch"]);
export const DEFAULT_WELCOME_DM_DAY_CAP = 10;
export const DEFAULT_OUTREACH_DM_DAY_CAP = 30;

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

export function runControlWelcomeRealSendEnabled(env: MiniRunEnv = process.env) {
  return env.WELCOME_DM_REAL_SEND_ENABLED === "true";
}

export function runControlOutreachRealSendEnabled(env: MiniRunEnv = process.env) {
  return env.OUTREACH_DM_REAL_SEND_ENABLED === "true";
}

export function runControlLegacyDmSenderRealSendEnabled(env: MiniRunEnv = process.env) {
  const raw = env.DM_SENDER_REAL_SEND_ENABLED;
  return raw === "true" ? true : raw === "false" ? false : null;
}

export function runControlFollowToUnfollowRealEnabled(env: MiniRunEnv = process.env) {
  return (
    env.INSTAGRAM_RUN_CONTROL_ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_ENABLED ??
    env.ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_ENABLED
  ) === "true";
}

export function runControlUnfollowAnyH3RealSupported(env: MiniRunEnv = process.env) {
  return env.INSTAGRAM_RUN_CONTROL_UNFOLLOW_ANY_H3_REAL_SUPPORTED === "true";
}

export function runControlUnfollowAnySafeStrategyProven(env: MiniRunEnv = process.env) {
  return env.INSTAGRAM_RUN_CONTROL_UNFOLLOW_ANY_SAFE_STRATEGY_PROVEN === "true";
}

export function runControlMiniRunCapsRequired() {
  return process.env.INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED === "true";
}

type MiniRunEnv = Record<string, string | undefined>;

function readPositiveInteger(value: unknown) {
  const raw = readString(value, "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function readMiniRunCap(names: string[], env: MiniRunEnv = process.env) {
  for (const name of names) {
    const value = readPositiveInteger(env[name]);
    if (value !== null) return value;
  }
  return null;
}

function capProvesAtMostOne(value: number | null) {
  return value !== null && value <= 1;
}

function capProvesAtLeastOne(value: number | null) {
  return value !== null && value >= 1;
}

function minKnownCaps(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.min(...known) : null;
}

function remainingCap(limit: number | null, used: number | null) {
  if (limit === null) return null;
  return Math.max(0, limit - (used ?? 0));
}

function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function resolveWelcomePreflightCap({
  sessionCap,
  dayCap,
  welcomeSentToday,
  totalDayCap,
  totalDmSentToday,
  env = process.env,
}: {
  sessionCap: number | null;
  dayCap: number | null;
  welcomeSentToday: number | null;
  totalDayCap?: number | null;
  totalDmSentToday?: number | null;
  env?: MiniRunEnv;
}) {
  const packageDayCap = DEFAULT_WELCOME_DM_DAY_CAP;
  const dayCapExceedsProductMax = dayCap !== null && dayCap > packageDayCap;
  const effectiveDayCap = dayCap ?? packageDayCap;
  const hardSessionCap = readMiniRunCap(
    ["INSTAGRAM_RUN_CONTROL_WELCOME_SESSION_SEND_MAX_JOBS", "WELCOME_SESSION_SEND_MAX_JOBS"],
    env,
  );
  const dayRemaining = remainingCap(effectiveDayCap, welcomeSentToday);
  const totalDayRemaining = remainingCap(totalDayCap ?? null, totalDmSentToday ?? null);
  const effectiveCap = minKnownCaps([sessionCap, hardSessionCap, dayRemaining, totalDayRemaining]);
  return {
    effectiveCap,
    effectiveDayCap,
    dayRemaining,
    dayCapExceedsProductMax,
    sessionCapExceedsDayCap: sessionCap !== null && sessionCap > effectiveDayCap,
    dailyCapExceeded:
      capProvesAtLeastOne(sessionCap) &&
      capProvesAtLeastOne(effectiveDayCap) &&
      ((dayRemaining !== null && dayRemaining <= 0) || (totalDayRemaining !== null && totalDayRemaining <= 0)),
  };
}

export function resolveOutreachPreflightCap({
  sessionCap,
  dayCap,
  outreachSentToday,
  totalDayCap,
  totalDmSentToday,
  env = process.env,
}: {
  sessionCap: number | null;
  dayCap: number | null;
  outreachSentToday: number | null;
  totalDayCap?: number | null;
  totalDmSentToday?: number | null;
  env?: MiniRunEnv;
}) {
  const packageDayCap = DEFAULT_OUTREACH_DM_DAY_CAP;
  const dayCapExceedsProductMax = dayCap !== null && dayCap > packageDayCap;
  const effectiveDayCap = dayCap ?? packageDayCap;
  const hardSessionCap = readMiniRunCap(
    ["INSTAGRAM_RUN_CONTROL_OUTREACH_HARD_MAX_PER_SESSION", "OUTREACH_HARD_MAX_PER_SESSION"],
    env,
  );
  const hardDayCap = readMiniRunCap(
    ["INSTAGRAM_RUN_CONTROL_OUTREACH_HARD_MAX_PER_DAY", "OUTREACH_HARD_MAX_PER_DAY"],
    env,
  );
  const dayRemaining = remainingCap(effectiveDayCap, outreachSentToday);
  const hardDayRemaining = remainingCap(hardDayCap, outreachSentToday);
  const totalDayRemaining = remainingCap(totalDayCap ?? null, totalDmSentToday ?? null);
  const effectiveCap = minKnownCaps([sessionCap, hardSessionCap, dayRemaining, hardDayRemaining, totalDayRemaining]);
  return {
    effectiveCap,
    effectiveDayCap,
    dayRemaining,
    dayCapExceedsProductMax,
    sessionCapExceedsDayCap: sessionCap !== null && sessionCap > effectiveDayCap,
    dailyCapExceeded:
      capProvesAtLeastOne(sessionCap) &&
      capProvesAtLeastOne(effectiveDayCap) &&
      ((dayRemaining !== null && dayRemaining <= 0) ||
        (hardDayCap !== null && hardDayRemaining !== null && hardDayRemaining <= 0) ||
        (totalDayRemaining !== null && totalDayRemaining <= 0)),
  };
}

export function isUnfollowAnyMode(value: unknown) {
  const mode = readString(value, "").trim().toLowerCase();
  return mode === "unfollow-any" || mode === "unfollow-any-non-followers" || mode === "unfollow-any-followers";
}

export function runControlDispatcherAllowedRunTypes(env: MiniRunEnv = process.env) {
  const raw = readString(
    env.INSTAGRAM_RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES ?? env.RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES,
    "",
  );
  if (!raw) return null;
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function dispatcherAllowsOnlyAccountSession(env: MiniRunEnv = process.env) {
  const allowed = runControlDispatcherAllowedRunTypes(env);
  return Boolean(allowed && allowed.length === 1 && allowed[0] === "account_session");
}

export function evaluateMiniRunCapsPreflight({
  requestedRunType,
  welcomeEnabled,
  welcomeRealSendEnabled,
  outreachRealSendEnabled,
  outreachEnabled,
  env = process.env,
}: {
  requestedRunType: string;
  welcomeEnabled: boolean;
  welcomeRealSendEnabled: boolean;
  outreachRealSendEnabled: boolean;
  outreachEnabled: boolean;
  env?: MiniRunEnv;
}): RunStartBlockReason | null {
  if (requestedRunType !== "account_session" || env.INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED !== "true") {
    return null;
  }

  const welcomeHardCap = readMiniRunCap(
    ["INSTAGRAM_RUN_CONTROL_WELCOME_SESSION_SEND_MAX_JOBS", "WELCOME_SESSION_SEND_MAX_JOBS"],
    env,
  );
  if (welcomeEnabled && !capProvesAtMostOne(welcomeHardCap)) {
    return "mini_run_welcome_cap_unproven";
  }

  const followMax = readMiniRunCap(["INSTAGRAM_RUN_CONTROL_FOLLOW_MAX_PER_RUN", "FOLLOW_MAX_PER_RUN"], env);
  const iterationsMax = readMiniRunCap(
    ["INSTAGRAM_RUN_CONTROL_FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN", "FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN"],
    env,
  );
  if (!capProvesAtMostOne(followMax) || !capProvesAtMostOne(iterationsMax)) {
    return "mini_run_follow_cap_unproven";
  }

  if (welcomeRealSendEnabled && outreachEnabled && outreachRealSendEnabled && !dispatcherAllowsOnlyAccountSession(env)) {
    return "mini_run_outreach_off_unproven";
  }

  return null;
}

export function evaluateUnfollowAnyStartGate({
  requestedRunType,
  unfollowEnabled,
  unfollowMode,
  unfollowPerSessionLimit,
  realHandoffEnabled,
  realMaxActions,
  realHardMax,
  h3RealSupported,
  safeCandidateStrategyProven,
}: {
  requestedRunType: string;
  unfollowEnabled: boolean;
  unfollowMode: string;
  unfollowPerSessionLimit: number | null;
  realHandoffEnabled: boolean;
  realMaxActions: number | null;
  realHardMax: number | null;
  h3RealSupported: boolean;
  safeCandidateStrategyProven: boolean;
}): RunStartBlockReason | null {
  if (requestedRunType !== "account_session" || !unfollowEnabled || !isUnfollowAnyMode(unfollowMode)) {
    return null;
  }

  if (!realHandoffEnabled) {
    return "real_handoff_disabled";
  }
  if (!h3RealSupported) {
    return "unfollow_any_not_supported";
  }
  if (
    !capProvesAtLeastOne(unfollowPerSessionLimit) ||
    !capProvesAtLeastOne(realMaxActions) ||
    !capProvesAtLeastOne(realHardMax)
  ) {
    return "unfollow_cap_unproven";
  }
  if (!safeCandidateStrategyProven) {
    return "no_safe_unfollow_strategy";
  }

  return null;
}

export function evaluateDmStartGate({
  requestedRunType,
  welcomeEnabled,
  welcomeTemplateReady,
  welcomeRealSendEnabled,
  welcomeEffectiveCap,
  welcomeDailyCapExceeded = false,
  welcomeDayCapExceedsProductMax = false,
  welcomeSessionCapExceedsDayCap = false,
  outreachEnabled,
  outreachTemplateReady,
  outreachRealSendEnabled,
  outreachEffectiveSessionCap,
  outreachEffectiveDayCap,
  outreachDailyCapExceeded = false,
  outreachDayCapExceedsProductMax = false,
  outreachSessionCapExceedsDayCap = false,
  outreachEntitlementActive,
  legacyDmSenderRealSendEnabled = null,
}: {
  requestedRunType: string;
  welcomeEnabled: boolean;
  welcomeTemplateReady: boolean;
  welcomeRealSendEnabled: boolean;
  welcomeEffectiveCap: number | null;
  welcomeDailyCapExceeded?: boolean;
  welcomeDayCapExceedsProductMax?: boolean;
  welcomeSessionCapExceedsDayCap?: boolean;
  outreachEnabled: boolean;
  outreachTemplateReady: boolean;
  outreachRealSendEnabled: boolean;
  outreachEffectiveSessionCap: number | null;
  outreachEffectiveDayCap: number | null;
  outreachDailyCapExceeded?: boolean;
  outreachDayCapExceedsProductMax?: boolean;
  outreachSessionCapExceedsDayCap?: boolean;
  outreachEntitlementActive: boolean;
  legacyDmSenderRealSendEnabled?: boolean | null;
}): RunStartBlockReason | null {
  if (requestedRunType === "account_session") {
    if (!welcomeEnabled) return null;
    if (legacyDmSenderRealSendEnabled === true && !welcomeRealSendEnabled) {
      return "dm_legacy_gate_mismatch";
    }
    if (!welcomeTemplateReady) {
      return "welcome_template_missing";
    }
    if (!welcomeRealSendEnabled) {
      return "welcome_real_send_disabled";
    }
    if (welcomeSessionCapExceedsDayCap) {
      return "session_cap_exceeds_day_cap";
    }
    if (welcomeDayCapExceedsProductMax) {
      return "welcome_daily_cap_exceeded";
    }
    if (welcomeDailyCapExceeded) {
      return "welcome_daily_cap_exceeded";
    }
    if (!capProvesAtLeastOne(welcomeEffectiveCap)) {
      return "welcome_cap_unproven";
    }
    return null;
  }

  if (requestedRunType === "outreach_session") {
    if (!outreachEnabled) {
      return "outreach_disabled";
    }
    if (!outreachEntitlementActive) {
      return "outreach_entitlement_missing";
    }
    if (legacyDmSenderRealSendEnabled === true && !outreachRealSendEnabled) {
      return "dm_legacy_gate_mismatch";
    }
    if (!outreachTemplateReady) {
      return "outreach_template_missing";
    }
    if (!outreachRealSendEnabled) {
      return "outreach_real_send_disabled";
    }
    if (outreachSessionCapExceedsDayCap) {
      return "session_cap_exceeds_day_cap";
    }
    if (outreachDayCapExceedsProductMax) {
      return "outreach_daily_cap_exceeded";
    }
    if (outreachDailyCapExceeded) {
      return "outreach_daily_cap_exceeded";
    }
    if (!capProvesAtLeastOne(outreachEffectiveSessionCap) || !capProvesAtLeastOne(outreachEffectiveDayCap)) {
      return "outreach_cap_unproven";
    }
  }

  return null;
}

export function accountSessionBlockedByWelcomeRealSendDisabled({
  requestedRunType,
  welcomeEnabled,
  welcomeRealSendEnabled,
}: {
  requestedRunType: string;
  welcomeEnabled: boolean;
  welcomeRealSendEnabled: boolean;
}) {
  return requestedRunType === "account_session" && welcomeEnabled && !welcomeRealSendEnabled;
}

export function outreachSessionBlockedByOutreachRealSendDisabled({
  requestedRunType,
  outreachEnabled,
  outreachRealSendEnabled,
}: {
  requestedRunType: string;
  outreachEnabled: boolean;
  outreachRealSendEnabled: boolean;
}) {
  return requestedRunType === "outreach_session" && outreachEnabled && !outreachRealSendEnabled;
}

async function hasActiveDmTemplate({
  accountId,
  templateType,
  templateId,
}: {
  accountId: string;
  templateType: "welcome" | "outreach";
  templateId: unknown;
}) {
  const supabase = createSupabaseClient();
  const configuredTemplateId = readString(templateId, "").trim();
  let query = supabase
    .from("ig_dm_templates")
    .select("id,body")
    .eq("account_id", accountId)
    .eq("template_type", templateType)
    .eq("active", true)
    .limit(1);

  if (configuredTemplateId) {
    query = query.eq("id", configuredTemplateId);
  } else {
    query = query.eq("is_default", true);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error("Could not verify DM template.");
  }
  return Boolean(data && readString((data as SupabaseRecord).body, "").trim());
}

async function accountHasOutreachEntitlement(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc("client_account_has_outreach_entitlement", {
    p_account_id: accountId,
  });
  if (error) {
    throw new Error("Could not verify Outreach entitlement.");
  }
  return data === true;
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
    .select("worker_id,status,last_seen_at,metadata")
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
  const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : null) as SupabaseRecord | null;
  const dispatcherLaunchEnabled =
    typeof metadata?.launch_enabled === "boolean" ? metadata.launch_enabled : null;
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
    dispatcherLaunchEnabled,
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
  if (health.dispatcherLaunchEnabled === false) {
    return { ok: false as const, reason: "dispatcher_launch_disabled" as RunStartBlockReason, health };
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

  if (normalizedRunType === "account_session" || normalizedRunType === "outreach_session") {
    const { data: dmSettings, error: dmSettingsError } = await supabase
      .from("ig_account_dm_settings")
      .select("welcome_enabled,outreach_enabled,welcome_template_id,default_outreach_template_id,welcome_per_session_limit,welcome_per_day_limit,outreach_per_session_limit,outreach_per_day_limit,total_dm_per_day_limit")
      .eq("account_id", accountId)
      .limit(1)
      .maybeSingle();

    if (dmSettingsError) {
      return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
    }

    const welcomeRealSendEnabled = runControlWelcomeRealSendEnabled();
    const outreachRealSendEnabled = runControlOutreachRealSendEnabled();
    const welcomeEnabled = dmSettings?.welcome_enabled === true;
    const outreachEnabled = dmSettings?.outreach_enabled === true;
    const { data: dmCounter, error: dmCounterError } = await supabase
      .from("ig_account_dm_counters")
      .select("welcome_sent_count,outreach_sent_count,total_dm_sent_count")
      .eq("account_id", accountId)
      .eq("counter_date", utcDateString())
      .limit(1)
      .maybeSingle();

    if (dmCounterError) {
      return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
    }

    let welcomeTemplateReady = false;
    let outreachTemplateReady = false;
    let outreachEntitlementActive = false;
    try {
      if (normalizedRunType === "account_session" && welcomeEnabled) {
        welcomeTemplateReady = await hasActiveDmTemplate({
          accountId,
          templateType: "welcome",
          templateId: dmSettings?.welcome_template_id,
        });
      }
      if (normalizedRunType === "outreach_session" && outreachEnabled) {
        outreachTemplateReady = await hasActiveDmTemplate({
          accountId,
          templateType: "outreach",
          templateId: dmSettings?.default_outreach_template_id,
        });
        outreachEntitlementActive = await accountHasOutreachEntitlement(accountId);
      }
    } catch {
      return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
    }

    const welcomePreflightCap = resolveWelcomePreflightCap({
      sessionCap: readPositiveInteger(dmSettings?.welcome_per_session_limit),
      dayCap: readPositiveInteger(dmSettings?.welcome_per_day_limit) ?? DEFAULT_WELCOME_DM_DAY_CAP,
      welcomeSentToday: readPositiveInteger(dmCounter?.welcome_sent_count) ?? 0,
      totalDayCap: readPositiveInteger(dmSettings?.total_dm_per_day_limit),
      totalDmSentToday: readPositiveInteger(dmCounter?.total_dm_sent_count) ?? 0,
    });
    const outreachPreflightCap = resolveOutreachPreflightCap({
      sessionCap: readPositiveInteger(dmSettings?.outreach_per_session_limit),
      dayCap: readPositiveInteger(dmSettings?.outreach_per_day_limit) ?? DEFAULT_OUTREACH_DM_DAY_CAP,
      outreachSentToday: readPositiveInteger(dmCounter?.outreach_sent_count) ?? 0,
      totalDayCap: readPositiveInteger(dmSettings?.total_dm_per_day_limit),
      totalDmSentToday: readPositiveInteger(dmCounter?.total_dm_sent_count) ?? 0,
    });

    const dmBlock = evaluateDmStartGate({
      requestedRunType: normalizedRunType,
      welcomeEnabled,
      welcomeTemplateReady,
      welcomeRealSendEnabled,
      welcomeEffectiveCap: welcomePreflightCap.effectiveCap,
      welcomeDailyCapExceeded: welcomePreflightCap.dailyCapExceeded,
      welcomeDayCapExceedsProductMax: welcomePreflightCap.dayCapExceedsProductMax,
      welcomeSessionCapExceedsDayCap: welcomePreflightCap.sessionCapExceedsDayCap,
      outreachEnabled,
      outreachTemplateReady,
      outreachRealSendEnabled,
      outreachEffectiveSessionCap: outreachPreflightCap.effectiveCap,
      outreachEffectiveDayCap: outreachPreflightCap.effectiveDayCap,
      outreachDailyCapExceeded: outreachPreflightCap.dailyCapExceeded,
      outreachDayCapExceedsProductMax: outreachPreflightCap.dayCapExceedsProductMax,
      outreachSessionCapExceedsDayCap: outreachPreflightCap.sessionCapExceedsDayCap,
      outreachEntitlementActive,
      legacyDmSenderRealSendEnabled: runControlLegacyDmSenderRealSendEnabled(),
    });
    if (dmBlock) {
      return { ok: false as const, reason: dmBlock, health };
    }

    if (accountSessionBlockedByWelcomeRealSendDisabled({
      requestedRunType: normalizedRunType,
      welcomeEnabled,
      welcomeRealSendEnabled,
    })) {
      return { ok: false as const, reason: "welcome_real_send_disabled" as RunStartBlockReason, health };
    }

    if (outreachSessionBlockedByOutreachRealSendDisabled({
      requestedRunType: normalizedRunType,
      outreachEnabled,
      outreachRealSendEnabled,
    })) {
      return { ok: false as const, reason: "outreach_real_send_disabled" as RunStartBlockReason, health };
    }

    const miniRunBlock = evaluateMiniRunCapsPreflight({
      requestedRunType: normalizedRunType,
      welcomeEnabled,
      welcomeRealSendEnabled,
      outreachRealSendEnabled,
      outreachEnabled,
    });
    if (miniRunBlock) {
      return { ok: false as const, reason: miniRunBlock, health };
    }

    if (normalizedRunType === "account_session") {
      const { data: unfollowSettings, error: unfollowSettingsError } = await supabase
        .from("ig_account_unfollow_settings")
        .select("unfollow_enabled,unfollow_mode,unfollow_per_session_limit")
        .eq("account_id", accountId)
        .limit(1)
        .maybeSingle();

      if (unfollowSettingsError) {
        return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
      }

      const unfollowBlock = evaluateUnfollowAnyStartGate({
        requestedRunType: normalizedRunType,
        unfollowEnabled: unfollowSettings?.unfollow_enabled === true,
        unfollowMode: readString(unfollowSettings?.unfollow_mode, ""),
        unfollowPerSessionLimit: readPositiveInteger(unfollowSettings?.unfollow_per_session_limit),
        realHandoffEnabled: runControlFollowToUnfollowRealEnabled(),
        realMaxActions: readMiniRunCap([
          "INSTAGRAM_RUN_CONTROL_ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_MAX_ACTIONS",
          "ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_MAX_ACTIONS",
        ]),
        realHardMax: readMiniRunCap([
          "INSTAGRAM_RUN_CONTROL_ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_HARD_MAX",
          "ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_HARD_MAX",
        ]),
        h3RealSupported: runControlUnfollowAnyH3RealSupported(),
        safeCandidateStrategyProven: runControlUnfollowAnySafeStrategyProven(),
      });
      if (unfollowBlock) {
        return { ok: false as const, reason: unfollowBlock, health };
      }
    }
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
    case "dispatcher_launch_disabled":
      return "Manual run is blocked because dispatcher launch is disabled.";
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
    case "welcome_template_missing":
      return "Manual run is blocked because no active Welcome DM template is configured.";
    case "welcome_real_send_disabled":
      return "Manual run is blocked because Welcome DM real send is disabled.";
    case "welcome_cap_unproven":
      return "Manual run is blocked because the effective Welcome DM cap is not proven.";
    case "welcome_daily_cap_exceeded":
      return "Manual run is blocked because the Welcome DM daily cap has no remaining quota.";
    case "outreach_entitlement_missing":
      return "Manual run is blocked because this account has no active Outreach entitlement.";
    case "outreach_disabled":
      return "Manual run is blocked because Outreach is disabled for this account.";
    case "outreach_template_missing":
      return "Manual run is blocked because no active Outreach DM template is configured.";
    case "outreach_real_send_disabled":
      return "Manual run is blocked because Outreach DM real send is disabled.";
    case "outreach_cap_unproven":
      return "Manual run is blocked because the effective Outreach DM caps are not proven.";
    case "outreach_daily_cap_exceeded":
      return "Manual run is blocked because the Outreach DM daily cap has no remaining quota.";
    case "session_cap_exceeds_day_cap":
      return "Manual run is blocked because a DM session cap exceeds its day cap.";
    case "dm_legacy_gate_mismatch":
      return "Manual run is blocked because the legacy DM sender flag conflicts with the domain DM real-send gate.";
    case "mini_run_welcome_cap_unproven":
      return "Manual mini-run is blocked because Welcome DM cap is not proven to be at most 1.";
    case "mini_run_follow_cap_unproven":
      return "Manual mini-run is blocked because Follow caps are not proven to be at most 1.";
    case "mini_run_outreach_off_unproven":
      return "Manual mini-run is blocked because Outreach isolation is not proven.";
    case "real_handoff_disabled":
      return "Manual run is blocked because Unfollow real handoff is disabled.";
    case "unfollow_any_not_supported":
      return "Manual run is blocked because Unfollow-any is not supported by the H3 real handoff path.";
    case "unfollow_cap_unproven":
      return "Manual run is blocked because the effective Unfollow cap is not proven to allow at least 1 action.";
    case "no_safe_unfollow_strategy":
      return "Manual run is blocked because no safe Unfollow-any candidate strategy is proven.";
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
