import { createSupabaseClient } from "@/lib/supabase";
import { getAccountPackageSummaries } from "./package-summary-data";

type SupabaseRecord = Record<string, unknown>;

export type ManageSourceStatusCode = "connected" | "legacy_ready" | "pending" | "unknown";

export type ManageSourceStatus = {
  status: ManageSourceStatusCode;
  label: string;
  description: string;
};

export type ManageAccount = {
  accountId: string;
  clientId: string | null;
  clientName: string | null;
  username: string;
  emailDisplay: string;
  adminStatus: string;
  customerStatus: string;
  subscriptionStatus: string;
  packageLabel: string;
  commercialAddonsLabel: string;
  outreachSourceLabel: string;
  runtimeProfilesLabel: string;
  entitlementSummary: string;
  credentialsConfigured: boolean | null;
  credentialsStatus: string;
  reauthRequired: boolean;
  loginStatus: string;
  provisioningStatus: string;
  onboardingStatus: string;
  passwordDisplay: string;
  twoFactorDisplay: string;
  last7dGrowth: number | null;
  createdAt: string | null;
  tags: string[];
  invoiceStatus: string;
  pendingActionsCount: number;
  blockingCampaign: boolean;
  latestIncidentSeverity: string;
  lastSafeUpdate: string | null;
  phoneName: string;
  macHostName: string;
  profileImageUrl?: string | null;
  profileImageSource?: string | null;
  instagramVerificationStatus?: string | null;
  instagramCanonicalUsername?: string | null;
  usernameVerificationReason?: string | null;
  sourceLabel: string;
  archivedAt: string | null;
  trashedAt: string | null;
  scheduledTrashAt: string | null;
  scheduledDeleteAt: string | null;
};

export type ManageSummary = {
  activeAccounts: number;
  needsAttentionCount: number;
  credentialsAttentionCount: number | null;
  automationHealthSummary: string;
  archiveCount: number;
  trashCount: number;
  sourceStatus: {
    backendApi: ManageSourceStatus;
    accounts: ManageSourceStatus;
    credentials: ManageSourceStatus;
    automation: ManageSourceStatus;
  };
};

export type ManageOverview = {
  summary: ManageSummary;
  activeAccounts: ManageAccount[];
  archivedAccounts: ManageAccount[];
  trashedAccounts: ManageAccount[];
  allAccounts: ManageAccount[];
  errors: string[];
};

export type ManageKpi = {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "warning" | "danger";
};

type AdminDashboardManageResponse = {
  ok?: unknown;
  action?: unknown;
  count?: unknown;
  items?: unknown;
};

const unknownPhone = "Unknown phone";
const localMac = "Local Mac";
const emptyMarker = "—";
const legacyAccountsSource = "legacy ig_accounts";
const adminDashboardSource = "admin-dashboard manage_overview";
const adminDashboardTimeoutMs = 9000;
const packagePending = "Package pending";
const noCommercialAddons = "No add-ons";
const outreachPending = "pending_source_classification";
const runtimeProfilePending = "Runtime profile pending";

class ManageApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManageApiError";
  }
}

const backendApiNotConfiguredStatus: ManageSourceStatus = {
  status: "pending",
  label: "Backend API not configured",
  description: "ADMIN_DASHBOARD_API_URL or ADMIN_DASHBOARD_INTERNAL_API_TOKEN is missing. Using legacy fallback.",
};

const backendApiFallbackStatus: ManageSourceStatus = {
  status: "pending",
  label: "Backend API failed, using legacy fallback",
  description: "admin-dashboard/manage_overview was unavailable or returned an invalid response. Using legacy fallback.",
};

const backendApiReadyStatus: ManageSourceStatus = {
  status: "connected",
  label: "Backend API ready",
  description: "Current Manage data comes from admin-dashboard/manage_overview.",
};

function connectedStatus(label: string, description: string): ManageSourceStatus {
  return { status: "connected", label, description };
}

function legacyReadyStatus(label: string, description: string): ManageSourceStatus {
  return { status: "legacy_ready", label, description };
}

function unknownStatus(label: string, description: string): ManageSourceStatus {
  return { status: "unknown", label, description };
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

function readOptionalString(row: SupabaseRecord | undefined, keys: string[]) {
  const value = readString(row, keys, "");
  return value || null;
}

function readStringList(row: SupabaseRecord | undefined, keys: string[], fallback = "unknown") {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      const items = value.map((item) => readString({ item }, ["item"], "")).filter(Boolean);
      if (items.length) return items.join(", ");
    }
    const text = readString(row, [key], "");
    if (text) return text;
  }
  return fallback;
}

function safeProfileImageUrlFromRow(row: SupabaseRecord | undefined) {
  const rawUrl = readString(row, ["avatar_url", "profile_image_url", "profile_picture_url", "instagram_profile_picture_url"], "");
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const unsafeText = `${url.search} ${url.hash}`.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (["token", "secret", "signature", "x-amz", "authorization", "service_role"].some((term) => unsafeText.includes(term))) return null;
    return url.toString();
  } catch {
    return null;
  }
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

function readNullableNumber(row: SupabaseRecord | undefined, keys: string[]) {
  if (!row) return null;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function readBoolean(row: SupabaseRecord | undefined, keys: string[], fallback = false) {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = normalize(value);
      if (["true", "yes", "1", "enabled", "configured", "required", "blocking"].includes(normalized)) return true;
      if (["false", "no", "0", "disabled", "missing", "unknown"].includes(normalized)) return false;
    }
  }

  return fallback;
}

function readNullableBoolean(row: SupabaseRecord | undefined, keys: string[]) {
  if (!row) return null;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = normalize(value);
      if (["true", "yes", "1", "enabled", "configured"].includes(normalized)) return true;
      if (["false", "no", "0", "disabled", "missing", "unknown"].includes(normalized)) return false;
    }
  }

  return null;
}

function readIso(row: SupabaseRecord | undefined, keys: string[]) {
  const value = readString(row, keys, "");
  return value || null;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function keyForAccount(row: SupabaseRecord | undefined) {
  if (!row) return "";
  return readString(row, ["account_id", "ig_account_id", "instagram_account_id", "id"], "");
}

function safeEmailDisplay(row: SupabaseRecord | undefined) {
  const explicitDisplay = readString(row, ["email_display"], "");
  if (explicitDisplay) return explicitDisplay;

  const email = readString(row, ["email", "account_email"], "");
  if (!email) return "unknown";
  const [name, domain] = email.split("@");
  if (!name || !domain) return "configured";
  return `${name.slice(0, 2)}***@${domain}`;
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

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    .map(String)
    .filter(Boolean)
    .slice(0, 8);
}

function isAttentionStatus(value: string) {
  const normalized = normalize(value);
  return ["error", "fail", "failed", "blocked", "checkpoint", "challenge", "paused", "pending", "problem", "review", "warning", "reauth", "missing"].some((term) => normalized.includes(term));
}

function isCredentialIssue(account: ManageAccount) {
  return account.reauthRequired || isAttentionStatus(`${account.credentialsStatus} ${account.loginStatus} ${account.passwordDisplay} ${account.twoFactorDisplay}`);
}

function lifecycleStatus(account: ManageAccount) {
  const status = normalize(account.adminStatus);
  if (status === "archived" || account.archivedAt) return "archived";
  if (status === "trashed" || status === "trash" || account.trashedAt) return "trashed";
  return "active";
}

function sourceStatusWithBackend(backendApi: ManageSourceStatus, overview: ManageOverview): ManageOverview {
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

async function enrichWithPublicProfileMetadata(overview: ManageOverview): Promise<ManageOverview> {
  const accountIds = overview.allAccounts.map((account) => account.accountId).filter(Boolean);
  if (!accountIds.length) return overview;

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("ig_accounts")
      .select("id,username,username_verification_status,username_verification_reason,avatar_url")
      .in("id", accountIds);

    if (error || !Array.isArray(data)) {
      return { ...overview, errors: ["Public profile metadata unavailable.", ...overview.errors] };
    }

    const metadataById = new Map((data as SupabaseRecord[]).map((row) => [readString(row, ["id"], ""), row]));
    const enrich = (account: ManageAccount): ManageAccount => {
      const row = metadataById.get(account.accountId);
      if (!row) return account;
      const profileImageUrl = safeProfileImageUrlFromRow(row);
      return {
        ...account,
        profileImageUrl,
        profileImageSource: profileImageUrl ? "ig_accounts" : account.profileImageSource ?? "pending",
        instagramVerificationStatus: readOptionalString(row, ["username_verification_status"]) ?? account.instagramVerificationStatus ?? "pending",
        instagramCanonicalUsername: readOptionalString(row, ["username"]) ?? account.instagramCanonicalUsername ?? account.username,
        usernameVerificationReason: readOptionalString(row, ["username_verification_reason"]) ?? account.usernameVerificationReason ?? null,
      };
    };

    const activeAccounts = overview.activeAccounts.map(enrich);
    const archivedAccounts = overview.archivedAccounts.map(enrich);
    const trashedAccounts = overview.trashedAccounts.map(enrich);
    return {
      ...overview,
      activeAccounts,
      archivedAccounts,
      trashedAccounts,
      allAccounts: [...activeAccounts, ...archivedAccounts, ...trashedAccounts],
    };
  } catch {
    return { ...overview, errors: ["Public profile metadata unavailable.", ...overview.errors] };
  }
}

async function enrichWithCommercialPackageSummaries(overview: ManageOverview): Promise<ManageOverview> {
  const accountIds = overview.allAccounts.map((account) => account.accountId).filter(Boolean);
  if (!accountIds.length) return overview;

  try {
    const summaryByAccount = await getAccountPackageSummaries(accountIds);
    const enrich = (account: ManageAccount): ManageAccount => {
      const summary = summaryByAccount.get(account.accountId);
      if (!summary) {
        return {
          ...account,
          packageLabel: packagePending,
          commercialAddonsLabel: noCommercialAddons,
          outreachSourceLabel: outreachPending,
          runtimeProfilesLabel: runtimeProfilePending,
        };
      }
      return {
        ...account,
        packageLabel: summary.commercialPackageLabel,
        commercialAddonsLabel: summary.commercialAddonsLabel,
        outreachSourceLabel: summary.outreachSourceLabel,
        runtimeProfilesLabel: summary.runtimeProfilesLabel,
        entitlementSummary: summary.entitlementSummary === "unknown" ? account.entitlementSummary : summary.entitlementSummary,
      };
    };

    const activeAccounts = overview.activeAccounts.map(enrich);
    const archivedAccounts = overview.archivedAccounts.map(enrich);
    const trashedAccounts = overview.trashedAccounts.map(enrich);
    return {
      ...overview,
      activeAccounts,
      archivedAccounts,
      trashedAccounts,
      allAccounts: [...activeAccounts, ...archivedAccounts, ...trashedAccounts],
    };
  } catch {
    return {
      ...overview,
      errors: ["Commercial package summary unavailable.", ...overview.errors],
    };
  }
}

function adminDashboardConfig() {
  const url = process.env.ADMIN_DASHBOARD_API_URL?.trim();
  const token = process.env.ADMIN_DASHBOARD_INTERNAL_API_TOKEN?.trim();

  if (!url || !token) return null;
  return { url, token };
}

function latestRunForAccount(runs: SupabaseRecord[], accountId: string) {
  return runs
    .filter((run) => keyForAccount(run) === accountId)
    .sort((a, b) => {
      const aDate = new Date(readString(a, ["started_at", "created_at", "updated_at"], "")).getTime();
      const bDate = new Date(readString(b, ["started_at", "created_at", "updated_at"], "")).getTime();
      return (Number.isFinite(bDate) ? bDate : 0) - (Number.isFinite(aDate) ? aDate : 0);
    })[0];
}

function mapLegacyAccount(account: SupabaseRecord, settings: SupabaseRecord[], runs: SupabaseRecord[], targets: SupabaseRecord[]): ManageAccount {
  const accountId = readString(account, ["id"], "");
  const accountSettings = settings.find((setting) => keyForAccount(setting) === accountId);
  const target = targets.find((item) => keyForAccount(item) === accountId);
  const latestRun = latestRunForAccount(runs, accountId);
  const adminStatus = readString(account, ["status", "state"], "active");
  const loginStatus = readString(account, ["login_status"], readString(accountSettings, ["login_status"], "unknown"));
  const credentialsStatus = readString(account, ["credentials_status", "credential_status"], readString(accountSettings, ["credentials_status", "credential_status"], "unknown"));
  const latestRunStatus = readString(latestRun, ["status", "run_status", "state"], "unknown");
  const pendingActionsCount = isAttentionStatus(`${adminStatus} ${latestRunStatus} ${loginStatus} ${credentialsStatus}`) ? 1 : 0;
  void target;

  return {
    accountId,
    clientId: null,
    clientName: readString(account, ["display_name", "name", "full_name"], "") || null,
    username: readString(account, ["username", "ig_username", "handle"], "Unknown"),
    emailDisplay: safeEmailDisplay(account),
    adminStatus,
    customerStatus: "unknown",
    subscriptionStatus: "unknown",
    packageLabel: packagePending,
    commercialAddonsLabel: noCommercialAddons,
    outreachSourceLabel: outreachPending,
    runtimeProfilesLabel: runtimeProfilePending,
    entitlementSummary: "Legacy source",
    credentialsConfigured: credentialsStatus === "configured" ? true : null,
    credentialsStatus,
    reauthRequired: isAttentionStatus(`${loginStatus} ${credentialsStatus}`),
    loginStatus,
    provisioningStatus: "unknown",
    onboardingStatus: "unknown",
    passwordDisplay: safeDisplayStatus(readString(account, ["password_display"], readString(accountSettings, ["password_display"], ""))),
    twoFactorDisplay: safeDisplayStatus(readString(account, ["two_factor_display"], readString(accountSettings, ["two_factor_display"], ""))),
    last7dGrowth: null,
    createdAt: readIso(account, ["created_at", "inserted_at"]),
    tags: [],
    invoiceStatus: "unknown",
    pendingActionsCount,
    blockingCampaign: isAttentionStatus(latestRunStatus),
    latestIncidentSeverity: isAttentionStatus(`${adminStatus} ${latestRunStatus}`) ? "warning" : "unknown",
    lastSafeUpdate: readIso(account, ["last_safe_update", "last_seen_at", "updated_at", "created_at"]),
    phoneName: readString(account, ["device_name", "device", "phone_name"], readString(accountSettings, ["device_name", "device", "phone_name"], unknownPhone)),
    macHostName: readString(account, ["host_name", "mac_host", "mac_name", "server_name", "worker_host"], localMac),
    profileImageUrl: safeProfileImageUrlFromRow(account),
    profileImageSource: safeProfileImageUrlFromRow(account) ? "ig_accounts" : "pending",
    instagramVerificationStatus: readOptionalString(account, ["username_verification_status", "instagram_verification_status", "verification_status"]) ?? "pending",
    instagramCanonicalUsername: readOptionalString(account, ["username", "instagram_canonical_username", "canonical_username"]),
    usernameVerificationReason: readOptionalString(account, ["username_verification_reason"]),
    sourceLabel: legacyAccountsSource,
    archivedAt: readIso(account, ["archived_at"]),
    trashedAt: readIso(account, ["trashed_at"]),
    scheduledTrashAt: readIso(account, ["scheduled_trash_at"]),
    scheduledDeleteAt: readIso(account, ["scheduled_delete_at"]),
  };
}

function mapAdminDashboardAccount(row: SupabaseRecord): ManageAccount {
  const passwordDisplay = safeDisplayStatus(readString(row, ["password_display"], ""));
  const twoFactorDisplay = safeDisplayStatus(readString(row, ["two_factor_display"], ""));
  const credentialsStatus = safeDisplayStatus(readString(row, ["credentials_status"], ""));
  const reauthRequired = readBoolean(row, ["reauth_required"], false);

  return {
    accountId: readString(row, ["account_id", "id"], ""),
    clientId: readString(row, ["client_id"], "") || null,
    clientName: readString(row, ["client_name"], "") || null,
    username: readString(row, ["username", "ig_username", "handle"], "Unknown"),
    emailDisplay: safeEmailDisplay(row),
    adminStatus: readString(row, ["admin_status"], "unknown"),
    customerStatus: readString(row, ["customer_status"], "unknown"),
    subscriptionStatus: readString(row, ["subscription_status"], "unknown"),
    packageLabel: packagePending,
    commercialAddonsLabel: noCommercialAddons,
    outreachSourceLabel: outreachPending,
    runtimeProfilesLabel: readString(row, ["runtime_profiles", "runtime_profile"], runtimeProfilePending),
    entitlementSummary: readStringList(row, ["entitlement_summary"], "unknown"),
    credentialsConfigured: readNullableBoolean(row, ["credentials_configured"]),
    credentialsStatus,
    reauthRequired,
    loginStatus: readString(row, ["login_status"], "unknown"),
    provisioningStatus: readString(row, ["provisioning_status"], "unknown"),
    onboardingStatus: readString(row, ["onboarding_status"], "unknown"),
    passwordDisplay,
    twoFactorDisplay,
    last7dGrowth: readNullableNumber(row, ["last_7d_growth"]),
    createdAt: readIso(row, ["created_at"]),
    tags: readTags(row.tags),
    invoiceStatus: readString(row, ["invoice_status"], "unknown"),
    pendingActionsCount: readNumber(row, ["pending_actions_count"], 0),
    blockingCampaign: readBoolean(row, ["blocking_campaign"], false),
    latestIncidentSeverity: readString(row, ["latest_incident_severity"], "unknown"),
    lastSafeUpdate: readIso(row, ["last_safe_update"]),
    phoneName: readString(row, ["phone_name", "device_name"], unknownPhone),
    macHostName: readString(row, ["mac_host_name", "host_name", "mac_host"], localMac),
    profileImageUrl: safeProfileImageUrlFromRow(row),
    profileImageSource: safeProfileImageUrlFromRow(row) ? "admin-dashboard" : "pending",
    instagramVerificationStatus: readOptionalString(row, ["username_verification_status", "instagram_verification_status", "verification_status"]) ?? "pending",
    instagramCanonicalUsername: readOptionalString(row, ["instagram_canonical_username", "canonical_username", "username"]),
    usernameVerificationReason: readOptionalString(row, ["username_verification_reason"]),
    sourceLabel: adminDashboardSource,
    archivedAt: readIso(row, ["archived_at"]),
    trashedAt: readIso(row, ["trashed_at"]),
    scheduledTrashAt: readIso(row, ["scheduled_trash_at"]),
    scheduledDeleteAt: readIso(row, ["scheduled_delete_at"]),
  };
}

function buildSummary(accounts: ManageAccount[], sourceStatus: ManageSummary["sourceStatus"]): ManageSummary {
  const activeAccounts = accounts.filter((account) => lifecycleStatus(account) === "active");
  const archivedAccounts = accounts.filter((account) => lifecycleStatus(account) === "archived");
  const trashedAccounts = accounts.filter((account) => lifecycleStatus(account) === "trashed");
  const needsAttention = activeAccounts.filter((account) => account.pendingActionsCount > 0 || account.blockingCampaign || isAttentionStatus(`${account.adminStatus} ${account.loginStatus} ${account.credentialsStatus} ${account.latestIncidentSeverity}`));
  const credentialIssues = activeAccounts.filter(isCredentialIssue);
  const automationIssues = activeAccounts.filter((account) => account.blockingCampaign || isAttentionStatus(`${account.adminStatus} ${account.provisioningStatus} ${account.onboardingStatus} ${account.latestIncidentSeverity}`));

  return {
    activeAccounts: activeAccounts.length,
    needsAttentionCount: needsAttention.length,
    credentialsAttentionCount: credentialIssues.length,
    automationHealthSummary: automationIssues.length ? `${formatInteger(automationIssues.length)} attention` : "OK",
    archiveCount: archivedAccounts.length,
    trashCount: trashedAccounts.length,
    sourceStatus,
  };
}

function assembleOverview(accounts: ManageAccount[], errors: string[], sourceStatus: ManageSummary["sourceStatus"]): ManageOverview {
  const activeAccounts = accounts.filter((account) => lifecycleStatus(account) === "active");
  const archivedAccounts = accounts.filter((account) => lifecycleStatus(account) === "archived");
  const trashedAccounts = accounts.filter((account) => lifecycleStatus(account) === "trashed");

  return {
    summary: buildSummary(accounts, sourceStatus),
    activeAccounts,
    archivedAccounts,
    trashedAccounts,
    allAccounts: accounts,
    errors,
  };
}

function legacySourceStatus(accounts: ManageAccount[]): ManageSummary["sourceStatus"] {
  const accountStatus = accounts.length
    ? legacyReadyStatus("Legacy DB ready", "Manage account data comes from legacy ig_accounts with ig_account_settings and ig_runs helpers.")
    : unknownStatus("Pending source", "No account rows found from legacy ig_accounts.");

  return {
    backendApi: backendApiNotConfiguredStatus,
    accounts: accountStatus,
    credentials: accountStatus,
    automation: accountStatus,
  };
}

function adminSourceStatus(): ManageSummary["sourceStatus"] {
  return {
    backendApi: backendApiReadyStatus,
    accounts: connectedStatus("Admin API", "Account management data comes from admin-dashboard/manage_overview."),
    credentials: connectedStatus("Admin API", "Credential status uses safe display fields from admin-dashboard/manage_overview."),
    automation: connectedStatus("Admin API", "Automation health uses pending actions, campaign blocking, provisioning, onboarding, and incident severity from manage_overview."),
  };
}

export function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

export function formatDateTime(value: string | null) {
  if (!value) return emptyMarker;
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
  const normalized = status.toLowerCase();
  if (normalized.includes("archived")) return "#93C5FD";
  if (normalized.includes("trashed")) return "#FCA5A5";
  if (normalized.includes("active") || normalized.includes("success") || normalized.includes("completed") || normalized === "ok") return "#34D399";
  if (normalized.includes("paused") || normalized.includes("pending") || normalized.includes("running") || normalized.includes("review")) return "#FBBF24";
  if (normalized.includes("error") || normalized.includes("fail") || normalized.includes("blocked") || normalized.includes("problem") || normalized.includes("checkpoint")) return "#F87171";
  return "rgba(255,255,255,0.66)";
}

export function manageKpiTone(kpi: ManageKpi) {
  if (kpi.tone === "good") return "#34D399";
  if (kpi.tone === "warning") return "#FBBF24";
  if (kpi.tone === "danger") return "#F87171";
  return "#f0f0ef";
}

function kpiSourceDetail(source: ManageSourceStatus, fallback: string) {
  if (source.label === "Admin API") return fallback;
  return source.label;
}

export function buildManageKpis(data: ManageOverview): ManageKpi[] {
  const credentialsValue = data.summary.credentialsAttentionCount === null ? "pending source" : formatInteger(data.summary.credentialsAttentionCount);

  return [
    {
      label: "Active accounts",
      value: formatInteger(data.summary.activeAccounts),
      detail: kpiSourceDetail(data.summary.sourceStatus.accounts, "Connected"),
      tone: "neutral",
    },
    {
      label: "Needs attention",
      value: formatInteger(data.summary.needsAttentionCount),
      detail: data.summary.needsAttentionCount ? "Pending action, blocked, credentials, or incident signals" : kpiSourceDetail(data.summary.sourceStatus.accounts, "Connected"),
      tone: data.summary.needsAttentionCount ? "warning" : "good",
    },
    {
      label: "Credentials / Reauth",
      value: credentialsValue,
      detail: kpiSourceDetail(data.summary.sourceStatus.credentials, "Credential status connected"),
      tone: data.summary.credentialsAttentionCount ? "danger" : data.summary.credentialsAttentionCount === null ? "warning" : "good",
    },
    {
      label: "Automation health",
      value: data.summary.automationHealthSummary,
      detail: kpiSourceDetail(data.summary.sourceStatus.automation, "Automation signals connected"),
      tone: data.summary.automationHealthSummary === "OK" ? "good" : "warning",
    },
  ];
}

export async function getManageDataFromLegacyTables(): Promise<ManageOverview> {
  const supabase = createSupabaseClient();
  const [accountsResult, settingsResult, runsResult, targetsResult] = await Promise.all([
    supabase.from("ig_accounts").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("ig_account_settings").select("*").limit(500),
    supabase.from("ig_runs").select("*").order("created_at", { ascending: false }).limit(250),
    supabase.from("ig_targets").select("*").limit(500),
  ]);

  const accounts = (accountsResult.data ?? []) as SupabaseRecord[];
  const settings = (settingsResult.data ?? []) as SupabaseRecord[];
  const runs = (runsResult.data ?? []) as SupabaseRecord[];
  const targets = (targetsResult.data ?? []) as SupabaseRecord[];
  const errors = [accountsResult.error, settingsResult.error, runsResult.error, targetsResult.error]
    .map((error) => error?.message)
    .filter((message): message is string => Boolean(message));

  const mappedAccounts = accounts.map((account) => mapLegacyAccount(account, settings, runs, targets));
  return assembleOverview(mappedAccounts, errors, legacySourceStatus(mappedAccounts));
}

export async function getManageDataFromAdminDashboardApi(): Promise<ManageOverview> {
  const config = adminDashboardConfig();
  if (!config) {
    throw new ManageApiError("Backend API not configured");
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
        action: "manage_overview",
        limit: 200,
        offset: 0,
        search: null,
        status: null,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ManageApiError(`Backend API returned ${response.status}`);
    }

    const payload = (await response.json()) as AdminDashboardManageResponse;

    if (payload.ok !== true || payload.action !== "manage_overview" || !Array.isArray(payload.items)) {
      throw new ManageApiError("Backend API returned invalid manage_overview shape");
    }

    const items = payload.items.filter((item): item is SupabaseRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    return assembleOverview(items.map(mapAdminDashboardAccount), [], adminSourceStatus());
  } catch (error) {
    if (error instanceof ManageApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ManageApiError("Backend API timeout");
    }
    throw new ManageApiError("Backend API request failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getManageData() {
  let overview: ManageOverview;
  if (!adminDashboardConfig()) {
    const fallback = await getManageDataFromLegacyTables();
    overview = sourceStatusWithBackend(backendApiNotConfiguredStatus, fallback);
    return await enrichWithCommercialPackageSummaries(await enrichWithPublicProfileMetadata(overview));
  }

  try {
    overview = await getManageDataFromAdminDashboardApi();
  } catch {
    const fallback = await getManageDataFromLegacyTables();
    overview = sourceStatusWithBackend(backendApiFallbackStatus, {
      ...fallback,
      errors: ["Backend API unavailable; using legacy fallback.", ...fallback.errors],
    });
  }
  return await enrichWithCommercialPackageSummaries(await enrichWithPublicProfileMetadata(overview));
}
