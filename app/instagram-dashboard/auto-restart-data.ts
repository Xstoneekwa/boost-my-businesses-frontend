import { createSupabaseClient } from "@/lib/supabase";
import { getManageData, type ManageAccount } from "./manage-data";
import { getRadarData } from "./radar-data";

type SupabaseRecord = Record<string, unknown>;

export type AutoRestartMode = "disabled" | "dry_run" | "active";
export type AutoRestartStatus = "connected" | "pending" | "unknown";

export type AutoRestartRulePreview = {
  enabled: boolean;
  mode: AutoRestartMode;
  checkEveryMinutes: number;
  restartYellowAccounts: boolean;
  restartRedAccounts: boolean;
  maxRestartsPerAccountPerDay: number;
  maxRestartsPerAccountPerWindow: number;
  respectPhoneRest: boolean;
  respectSixHourWindow: boolean;
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
  enabledServices: string[];
  phoneName: string;
  phoneRestStatus: string;
  sessionWindowStatus: string;
  assignmentStatus: string;
  gateStatus: string;
  restartEligible: boolean;
  blockReason: string;
  plannedRunType: "account_session" | "outreach_session" | "none";
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
  return {
    enabled: false,
    mode: "dry_run",
    checkEveryMinutes: 15,
    restartYellowAccounts: true,
    restartRedAccounts: true,
    maxRestartsPerAccountPerDay: 2,
    maxRestartsPerAccountPerWindow: 1,
    respectPhoneRest: true,
    respectSixHourWindow: true,
    thresholds: {
      followRemainingMin: 1,
      unfollowRemainingMin: 1,
      welcomeRemainingMin: 1,
      outreachRemainingMin: 1,
    },
    sourceLabel: "configuration API pending; preview defaults only",
  };
}

function inferPackageDefaults(account: ManageAccount) {
  const label = account.packageLabel || "Unknown package";
  const normalized = label.toLowerCase();
  const entitlementText = account.entitlementSummary.toLowerCase();
  const isGrowth = normalized.includes("growth");
  const isPro = normalized.includes("pro") || (!isGrowth && entitlementText.includes("follow") && entitlementText.includes("unfollow"));
  const outreachEnabled = entitlementText.includes("outreach");
  const welcomeEnabled = isPro || normalized.includes("premium") || entitlementText.includes("welcome");
  const followCap = isGrowth ? 80 : isPro || normalized.includes("premium") ? 120 : 0;
  const unfollowCap = followCap;

  return {
    label,
    followCap,
    unfollowCap,
    welcomeCap: welcomeEnabled ? 10 : 0,
    outreachCap: outreachEnabled ? 30 : 0,
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

function isBlockingAccount(account: ManageAccount) {
  const combined = `${account.adminStatus} ${account.loginStatus} ${account.credentialsStatus} ${account.latestIncidentSeverity}`.toLowerCase();
  return ["checkpoint", "challenge", "reauth", "missing", "blocked", "problem", "failed"].some((term) => combined.includes(term)) || account.pendingActionsCount > 0 || account.blockingCampaign;
}

function planCandidate({
  account,
  settings,
  unfollowSettings,
  dmSettings,
  interactions,
  activeRun,
  activeRequest,
  rules,
}: {
  account: ManageAccount;
  settings: SupabaseRecord | undefined;
  unfollowSettings: SupabaseRecord | undefined;
  dmSettings: SupabaseRecord | undefined;
  interactions: SupabaseRecord[];
  activeRun: SupabaseRecord | undefined;
  activeRequest: SupabaseRecord | undefined;
  rules: AutoRestartRulePreview;
}): AutoRestartCandidate {
  const packageDefaults = inferPackageDefaults(account);
  const followEnabled = readBoolean(settings?.follow_enabled, false);
  const followDayCap = readNumber(settings?.total_follows_limit, packageDefaults.followCap);
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
    sourceLabel: "ig_account_settings + ig_interacted_users.followed_at",
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
  if (!rules.enabled) blockingReasons.push("scheduler_disabled");
  if (rules.mode !== "dry_run") blockingReasons.push("active_mode_not_wired");
  if (activeRun) blockingReasons.push("active_run_exists");
  if (activeRequest) blockingReasons.push("active_run_request_exists");
  if (isBlockingAccount(account)) blockingReasons.push("account_blocking_action_or_credentials");
  if (!account.phoneName || account.phoneName === "Unknown phone") blockingReasons.push("assignment_or_device_pending");

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
    enabledServices: [
      followEnabled ? "Follow" : "",
      unfollowEnabled ? "Unfollow" : "",
      welcomeEnabled ? "Welcome" : "",
      outreachEnabled ? "Outreach" : "",
    ].filter(Boolean),
    phoneName: account.phoneName || "Unknown phone",
    phoneRestStatus: "pending source",
    sessionWindowStatus: "6h window pending source",
    assignmentStatus: account.phoneName && account.phoneName !== "Unknown phone" ? "assigned" : "pending",
    gateStatus: restartEligible ? "dry-run eligible" : "blocked",
    restartEligible,
    blockReason: blockingReasons.join(",") || "eligible_dry_run",
    plannedRunType,
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
  const rules = defaultRules();
  const [manageData, radarData] = await Promise.all([getManageData(), getRadarData()]);
  const accountIds = manageData.activeAccounts.map((account) => account.accountId).filter(Boolean);
  const since = todayStartIso();

  const [
    settingsResult,
    unfollowResult,
    dmResult,
    interactionsResult,
    runsResult,
    requestsResult,
    runtimeEventsResult,
    workerHeartbeatsResult,
    deviceHeartbeatsResult,
  ] = await Promise.all([
    supabase.from("ig_account_settings").select("account_id,follow_enabled,follow_limit,total_follows_limit,current_run_status,manual_stop_requested").in("account_id", accountIds).limit(500),
    supabase.from("ig_account_unfollow_settings").select("account_id,unfollow_enabled,unfollow_per_session_limit,unfollow_per_day_limit,runtime_cap_mode,runtime_safety_cap").in("account_id", accountIds).limit(500),
    supabase.from("ig_account_dm_settings").select("account_id,welcome_enabled,outreach_enabled,welcome_per_session_limit,welcome_per_day_limit,outreach_per_session_limit,outreach_per_day_limit").in("account_id", accountIds).limit(500),
    supabase.from("ig_interacted_users").select("account_id,followed_at,unfollowed_at,unfollow_result,was_successful,welcome_dm_sent,dm_sent,updated_at").in("account_id", accountIds).or(`followed_at.gte.${since},unfollowed_at.gte.${since},updated_at.gte.${since}`).limit(5000),
    supabase.from("ig_runs").select("id,account_id,status,created_at,updated_at").in("account_id", accountIds).in("status", [...ACTIVE_RUN_STATUSES]).limit(500),
    supabase.from("account_run_requests").select("id,account_id,status,requested_run_type,created_at,metadata_safe").in("account_id", accountIds).in("status", [...ACTIVE_REQUEST_STATUSES]).limit(500),
    supabase.from("runtime_events").select("id,created_at,event_type,reason,source,job_id,metadata").ilike("event_type", "%restart%").order("created_at", { ascending: false }).limit(10),
    supabase.from("worker_heartbeats").select("worker_id,status,last_seen_at").order("last_seen_at", { ascending: false }).limit(20),
    supabase.from("device_heartbeats").select("device_id,status,last_seen_at,current_account_id").order("last_seen_at", { ascending: false }).limit(50),
  ]);

  const errors = [
    settingsResult.error,
    unfollowResult.error,
    dmResult.error,
    interactionsResult.error,
    runsResult.error,
    requestsResult.error,
    runtimeEventsResult.error,
    workerHeartbeatsResult.error,
    deviceHeartbeatsResult.error,
    ...manageData.errors.map((message) => ({ message })),
    ...radarData.errors.map((message) => ({ message })),
  ].map((error) => error?.message).filter((message): message is string => Boolean(message));

  const settingsByAccount = mapByAccount((settingsResult.data ?? []) as SupabaseRecord[]);
  const unfollowByAccount = mapByAccount((unfollowResult.data ?? []) as SupabaseRecord[]);
  const dmByAccount = mapByAccount((dmResult.data ?? []) as SupabaseRecord[]);
  const interactionsByAccount = groupByAccount((interactionsResult.data ?? []) as SupabaseRecord[]);
  const activeRunsByAccount = mapByAccount((runsResult.data ?? []) as SupabaseRecord[]);
  const activeRequestsByAccount = mapByAccount((requestsResult.data ?? []) as SupabaseRecord[]);

  const candidates = manageData.activeAccounts
    .map((account) => planCandidate({
      account,
      settings: settingsByAccount.get(account.accountId),
      unfollowSettings: unfollowByAccount.get(account.accountId),
      dmSettings: dmByAccount.get(account.accountId),
      interactions: interactionsByAccount.get(account.accountId) ?? [],
      activeRun: activeRunsByAccount.get(account.accountId),
      activeRequest: activeRequestsByAccount.get(account.accountId),
      rules,
    }))
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
      statusLabel: "Dry-run only; active scheduler not wired",
      lastSchedulerCheck: null,
      nextSchedulerCheck: null,
      activeRestartCandidates,
      blockedCandidates,
      schedulerSourceStatus: "pending",
    },
    rules,
    candidates,
    decisions: ((runtimeEventsResult.data ?? []) as SupabaseRecord[]).map(mapDecision),
    safetyGates: [
      { label: "Dispatcher / worker heartbeat", status: latestWorkerSeen ? "observed" : "unknown", detail: latestWorkerSeen ?? "No worker heartbeat visible from current source." },
      { label: "Device availability", status: latestDeviceSeen ? "observed" : "unknown", detail: latestDeviceSeen ?? "No device heartbeat visible from current source." },
      { label: "Phone rest", status: "pending", detail: "No dedicated phone-rest settings table is wired yet." },
      { label: "6h session window", status: "pending", detail: "Session window enforcement is not wired to scheduler settings yet." },
      { label: "Active run/request protection", status: "connected", detail: "Preview blocks accounts with active ig_runs or account_run_requests." },
      { label: "Package cap alignment", status: "partial", detail: "Uses dashboard package labels and domain caps; explicit package preset table is still recommended." },
    ],
    sourceStatus: [
      { label: "Auto Restart settings", status: "pending", detail: "No auto_restart_settings table or PATCH API yet; preview defaults are read-only." },
      { label: "Quota counts", status: interactionsResult.error ? "unknown" : "connected", detail: "Derived from ig_interacted_users daily markers." },
      { label: "Run protection", status: runsResult.error || requestsResult.error ? "unknown" : "connected", detail: "Reads ig_runs and account_run_requests without creating requests." },
      { label: "Decisions/audit", status: runtimeEventsResult.error ? "unknown" : "pending", detail: "Reads runtime_events restart decisions if present; no dedicated decision table yet." },
    ],
    errors,
  };
}
