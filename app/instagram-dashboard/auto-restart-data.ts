import { createSupabaseClient } from "@/lib/supabase";
import { assignmentWindowContainsNow, phoneRestActiveNow, type ScheduleRestWindowProjection } from "@/lib/instagram-dashboard/schedule";
import { getManageData, type ManageAccount } from "./manage-data";
import { getRadarData } from "./radar-data";

type SupabaseRecord = Record<string, unknown>;

export type AutoRestartMode = "disabled" | "dry_run" | "active";
export type AutoRestartStatus = "connected" | "pending" | "unknown";

export type AutoRestartRulePreview = {
  enabled: boolean;
  mode: AutoRestartMode;
  checkEveryMinutes: number;
  restartDelayMinutes: number;
  maxAttemptsPerSession: number;
  resumeFollowIfQuotaRemaining: boolean;
  resumeUnfollowIfQuotaRemaining: boolean;
  respectPhoneRest: boolean;
  respectSixHourWindow: boolean;
  blockOnChallenge: boolean;
  blockOnRestriction: boolean;
  blockOnAccountMismatch: boolean;
  blockOnDeviceOffline: boolean;
  notifyOnBlockedRestart: boolean;
  thresholds: {
    followRemainingMin: number;
    unfollowRemainingMin: number;
    welcomeRemainingMin: number;
    outreachRemainingMin: number;
  };
  sourceLabel: string;
};

export type AutoRestartQuotaPreview = {
  doneToday: number;
  capDay: number;
  remaining: number;
  plannedNextRunQuota: number;
  enabled: boolean;
  sourceLabel: string;
};

export type AutoRestartCandidate = {
  accountId: string;
  username: string;
  packageLabel: string;
  commercialAddonsLabel: string;
  outreachSourceLabel: string;
  runtimeProfilesLabel: string;
  followFiltersLabel: string;
  enabledServices: string[];
  phoneName: string;
  phoneRestStatus: string;
  sessionWindowStatus: string;
  assignmentStatus: string;
  gateStatus: string;
  restartEligible: boolean;
  blockReason: string;
  plannedRunType: "account_session" | "outreach_session" | "none";
  reliability: {
    restartAllowed: boolean | null;
    restartBlockReason: string;
    unsafeMarkers: string[];
    currentAttempt: string;
    nextAttempt: string;
    nextRestartAt: string | null;
    lastRestartError: string;
    sessionTerminationClass: string;
    lastRunId: string;
    lastRunStatus: string;
    sourceLabel: string;
  };
  quotas: {
    follow: AutoRestartQuotaPreview;
    unfollow: AutoRestartQuotaPreview;
    welcome: AutoRestartQuotaPreview;
    outreach: AutoRestartQuotaPreview;
  };
};

export type AutoRestartDecision = {
  id: string;
  account: string;
  decisionTime: string | null;
  action: string;
  reason: string;
  plannedQuotas: string;
  requestId: string | null;
  actor: string;
  mode: AutoRestartMode;
};

export type AutoRestartOverview = {
  status: {
    enabled: boolean;
    mode: AutoRestartMode;
    statusLabel: string;
    lastSchedulerCheck: string | null;
    nextSchedulerCheck: string | null;
    activeRestartCandidates: number;
    blockedCandidates: number;
    schedulerSourceStatus: AutoRestartStatus;
  };
  rules: AutoRestartRulePreview;
  candidates: AutoRestartCandidate[];
  decisions: AutoRestartDecision[];
  safetyGates: Array<{ label: string; status: string; detail: string }>;
  sourceStatus: Array<{ label: string; status: AutoRestartStatus; detail: string }>;
  errors: string[];
};

const ACTIVE_RUN_STATUSES = new Set(["running", "queued", "pending", "in_progress", "active", "starting"]);
const ACTIVE_REQUEST_STATUSES = new Set(["queued", "claimed", "starting", "running", "active", "pending", "processing"]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "enabled"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "disabled"].includes(normalized)) return false;
  }
  return fallback;
}

function todayStartIso() {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function mapByAccount(rows: SupabaseRecord[], key = "account_id") {
  const map = new Map<string, SupabaseRecord>();
  for (const row of rows) {
    const accountId = readString(row[key]);
    if (accountId) map.set(accountId, row);
  }
  return map;
}

function groupByAccount(rows: SupabaseRecord[], key = "account_id") {
  const map = new Map<string, SupabaseRecord[]>();
  for (const row of rows) {
    const accountId = readString(row[key]);
    if (!accountId) continue;
    map.set(accountId, [...(map.get(accountId) ?? []), row]);
  }
  return map;
}

function defaultRules(): AutoRestartRulePreview {
  return defaultAutoRestartRules();
}

export function defaultAutoRestartRules(): AutoRestartRulePreview {
  return {
    enabled: false,
    mode: "dry_run",
    checkEveryMinutes: 15,
    restartDelayMinutes: 20,
    maxAttemptsPerSession: 2,
    resumeFollowIfQuotaRemaining: true,
    resumeUnfollowIfQuotaRemaining: true,
    respectPhoneRest: true,
    respectSixHourWindow: true,
    blockOnChallenge: true,
    blockOnRestriction: true,
    blockOnAccountMismatch: true,
    blockOnDeviceOffline: true,
    notifyOnBlockedRestart: true,
    thresholds: {
      followRemainingMin: 1,
      unfollowRemainingMin: 1,
      welcomeRemainingMin: 1,
      outreachRemainingMin: 1,
    },
    sourceLabel: "auto_restart_settings fallback defaults",
  };
}

function rulesFromSettings(row: SupabaseRecord | null | undefined): AutoRestartRulePreview {
  return rulesFromSettingsRow(row);
}

export function rulesFromSettingsRow(row: SupabaseRecord | null | undefined): AutoRestartRulePreview {
  const fallback = defaultAutoRestartRules();
  if (!row) return fallback;
  const mode = readString(row.mode, "dry_run") as AutoRestartMode;
  return {
    ...fallback,
    enabled: readBoolean(row.auto_restart_enabled, fallback.enabled),
    mode: mode === "active" || mode === "disabled" || mode === "dry_run" ? mode : "dry_run",
    restartDelayMinutes: Math.max(1, readNumber(row.restart_delay_minutes, fallback.restartDelayMinutes)),
    maxAttemptsPerSession: Math.max(0, readNumber(row.max_attempts_per_session, fallback.maxAttemptsPerSession)),
    resumeFollowIfQuotaRemaining: readBoolean(row.resume_follow_if_quota_remaining, fallback.resumeFollowIfQuotaRemaining),
    resumeUnfollowIfQuotaRemaining: readBoolean(row.resume_unfollow_if_quota_remaining, fallback.resumeUnfollowIfQuotaRemaining),
    blockOnChallenge: readBoolean(row.block_on_challenge, fallback.blockOnChallenge),
    blockOnRestriction: readBoolean(row.block_on_restriction, fallback.blockOnRestriction),
    blockOnAccountMismatch: readBoolean(row.block_on_account_mismatch, fallback.blockOnAccountMismatch),
    blockOnDeviceOffline: readBoolean(row.block_on_device_offline, fallback.blockOnDeviceOffline),
    notifyOnBlockedRestart: readBoolean(row.notify_on_blocked_restart, fallback.notifyOnBlockedRestart),
    sourceLabel: "auto_restart_settings",
  };
}

function inferPackageDefaults(account: ManageAccount) {
  const label = account.packageLabel || "Unknown package";
  const normalized = label.toLowerCase();
  const isGrowth = normalized.includes("growth");
  const isPro = normalized.includes("pro");
  const isPremium = normalized.includes("premium");
  const isOutreachStandalone = normalized.includes("outreach standalone");
  const hasOutreachAddon = account.commercialAddonsLabel.toLowerCase().includes("outreach");
  const welcomeEnabled = isPro || isPremium;
  const followCap = isGrowth ? 80 : isPro || isPremium ? 120 : 0;
  const unfollowCap = followCap;

  return {
    label,
    followCap,
    unfollowCap,
    welcomeCap: welcomeEnabled ? 10 : 0,
    outreachCap: isOutreachStandalone || hasOutreachAddon ? 30 : 0,
  };
}

function quota({
  doneToday,
  capDay,
  sessionCap,
  enabled,
  sourceLabel,
}: {
  doneToday: number;
  capDay: number;
  sessionCap: number;
  enabled: boolean;
  sourceLabel: string;
}): AutoRestartQuotaPreview {
  const remaining = Math.max(0, capDay - doneToday);
  return {
    doneToday,
    capDay,
    remaining,
    plannedNextRunQuota: enabled ? Math.max(0, Math.min(sessionCap || capDay, remaining)) : 0,
    enabled,
    sourceLabel,
  };
}

function countToday(rows: SupabaseRecord[], predicate: (row: SupabaseRecord) => boolean) {
  return rows.filter(predicate).length;
}

function rowDateToday(row: SupabaseRecord, key: string, since: string) {
  const raw = readString(row[key]);
  return Boolean(raw && raw >= since);
}

function readRecord(value: unknown): SupabaseRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SupabaseRecord;
  }
  return undefined;
}

function latestSessionRunByAccount(rows: SupabaseRecord[]) {
  const map = new Map<string, SupabaseRecord>();
  for (const row of rows) {
    const accountId = readString(row.account_id);
    if (!accountId || map.has(accountId)) continue;
    map.set(accountId, row);
  }
  return map;
}

function reliabilityFromLatestRun(
  latestRun: SupabaseRecord | undefined,
  rules: AutoRestartRulePreview,
): AutoRestartCandidate["reliability"] {
  if (!latestRun) {
    return {
      restartAllowed: null,
      restartBlockReason: "no_recent_run",
      unsafeMarkers: [],
      currentAttempt: "—",
      nextAttempt: "—",
      nextRestartAt: null,
      lastRestartError: "",
      sessionTerminationClass: "",
      lastRunId: "",
      lastRunStatus: "",
      sourceLabel: "no_recent_run",
    };
  }

  const performance = readRecord(latestRun.performance_summary);
  const resumePlan = readRecord(performance?.auto_restart_resume_plan)
    ?? readRecord(performance?.admin_reliability_snapshot);
  const unsafeRaw = resumePlan?.unsafe_markers ?? performance?.unsafe_markers;
  const unsafeMarkers = Array.isArray(unsafeRaw)
    ? unsafeRaw.map((marker) => readString(marker)).filter(Boolean)
    : readString(unsafeRaw).split(",").map((marker) => marker.trim()).filter(Boolean);

  const restartAllowedRaw = resumePlan?.restart_allowed ?? performance?.auto_restart_restart_allowed;
  const restartAllowed = typeof restartAllowedRaw === "boolean" ? restartAllowedRaw : null;
  const finishedAt = readString(latestRun.finished_at) || readString(latestRun.updated_at);
  const nextRestartAt = finishedAt && rules.restartDelayMinutes > 0
    ? new Date(new Date(finishedAt).getTime() + rules.restartDelayMinutes * 60_000).toISOString()
    : null;

  return {
    restartAllowed,
    restartBlockReason: readString(
      resumePlan?.restart_block_reason,
      readString(performance?.auto_restart_restart_block_reason, "unknown"),
    ),
    unsafeMarkers,
    currentAttempt: readString(resumePlan?.current_attempt_id, "—") || "—",
    nextAttempt: readString(resumePlan?.next_attempt_id, "—") || "—",
    nextRestartAt,
    lastRestartError: readString(performance?.auto_restart_resume_plan_error, ""),
    sessionTerminationClass: readString(
      resumePlan?.session_termination_class,
      readString(performance?.session_termination_class, ""),
    ),
    lastRunId: readString(latestRun.id),
    lastRunStatus: readString(latestRun.status),
    sourceLabel: resumePlan ? "ig_runs.performance_summary.resume_plan" : "ig_runs.performance_summary",
  };
}

function accountHasUnsafeMarker(account: ManageAccount, marker: string) {
  const combined = `${account.adminStatus} ${account.loginStatus} ${account.credentialsStatus} ${account.latestIncidentSeverity}`.toLowerCase();
  const patterns: Record<string, string[]> = {
    challenge: ["checkpoint", "challenge", "2fa"],
    restriction: ["restricted", "restriction", "action block", "action_block"],
    account_mismatch: ["mismatch", "wrong account"],
    device_offline: ["offline", "device_offline"],
  };
  return (patterns[marker] ?? [marker]).some((term) => combined.includes(term));
}

function isBlockingAccount(account: ManageAccount) {
  const combined = `${account.adminStatus} ${account.loginStatus} ${account.credentialsStatus} ${account.latestIncidentSeverity}`.toLowerCase();
  return ["checkpoint", "challenge", "reauth", "missing", "blocked", "problem", "failed"].some((term) => combined.includes(term)) || account.pendingActionsCount > 0 || account.blockingCampaign;
}

function applySafetyBlocks({
  account,
  rules,
  blockingReasons,
  reliability,
}: {
  account: ManageAccount;
  rules: AutoRestartRulePreview;
  blockingReasons: string[];
  reliability: AutoRestartCandidate["reliability"];
}) {
  if (rules.blockOnChallenge && accountHasUnsafeMarker(account, "challenge")) {
    blockingReasons.push("challenge_blocked");
  }
  if (rules.blockOnRestriction && accountHasUnsafeMarker(account, "restriction")) {
    blockingReasons.push("restriction_blocked");
  }
  if (rules.blockOnAccountMismatch && accountHasUnsafeMarker(account, "account_mismatch")) {
    blockingReasons.push("account_mismatch_blocked");
  }
  if (rules.blockOnDeviceOffline && accountHasUnsafeMarker(account, "device_offline")) {
    blockingReasons.push("device_offline_blocked");
  }
  if (reliability.unsafeMarkers.length) {
    blockingReasons.push(`unsafe_markers:${reliability.unsafeMarkers.join(",")}`);
  }
  if (reliability.restartAllowed === false && reliability.restartBlockReason) {
    blockingReasons.push(`worker_plan:${reliability.restartBlockReason}`);
  }
}

function followFiltersLabel(settings: SupabaseRecord | undefined) {
  const active = [
    readBoolean(settings?.dont_follow_private_accounts, false) ? "private" : "",
    settings?.min_followers !== null && settings?.min_followers !== undefined ? "min followers" : "",
    settings?.max_followers !== null && settings?.max_followers !== undefined ? "max followers" : "",
    settings?.min_posts !== null && settings?.min_posts !== undefined ? "min posts" : "",
  ].filter(Boolean);
  return active.length
    ? `Follow filters active: ${active.join(", ")} · candidate eligibility not precomputed`
    : "Follow filters inactive · candidate eligibility not precomputed";
}

function isEligibleFollowTarget(row: SupabaseRecord) {
  const status = readString(row.status, "").toLowerCase();
  if (status !== "valid" && status !== "active") return false;
  if (readString(row.quality_status, "").toLowerCase() !== "eligible") return false;
  const verificationStatus = readString(row.verification_status, "").toLowerCase();
  if (verificationStatus && verificationStatus !== "found") return false;
  if (readString(row.archived_at, "")) return false;
  if (readString(row.deleted_at, "")) return false;
  return true;
}

function eligibleFollowTargetCounts(rows: SupabaseRecord[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isEligibleFollowTarget(row)) continue;
    const accountId = readString(row.account_id, "");
    if (!accountId) continue;
    counts.set(accountId, (counts.get(accountId) ?? 0) + 1);
  }
  return counts;
}

function planCandidate({
  account,
  settings,
  followFilterSettings,
  unfollowSettings,
  dmSettings,
  packageSummary,
  interactions,
  activeRun,
  activeRequest,
  assignment,
  restWindows,
  eligibleFollowTargetCount,
  rules,
  reliability,
}: {
  account: ManageAccount;
  settings: SupabaseRecord | undefined;
  followFilterSettings: SupabaseRecord | undefined;
  unfollowSettings: SupabaseRecord | undefined;
  dmSettings: SupabaseRecord | undefined;
  packageSummary: SupabaseRecord | undefined;
  interactions: SupabaseRecord[];
  activeRun: SupabaseRecord | undefined;
  activeRequest: SupabaseRecord | undefined;
  assignment: SupabaseRecord | undefined;
  restWindows: ScheduleRestWindowProjection[];
  eligibleFollowTargetCount: number;
  rules: AutoRestartRulePreview;
  reliability: AutoRestartCandidate["reliability"];
}): AutoRestartCandidate {
  const packageDefaults = inferPackageDefaults(account);
  const followEnabled = readBoolean(settings?.follow_enabled, false);
  const effectiveCapsPreview = typeof packageSummary?.effective_caps_preview === "object" && packageSummary.effective_caps_preview && !Array.isArray(packageSummary.effective_caps_preview)
    ? packageSummary.effective_caps_preview as SupabaseRecord
    : undefined;
  const followDayCap = readNumber(effectiveCapsPreview?.follow_day, readNumber(settings?.max_actions_per_day, packageDefaults.followCap));
  const followSessionCap = readNumber(settings?.follow_limit, followDayCap);
  const unfollowEnabled = readBoolean(unfollowSettings?.unfollow_enabled, false);
  const unfollowDayCap = readNumber(unfollowSettings?.unfollow_per_day_limit, packageDefaults.unfollowCap);
  const unfollowSessionCap = readNumber(unfollowSettings?.unfollow_per_session_limit, unfollowDayCap);
  const welcomeEnabled = readBoolean(dmSettings?.welcome_enabled, packageDefaults.welcomeCap > 0);
  const welcomeDayCap = readNumber(dmSettings?.welcome_per_day_limit, packageDefaults.welcomeCap);
  const welcomeSessionCap = readNumber(dmSettings?.welcome_per_session_limit, welcomeDayCap);
  const outreachEnabled = readBoolean(dmSettings?.outreach_enabled, packageDefaults.outreachCap > 0);
  const outreachDayCap = readNumber(dmSettings?.outreach_per_day_limit, packageDefaults.outreachCap);
  const outreachSessionCap = readNumber(dmSettings?.outreach_per_session_limit, outreachDayCap);
  const since = todayStartIso();

  const follow = quota({
    doneToday: countToday(interactions, (row) => rowDateToday(row, "followed_at", since) && readBoolean(row.was_successful, true)),
    capDay: followDayCap,
    sessionCap: followSessionCap,
    enabled: followEnabled,
    sourceLabel: "account_package_summary warmup preview + ig_interacted_users.followed_at",
  });
  const unfollow = quota({
    doneToday: countToday(interactions, (row) => rowDateToday(row, "unfollowed_at", since) && readString(row.unfollow_result) === "success"),
    capDay: unfollowDayCap,
    sessionCap: unfollowSessionCap,
    enabled: unfollowEnabled,
    sourceLabel: "ig_account_unfollow_settings + ig_interacted_users.unfollowed_at",
  });
  const welcome = quota({
    doneToday: countToday(interactions, (row) => rowDateToday(row, "updated_at", since) && readBoolean(row.welcome_dm_sent, false)),
    capDay: welcomeDayCap,
    sessionCap: welcomeSessionCap,
    enabled: welcomeEnabled,
    sourceLabel: "ig_account_dm_settings + welcome_dm_sent marker",
  });
  const outreach = quota({
    doneToday: countToday(interactions, (row) => rowDateToday(row, "updated_at", since) && readBoolean(row.dm_sent, false) && !readBoolean(row.welcome_dm_sent, false)),
    capDay: outreachDayCap,
    sessionCap: outreachSessionCap,
    enabled: outreachEnabled,
    sourceLabel: "ig_account_dm_settings + dm_sent marker",
  });

  const blockingReasons: string[] = [];
  const startsAt = readString(assignment?.starts_at, "");
  const endsAt = readString(assignment?.ends_at, "");
  const deviceTimezone = readString(
    (assignment?.phone_devices as SupabaseRecord | undefined)?.timezone,
    "UTC",
  );
  const windowActive = startsAt && endsAt ? assignmentWindowContainsNow(startsAt, endsAt) : false;
  const phoneRestActive = phoneRestActiveNow(restWindows, new Date(), deviceTimezone);
  const sessionWindowStatus = !assignment
    ? "assignment_missing"
    : windowActive
      ? "in_window"
      : "outside_window";
  const phoneRestStatus = phoneRestActive ? "active" : restWindows.length ? "clear" : "no_rest_configured";

  if (!rules.enabled) blockingReasons.push("scheduler_disabled");
  if (rules.mode === "disabled") blockingReasons.push("mode_disabled");
  if (activeRun) blockingReasons.push("active_run_exists");
  if (activeRequest) blockingReasons.push("active_run_request_exists");
  if (isBlockingAccount(account)) blockingReasons.push("account_blocking_action_or_credentials");
  if (!assignment) blockingReasons.push("assignment_missing");
  if (rules.respectSixHourWindow && assignment && !windowActive) blockingReasons.push("assignment_window_closed");
  if (rules.respectPhoneRest && phoneRestActive) blockingReasons.push("phone_rest_active");
  if (!account.phoneName || account.phoneName === "Unknown phone") blockingReasons.push("assignment_or_device_pending");
  if (follow.enabled && follow.remaining > 0 && eligibleFollowTargetCount < 1) blockingReasons.push("no_eligible_targets");
  applySafetyBlocks({ account, rules, blockingReasons, reliability });

  const accountSessionRemaining = follow.remaining + unfollow.remaining + welcome.remaining;
  const outreachRemaining = outreach.remaining;
  if (accountSessionRemaining < 1 && outreachRemaining < 1) blockingReasons.push("no_quota_remaining");

  const restartEligible = blockingReasons.length === 0;
  const plannedRunType =
    restartEligible && accountSessionRemaining >= 1
      ? "account_session"
      : restartEligible && outreachRemaining >= 1
        ? "outreach_session"
        : "none";

  return {
    accountId: account.accountId,
    username: account.username,
    packageLabel: packageDefaults.label,
    commercialAddonsLabel: account.commercialAddonsLabel,
    outreachSourceLabel: account.outreachSourceLabel,
    runtimeProfilesLabel: account.runtimeProfilesLabel,
    followFiltersLabel: followFiltersLabel(followFilterSettings),
    enabledServices: [
      followEnabled ? "Follow" : "",
      unfollowEnabled ? "Unfollow" : "",
      welcomeEnabled ? "Welcome" : "",
      outreachEnabled ? "Outreach" : "",
    ].filter(Boolean),
    phoneName: account.phoneName || readString((assignment?.phone_devices as SupabaseRecord | undefined)?.name, "Unknown phone"),
    phoneRestStatus,
    sessionWindowStatus,
    assignmentStatus: assignment ? readString(assignment.status, "assigned") : "pending",
    gateStatus: restartEligible ? "eligible_preview" : "blocked",
    restartEligible,
    blockReason: blockingReasons.join(",") || "eligible_preview",
    plannedRunType,
    reliability,
    quotas: { follow, unfollow, welcome, outreach },
  };
}

function mapDecision(row: SupabaseRecord): AutoRestartDecision {
  const metadata = typeof row.metadata === "object" && row.metadata && !Array.isArray(row.metadata) ? row.metadata as SupabaseRecord : {};
  return {
    id: readString(row.id, "unknown"),
    account: readString(row.reason, "system"),
    decisionTime: readString(row.created_at) || null,
    action: readString(row.event_type, "runtime_event"),
    reason: readString(row.reason, "no reason"),
    plannedQuotas: readString(metadata.planned_quotas, "not available"),
    requestId: readString(row.job_id) || null,
    actor: readString(row.source, "system"),
    mode: "dry_run",
  };
}

export async function getAutoRestartData(): Promise<AutoRestartOverview> {
  const supabase = createSupabaseClient();
  const [manageData, radarData] = await Promise.all([getManageData(), getRadarData()]);
  const accountIds = manageData.activeAccounts.map((account) => account.accountId).filter(Boolean);
  const since = todayStartIso();

  const [
    autoRestartSettingsResult,
    settingsResult,
    unfollowResult,
    dmResult,
    interactionsResult,
    runsResult,
    sessionRunsResult,
    requestsResult,
    runtimeEventsResult,
    workerHeartbeatsResult,
    deviceHeartbeatsResult,
    packageSummaryResult,
    followFilterSettingsResult,
    targetsResult,
    assignmentsResult,
    restWindowsResult,
  ] = await Promise.all([
    supabase.from("auto_restart_settings").select("*").eq("id", "global").limit(1).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_account_settings").select("account_id,follow_enabled,follow_limit,max_actions_per_day,total_follows_limit,current_run_status,manual_stop_requested").in("account_id", accountIds).limit(500),
    supabase.from("ig_account_unfollow_settings").select("account_id,unfollow_enabled,unfollow_per_session_limit,unfollow_per_day_limit,runtime_cap_mode,runtime_safety_cap").in("account_id", accountIds).limit(500),
    supabase.from("ig_account_dm_settings").select("account_id,welcome_enabled,outreach_enabled,welcome_per_session_limit,welcome_per_day_limit,outreach_per_session_limit,outreach_per_day_limit").in("account_id", accountIds).limit(500),
    supabase.from("ig_interacted_users").select("account_id,followed_at,unfollowed_at,unfollow_result,was_successful,welcome_dm_sent,dm_sent,updated_at").in("account_id", accountIds).or(`followed_at.gte.${since},unfollowed_at.gte.${since},updated_at.gte.${since}`).limit(5000),
    supabase.from("ig_runs").select("id,account_id,status,created_at,updated_at").in("account_id", accountIds).in("status", [...ACTIVE_RUN_STATUSES]).limit(500),
    supabase.from("ig_runs").select("id,account_id,status,finished_at,updated_at,performance_summary").in("account_id", accountIds).order("created_at", { ascending: false }).limit(500),
    supabase.from("account_run_requests").select("id,account_id,status,requested_run_type,created_at,metadata_safe").in("account_id", accountIds).in("status", [...ACTIVE_REQUEST_STATUSES]).limit(500),
    supabase.from("runtime_events").select("id,created_at,event_type,reason,source,job_id,metadata").ilike("event_type", "%restart%").order("created_at", { ascending: false }).limit(10),
    supabase.from("worker_heartbeats").select("worker_id,status,last_seen_at").order("last_seen_at", { ascending: false }).limit(20),
    supabase.from("device_heartbeats").select("device_id,status,last_seen_at,current_account_id").order("last_seen_at", { ascending: false }).limit(50),
    supabase.from("account_package_summary").select("account_id,effective_caps_preview,warmup_status,warmup_day,package_started_at").in("account_id", accountIds).limit(500),
    supabase.from("ig_account_follow_settings").select("account_id,dont_follow_private_accounts,min_followers,max_followers,min_posts").in("account_id", accountIds).limit(500),
    supabase.from("ig_targets").select("account_id,status,quality_status,verification_status,archived_at,deleted_at").in("account_id", accountIds).in("status", ["valid", "active"]).limit(5000),
    supabase
      .from("account_assignments")
      .select("account_id,assignment_type,slot_kind,status,starts_at,ends_at,assignment_source,device_id,phone_devices(name,timezone,status)")
      .in("account_id", accountIds)
      .in("status", ["pending", "reserved", "active"])
      .limit(500),
    supabase
      .from("phone_rest_windows")
      .select("id,device_id,weekday,local_start_time,local_end_time,timezone,status,reason")
      .eq("status", "active")
      .limit(1000),
  ]);
  const rules = rulesFromSettings(autoRestartSettingsResult.data as SupabaseRecord | null | undefined);

  const errors = [
    autoRestartSettingsResult.error,
    settingsResult.error,
    unfollowResult.error,
    dmResult.error,
    interactionsResult.error,
    runsResult.error,
    sessionRunsResult.error,
    requestsResult.error,
    runtimeEventsResult.error,
    workerHeartbeatsResult.error,
    deviceHeartbeatsResult.error,
    packageSummaryResult.error,
    followFilterSettingsResult.error,
    targetsResult.error,
    assignmentsResult.error,
    restWindowsResult.error,
    ...manageData.errors.map((message) => ({ message })),
    ...radarData.errors.map((message) => ({ message })),
  ].map((error) => error?.message).filter((message): message is string => Boolean(message));

  const settingsByAccount = mapByAccount((settingsResult.data ?? []) as SupabaseRecord[]);
  const unfollowByAccount = mapByAccount((unfollowResult.data ?? []) as SupabaseRecord[]);
  const dmByAccount = mapByAccount((dmResult.data ?? []) as SupabaseRecord[]);
  const interactionsByAccount = groupByAccount((interactionsResult.data ?? []) as SupabaseRecord[]);
  const activeRunsByAccount = mapByAccount((runsResult.data ?? []) as SupabaseRecord[]);
  const latestSessionRunsByAccount = latestSessionRunByAccount((sessionRunsResult.data ?? []) as SupabaseRecord[]);
  const activeRequestsByAccount = mapByAccount((requestsResult.data ?? []) as SupabaseRecord[]);
  const packageSummaryByAccount = mapByAccount((packageSummaryResult.data ?? []) as SupabaseRecord[]);
  const followFilterSettingsByAccount = mapByAccount((followFilterSettingsResult.data ?? []) as SupabaseRecord[]);
  const eligibleTargetsByAccount = eligibleFollowTargetCounts((targetsResult.data ?? []) as SupabaseRecord[]);
  const assignmentsByAccount = mapByAccount((assignmentsResult.data ?? []) as SupabaseRecord[]);
  const restWindowsByDevice = groupByAccount((restWindowsResult.data ?? []) as SupabaseRecord[], "device_id");

  const candidates = manageData.activeAccounts
    .map((account) => {
      const assignment = assignmentsByAccount.get(account.accountId);
      const deviceId = readString(assignment?.device_id, "");
      const restWindows = (restWindowsByDevice.get(deviceId) ?? []).map((row) => ({
        id: readString(row.id, ""),
        weekday: typeof row.weekday === "number" ? row.weekday : null,
        local_start_time: readString(row.local_start_time, ""),
        local_end_time: readString(row.local_end_time, ""),
        timezone: readString(row.timezone, "UTC"),
        status: readString(row.status, "active"),
        reason: readString(row.reason, "") || null,
      }));
      return planCandidate({
        account,
        settings: settingsByAccount.get(account.accountId),
        followFilterSettings: followFilterSettingsByAccount.get(account.accountId),
        unfollowSettings: unfollowByAccount.get(account.accountId),
        dmSettings: dmByAccount.get(account.accountId),
        packageSummary: packageSummaryByAccount.get(account.accountId),
        interactions: interactionsByAccount.get(account.accountId) ?? [],
        activeRun: activeRunsByAccount.get(account.accountId),
        activeRequest: activeRequestsByAccount.get(account.accountId),
        assignment,
        restWindows,
        eligibleFollowTargetCount: eligibleTargetsByAccount.get(account.accountId) ?? 0,
        rules,
        reliability: reliabilityFromLatestRun(latestSessionRunsByAccount.get(account.accountId), rules),
      });
    })
    .sort((a, b) => Number(b.restartEligible) - Number(a.restartEligible) || b.quotas.follow.remaining + b.quotas.unfollow.remaining - (a.quotas.follow.remaining + a.quotas.unfollow.remaining))
    .slice(0, 50);

  const activeRestartCandidates = candidates.filter((candidate) => candidate.restartEligible).length;
  const blockedCandidates = candidates.length - activeRestartCandidates;
  const latestWorkerSeen = ((workerHeartbeatsResult.data ?? []) as SupabaseRecord[]).map((row) => readString(row.last_seen_at)).filter(Boolean).sort().at(-1) ?? null;
  const latestDeviceSeen = ((deviceHeartbeatsResult.data ?? []) as SupabaseRecord[]).map((row) => readString(row.last_seen_at)).filter(Boolean).sort().at(-1) ?? null;

  return {
    status: {
      enabled: rules.enabled,
      mode: rules.mode,
      statusLabel: rules.enabled
        ? "Settings active; scheduler enqueue remains disabled from BotApp"
        : "Settings persisted; auto restart disabled",
      lastSchedulerCheck: null,
      nextSchedulerCheck: rules.enabled ? new Date(Date.now() + rules.restartDelayMinutes * 60_000).toISOString() : null,
      activeRestartCandidates,
      blockedCandidates,
      schedulerSourceStatus: autoRestartSettingsResult.error ? "pending" : "connected",
    },
    rules,
    candidates,
    decisions: ((runtimeEventsResult.data ?? []) as SupabaseRecord[]).map(mapDecision),
    safetyGates: [
      { label: "Dispatcher / worker heartbeat", status: latestWorkerSeen ? "observed" : "unknown", detail: latestWorkerSeen ?? "No worker heartbeat visible from current source." },
      { label: "Device availability", status: latestDeviceSeen ? "observed" : "unknown", detail: latestDeviceSeen ?? "No device heartbeat visible from current source." },
      { label: "Fixed blackout windows", status: restWindowsResult.error ? "unknown" : "connected", detail: "Uses phone_rest_windows only for explicit maintenance/ops blackouts; natural post-session rest is buffer time inside the assigned slot." },
      { label: "6h session window", status: assignmentsResult.error ? "unknown" : "connected", detail: "Uses account_assignments starts_at/ends_at for schedule window compliance." },
      { label: "Follow target accounts", status: targetsResult.error ? "unknown" : "connected", detail: "Blocks account_session dry-run restart when no eligible target account exists." },
      { label: "Active run/request protection", status: "connected", detail: "Preview blocks accounts with active ig_runs or account_run_requests." },
      { label: "Package cap alignment", status: "partial", detail: "Uses account_package_summary when available plus domain caps; runtime profiles are displayed separately." },
    ],
    sourceStatus: [
      { label: "Auto Restart settings", status: autoRestartSettingsResult.error ? "pending" : "connected", detail: autoRestartSettingsResult.error ? "auto_restart_settings unavailable; apply migration before real save/load." : `Loaded from ${rules.sourceLabel}.` },
      { label: "Quota counts", status: interactionsResult.error ? "unknown" : "connected", detail: "Derived from ig_interacted_users daily markers." },
      { label: "Run protection", status: runsResult.error || requestsResult.error ? "unknown" : "connected", detail: "Reads ig_runs and account_run_requests without creating requests." },
      { label: "Decisions/audit", status: runtimeEventsResult.error ? "unknown" : "pending", detail: "Reads runtime_events restart decisions if present; no dedicated decision table yet." },
    ],
    errors,
  };
}
