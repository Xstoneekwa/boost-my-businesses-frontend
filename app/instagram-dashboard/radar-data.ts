import { createSupabaseClient } from "@/lib/supabase";

type SupabaseRecord = Record<string, unknown>;

export type HealthStatus = "ok" | "monitor" | "problem" | "unknown";
export type WarningSeverity = "info" | "warning" | "error" | "critical" | "unknown";
export type RunStatus = "running" | "queued" | "completed" | "failed" | "stopped" | "unknown";
export type SourceStatusCode = "connected" | "legacy_ready" | "pending" | "unknown";

export type RadarSourceStatus = {
  status: SourceStatusCode;
  label: string;
  description: string;
};

export type RadarLatestWarning = {
  message: string;
  warningType: string;
  severity: WarningSeverity;
  timestamp: string | null;
  sourceLabel: string;
};

export type RadarAccount = {
  accountId: string;
  username: string;
  emailDisplay: string;
  healthStatus: HealthStatus;
  healthReason: string;
  adminStatus: string;
  loginStatus: string;
  credentialsStatus: string;
  dashboardActivityStatus: string;
  pendingActionsCount: number;
  blockingCampaign: boolean;
  latestIncidentSeverity: WarningSeverity;
  phoneName: string;
  macHostName: string;
  lastSafeUpdate: string | null;
  sourceLabel: string;
  latestWarning: RadarLatestWarning | null;
  recommendedAction: string;
};

export type RadarWarning = {
  id: string;
  accountId: string | null;
  username: string | null;
  warningType: string;
  severity: WarningSeverity;
  message: string;
  sourceLabel: string;
  runId: string | null;
  timestamp: string | null;
  phoneName: string;
  macHostName: string;
  isLinkedToAccount: boolean;
};

export type RadarRun = {
  runId: string;
  accountId: string | null;
  username: string | null;
  status: RunStatus;
  startedAt: string | null;
  updatedAt: string | null;
  phoneName: string;
  macHostName: string;
  sourceLabel: string;
};

export type RadarDevice = {
  deviceId: string | null;
  phoneName: string;
  macHostName: string;
  healthStatus: HealthStatus;
  statusLabel: string;
  accountsCount: number | null;
  lastSeenAt: string | null;
  lastRebootAt: string | null;
  sourceLabel: string;
};

export type RadarSummary = {
  totalAccounts: number;
  okCount: number;
  monitorCount: number;
  problemCount: number;
  riskAccountsCount: number;
  runningCount: number;
  queuedCount: number | null;
  queuedSourceStatus: SourceStatusCode;
  runWarningsCount: number;
  accountsNeedingAttentionCount: number;
  sourceStatus: {
    backendApi: RadarSourceStatus;
    accounts: RadarSourceStatus;
    runs: RadarSourceStatus;
    warnings: RadarSourceStatus;
    devices: RadarSourceStatus;
  };
};

export type ServerCheckItem = {
  id: string;
  accountId: string | null;
  username: string | null;
  reason: string;
  severity: WarningSeverity;
  healthStatus: HealthStatus;
  recommendedAction: string;
  phoneName: string;
  macHostName: string;
  lastUpdate: string | null;
  sourceLabel: string;
};

export type NotificationItem = {
  id: string;
  scope: "radar" | "server_check" | "manage" | "credentials" | "incident" | "action";
  title: string;
  reason: string;
  severity: WarningSeverity;
  countImpact: number;
  accountId: string | null;
  username: string | null;
  phoneName: string;
  macHostName: string;
  sourceLabel: string;
  targetHref: string;
  status: "open" | "acknowledged" | "resolved" | "unknown";
  backendResolutionStatus: "pending" | "available";
  timestamp: string | null;
  recommendedAction: string;
};

export type RadarAccountBreakdown = {
  okAccounts: RadarAccount[];
  monitorAccounts: RadarAccount[];
  problemAccounts: RadarAccount[];
  riskAccounts: RadarAccount[];
};

export type RadarNotificationSummary = {
  totalAttentionCount: number;
  radarBadgeCount: number;
  serverCheckBadgeCount: number;
  credentialsBadgeCount: number | null;
  incidentsBadgeCount: number | null;
};

export type RadarOverview = {
  summary: RadarSummary;
  accounts: RadarAccount[];
  accountBreakdown: RadarAccountBreakdown;
  riskAccounts: RadarAccount[];
  warnings: RadarWarning[];
  runs: RadarRun[];
  devices: RadarDevice[];
  serverCheckItems: ServerCheckItem[];
  notificationSummary: RadarNotificationSummary;
  notificationItems: {
    radar: NotificationItem[];
    serverCheck: NotificationItem[];
  };
  errors: string[];
};

type AdminDashboardRadarResponse = {
  ok?: unknown;
  action?: unknown;
  count?: unknown;
  items?: unknown;
};

export const unknownPhone = "Unknown phone";
export const unknownMac = "Unknown Mac";
export const localMac = "Local Mac";
export const pendingSourceLabel = "admin-dashboard radar_overview pending";
export const legacyAccountsSource = "legacy ig_accounts";
export const legacyRunsSource = "legacy ig_runs";
export const legacyWarningsSource = "legacy ig_action_logs";
export const legacyDevicesSource = "legacy ig_devices";
export const derivedDeviceSource = "derived from account/run data";
export const adminDashboardSource = "admin-dashboard radar_overview";

export const backendApiPendingStatus: RadarSourceStatus = {
  status: "pending",
  label: "Pending API branch",
  description: "Backend API: pending branch. UI and data contract are ready; admin-dashboard/radar_overview is not consumed yet.",
};

export const backendApiNotConfiguredStatus: RadarSourceStatus = {
  status: "pending",
  label: "Backend API not configured",
  description: "ADMIN_DASHBOARD_API_URL or ADMIN_DASHBOARD_INTERNAL_API_TOKEN is missing. Using legacy fallback.",
};

export const backendApiFallbackStatus: RadarSourceStatus = {
  status: "pending",
  label: "Backend API failed, using legacy fallback",
  description: "admin-dashboard/radar_overview was unavailable or returned an invalid response. Using legacy fallback.",
};

export const backendApiReadyStatus: RadarSourceStatus = {
  status: "connected",
  label: "Backend API ready",
  description: "Current data comes from admin-dashboard/radar_overview.",
};

function legacyReadyStatus(label: string, description: string): RadarSourceStatus {
  return {
    status: "legacy_ready",
    label,
    description,
  };
}

function pendingStatus(label: string, description: string): RadarSourceStatus {
  return {
    status: "pending",
    label,
    description,
  };
}

function unknownStatus(label: string, description: string): RadarSourceStatus {
  return {
    status: "unknown",
    label,
    description,
  };
}

function connectedStatus(label: string, description: string): RadarSourceStatus {
  return {
    status: "connected",
    label,
    description,
  };
}

const riskTerms = ["error", "fail", "failed", "blocked", "checkpoint", "challenge", "suspended", "problem"];
const monitorTerms = ["paused", "review", "warning", "monitor", "pending"];
const runningTerms = ["running", "in_progress", "active"];
const queuedTerms = ["queued"];
const completedTerms = ["success", "completed", "done"];
const stoppedTerms = ["stopped", "cancelled", "canceled"];
const adminDashboardTimeoutMs = 9000;

class RadarApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RadarApiError";
  }
}

function readString(row: SupabaseRecord | undefined, keys: string[], fallback = "") {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
  }

  return fallback;
}

function readNumber(row: SupabaseRecord | undefined, keys: string[], fallback = 0) {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return fallback;
}

function readBoolean(row: SupabaseRecord | undefined, keys: string[], fallback = false) {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1", "blocked", "blocking"].includes(normalized)) return true;
      if (["false", "no", "0"].includes(normalized)) return false;
    }
  }

  return fallback;
}

function readIso(row: SupabaseRecord | undefined, keys: string[]) {
  const value = readString(row, keys, "");
  return value || null;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function includesAny(value: string, terms: string[]) {
  const normalized = normalize(value);
  return terms.some((term) => normalized.includes(term));
}

function normalizeHealthStatus(value: string): HealthStatus {
  if (!value) return "unknown";
  if (includesAny(value, riskTerms)) return "problem";
  if (includesAny(value, monitorTerms)) return "monitor";
  if (includesAny(value, ["ok", "healthy", "active", "ready", "online", "success", "completed"])) return "ok";
  return "unknown";
}

function normalizeRunStatus(value: string): RunStatus {
  if (!value) return "unknown";
  if (includesAny(value, runningTerms)) return "running";
  if (includesAny(value, queuedTerms)) return "queued";
  if (includesAny(value, completedTerms)) return "completed";
  if (includesAny(value, riskTerms)) return "failed";
  if (includesAny(value, stoppedTerms)) return "stopped";
  return "unknown";
}

function severityFrom(value: string): WarningSeverity {
  const normalized = normalize(value);
  if (["critical", "blocked", "checkpoint", "challenge", "suspended"].some((term) => normalized.includes(term))) return "critical";
  if (["error", "failed", "fail"].some((term) => normalized.includes(term))) return "error";
  if (["warning", "warn", "paused", "review", "monitor"].some((term) => normalized.includes(term))) return "warning";
  if (["info", "success", "completed"].some((term) => normalized.includes(term))) return "info";
  return "unknown";
}

function emailDisplay(row: SupabaseRecord | undefined) {
  const explicitDisplay = readString(row, ["email_display"], "");
  if (explicitDisplay) return explicitDisplay;

  const email = readString(row, ["email", "account_email"], "");
  if (!email) return "unknown";
  const [name, domain] = email.split("@");
  if (!name || !domain) return "configured";
  return `${name.slice(0, 2)}***@${domain}`;
}

function accountId(row: SupabaseRecord | undefined) {
  return readString(row, ["account_id", "ig_account_id", "instagram_account_id", "id"], "");
}

function username(row: SupabaseRecord | undefined, fallback = "account unknown") {
  return readString(row, ["username", "account_username", "ig_username", "handle"], fallback);
}

function phoneName(row: SupabaseRecord | undefined, fallback = unknownPhone) {
  return readString(row, ["device_name", "phone_name", "device", "phone"], fallback);
}

function macHostName(row: SupabaseRecord | undefined, fallback = localMac) {
  return readString(row, ["host_name", "mac_host", "mac_name", "server_name", "worker_host"], fallback);
}

function accountMaps(accounts: RadarAccount[]) {
  return {
    byId: new Map(accounts.map((account) => [account.accountId, account])),
    byUsername: new Map(accounts.map((account) => [account.username.toLowerCase(), account])),
  };
}

function resolveAccountForRow(row: SupabaseRecord, accounts: RadarAccount[]) {
  const maps = accountMaps(accounts);
  const id = accountId(row);
  const byId = maps.byId.get(id);
  if (byId) return byId;

  const name = username(row, "").toLowerCase();
  return name ? maps.byUsername.get(name) : undefined;
}

function legacySourceStatus(rows: unknown[], readyLabel: string, emptyLabel: string, readyDescription: string, emptyDescription: string): RadarSourceStatus {
  return rows.length > 0 ? legacyReadyStatus(readyLabel, readyDescription) : unknownStatus(emptyLabel, emptyDescription);
}

function adminDashboardConfig() {
  const url = process.env.ADMIN_DASHBOARD_API_URL?.trim();
  const token = process.env.ADMIN_DASHBOARD_INTERNAL_API_TOKEN?.trim();

  if (!url || !token) return null;
  return { url, token };
}

function adminDashboardSourceStatus(): RadarSummary["sourceStatus"] {
  return {
    backendApi: backendApiReadyStatus,
    accounts: connectedStatus("Admin API", "Account health data comes from admin-dashboard/radar_overview."),
    runs: pendingStatus("Pending source", "admin-dashboard/radar_overview does not provide run rows yet. Runtime run source remains pending."),
    warnings: connectedStatus("Admin API signals", "Warning signals are derived from admin-dashboard/radar_overview account health. account_incidents/runtime_events pending migration."),
    devices: pendingStatus("Inventory pending", "admin-dashboard/radar_overview does not provide device/host inventory yet. Device source remains pending."),
  };
}

function legacySourceStatusWithBackend(backendApi: RadarSourceStatus, overview: RadarOverview): RadarOverview {
  return {
    ...overview,
    summary: {
      ...overview.summary,
      sourceStatus: {
        ...overview.summary.sourceStatus,
        backendApi,
      },
    },
  };
}

export function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

export function formatDateTime(value: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function statusTone(status: string) {
  const normalized = normalize(status);
  if (["ok", "completed", "success", "online", "ready"].some((term) => normalized.includes(term))) return "#34D399";
  if (["monitor", "warning", "queued", "running", "pending"].some((term) => normalized.includes(term))) return "#FBBF24";
  if (["problem", "error", "critical", "failed", "blocked", "challenge"].some((term) => normalized.includes(term))) return "#F87171";
  if (["stopped", "paused"].some((term) => normalized.includes(term))) return "#93C5FD";
  return "rgba(255,255,255,0.66)";
}

async function readLegacyTables() {
  const supabase = createSupabaseClient();
  const [accountsResult, runsResult, logsResult, devicesResult] = await Promise.all([
    supabase.from("ig_accounts").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("ig_runs").select("*").order("created_at", { ascending: false }).limit(250),
    supabase.from("ig_action_logs").select("*").order("created_at", { ascending: false }).limit(1000),
    supabase.from("ig_devices").select("*").order("created_at", { ascending: false }).limit(100),
  ]);

  return {
    accounts: (accountsResult.data ?? []) as SupabaseRecord[],
    runs: (runsResult.data ?? []) as SupabaseRecord[],
    logs: (logsResult.data ?? []) as SupabaseRecord[],
    devices: (devicesResult.data ?? []) as SupabaseRecord[],
    errors: [accountsResult.error, runsResult.error, logsResult.error, devicesResult.error]
      .map((error) => error?.message)
      .filter((message): message is string => Boolean(message)),
  };
}

function mapLegacyAccounts(rows: SupabaseRecord[]): RadarAccount[] {
  return rows.map((row) => {
    const adminStatus = readString(row, ["admin_status", "status", "state"], "unknown");
    const loginStatus = readString(row, ["login_status"], "unknown");
    const credentialsStatus = readString(row, ["credentials_status"], readString(row, ["password"], "") ? "configured" : "unknown");
    const dashboardActivityStatus = readString(row, ["dashboard_activity_status", "last_run_status"], "unknown");
    const latestIncidentSeverity = severityFrom(readString(row, ["latest_incident_severity", "status", "state"], ""));
    const derivedHealth = normalizeHealthStatus(readString(row, ["health_status"], adminStatus));

    return {
      accountId: readString(row, ["id", "account_id"], ""),
      username: username(row),
      emailDisplay: emailDisplay(row),
      healthStatus: derivedHealth,
      healthReason: readString(row, ["health_reason", "warning_reason", "incident_reason", "action_reason"], derivedHealth === "ok" ? "No issue from current source" : "Derived from legacy account status"),
      adminStatus,
      loginStatus,
      credentialsStatus,
      dashboardActivityStatus,
      pendingActionsCount: readNumber(row, ["pending_actions_count"], 0),
      blockingCampaign: readBoolean(row, ["blocking_campaign", "campaign_blocking"], false),
      latestIncidentSeverity,
      phoneName: phoneName(row),
      macHostName: macHostName(row),
      lastSafeUpdate: readIso(row, ["last_safe_update", "last_seen_at", "updated_at", "created_at"]),
      sourceLabel: legacyAccountsSource,
      latestWarning: null,
      recommendedAction: "Review in Manage",
    };
  });
}

function mapLegacyRuns(rows: SupabaseRecord[], accounts: RadarAccount[]): RadarRun[] {
  return rows.map((row, index) => {
    const linkedAccount = resolveAccountForRow(row, accounts);

    return {
      runId: readString(row, ["run_id", "id"], `legacy-run-${index}`),
      accountId: accountId(row) || linkedAccount?.accountId || null,
      username: username(row, linkedAccount?.username ?? "account unknown"),
      status: normalizeRunStatus(readString(row, ["status", "run_status", "state"], "")),
      startedAt: readIso(row, ["started_at", "created_at"]),
      updatedAt: readIso(row, ["updated_at", "finished_at", "created_at"]),
      phoneName: phoneName(row, linkedAccount?.phoneName ?? unknownPhone),
      macHostName: macHostName(row, linkedAccount?.macHostName ?? localMac),
      sourceLabel: legacyRunsSource,
    };
  });
}

function mapLegacyWarnings(rows: SupabaseRecord[], accounts: RadarAccount[]): RadarWarning[] {
  return rows
    .filter((row) => {
      const status = readString(row, ["status", "result"], "");
      const type = readString(row, ["action_type", "action", "event_type", "type"], "");
      return normalizeRunStatus(status) === "failed" || ["error", "warning", "blocked", "checkpoint", "challenge"].some((term) => normalize(`${status} ${type}`).includes(term));
    })
    .map((row, index) => {
      const linkedAccount = resolveAccountForRow(row, accounts);
      const explicitAccountId = readString(row, ["account_id", "ig_account_id", "instagram_account_id"], "");
      const status = readString(row, ["status", "result"], "unknown");
      const logSource = readString(row, ["worker_type", "source"], "");

      return {
        id: readString(row, ["id"], `legacy-warning-${index}`),
        accountId: explicitAccountId || linkedAccount?.accountId || null,
        username: username(row, linkedAccount?.username ?? "account unknown"),
        warningType: readString(row, ["action_type", "action", "event_type", "type"], "warning"),
        severity: severityFrom(`${status} ${readString(row, ["action_type", "action", "event_type", "type"], "")}`),
        message: readString(row, ["message", "error"], "Legacy warning without message"),
        sourceLabel: logSource ? `${legacyWarningsSource} / ${logSource}` : legacyWarningsSource,
        runId: readString(row, ["run_id", "ig_run_id"], "") || null,
        timestamp: readIso(row, ["created_at", "updated_at"]),
        phoneName: phoneName(row, linkedAccount?.phoneName ?? unknownPhone),
        macHostName: macHostName(row, linkedAccount?.macHostName ?? localMac),
        isLinkedToAccount: Boolean(explicitAccountId || linkedAccount),
      };
    });
}

function mapLegacyDevices(rows: SupabaseRecord[], accounts: RadarAccount[]): RadarDevice[] {
  const mappedDevices = rows.map((row) => {
    const name = phoneName(row, readString(row, ["device_name", "name", "label"], unknownPhone));
    const statusLabel = readString(row, ["status", "state"], "unknown");
    const accountsCount = accounts.filter((account) => account.phoneName === name).length;

    return {
      deviceId: readString(row, ["id"], "") || null,
      phoneName: name,
      macHostName: macHostName(row, localMac),
      healthStatus: normalizeHealthStatus(readString(row, ["health_status", "health", "status", "state"], "")),
      statusLabel,
      accountsCount,
      lastSeenAt: readIso(row, ["last_seen_at", "updated_at", "created_at"]),
      lastRebootAt: readIso(row, ["last_reboot_at", "rebooted_at"]),
      sourceLabel: legacyDevicesSource,
    };
  });

  if (mappedDevices.length > 0) return mappedDevices;

  const derivedNames = [...new Set(accounts.map((account) => account.phoneName).filter((name) => name && name !== unknownPhone))];
  return derivedNames.map((name) => ({
    deviceId: null,
    phoneName: name,
    macHostName: accounts.find((account) => account.phoneName === name)?.macHostName ?? localMac,
    healthStatus: "unknown",
    statusLabel: "Derived from account/run data",
    accountsCount: accounts.filter((account) => account.phoneName === name).length,
    lastSeenAt: null,
    lastRebootAt: null,
    sourceLabel: derivedDeviceSource,
  }));
}

function safeDisplayStatus(value: string, fallback = "unknown") {
  const normalized = normalize(value);
  if (!normalized) return fallback;
  if (["configured", "missing", "unknown", "ok", "problem", "needs_2fa", "checkpoint", "blocked", "reauth_required", "enabled", "disabled"].includes(normalized)) return value;
  if (normalized.includes("missing")) return "missing";
  if (normalized.includes("reauth")) return "reauth_required";
  if (normalized.includes("checkpoint")) return "checkpoint";
  if (normalized.includes("blocked")) return "blocked";
  if (normalized.includes("2fa") || normalized.includes("two_factor")) return "needs_2fa";
  if (normalized.includes("configured") || normalized.includes("enabled")) return "configured";
  return fallback;
}

function stringifySafeList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(String)
      .filter(Boolean)
      .slice(0, 4)
      .join(", ");
  }

  if (typeof value === "string") return value;
  return "";
}

function adminHealthReason(row: SupabaseRecord, healthStatus: HealthStatus) {
  const explicitReason = readString(row, ["health_reason"], "");
  const quickRules = stringifySafeList(row.quick_rule_flags);
  const tags = stringifySafeList(row.tags);

  if (explicitReason) return explicitReason;
  if (readBoolean(row, ["special_care_active"], false)) return "Special care active";
  if (readBoolean(row, ["live_feed_not_updated_2d"], false)) return "Live feed not updated for 2d";
  if (readString(row, ["last_block_at"], "")) return "Recent block signal";
  if (quickRules) return `Quick rule flags: ${quickRules}`;
  if (tags) return `Tags: ${tags}`;
  if (healthStatus === "ok") return "No issue from admin-dashboard radar_overview";
  return "Review admin-dashboard radar_overview signal";
}

function adminLatestSeverity(row: SupabaseRecord, healthStatus: HealthStatus): WarningSeverity {
  if (readString(row, ["last_block_at"], "")) return "critical";
  const quickRules = stringifySafeList(row.quick_rule_flags);
  const reason = `${readString(row, ["health_reason"], "")} ${quickRules}`;
  const explicitSeverity = severityFrom(reason);
  if (explicitSeverity !== "unknown") return explicitSeverity;
  if (healthStatus === "problem") return "warning";
  if (healthStatus === "monitor") return "info";
  return "unknown";
}

function pendingActionsFromAdminRow(row: SupabaseRecord) {
  return readNumber(row, ["pending_actions_count"], readNumber(row, ["actions_2d"], 0));
}

function mapAdminDashboardAccounts(rows: SupabaseRecord[]): RadarAccount[] {
  return rows.map((row) => {
    const healthStatus = normalizeHealthStatus(readString(row, ["health_status"], ""));
    const passwordDisplay = safeDisplayStatus(readString(row, ["password_display"], ""), "unknown");
    const twoFactorDisplay = safeDisplayStatus(readString(row, ["two_factor_display"], ""), "unknown");
    const credentialsStatus = [passwordDisplay, twoFactorDisplay]
      .filter((value) => value !== "unknown")
      .join(" / ") || "unknown";
    const lastBlockAt = readIso(row, ["last_block_at"]);
    const latestIncidentSeverity = adminLatestSeverity(row, healthStatus);

    return {
      accountId: readString(row, ["account_id", "id"], ""),
      username: username(row),
      emailDisplay: emailDisplay(row),
      healthStatus,
      healthReason: adminHealthReason(row, healthStatus),
      adminStatus: readString(row, ["admin_status"], "unknown"),
      loginStatus: readString(row, ["login_status"], healthStatus === "problem" ? "problem" : "unknown"),
      credentialsStatus,
      dashboardActivityStatus: readString(row, ["dashboard_activity_status"], readBoolean(row, ["live_feed_not_updated_2d"], false) ? "stale" : "unknown"),
      pendingActionsCount: pendingActionsFromAdminRow(row),
      blockingCampaign: Boolean(lastBlockAt || readBoolean(row, ["blocking_campaign"], false)),
      latestIncidentSeverity,
      phoneName: phoneName(row, unknownPhone),
      macHostName: macHostName(row, localMac),
      lastSafeUpdate: lastBlockAt,
      sourceLabel: adminDashboardSource,
      latestWarning: null,
      recommendedAction: "Review in Server Check",
    };
  });
}

function mapAdminDashboardWarnings(accounts: RadarAccount[]): RadarWarning[] {
  return accounts
    .filter((account) => account.healthStatus === "problem" || account.healthStatus === "monitor" || account.blockingCampaign || account.pendingActionsCount > 0)
    .map((account) => ({
      id: `admin-warning-${account.accountId || account.username}`,
      accountId: account.accountId || null,
      username: account.username,
      warningType: account.blockingCampaign ? "account block signal" : account.healthStatus === "problem" ? "account health problem" : "account monitor signal",
      severity: account.latestIncidentSeverity === "unknown" ? (account.healthStatus === "problem" ? "warning" : "info") : account.latestIncidentSeverity,
      message: account.healthReason,
      sourceLabel: `${adminDashboardSource} / account health`,
      runId: null,
      timestamp: account.lastSafeUpdate,
      phoneName: account.phoneName,
      macHostName: account.macHostName,
      isLinkedToAccount: Boolean(account.accountId),
    }));
}

function buildServerCheckItems(accounts: RadarAccount[], warnings: RadarWarning[]): ServerCheckItem[] {
  const items = new Map<string, ServerCheckItem>();

  for (const account of accounts) {
    const shouldInclude =
      account.healthStatus === "problem" ||
      account.healthStatus === "monitor" ||
      account.blockingCampaign ||
      account.loginStatus === "problem" ||
      account.credentialsStatus === "problem" ||
      account.pendingActionsCount > 0;

    if (!shouldInclude) continue;

    items.set(account.accountId || account.username, {
      id: account.accountId || account.username,
      accountId: account.accountId || null,
      username: account.username,
      reason: account.healthReason || "Review in Manage",
      severity: account.latestIncidentSeverity === "unknown" ? (account.healthStatus === "problem" ? "warning" : "info") : account.latestIncidentSeverity,
      healthStatus: account.healthStatus,
      recommendedAction: "Review in Manage",
      phoneName: account.phoneName,
      macHostName: account.macHostName,
      lastUpdate: account.lastSafeUpdate,
      sourceLabel: account.sourceLabel,
    });
  }

  for (const warning of warnings) {
    const key = warning.accountId || `warning-${warning.id}`;
    const existing = items.get(key);
    const warningItem: ServerCheckItem = {
      id: key,
      accountId: warning.accountId,
      username: warning.username,
      reason: warning.message || (warning.isLinkedToAccount ? "Warning from legacy logs" : "unlinked warning"),
      severity: warning.severity,
      healthStatus: warning.severity === "critical" || warning.severity === "error" ? "problem" : "monitor",
      recommendedAction: "Review in Manage",
      phoneName: warning.phoneName,
      macHostName: warning.macHostName,
      lastUpdate: warning.timestamp,
      sourceLabel: warning.isLinkedToAccount ? warning.sourceLabel : `${warning.sourceLabel} / unlinked warning`,
    };

    items.set(key, existing && existing.severity === "critical" ? existing : warningItem);
  }

  const severityRank: Record<WarningSeverity, number> = {
    critical: 0,
    error: 1,
    warning: 2,
    unknown: 3,
    info: 4,
  };
  const healthRank: Record<HealthStatus, number> = {
    problem: 0,
    monitor: 1,
    unknown: 2,
    ok: 3,
  };

  return [...items.values()].sort((a, b) => {
    const severityDelta = severityRank[a.severity] - severityRank[b.severity];
    if (severityDelta !== 0) return severityDelta;
    const healthDelta = healthRank[a.healthStatus] - healthRank[b.healthStatus];
    if (healthDelta !== 0) return healthDelta;
    return (b.lastUpdate ?? "").localeCompare(a.lastUpdate ?? "");
  });
}

function buildAccountBreakdown(accounts: RadarAccount[], riskAccounts: RadarAccount[]): RadarAccountBreakdown {
  return {
    okAccounts: accounts.filter((account) => account.healthStatus === "ok"),
    monitorAccounts: accounts.filter((account) => account.healthStatus === "monitor"),
    problemAccounts: accounts.filter((account) => account.healthStatus === "problem"),
    riskAccounts,
  };
}

function latestWarningForAccount(account: RadarAccount, warnings: RadarWarning[]): RadarLatestWarning | null {
  const linkedWarnings = warnings
    .filter((warning) => warning.accountId === account.accountId || warning.username?.toLowerCase() === account.username.toLowerCase())
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));

  const latest = linkedWarnings[0];
  if (!latest) return null;

  return {
    message: latest.message,
    warningType: latest.warningType,
    severity: latest.severity,
    timestamp: latest.timestamp,
    sourceLabel: latest.sourceLabel,
  };
}

function enrichAccountsWithWarnings(accounts: RadarAccount[], warnings: RadarWarning[]) {
  return accounts.map((account) => ({
    ...account,
    latestWarning: latestWarningForAccount(account, warnings),
  }));
}

function accountTargetHref(account: RadarAccount) {
  if (account.healthStatus === "problem") return "/instagram-dashboard/radar?accountFilter=problem#account-drilldown";
  if (account.healthStatus === "monitor") return "/instagram-dashboard/radar?accountFilter=monitor#account-drilldown";
  return "/instagram-dashboard/radar?accountFilter=risk#account-drilldown";
}

function notificationSeverityFromHealth(account: RadarAccount): WarningSeverity {
  if (account.latestWarning) return account.latestWarning.severity;
  if (account.latestIncidentSeverity !== "unknown") return account.latestIncidentSeverity;
  if (account.healthStatus === "problem") return "warning";
  if (account.healthStatus === "monitor") return "info";
  return "unknown";
}

function buildRadarNotificationItems(riskAccounts: RadarAccount[], warnings: RadarWarning[]): NotificationItem[] {
  const accountItems: NotificationItem[] = riskAccounts.map((account) => ({
    id: `radar-account-${account.accountId || account.username}`,
    scope: "radar",
    title: account.username,
    reason: account.latestWarning?.message ?? account.healthReason,
    severity: notificationSeverityFromHealth(account),
    countImpact: 1,
    accountId: account.accountId || null,
    username: account.username,
    phoneName: account.phoneName,
    macHostName: account.macHostName,
    sourceLabel: account.latestWarning?.sourceLabel ?? account.sourceLabel,
    targetHref: accountTargetHref(account),
    status: "open",
    backendResolutionStatus: "pending",
    timestamp: account.latestWarning?.timestamp ?? account.lastSafeUpdate,
    recommendedAction: account.recommendedAction,
  }));

  const warningItems: NotificationItem[] = warnings
    .filter((warning) => warning.severity === "critical" || warning.severity === "error" || warning.severity === "warning" || !warning.isLinkedToAccount)
    .map((warning) => ({
      id: `radar-warning-${warning.id}`,
      scope: "radar",
      title: warning.username ?? "account unknown",
      reason: warning.message,
      severity: warning.severity,
      countImpact: 1,
      accountId: warning.accountId,
      username: warning.username,
      phoneName: warning.phoneName,
      macHostName: warning.macHostName,
      sourceLabel: warning.sourceLabel,
      targetHref: warning.accountId ? "/instagram-dashboard/radar?accountFilter=risk#account-drilldown" : "/instagram-dashboard/radar#recent-warning-signals",
      status: "open",
      backendResolutionStatus: "pending",
      timestamp: warning.timestamp,
      recommendedAction: "Review in Manage",
    }));

  return [...accountItems, ...warningItems];
}

function buildServerCheckNotificationItems(serverCheckItems: ServerCheckItem[]): NotificationItem[] {
  return serverCheckItems.map((item) => ({
    id: `server-check-${item.id}`,
    scope: "server_check",
    title: item.username ?? "account unknown",
    reason: item.reason,
    severity: item.severity,
    countImpact: 1,
    accountId: item.accountId,
    username: item.username,
    phoneName: item.phoneName,
    macHostName: item.macHostName,
    sourceLabel: item.sourceLabel,
    targetHref: `/instagram-dashboard/server-check#server-check-item-${encodeURIComponent(item.id)}`,
    status: "open",
    backendResolutionStatus: "pending",
    timestamp: item.lastUpdate,
    recommendedAction: item.recommendedAction,
  }));
}

function countOpenNotifications(items: NotificationItem[]) {
  return items.filter((item) => item.status === "open").reduce((total, item) => total + item.countImpact, 0);
}

function buildNotificationSummary(radarItems: NotificationItem[], serverCheckItems: NotificationItem[]): RadarNotificationSummary {
  const radarBadgeCount = countOpenNotifications(radarItems);
  const serverCheckBadgeCount = countOpenNotifications(serverCheckItems);

  return {
    totalAttentionCount: serverCheckBadgeCount,
    radarBadgeCount,
    serverCheckBadgeCount,
    // TODO: Future notification badges from account_dashboard_actions resolve,
    // account_incidents acknowledge/resolve, credentials action resolved, Activity Log audit,
    // and decrement badge after backend confirms resolved/acknowledged/dismissed/fixed.
    credentialsBadgeCount: null,
    incidentsBadgeCount: null,
  };
}

function buildSummary(
  accounts: RadarAccount[],
  warnings: RadarWarning[],
  runs: RadarRun[],
  devices: RadarDevice[],
  riskAccountsCount: number,
  accountsNeedingAttentionCount: number,
  sourceStatus?: RadarSummary["sourceStatus"],
): RadarSummary {
  const queuedCount = runs.some((run) => run.status === "queued") ? runs.filter((run) => run.status === "queued").length : null;
  const hasDerivedDevices = devices.some((device) => device.sourceLabel === derivedDeviceSource);
  const hasLegacyDevices = devices.some((device) => device.sourceLabel === legacyDevicesSource);

  return {
    totalAccounts: accounts.length,
    okCount: accounts.filter((account) => account.healthStatus === "ok").length,
    monitorCount: accounts.filter((account) => account.healthStatus === "monitor").length,
    problemCount: accounts.filter((account) => account.healthStatus === "problem").length,
    riskAccountsCount,
    runningCount: runs.filter((run) => run.status === "running").length,
    queuedCount,
    queuedSourceStatus: queuedCount === null ? "pending" : sourceStatus?.runs.status ?? "legacy_ready",
    runWarningsCount: warnings.length,
    accountsNeedingAttentionCount,
    sourceStatus: sourceStatus ?? {
      backendApi: backendApiPendingStatus,
      accounts: legacySourceStatus(
        accounts,
        "Legacy DB ready",
        "Pending source",
        "Current account data comes from legacy ig_accounts. Backend API branch is pending.",
        "No account rows found from legacy ig_accounts.",
      ),
      runs: legacySourceStatus(
        runs,
        "Legacy DB ready",
        "Pending source",
        "Running data comes from legacy ig_runs. Queue source is still pending unless queued rows exist.",
        "No run rows found from legacy ig_runs.",
      ),
      warnings: legacySourceStatus(
        warnings,
        "Legacy logs ready",
        "Pending source",
        "Current warning data comes from legacy ig_action_logs. account_incidents/runtime_events pending migration.",
        "No warning rows found from legacy ig_action_logs.",
      ),
      devices: hasLegacyDevices
        ? legacyReadyStatus("Legacy DB ready", "Device readiness comes from legacy ig_devices.")
        : hasDerivedDevices
          ? legacyReadyStatus("Derived from account/run data", "No device inventory rows found; phone readiness is derived from linked account/run data.")
        : pendingStatus("Inventory pending", "No devices found from current source. Future device/host inventory source pending."),
    },
  };
}

function assembleOverview(
  accounts: RadarAccount[],
  warnings: RadarWarning[],
  runs: RadarRun[],
  devices: RadarDevice[],
  errors: string[],
  sourceStatus?: RadarSummary["sourceStatus"],
): RadarOverview {
  const enrichedAccounts = enrichAccountsWithWarnings(accounts, warnings);
  const serverCheckItems = buildServerCheckItems(enrichedAccounts, warnings);
  const riskAccountIds = new Set(serverCheckItems.map((item) => item.accountId).filter((id): id is string => Boolean(id)));
  const riskAccounts = enrichedAccounts.filter((account) => riskAccountIds.has(account.accountId) || account.healthStatus === "monitor" || account.healthStatus === "problem");
  const accountBreakdown = buildAccountBreakdown(enrichedAccounts, riskAccounts);
  const radarNotificationItems = buildRadarNotificationItems(riskAccounts, warnings);
  const serverCheckNotificationItems = buildServerCheckNotificationItems(serverCheckItems);

  return {
    summary: buildSummary(enrichedAccounts, warnings, runs, devices, riskAccounts.length, serverCheckItems.length, sourceStatus),
    accounts: enrichedAccounts,
    accountBreakdown,
    riskAccounts,
    warnings,
    runs,
    devices,
    serverCheckItems,
    notificationSummary: buildNotificationSummary(radarNotificationItems, serverCheckNotificationItems),
    notificationItems: {
      radar: radarNotificationItems,
      serverCheck: serverCheckNotificationItems,
    },
    errors,
  };
}

export async function getRadarDataFromLegacyTables(): Promise<RadarOverview> {
  const legacy = await readLegacyTables();
  const accounts = mapLegacyAccounts(legacy.accounts);
  const warnings = mapLegacyWarnings(legacy.logs, accounts);
  const runs = mapLegacyRuns(legacy.runs, accounts);
  const devices = mapLegacyDevices(legacy.devices, accounts);

  return assembleOverview(accounts, warnings, runs, devices, legacy.errors);
}

export async function getRadarDataFromAdminDashboardApi(): Promise<RadarOverview> {
  const config = adminDashboardConfig();
  if (!config) {
    throw new RadarApiError("Backend API not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), adminDashboardTimeoutMs);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "radar_overview",
        limit: 200,
        offset: 0,
        search: null,
        status: null,
        health: null,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RadarApiError(`Backend API returned ${response.status}`);
    }

    const payload = (await response.json()) as AdminDashboardRadarResponse;

    if (payload.ok !== true || payload.action !== "radar_overview" || !Array.isArray(payload.items)) {
      throw new RadarApiError("Backend API returned invalid radar_overview shape");
    }

    const items = payload.items.filter((item): item is SupabaseRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    const accounts = mapAdminDashboardAccounts(items);
    const warnings = mapAdminDashboardWarnings(accounts);

    // TODO: Map account_incidents/runtime_events into RadarWarning when backend exposes them.
    // TODO: Map run rows, queued source, device/host inventory, Source Quality/FBR, and special care detail fields when radar_overview adds them.
    return assembleOverview(accounts, warnings, [], [], [], adminDashboardSourceStatus());
  } catch (error) {
    if (error instanceof RadarApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new RadarApiError("Backend API timeout");
    }
    throw new RadarApiError("Backend API request failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRadarData() {
  if (!adminDashboardConfig()) {
    const fallback = await getRadarDataFromLegacyTables();
    return legacySourceStatusWithBackend(backendApiNotConfiguredStatus, fallback);
  }

  try {
    return await getRadarDataFromAdminDashboardApi();
  } catch {
    const fallback = await getRadarDataFromLegacyTables();
    return legacySourceStatusWithBackend(backendApiFallbackStatus, {
      ...fallback,
      errors: ["Backend API unavailable; using legacy fallback.", ...fallback.errors],
    });
  }
}
