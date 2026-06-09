import { createSupabaseClient } from "@/lib/supabase";
import { mapScheduleGateReasonToRunStart, type ScheduleBlockReason } from "@/lib/instagram-dashboard/schedule";
import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";

export const ACTIVE_IG_RUN_STATUSES = ["running", "queued", "pending", "in_progress", "active", "starting"] as const;
export const ACTIVE_RUN_REQUEST_STATUSES = ["queued", "claimed", "starting", "running"] as const;
export const LOGIN_RUN_TYPES = ["login_provisioning", "login_email_code_resume"] as const;
export const DEFAULT_ALLOWED_RUN_TYPES = [
  "account_session",
  "outreach_session",
  ...LOGIN_RUN_TYPES,
] as const;
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

export type RunControlDisplayState =
  | "ready"
  | "offline"
  | "stale"
  | "launch_disabled"
  | "maintenance_disabled"
  | "unconfigured";

export type RunControlHealthProjection = RunControlHealth & {
  displayState: RunControlDisplayState;
  label: string;
  message: string;
  heartbeatAgeSeconds: number | null;
};

export type RunStartBlockReason =
  | "dispatcher_unhealthy"
  | "dispatcher_unconfigured"
  | "dispatcher_launch_disabled"
  | "play_disabled"
  | "account_archived"
  | "account_trashed"
  | "account_canceled"
  | "account_cancelled"
  | "account_paused"
  | "account_needs_assistance"
  | "support_required"
  | "credentials_review_required"
  | "reauth_required"
  | "login_not_connected"
  | "login_verification_required"
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
  | "no_eligible_targets"
  | "no_executable_phase"
  | "follow_day_quota_exhausted"
  | "follow_warmup_pending"
  | "follow_filter_invalid_range"
  | "mini_run_outreach_off_unproven"
  | "unfollow_entitlement_missing"
  | "unfollow_disabled"
  | "unfollow_mode_not_supported"
  | "unfollow_handoff_disabled"
  | "unfollow_cap_unproven"
  | "unfollow_day_quota_exhausted"
  | "unfollow_no_safe_candidate_strategy"
  | "assignment_missing"
  | "assignment_window_closed"
  | "assignment_slot_conflict"
  | "phone_rest_active"
  | "outreach_rest_reserved"
  | "no_app_instance_available"
  | "device_unavailable"
  | "assignment_profile_mismatch"
  | "already_running"
  | "already_requested"
  | "invalid_run_type";

const BLOCKED_ACCOUNT_STATUSES = new Set(["canceled", "cancelled", "deleted"]);
const CREDENTIAL_REVIEW_ACTIONS = new Set(["review_credentials", "submit_instagram_credentials"]);
const CHECKPOINT_ACTIONS = new Set(["complete_two_factor", "review_checkpoint", "review_account_mismatch"]);
const CONNECTED_LOGIN_STATUSES = new Set(["connected"]);
const READY_PROVISIONING_STATUSES = new Set(["ready"]);
const LOGIN_ACTION_REQUIRED_STATUSES = new Set(["needs_2fa", "2fa_required", "checkpoint", "password_invalid", "bad_password", "login_failed", "failed", "mismatch", "logged_out"]);
export const DEFAULT_WELCOME_DM_DAY_CAP = 10;
export const DEFAULT_OUTREACH_DM_DAY_CAP = 30;

export function runControlPlayFeatureEnabled(env: MiniRunEnv = process.env) {
  const raw = readString(env.INSTAGRAM_RUN_CONTROL_PLAY_ENABLED, "").trim().toLowerCase();
  if (raw === "false") return false;
  return true;
}

export function runControlDispatcherWorkerId(env: MiniRunEnv = process.env) {
  return (
    readString(env.INSTAGRAM_RUN_CONTROL_DISPATCHER_WORKER_ID, "").trim() ||
    readString(env.RUN_CONTROL_DISPATCHER_WORKER_ID, "").trim() ||
    null
  );
}

export function runControlHeartbeatAgeSeconds(lastSeenAt: string | null): number | null {
  if (!lastSeenAt) return null;
  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return null;
  return Math.max(0, Math.round((Date.now() - lastSeenMs) / 1000));
}

export function projectRunControlHealthState(health: RunControlHealth): RunControlHealthProjection {
  const heartbeatAgeSeconds = runControlHeartbeatAgeSeconds(health.lastSeenAt);
  if (!health.playEnabled || health.reason === "play_disabled") {
    return {
      ...health,
      displayState: "maintenance_disabled",
      label: "Play disabled by maintenance",
      message: runStartBlockMessage("play_disabled"),
      heartbeatAgeSeconds,
    };
  }
  if (health.reason === "dispatcher_unconfigured" || !health.dispatcherWorkerId) {
    return {
      ...health,
      displayState: "unconfigured",
      label: "Dispatcher offline",
      message: runStartBlockMessage("dispatcher_unconfigured"),
      heartbeatAgeSeconds,
    };
  }
  if (health.reason === "dispatcher_health_read_failed" || (!health.lastSeenAt && !health.healthy)) {
    return {
      ...health,
      displayState: "offline",
      label: "Dispatcher offline",
      message: "Manual run dispatcher heartbeat is unavailable.",
      heartbeatAgeSeconds,
    };
  }
  if (!health.healthy) {
    return {
      ...health,
      displayState: "stale",
      label: "Dispatcher stale",
      message: runStartBlockMessage("dispatcher_unhealthy"),
      heartbeatAgeSeconds,
    };
  }
  if (health.dispatcherLaunchEnabled === false) {
    return {
      ...health,
      displayState: "launch_disabled",
      label: "Launch disabled",
      message: runStartBlockMessage("dispatcher_launch_disabled"),
      heartbeatAgeSeconds,
    };
  }
  return {
    ...health,
    displayState: "ready",
    label: "RunControl ready",
    message: "Manual run dispatcher is healthy and ready.",
    heartbeatAgeSeconds,
  };
}

export async function getRunControlHealthProjection(env: MiniRunEnv = process.env): Promise<RunControlHealthProjection> {
  return projectRunControlHealthState(await getRunControlHealth(env));
}

export function resolveRunControlHealthBlockReason(health: RunControlHealth): RunStartBlockReason | null {
  if (!health.playEnabled || health.reason === "play_disabled") {
    return "play_disabled";
  }
  if (health.reason === "dispatcher_unconfigured") {
    return "dispatcher_unconfigured";
  }
  if (!health.healthy) {
    return "dispatcher_unhealthy";
  }
  return null;
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

export function isEligibleFollowTarget(row: SupabaseRecord) {
  const status = readString(row.status, "").toLowerCase();
  if (status !== "valid" && status !== "active") return false;
  if (readString(row.quality_status, "").toLowerCase() !== "eligible") return false;
  const verificationStatus = readString(row.verification_status, "").toLowerCase();
  if (verificationStatus && verificationStatus !== "found") return false;
  if (readString(row.archived_at, "")) return false;
  if (readString(row.deleted_at, "")) return false;
  return true;
}

async function countEligibleFollowTargets(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_targets")
    .select("id,status,quality_status,verification_status,archived_at,deleted_at")
    .eq("account_id", accountId)
    .in("status", ["valid", "active"])
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SupabaseRecord[]).filter(isEligibleFollowTarget).length;
}

export function resolveFollowToUnfollowHandoffEnabled({
  unfollowEnabled,
  unfollowMode,
  runtimeCapMode,
  env = process.env,
}: {
  unfollowEnabled: boolean;
  unfollowMode: string;
  runtimeCapMode?: unknown;
  env?: MiniRunEnv;
}) {
  const mode = normalizeUnfollowRuntimeCapMode(runtimeCapMode ?? runControlDefaultUnfollowRuntimeCapMode(env));
  if (mode === "prod_normal") {
    return unfollowEnabled && isSupportedHandoffUnfollowMode(unfollowMode);
  }
  return runControlFollowToUnfollowRealEnabled(env);
}

export function runControlUnfollowAnyH3RealSupported(env: MiniRunEnv = process.env) {
  return env.INSTAGRAM_RUN_CONTROL_UNFOLLOW_ANY_H3_REAL_SUPPORTED !== "false";
}

export function runControlUnfollowAnySafeStrategyProven(env: MiniRunEnv = process.env) {
  return env.INSTAGRAM_RUN_CONTROL_UNFOLLOW_ANY_SAFE_STRATEGY_PROVEN !== "false";
}

export function runControlFollowToUnfollowRealMaxActions(env: MiniRunEnv = process.env) {
  return readMiniRunCap(
    [
      "INSTAGRAM_RUN_CONTROL_ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_MAX_ACTIONS",
      "ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_MAX_ACTIONS",
    ],
    env,
  ) ?? 1;
}

export function runControlFollowToUnfollowRealHardMax(env: MiniRunEnv = process.env) {
  const raw = readMiniRunCap(
    [
      "INSTAGRAM_RUN_CONTROL_ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_HARD_MAX",
      "ACCOUNT_SESSION_FOLLOW_TO_UNFOLLOW_REAL_HARD_MAX",
    ],
    env,
  ) ?? 3;
  return Math.max(0, Math.min(raw, 10));
}

export function runControlMiniRunCapsRequired() {
  return process.env.INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED === "true";
}

type MiniRunEnv = Record<string, string | undefined>;
export type UnfollowRuntimeCapMode = "mini_run" | "prod_normal" | "incident_safety";

export function normalizeUnfollowRuntimeCapMode(value: unknown): UnfollowRuntimeCapMode {
  const mode = readString(value, "prod_normal").trim().toLowerCase().replace(/-/g, "_");
  if (mode === "mini_run" || mode === "incident_safety") return mode;
  return "prod_normal";
}

export function runControlDefaultUnfollowRuntimeCapMode(env: MiniRunEnv = process.env): UnfollowRuntimeCapMode {
  return normalizeUnfollowRuntimeCapMode(
    env.INSTAGRAM_RUN_CONTROL_UNFOLLOW_RUNTIME_CAP_MODE ?? env.UNFOLLOW_RUNTIME_CAP_MODE ?? "prod_normal",
  );
}

export function resolveUnfollowRuntimeCap({
  unfollowPerSessionLimit,
  runtimeCapMode,
  runtimeSafetyCap,
  env = process.env,
}: {
  unfollowPerSessionLimit: number | null;
  runtimeCapMode?: unknown;
  runtimeSafetyCap?: number | null;
  env?: MiniRunEnv;
}) {
  const sessionCap = unfollowPerSessionLimit === null ? null : Math.max(0, unfollowPerSessionLimit);
  const mode = normalizeUnfollowRuntimeCapMode(runtimeCapMode ?? runControlDefaultUnfollowRuntimeCapMode(env));

  if (mode === "prod_normal") {
    return {
      mode,
      cap: sessionCap,
      hardCap: sessionCap,
      limitedByRuntimeCap: false,
      source: "supabase_domain_caps",
      envFallbackUsed: false,
    };
  }

  const dbSafetyCap = runtimeSafetyCap === null || runtimeSafetyCap === undefined ? null : Math.max(0, runtimeSafetyCap);
  const envCap = Math.min(runControlFollowToUnfollowRealMaxActions(env), runControlFollowToUnfollowRealHardMax(env));
  const modeCap = dbSafetyCap ?? envCap;
  const cap = minKnownCaps([sessionCap, modeCap]);

  return {
    mode,
    cap,
    hardCap: modeCap,
    limitedByRuntimeCap: cap !== null && sessionCap !== null && cap < sessionCap,
    source: dbSafetyCap === null ? "env_fallback_unfollow_runtime_cap" : "ig_account_unfollow_settings.runtime_safety_cap",
    envFallbackUsed: dbSafetyCap === null,
  };
}

function readPositiveInteger(value: unknown) {
  const raw = readString(value, "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function readNullableNonnegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return { value: null, valid: true };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return { value: null, valid: false };
  return { value: parsed, valid: true };
}

export function validateFollowFilterSettingsRow(row: SupabaseRecord | null | undefined): RunStartBlockReason | null {
  if (!row) return null;
  const minFollowers = readNullableNonnegativeInteger(row.min_followers);
  const maxFollowers = readNullableNonnegativeInteger(row.max_followers);
  const minPosts = readNullableNonnegativeInteger(row.min_posts);
  if (!minFollowers.valid || !maxFollowers.valid || !minPosts.valid) {
    return "follow_filter_invalid_range";
  }
  if (
    minFollowers.value !== null &&
    maxFollowers.value !== null &&
    minFollowers.value > maxFollowers.value
  ) {
    return "follow_filter_invalid_range";
  }
  return null;
}

function followFiltersSummary(row: SupabaseRecord | null | undefined) {
  if (!row) return { enabled: false, active: [] as string[], candidate_eligibility: "candidate eligibility not precomputed" };
  const active = [
    row.dont_follow_private_accounts === true ? "private" : "",
    row.min_followers !== null && row.min_followers !== undefined ? "min_followers" : "",
    row.max_followers !== null && row.max_followers !== undefined ? "max_followers" : "",
    row.min_posts !== null && row.min_posts !== undefined ? "min_posts" : "",
  ].filter(Boolean);
  return {
    enabled: active.length > 0,
    active,
    candidate_eligibility: "candidate eligibility not precomputed",
  };
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

export function isSupportedHandoffUnfollowMode(value: unknown) {
  const mode = readString(value, "").trim().toLowerCase();
  return mode === "unfollow" || mode === "unfollow-any";
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

export function isLoginRunType(runType: string) {
  const normalized = runType.trim().toLowerCase();
  return LOGIN_RUN_TYPES.includes(normalized as (typeof LOGIN_RUN_TYPES)[number]);
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

export function evaluateUnfollowStartGate({
  requestedRunType,
  unfollowEntitlementActive,
  unfollowEnabled,
  unfollowMode,
  unfollowPerSessionLimit,
  unfollowPerDayLimit,
  unfollowDayRemaining,
  realHandoffEnabled,
  realMaxActions,
  realHardMax,
  h3RealSupported,
  safeCandidateStrategyProven,
}: {
  requestedRunType: string;
  unfollowEntitlementActive: boolean;
  unfollowEnabled: boolean;
  unfollowMode: string;
  unfollowPerSessionLimit: number | null;
  unfollowPerDayLimit: number | null;
  unfollowDayRemaining: number | null;
  realHandoffEnabled: boolean;
  realMaxActions: number | null;
  realHardMax: number | null;
  h3RealSupported: boolean;
  safeCandidateStrategyProven: boolean;
}): RunStartBlockReason | null {
  if (requestedRunType !== "account_session") {
    return null;
  }

  const mode = readString(unfollowMode, "unfollow").trim().toLowerCase() || "unfollow";
  if (!unfollowEntitlementActive) {
    return "unfollow_entitlement_missing";
  }
  if (!unfollowEnabled) {
    return "unfollow_disabled";
  }
  if (!isSupportedHandoffUnfollowMode(mode)) {
    return "unfollow_mode_not_supported";
  }
  if (!realHandoffEnabled) {
    return "unfollow_handoff_disabled";
  }
  if (isUnfollowAnyMode(mode) && !h3RealSupported) {
    return "unfollow_mode_not_supported";
  }
  if (
    !capProvesAtLeastOne(unfollowPerSessionLimit) ||
    !capProvesAtLeastOne(unfollowPerDayLimit) ||
    !capProvesAtLeastOne(realMaxActions) ||
    !capProvesAtLeastOne(realHardMax)
  ) {
    return "unfollow_cap_unproven";
  }
  if (unfollowDayRemaining !== null && unfollowDayRemaining < 1) {
    return "unfollow_day_quota_exhausted";
  }
  if (isUnfollowAnyMode(mode) && !safeCandidateStrategyProven) {
    return "unfollow_no_safe_candidate_strategy";
  }

  return null;
}

export type AccountSessionExecutablePhases = {
  follow: boolean;
  welcome: boolean;
  unfollow: boolean;
};

export function evaluateAccountSessionExecutablePhases({
  requestedRunType,
  welcomeEnabled,
  welcomePassedPreflight,
  eligibleFollowTargets,
  followExecutableByCap,
  followWarmupPending = false,
  unfollowEnabled,
  unfollowPassedPreflight,
}: {
  requestedRunType: string;
  welcomeEnabled: boolean;
  welcomePassedPreflight: boolean;
  eligibleFollowTargets: number;
  followExecutableByCap: boolean;
  followWarmupPending?: boolean;
  unfollowEnabled: boolean;
  unfollowPassedPreflight: boolean;
}): AccountSessionExecutablePhases {
  if (requestedRunType !== "account_session") {
    return { follow: false, welcome: false, unfollow: false };
  }

  return {
    welcome: welcomeEnabled && welcomePassedPreflight,
    follow: eligibleFollowTargets >= 1 && followExecutableByCap && !followWarmupPending,
    unfollow: unfollowEnabled && unfollowPassedPreflight,
  };
}

export function evaluateAccountSessionExecutablePhaseGate(
  phases: AccountSessionExecutablePhases,
): RunStartBlockReason | null {
  if (phases.follow || phases.welcome || phases.unfollow) {
    return null;
  }
  return "no_executable_phase";
}

export function evaluateUnfollowAnyStartGate(args: {
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
  if (args.requestedRunType !== "account_session" || !args.unfollowEnabled || !isUnfollowAnyMode(args.unfollowMode)) {
    return null;
  }
  return evaluateUnfollowStartGate({
    ...args,
    unfollowEntitlementActive: true,
    unfollowPerDayLimit: 1,
    unfollowDayRemaining: 1,
  });
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

async function accountHasFeatureEntitlement(accountId: string, featureCode: "follow" | "unfollow") {
  const supabase = createSupabaseClient();
  const { data: links, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("client_id")
    .eq("account_id", accountId)
    .limit(10);
  if (linkError) {
    throw new Error(`Could not verify ${featureCode} entitlement.`);
  }
  const clientIds = [...new Set((links ?? []).map((row) => readString((row as SupabaseRecord).client_id, "")).filter(Boolean))];
  if (!clientIds.length) return false;

  const { data, error } = await supabase
    .from("client_entitlements")
    .select("active,valid_until")
    .in("client_id", clientIds)
    .eq("feature_code", featureCode)
    .eq("active", true)
    .limit(10);
  if (error) {
    throw new Error(`Could not verify ${featureCode} entitlement.`);
  }

  const now = Date.now();
  return (data ?? []).some((row) => {
    const validUntil = readString((row as SupabaseRecord).valid_until, "").trim();
    return !validUntil || Date.parse(validUntil) > now;
  });
}

async function countUnfollowsToday(accountId: string) {
  const since = `${utcDateString()}T00:00:00.000Z`;
  const { count, error } = await createSupabaseClient()
    .from("ig_interacted_users")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("unfollow_result", "success")
    .gte("unfollowed_at", since);
  if (error) {
    throw new Error("Could not verify Unfollow day quota.");
  }
  return count ?? 0;
}

async function countFollowsToday(accountId: string) {
  const since = `${utcDateString()}T00:00:00.000Z`;
  const { count, error } = await createSupabaseClient()
    .from("ig_interacted_users")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("followed_at", since);
  if (error) {
    throw new Error("Could not verify Follow day quota.");
  }
  return count ?? 0;
}

function readJsonNumber(row: SupabaseRecord | null | undefined, key: string, fallback = 0) {
  if (!row || typeof row !== "object") return fallback;
  return readPositiveInteger(row[key]) ?? fallback;
}

function readJsonBoolean(row: SupabaseRecord | null | undefined, key: string, fallback = false) {
  if (!row || typeof row !== "object") return fallback;
  const raw = readString(row[key], "").trim().toLowerCase();
  if (["true", "1", "yes", "enabled"].includes(raw)) return true;
  if (["false", "0", "no", "disabled"].includes(raw)) return false;
  return fallback;
}

function resolveFollowCapPreview(row: SupabaseRecord | null | undefined) {
  const caps = row?.package_caps && typeof row.package_caps === "object" && !Array.isArray(row.package_caps)
    ? row.package_caps as SupabaseRecord
    : null;
  const preview = row?.effective_caps_preview && typeof row.effective_caps_preview === "object" && !Array.isArray(row.effective_caps_preview)
    ? row.effective_caps_preview as SupabaseRecord
    : null;
  const packageCap = readJsonNumber(caps, "follow_day", 0);
  const warmupApplied = readJsonBoolean(preview, "warmup_applied", false);
  const followDay = readJsonNumber(preview, "follow_day", packageCap);
  const followSession = readJsonNumber(preview, "follow_session", followDay);
  return {
    packageCap,
    followDay,
    followSession,
    warmupApplied,
    warmupStatus: readString(row?.warmup_status, "pending_package_start"),
  };
}

export function sanitizeRunControlReason(value: unknown, fallback = "blocked") {
  const raw = readString(value, fallback).slice(0, 500);
  if (!raw) return fallback;
  if (/token|secret|authorization|cookie|service_role|vault|password|adb_serial|device_udid/i.test(raw)) {
    return fallback;
  }
  return raw;
}

export async function getRunControlHealth(env: MiniRunEnv = process.env): Promise<RunControlHealth> {
  const playEnabled = runControlPlayFeatureEnabled(env);
  const dispatcherWorkerId = runControlDispatcherWorkerId(env);

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

export async function evaluateLoginChallengeRunEligibility(
  accountId: string,
  requestedRunType: string,
) {
  const normalizedRunType = requestedRunType.trim().toLowerCase();
  if (!isLoginRunType(normalizedRunType)) {
    return { ok: false as const, reason: "invalid_run_type" as RunStartBlockReason };
  }

  const health = await getRunControlHealth();
  const healthBlock = resolveRunControlHealthBlockReason(health);
  if (healthBlock) {
    return { ok: false as const, reason: healthBlock, health };
  }
  if (health.dispatcherLaunchEnabled === false) {
    return { ok: false as const, reason: "dispatcher_launch_disabled" as RunStartBlockReason, health };
  }

  const supabase = createSupabaseClient();
  const { data: accountRow, error: accountError } = await supabase
    .from("ig_accounts")
    .select("id,status,admin_lifecycle_status")
    .eq("id", accountId)
    .limit(1)
    .maybeSingle();

  if (accountError || !accountRow) {
    return { ok: false as const, reason: "account_archived" as RunStartBlockReason, health };
  }

  const accountStatus = readString(accountRow.status, "active").toLowerCase();
  const adminLifecycleStatus = readString(accountRow.admin_lifecycle_status, accountStatus).toLowerCase();
  if (adminLifecycleStatus === "paused") {
    return { ok: false as const, reason: "account_paused" as RunStartBlockReason, health };
  }
  if (BLOCKED_ACCOUNT_STATUSES.has(accountStatus)) {
    return { ok: false as const, reason: "account_canceled" as RunStartBlockReason, health };
  }

  const activeRequest = await getActiveRunRequest(accountId);
  if (activeRequest) {
    return { ok: false as const, reason: "already_requested" as RunStartBlockReason, health, activeRequest };
  }

  return { ok: true as const, health, normalizedRunType };
}

export type LoginEmailCodeResumeRunRequestResult = {
  queued: boolean;
  idempotent: boolean;
  requestId: string | null;
  requestStatus: string | null;
  reason: string | null;
};

export async function createLoginEmailCodeResumeRunRequest({
  accountId,
  actionId,
  submissionId,
  actorId,
  actorType = "system",
}: {
  accountId: string;
  actionId: string;
  submissionId: string;
  actorId?: string | null;
  actorType?: "admin" | "assistant" | "ops" | "system" | "internal";
}): Promise<LoginEmailCodeResumeRunRequestResult> {
  const supabase = createSupabaseClient();
  const idempotencyKey = `login_email_code_resume:${actionId}:${submissionId}`;
  const { data: existingRequest } = await supabase
    .from("account_run_requests")
    .select("id,status")
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .maybeSingle();

  if (existingRequest) {
    return {
      queued: false,
      idempotent: true,
      requestId: readString(existingRequest.id, "") || null,
      requestStatus: readString(existingRequest.status, "") || null,
      reason: "already_queued",
    };
  }

  const { data, error } = await supabase.rpc("create_account_run_request", {
    p_account_id: accountId,
    p_requested_by: actorId ?? null,
    p_actor_type: actorType,
    p_source_surface: "instagram_dashboard",
    p_requested_run_type: "login_email_code_resume",
    p_idempotency_key: idempotencyKey,
    p_priority: 1,
    p_metadata_safe: {
      action_id: actionId,
      account_id: accountId,
      source: "dashboard_code_submit",
      challenge_type: "email_code_challenge",
      submission_id: submissionId,
    },
  });

  if (error) {
    if (/account_run_already_requested/i.test(error.message)) {
      const activeRequest = await getActiveRunRequest(accountId);
      const requestId = readString(activeRequest?.id, "");
      const requestStatus = readString(activeRequest?.status, "");
      if (requestId && readString(activeRequest?.requested_run_type, "") === "login_email_code_resume") {
        return {
          queued: false,
          idempotent: true,
          requestId,
          requestStatus,
          reason: "already_requested",
        };
      }
    }
    return {
      queued: false,
      idempotent: false,
      requestId: null,
      requestStatus: null,
      reason: sanitizeRunControlReason(error.message, "resume_queue_failed"),
    };
  }

  const requestRow = (Array.isArray(data) ? data[0] : data) as SupabaseRecord | null;
  const requestId = readString(requestRow?.id, "");
  const requestStatus = readString(requestRow?.status, "queued");

  return {
    queued: Boolean(requestId),
    idempotent: false,
    requestId: requestId || null,
    requestStatus: requestStatus || null,
    reason: "queued",
  };
}

export async function evaluateLoginConnectionStartGate(
  accountId: string,
): Promise<Extract<RunStartBlockReason, "login_not_connected" | "login_verification_required" | "support_required"> | null> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("client_instagram_accounts")
    .select("login_status,provisioning_status")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();

  if (error) return "support_required";

  const loginStatus = readString(data?.login_status, "unknown").toLowerCase();
  const provisioningStatus = readString(data?.provisioning_status, "unknown").toLowerCase();
  if (CONNECTED_LOGIN_STATUSES.has(loginStatus) && READY_PROVISIONING_STATUSES.has(provisioningStatus)) {
    return null;
  }
  if (LOGIN_ACTION_REQUIRED_STATUSES.has(loginStatus)) {
    return "login_verification_required";
  }
  return "login_not_connected";
}

export async function evaluateRunStartEligibility(accountId: string, requestedRunType: string) {
  const normalizedRunType = requestedRunType.trim().toLowerCase();
  if (isLoginRunType(normalizedRunType)) {
    return evaluateLoginChallengeRunEligibility(accountId, normalizedRunType);
  }
  if (!DEFAULT_ALLOWED_RUN_TYPES.includes(normalizedRunType as (typeof DEFAULT_ALLOWED_RUN_TYPES)[number])) {
    return { ok: false as const, reason: "invalid_run_type" as RunStartBlockReason };
  }

  const health = await getRunControlHealth();
  const healthBlock = resolveRunControlHealthBlockReason(health);
  if (healthBlock) {
    return { ok: false as const, reason: healthBlock, health };
  }
  if (health.dispatcherLaunchEnabled === false) {
    return { ok: false as const, reason: "dispatcher_launch_disabled" as RunStartBlockReason, health };
  }

  const supabase = createSupabaseClient();
  let safeFollowFiltersSummary: ReturnType<typeof followFiltersSummary> | undefined;
  const { data: accountRow, error: accountError } = await supabase
    .from("ig_accounts")
    .select("id,status,admin_lifecycle_status,username")
    .eq("id", accountId)
    .limit(1)
    .maybeSingle();

  if (accountError || !accountRow) {
    return { ok: false as const, reason: "account_archived" as RunStartBlockReason, health };
  }

  const accountStatus = readString(accountRow.status, "active").toLowerCase();
  const adminLifecycleStatus = readString(accountRow.admin_lifecycle_status, accountStatus).toLowerCase();
  if (adminLifecycleStatus === "paused") {
    return { ok: false as const, reason: "account_paused" as RunStartBlockReason, health };
  }
  if (adminLifecycleStatus === "needs_assistance") {
    return { ok: false as const, reason: "account_needs_assistance" as RunStartBlockReason, health };
  }
  if (adminLifecycleStatus === "cancelled" || adminLifecycleStatus === "pending_cancellation") {
    return { ok: false as const, reason: "account_cancelled" as RunStartBlockReason, health };
  }
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
      let eligibleFollowTargets = 0;
      try {
        eligibleFollowTargets = await countEligibleFollowTargets(accountId);
      } catch {
        return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
      }
      if (eligibleFollowTargets < 1) {
        if (welcomeEnabled) {
          // Welcome-only account_session may still be executable without follow targets.
        } else {
          return { ok: false as const, reason: "no_eligible_targets" as RunStartBlockReason, health };
        }
      }

      const { data: packageSummary, error: packageSummaryError } = await supabase
        .from("account_package_summary")
        .select("warmup_status,package_caps,effective_caps_preview")
        .eq("account_id", accountId)
        .limit(1)
        .maybeSingle<SupabaseRecord>();
      if (packageSummaryError) {
        return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
      }
      const followCaps = resolveFollowCapPreview(packageSummary);
      let followExecutableByCap = eligibleFollowTargets >= 1;
      let followWarmupPending = false;
      if (followCaps.packageCap > 0) {
        let followsDoneToday = 0;
        try {
          followsDoneToday = await countFollowsToday(accountId);
        } catch {
          return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
        }
        const remaining = Math.max(0, followCaps.followDay - followsDoneToday);
        const effectiveFollowCap = Math.min(followCaps.followSession, remaining);
        if (effectiveFollowCap < 1 && followCaps.followDay > 0) {
          followExecutableByCap = false;
        }
        if (followCaps.warmupStatus === "pending_package_start" && followCaps.warmupApplied) {
          followWarmupPending = true;
          followExecutableByCap = false;
        }
      }

      const { data: followFilterSettings, error: followFilterSettingsError } = await supabase
        .from("ig_account_follow_settings")
        .select("dont_follow_private_accounts,min_followers,max_followers,min_posts")
        .eq("account_id", accountId)
        .limit(1)
        .maybeSingle<SupabaseRecord>();
      if (followFilterSettingsError) {
        return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
      }
      const followFilterBlock = validateFollowFilterSettingsRow(followFilterSettings);
      if (followFilterBlock) {
        return { ok: false as const, reason: followFilterBlock, health };
      }
      safeFollowFiltersSummary = followFiltersSummary(followFilterSettings);

      const { data: unfollowSettings, error: unfollowSettingsError } = await supabase
        .from("ig_account_unfollow_settings")
        .select("unfollow_enabled,unfollow_mode,unfollow_per_session_limit,unfollow_per_day_limit,runtime_cap_mode,runtime_safety_cap")
        .eq("account_id", accountId)
        .limit(1)
        .maybeSingle();

      if (unfollowSettingsError) {
        return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
      }

      const unfollowDayLimit = readPositiveInteger(unfollowSettings?.unfollow_per_day_limit);
      const unfollowSessionLimit = readPositiveInteger(unfollowSettings?.unfollow_per_session_limit);
      const runtimeCap = resolveUnfollowRuntimeCap({
        unfollowPerSessionLimit: unfollowSessionLimit,
        runtimeCapMode: unfollowSettings?.runtime_cap_mode,
        runtimeSafetyCap: readPositiveInteger(unfollowSettings?.runtime_safety_cap),
      });
      const handoffEnabled = resolveFollowToUnfollowHandoffEnabled({
        unfollowEnabled: unfollowSettings?.unfollow_enabled === true,
        unfollowMode: readString(unfollowSettings?.unfollow_mode, ""),
        runtimeCapMode: runtimeCap.mode,
      });
      let unfollowEntitlementActive = false;
      let unfollowsDoneToday = 0;
      try {
        unfollowEntitlementActive = await accountHasFeatureEntitlement(accountId, "unfollow");
        unfollowsDoneToday = await countUnfollowsToday(accountId);
      } catch {
        return { ok: false as const, reason: "support_required" as RunStartBlockReason, health };
      }

      const unfollowEnabled = unfollowSettings?.unfollow_enabled === true;
      let unfollowPassedPreflight = false;
      if (unfollowEnabled) {
        const unfollowBlock = evaluateUnfollowStartGate({
          requestedRunType: normalizedRunType,
          unfollowEntitlementActive,
          unfollowEnabled: true,
          unfollowMode: readString(unfollowSettings?.unfollow_mode, ""),
          unfollowPerSessionLimit: unfollowSessionLimit,
          unfollowPerDayLimit: unfollowDayLimit,
          unfollowDayRemaining:
            unfollowDayLimit === null ? null : Math.max(0, unfollowDayLimit - unfollowsDoneToday),
          realHandoffEnabled: handoffEnabled,
          realMaxActions: runtimeCap.cap,
          realHardMax: runtimeCap.hardCap,
          h3RealSupported: runControlUnfollowAnyH3RealSupported(),
          safeCandidateStrategyProven: runControlUnfollowAnySafeStrategyProven(),
        });
        if (unfollowBlock) {
          return { ok: false as const, reason: unfollowBlock, health };
        }
        unfollowPassedPreflight = true;
      }

      const executablePhases = evaluateAccountSessionExecutablePhases({
        requestedRunType: normalizedRunType,
        welcomeEnabled,
        welcomePassedPreflight: welcomeEnabled,
        eligibleFollowTargets,
        followExecutableByCap,
        followWarmupPending,
        unfollowEnabled,
        unfollowPassedPreflight,
      });
      const executablePhaseBlock = evaluateAccountSessionExecutablePhaseGate(executablePhases);
      if (executablePhaseBlock) {
        return { ok: false as const, reason: executablePhaseBlock, health };
      }

      if (followWarmupPending && !executablePhases.welcome && !executablePhases.unfollow) {
        return { ok: false as const, reason: "follow_warmup_pending" as RunStartBlockReason, health };
      }
      if (
        !followExecutableByCap &&
        followCaps.packageCap > 0 &&
        !executablePhases.welcome &&
        !executablePhases.unfollow
      ) {
        return { ok: false as const, reason: "follow_day_quota_exhausted" as RunStartBlockReason, health };
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

  const loginConnectionBlock = await evaluateLoginConnectionStartGate(accountId);
  if (loginConnectionBlock) {
    return { ok: false as const, reason: loginConnectionBlock, health };
  }

  if (await accountHasActiveIgRun(accountId)) {
    return { ok: false as const, reason: "already_running" as RunStartBlockReason, health };
  }

  const scheduleBlock = await evaluateScheduleStartGate(accountId, normalizedRunType);
  if (scheduleBlock) {
    return { ok: false as const, reason: scheduleBlock, health };
  }

  const activeRequest = await getActiveRunRequest(accountId);
  if (activeRequest) {
    return { ok: false as const, reason: "already_requested" as RunStartBlockReason, health, activeRequest };
  }

  return { ok: true as const, health, normalizedRunType, followFiltersSummary: safeFollowFiltersSummary };
}

export async function evaluateScheduleStartGate(
  accountId: string,
  requestedRunType: string,
): Promise<ScheduleBlockReason | null> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc("evaluate_account_schedule_gate", {
    p_account_id: accountId,
    p_requested_run_type: requestedRunType,
  });
  if (error) {
    return "assignment_missing";
  }
  const row = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as SupabaseRecord;
  if (row.ok === true) return null;
  return mapScheduleGateReasonToRunStart(readString(row.reason, "assignment_missing")) ?? "assignment_missing";
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
      return "Manual run requires a healthy runtime dispatcher with a fresh heartbeat.";
    case "dispatcher_unconfigured":
      return "Manual run is unavailable because no runtime dispatcher worker is configured on the dashboard host.";
    case "dispatcher_launch_disabled":
      return "Manual run is blocked because dispatcher launch is disabled.";
    case "play_disabled":
      return "Manual run is disabled for this environment (maintenance mode).";
    case "account_archived":
      return "Archived accounts cannot be started.";
    case "account_trashed":
      return "Trashed accounts cannot be started.";
    case "account_canceled":
      return "This account cannot be started.";
    case "account_cancelled":
      return "Cancelled accounts cannot be started.";
    case "account_paused":
      return "Paused accounts cannot be started until an admin reactivates them.";
    case "account_needs_assistance":
      return "This account needs assistance before it can be started.";
    case "support_required":
      return "Account requires support review before manual run.";
    case "credentials_review_required":
      return "Credentials review is required before manual run.";
    case "reauth_required":
      return "Credential re-authentication is required before manual run.";
    case "login_not_connected":
      return "Manual run is blocked until Instagram is connected on the assigned phone/app.";
    case "login_verification_required":
      return "Manual run is blocked because Instagram login needs verification first.";
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
    case "no_eligible_targets":
      return "Manual run is blocked because no eligible target account is available.";
    case "no_executable_phase":
      return "Manual run is blocked because no executable automation phase is enabled for this account.";
    case "follow_day_quota_exhausted":
      return "Manual run is blocked because the effective Follow day quota is exhausted.";
    case "follow_warmup_pending":
      return "Manual run is blocked because Follow warmup is missing a package/service start date.";
    case "follow_filter_invalid_range":
      return "Manual run is blocked because Follow filter thresholds are invalid.";
    case "mini_run_outreach_off_unproven":
      return "Manual mini-run is blocked because Outreach isolation is not proven.";
    case "unfollow_entitlement_missing":
      return "Manual run is blocked because the Unfollow entitlement is missing.";
    case "unfollow_disabled":
      return "Manual run is blocked because Unfollow is disabled for this account.";
    case "unfollow_mode_not_supported":
      return "Manual run is blocked because the selected Unfollow mode is not supported by the runtime handoff.";
    case "unfollow_handoff_disabled":
      return "Manual run is blocked because Follow-to-Unfollow handoff is disabled.";
    case "unfollow_cap_unproven":
      return "Manual run is blocked because the effective Unfollow cap is not proven to allow at least 1 action.";
    case "unfollow_day_quota_exhausted":
      return "Manual run is blocked because the Unfollow day quota is exhausted.";
    case "unfollow_no_safe_candidate_strategy":
      return "Manual run is blocked because no safe Unfollow-any candidate strategy is proven.";
    case "assignment_missing":
      return "Manual run is blocked because no phone slot assignment exists for this account.";
    case "assignment_window_closed":
      return "Manual run is blocked because the account is outside its assigned schedule window.";
    case "assignment_slot_conflict":
      return "Manual run is blocked because the assigned slot conflicts with another account on this phone.";
    case "phone_rest_active":
      return "Manual run is blocked because the phone is in a rest window.";
    case "outreach_rest_reserved":
      return "Manual run is blocked because this Outreach slot is reserved for phone rest.";
    case "no_app_instance_available":
      return "Manual run is blocked because no Instagram app instance is available on this phone.";
    case "device_unavailable":
      return "Manual run is blocked because the assigned phone/device is unavailable.";
    case "assignment_profile_mismatch":
      return "Manual run is blocked because the assignment profile does not match this run type.";
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
