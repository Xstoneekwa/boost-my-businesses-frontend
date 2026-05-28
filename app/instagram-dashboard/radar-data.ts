import { createSupabaseClient } from "@/lib/supabase";

type SupabaseRecord = Record<string, unknown>;

export type HealthStatus = "ok" | "monitor" | "problem" | "unknown";
export type WarningSeverity = "info" | "warning" | "error" | "critical" | "unknown";
export type RunStatus = "running" | "queued" | "completed" | "failed" | "stopped" | "unknown";
export type SourceStatus = "connected" | "pending" | "unknown";

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
  queuedSourceStatus: SourceStatus;
  runWarningsCount: number;
  accountsNeedingAttentionCount: number;
  sourceStatus: {
    accounts: SourceStatus;
    runs: SourceStatus;
    warnings: SourceStatus;
    devices: SourceStatus;
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

export type RadarOverview = {
  summary: RadarSummary;
  accounts: RadarAccount[];
  riskAccounts: RadarAccount[];
  warnings: RadarWarning[];
  runs: RadarRun[];
  devices: RadarDevice[];
  serverCheckItems: ServerCheckItem[];
  errors: string[];
};

export const unknownPhone = "Unknown phone";
export const unknownMac = "Unknown Mac";
export const localMac = "Local Mac";
export const pendingSourceLabel = "admin-dashboard radar_overview pending";
export const legacyAccountsSource = "legacy ig_accounts";
export const legacyRunsSource = "legacy ig_runs";
export const legacyWarningsSource = "legacy ig_action_logs";
export const legacyDevicesSource = "legacy ig_devices";

const riskTerms = ["error", "fail", "failed", "blocked", "checkpoint", "challenge", "suspended", "problem"];
const monitorTerms = ["paused", "review", "warning", "monitor", "pending"];
const runningTerms = ["running", "in_progress", "active"];
const queuedTerms = ["queued"];
const completedTerms = ["success", "completed", "done"];
const stoppedTerms = ["stopped", "cancelled", "canceled"];

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

function sourceStatus(rows: unknown[]): SourceStatus {
  return rows.length > 0 ? "connected" : "unknown";
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
      const id = accountId(row);
      const status = readString(row, ["status", "result"], "unknown");

      return {
        id: readString(row, ["id"], `legacy-warning-${index}`),
        accountId: id || linkedAccount?.accountId || null,
        username: username(row, linkedAccount?.username ?? "account unknown"),
        warningType: readString(row, ["action_type", "action", "event_type", "type"], "warning"),
        severity: severityFrom(`${status} ${readString(row, ["action_type", "action", "event_type", "type"], "")}`),
        message: readString(row, ["message", "error"], "Legacy warning without message"),
        sourceLabel: readString(row, ["worker_type", "source"], legacyWarningsSource),
        runId: readString(row, ["run_id", "ig_run_id"], "") || null,
        timestamp: readIso(row, ["created_at", "updated_at"]),
        phoneName: phoneName(row, linkedAccount?.phoneName ?? unknownPhone),
        macHostName: macHostName(row, linkedAccount?.macHostName ?? localMac),
        isLinkedToAccount: Boolean(id || linkedAccount),
      };
    });
}

function mapLegacyDevices(rows: SupabaseRecord[], accounts: RadarAccount[]): RadarDevice[] {
  return rows.map((row) => {
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

  return [...items.values()];
}

function buildSummary(accounts: RadarAccount[], warnings: RadarWarning[], runs: RadarRun[], devices: RadarDevice[]): RadarSummary {
  const queuedCount = runs.some((run) => run.status === "queued") ? runs.filter((run) => run.status === "queued").length : null;

  return {
    totalAccounts: accounts.length,
    okCount: accounts.filter((account) => account.healthStatus === "ok").length,
    monitorCount: accounts.filter((account) => account.healthStatus === "monitor").length,
    problemCount: accounts.filter((account) => account.healthStatus === "problem").length,
    riskAccountsCount: accounts.filter((account) => account.healthStatus === "monitor" || account.healthStatus === "problem").length,
    runningCount: runs.filter((run) => run.status === "running").length,
    queuedCount,
    queuedSourceStatus: queuedCount === null ? "pending" : "connected",
    runWarningsCount: warnings.length,
    accountsNeedingAttentionCount: buildServerCheckItems(accounts, warnings).length,
    sourceStatus: {
      accounts: sourceStatus(accounts),
      runs: sourceStatus(runs),
      warnings: sourceStatus(warnings),
      devices: devices.length > 0 ? "connected" : "pending",
    },
  };
}

function assembleOverview(accounts: RadarAccount[], warnings: RadarWarning[], runs: RadarRun[], devices: RadarDevice[], errors: string[]): RadarOverview {
  const serverCheckItems = buildServerCheckItems(accounts, warnings);
  const riskAccountIds = new Set(serverCheckItems.map((item) => item.accountId).filter((id): id is string => Boolean(id)));

  return {
    summary: buildSummary(accounts, warnings, runs, devices),
    accounts,
    riskAccounts: accounts.filter((account) => riskAccountIds.has(account.accountId) || account.healthStatus === "monitor" || account.healthStatus === "problem"),
    warnings,
    runs,
    devices,
    serverCheckItems,
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
  // TODO: Future: replace legacy table reads with admin-dashboard radar_overview response.
  // TODO: Map account_incidents/runtime_events into RadarWarning once backend sources are live.
  // TODO: Map device/host inventory, queued source, Source Quality/FBR, and special care signals here.
  return {
    summary: {
      totalAccounts: 0,
      okCount: 0,
      monitorCount: 0,
      problemCount: 0,
      riskAccountsCount: 0,
      runningCount: 0,
      queuedCount: null,
      queuedSourceStatus: "pending",
      runWarningsCount: 0,
      accountsNeedingAttentionCount: 0,
      sourceStatus: {
        accounts: "pending",
        runs: "pending",
        warnings: "pending",
        devices: "pending",
      },
    },
    accounts: [],
    riskAccounts: [],
    warnings: [],
    runs: [],
    devices: [],
    serverCheckItems: [],
    errors: [pendingSourceLabel],
  };
}

export async function getRadarData() {
  return getRadarDataFromLegacyTables();
}
