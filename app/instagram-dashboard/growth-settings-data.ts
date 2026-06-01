import { createSupabaseClient } from "@/lib/supabase";
import { getManageData, type ManageAccount } from "./manage-data";

type SafeRecord = Record<string, unknown>;

export type GrowthCategory = "package" | "follow" | "unfollow" | "dm" | "welcome" | "schedule" | "safety" | "filters" | "sources" | "runtime";
export type GrowthRuntimeStatus = "verified" | "unverified" | "pending" | "unknown";
export type GrowthClientVisibility = "client_safe" | "admin_only" | "ops_only" | "pending_review";
export type GrowthSourceStatusCode = "connected" | "legacy_safe_projection" | "pending" | "unknown";

export type GrowthSettingsAccount = {
  accountId: string;
  username: string;
  clientName: string | null;
  packageLabel: string | null;
  commercialAddonsLabel: string | null;
  outreachSourceLabel: string | null;
  runtimeProfilesLabel: string | null;
  entitlementSummary: string | null;
  subscriptionStatus: string | null;
  customerStatus: string | null;
  sourceLabel: string;
  accountDetailHref: string;
  editSettingsLabel: string;
};

export type GrowthSettingItem = {
  key: string;
  label: string;
  valueLabel: string;
  category: GrowthCategory;
  runtimeStatus: GrowthRuntimeStatus;
  clientVisibility: GrowthClientVisibility;
  sourceLabel: string;
  warning: string | null;
};

export type GrowthLimitGroup = {
  groupKey: string;
  title: string;
  description: string;
  items: GrowthSettingItem[];
};

export type GrowthPackageSummary = {
  packageLabel: string;
  commercialAddonsLabel: string;
  outreachSourceLabel: string;
  runtimeProfilesLabel: string;
  entitlementSummary: string;
  subscriptionStatus: string;
  runtimeProofStatus: GrowthRuntimeStatus;
  pricingReadyStatus: "ready" | "pending" | "unknown";
};

export type GrowthAccountOverview = {
  account: GrowthSettingsAccount;
  packageSummary: GrowthPackageSummary;
  groups: GrowthLimitGroup[];
  warningCount: number;
  runtimeProofStatus: GrowthRuntimeStatus;
  clientVisibilityStatus: GrowthClientVisibility;
};

export type GrowthSettingsSummary = {
  accountsCount: number;
  clientSafeReadyCount: number;
  adminOnlyCount: number;
  opsOnlyCount: number;
  runtimeUnverifiedCount: number;
  pendingReviewCount: number;
};

export type GrowthSettingsSourceStatus = {
  manageOverview: GrowthSourceStatusCode;
  accountSettings: GrowthSourceStatusCode;
  filters: GrowthSourceStatusCode;
  packageModel: GrowthSourceStatusCode;
  runtimeProof: GrowthSourceStatusCode;
};

export type GrowthSourceDetail = {
  label: string;
  description: string;
};

export type GrowthSettingsOverview = {
  accounts: GrowthSettingsAccount[];
  groupsByAccount: GrowthAccountOverview[];
  summary: GrowthSettingsSummary;
  sourceStatus: GrowthSettingsSourceStatus;
  sourceDetails: Record<keyof GrowthSettingsSourceStatus, GrowthSourceDetail>;
  errors: string[];
};

const settingsSourceLabel = "ig_account_settings safe projection";
const filtersSourceLabel = "ig_account_filters safe projection";
const manageSourceLabel = "admin-dashboard/manage_overview";
const runtimeWarning = "Needs operator review before exposing outside admin views.";

const settingsSelect = [
  "account_id",
  "follow_enabled",
  "follow_limit",
  "total_follows_limit",
  "follow_percentage",
  "unfollow_enabled",
  "total_unfollows_limit",
  "unfollow_delay_days",
  "welcome_dm_enabled",
  "welcome_dm_message",
  "check_chat_before_welcoming",
  "cold_dm_enabled",
  "cold_dm_message",
  "max_dm_per_run",
  "max_consecutive_dms",
  "send_enabled",
  "safe_review_mode",
  "timeslot_start",
  "timeslot_end",
  "total_sessions",
  "pause_account_days",
  "randomize_start_enabled",
  "dry_run_enabled",
  "max_actions_per_hour",
  "max_actions_per_day",
  "end_if_follow_limit_reached",
  "end_if_dm_limit_reached",
  "end_if_likes_limit_reached",
  "source_accounts",
  "updated_at",
].join(", ");

const filtersSelect = [
  "account_id",
  "disable_filters",
  "skip_followers",
  "skip_following",
  "skip_business_profiles",
  "skip_non_business_profiles",
  "follow_private_profiles",
  "follow_only_private_profiles",
  "dm_private_profiles",
  "min_followers",
  "max_followers",
  "min_following",
  "max_following",
  "min_posts",
  "blacklisted_words",
  "mandatory_words",
  "whitelist_words",
  "blacklist_accounts",
].join(", ");

function readString(row: SafeRecord | undefined, key: string, fallback = "") {
  const value = row?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readNumber(row: SafeRecord | undefined, key: string, fallback = 0) {
  const value = row?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readBoolean(row: SafeRecord | undefined, key: string, fallback = false) {
  const value = row?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "enabled"].includes(normalized)) return true;
    if (["false", "no", "0", "disabled"].includes(normalized)) return false;
  }
  return fallback;
}

function boolLabel(value: boolean) {
  return value ? "Enabled" : "Disabled";
}

function countConfiguredText(value: string) {
  return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean).length;
}

function configuredLabel(value: string) {
  const count = countConfiguredText(value);
  if (!count) return "Not configured";
  return count === 1 ? "1 entry configured" : `${count} entries configured`;
}

function item(
  key: string,
  label: string,
  valueLabel: string,
  category: GrowthCategory,
  clientVisibility: GrowthClientVisibility,
  sourceLabel: string,
  runtimeStatus: GrowthRuntimeStatus = "unverified",
  warning: string | null = runtimeWarning,
): GrowthSettingItem {
  return { key, label, valueLabel, category, runtimeStatus, clientVisibility, sourceLabel, warning };
}

function packageItem(key: string, label: string, valueLabel: string): GrowthSettingItem {
  return item(key, label, valueLabel || "unknown", "package", "pending_review", manageSourceLabel, "pending", "Package setting needs operator review.");
}

function group(groupKey: string, title: string, description: string, items: GrowthSettingItem[]): GrowthLimitGroup {
  return { groupKey, title, description, items };
}

function mapAccount(account: ManageAccount): GrowthSettingsAccount {
  return {
    accountId: account.accountId,
    username: account.username,
    clientName: account.clientName,
    packageLabel: account.packageLabel,
    commercialAddonsLabel: account.commercialAddonsLabel,
    outreachSourceLabel: account.outreachSourceLabel,
    runtimeProfilesLabel: account.runtimeProfilesLabel,
    entitlementSummary: account.entitlementSummary,
    subscriptionStatus: account.subscriptionStatus,
    customerStatus: account.customerStatus,
    sourceLabel: account.sourceLabel,
    accountDetailHref: `/instagram-dashboard/accounts/${encodeURIComponent(account.accountId || account.username)}`,
    editSettingsLabel: "Edit in Settings",
  };
}

function buildGroups(account: ManageAccount, settings: SafeRecord | undefined, filters: SafeRecord | undefined): GrowthLimitGroup[] {
  const packageItems = [
    packageItem("package_label", "Package", account.packageLabel),
    packageItem("commercial_addons", "Add-ons", account.commercialAddonsLabel),
    packageItem("outreach_source", "Outreach source", account.outreachSourceLabel),
    packageItem("runtime_profiles", "Runtime profile", account.runtimeProfilesLabel),
    packageItem("entitlement_summary", "Entitlement", account.entitlementSummary),
    packageItem("subscription_status", "Subscription", account.subscriptionStatus),
    packageItem("customer_status", "Customer status", account.customerStatus),
  ];

  const followItems = [
    item("follow_enabled", "Follow automation", boolLabel(readBoolean(settings, "follow_enabled")), "follow", "pending_review", settingsSourceLabel),
    item("follow_limit", "Follow per session", String(readNumber(settings, "follow_limit")), "follow", "pending_review", settingsSourceLabel),
    item("total_follows_limit", "Daily/total follows", String(readNumber(settings, "total_follows_limit")), "follow", "pending_review", settingsSourceLabel),
    item("follow_percentage", "Follow percentage", `${readNumber(settings, "follow_percentage", 100)}%`, "follow", "admin_only", settingsSourceLabel),
  ];

  const unfollowItems = [
    item("unfollow_enabled", "Unfollow automation", boolLabel(readBoolean(settings, "unfollow_enabled")), "unfollow", "pending_review", settingsSourceLabel),
    item("total_unfollows_limit", "Unfollow limit", String(readNumber(settings, "total_unfollows_limit")), "unfollow", "pending_review", settingsSourceLabel),
    item("unfollow_delay_days", "Unfollow delay", `${readNumber(settings, "unfollow_delay_days", 7)} days`, "unfollow", "admin_only", settingsSourceLabel),
  ];

  const dmItems = [
    item("cold_dm_enabled", "Cold/outreach DM", boolLabel(readBoolean(settings, "cold_dm_enabled")), "dm", "pending_review", settingsSourceLabel),
    item("cold_dm_message", "Cold DM message", readString(settings, "cold_dm_message") ? "Configured" : "Missing", "dm", "pending_review", settingsSourceLabel),
    item("max_dm_per_run", "Max DMs per run", String(readNumber(settings, "max_dm_per_run", 2)), "dm", "pending_review", settingsSourceLabel),
    item("max_consecutive_dms", "Max consecutive DMs", String(readNumber(settings, "max_consecutive_dms", 3)), "dm", "admin_only", settingsSourceLabel),
    item("send_enabled", "Real send enabled", boolLabel(readBoolean(settings, "send_enabled")), "dm", "admin_only", settingsSourceLabel, "unverified", "Admin-only send control."),
  ];

  const welcomeItems = [
    item("welcome_dm_enabled", "Welcome DM", boolLabel(readBoolean(settings, "welcome_dm_enabled", true)), "welcome", "pending_review", settingsSourceLabel),
    item("welcome_dm_message", "Welcome message", readString(settings, "welcome_dm_message") ? "Configured" : "Missing", "welcome", "pending_review", settingsSourceLabel),
    item("check_chat_before_welcoming", "Check chat first", boolLabel(readBoolean(settings, "check_chat_before_welcoming", true)), "welcome", "admin_only", settingsSourceLabel),
  ];

  const scheduleItems = [
    item("timeslot_start", "Timeslot start", readString(settings, "timeslot_start", "09:00"), "schedule", "pending_review", settingsSourceLabel),
    item("timeslot_end", "Timeslot end", readString(settings, "timeslot_end", "18:00"), "schedule", "pending_review", settingsSourceLabel),
    item("total_sessions", "Sessions", String(readNumber(settings, "total_sessions", 1)), "schedule", "admin_only", settingsSourceLabel),
    item("pause_account_days", "Pause days", String(readNumber(settings, "pause_account_days")), "schedule", "admin_only", settingsSourceLabel),
    item("randomize_start_enabled", "Randomize start", boolLabel(readBoolean(settings, "randomize_start_enabled", true)), "schedule", "admin_only", settingsSourceLabel),
  ];

  const safetyItems = [
    item("dry_run_enabled", "Dry run", boolLabel(readBoolean(settings, "dry_run_enabled", true)), "safety", "admin_only", settingsSourceLabel, "unverified", "Admin-only safety control. Do not expose to client/pricing."),
    item("safe_review_mode", "Safe review mode", boolLabel(readBoolean(settings, "safe_review_mode", true)), "safety", "admin_only", settingsSourceLabel),
    item("max_actions_per_hour", "Max actions/hour", String(readNumber(settings, "max_actions_per_hour", 30)), "safety", "admin_only", settingsSourceLabel),
    item("max_actions_per_day", "Max actions/day", String(readNumber(settings, "max_actions_per_day", 120)), "safety", "admin_only", settingsSourceLabel),
    item("end_if_follow_limit_reached", "Stop at follow cap", boolLabel(readBoolean(settings, "end_if_follow_limit_reached", true)), "safety", "admin_only", settingsSourceLabel),
    item("end_if_dm_limit_reached", "Stop at DM cap", boolLabel(readBoolean(settings, "end_if_dm_limit_reached", true)), "safety", "admin_only", settingsSourceLabel),
    item("filters", "Follower filters", filters ? "Safe projection available" : "No filter source", "filters", "pending_review", filtersSourceLabel, "unverified"),
    item("min_followers", "Follower range", `${readNumber(filters, "min_followers", 1)} - ${readNumber(filters, "max_followers", 0) || "unknown"}`, "filters", "pending_review", filtersSourceLabel),
    item("word_filters", "Word/account filters", [
      configuredLabel(readString(filters, "blacklisted_words")),
      configuredLabel(readString(filters, "mandatory_words")),
      configuredLabel(readString(filters, "blacklist_accounts")),
    ].join(" / "), "filters", "admin_only", filtersSourceLabel),
  ];

  const sourceItems = [
    item("source_accounts", "Source accounts", configuredLabel(readString(settings, "source_accounts")), "sources", "pending_review", settingsSourceLabel),
    item("target_accounts", "Target accounts / CT", "Managed in Targets modal", "sources", "pending_review", "ig_targets / Targets modal", "pending", "Use CT quality/sync model for target management."),
  ];

  const runtimeItems = [
    item("runtime_proof", "Runtime review", "Needs review", "runtime", "pending_review", "runtime review", "pending", "Operator review required."),
    item("pricing_ready", "Package readiness", "Needs review", "runtime", "pending_review", "package review", "pending", "Package limits require operator review."),
    item("client_dashboard_subset", "Client dashboard subset", "Needs review", "runtime", "pending_review", "client dashboard review", "pending", "Restricted client-safe subset only."),
    item("ops_internals", "Ops-only internals", "Hidden", "runtime", "ops_only", "hidden by projection", "pending", "Sensitive internals are intentionally omitted."),
  ];

  return [
    group("package", "Package / entitlement", "Package labels and entitlement status.", packageItems),
    group("follow", "Follow limits", "Follow limits from the safe settings projection.", followItems),
    group("unfollow", "Unfollow limits", "Unfollow limits from the safe settings projection.", unfollowItems),
    group("dm", "DM / outreach limits", "DM limits and send controls from safe settings projection.", dmItems),
    group("welcome", "Welcome DM limits", "Welcome DM status without rendering raw settings payloads.", welcomeItems),
    group("schedule", "Schedule / timeslot", "Schedule fields are shown as settings, not pricing promises.", scheduleItems),
    group("safety", "Safety / filters", "Admin safety controls and filter summaries.", safetyItems),
    group("sources", "Sources / CT link", "Source summaries; detailed CT management stays in Targets.", sourceItems),
    group("runtime", "Runtime review / visibility", "Readiness markers for operator review.", runtimeItems),
  ];
}

function packageSummary(account: ManageAccount): GrowthPackageSummary {
  return {
    packageLabel: account.packageLabel || "unknown",
    commercialAddonsLabel: account.commercialAddonsLabel || "No add-ons",
    outreachSourceLabel: account.outreachSourceLabel || "pending_source_classification",
    runtimeProfilesLabel: account.runtimeProfilesLabel || "Runtime profile pending",
    entitlementSummary: account.entitlementSummary || "unknown",
    subscriptionStatus: account.subscriptionStatus || "unknown",
    runtimeProofStatus: "pending",
    pricingReadyStatus: "pending",
  };
}

function itemList(accounts: GrowthAccountOverview[]) {
  return accounts.flatMap((account) => account.groups.flatMap((groupItem) => groupItem.items));
}

function buildSummary(accounts: GrowthAccountOverview[]): GrowthSettingsSummary {
  const items = itemList(accounts);
  return {
    accountsCount: accounts.length,
    clientSafeReadyCount: items.filter((entry) => entry.clientVisibility === "client_safe" && entry.runtimeStatus === "verified").length,
    adminOnlyCount: items.filter((entry) => entry.clientVisibility === "admin_only").length,
    opsOnlyCount: items.filter((entry) => entry.clientVisibility === "ops_only").length,
    runtimeUnverifiedCount: items.filter((entry) => entry.runtimeStatus === "unverified" || entry.runtimeStatus === "pending").length,
    pendingReviewCount: items.filter((entry) => entry.clientVisibility === "pending_review").length,
  };
}

async function readSafeRows() {
  const supabase = createSupabaseClient();
  const [settingsResult, filtersResult] = await Promise.all([
    supabase.from("ig_account_settings").select(settingsSelect),
    supabase.from("ig_account_filters").select(filtersSelect),
  ]);

  return {
    settings: (settingsResult.data ?? []) as unknown as SafeRecord[],
    filters: (filtersResult.data ?? []) as unknown as SafeRecord[],
    errors: [settingsResult.error?.message, filtersResult.error?.message].filter((message): message is string => Boolean(message)),
    settingsReady: !settingsResult.error,
    filtersReady: !filtersResult.error,
  };
}

function byAccount(rows: SafeRecord[]) {
  const entries: Array<[string, SafeRecord]> = [];
  for (const row of rows) {
    const accountId = readString(row, "account_id");
    if (accountId) entries.push([accountId, row]);
  }
  return new Map(entries);
}

export async function getGrowthSettingsData(): Promise<GrowthSettingsOverview> {
  const [manageData, safeRows] = await Promise.all([getManageData(), readSafeRows()]);
  const settingsByAccount = byAccount(safeRows.settings);
  const filtersByAccount = byAccount(safeRows.filters);

  const groupsByAccount = manageData.allAccounts.map((manageAccount) => {
    const settings = settingsByAccount.get(manageAccount.accountId);
    const filters = filtersByAccount.get(manageAccount.accountId);
    const groups = buildGroups(manageAccount, settings, filters);
    const items = groups.flatMap((groupItem) => groupItem.items);
    return {
      account: mapAccount(manageAccount),
      packageSummary: packageSummary(manageAccount),
      groups,
      warningCount: items.filter((entry) => entry.warning || entry.runtimeStatus === "unverified" || entry.runtimeStatus === "pending").length,
      runtimeProofStatus: "pending",
      clientVisibilityStatus: "pending_review",
    } satisfies GrowthAccountOverview;
  });

  return {
    accounts: groupsByAccount.map((entry) => entry.account),
    groupsByAccount,
    summary: buildSummary(groupsByAccount),
    sourceStatus: {
      manageOverview: manageData.summary.sourceStatus.backendApi.status === "unknown" ? "unknown" : manageData.summary.sourceStatus.backendApi.status === "pending" ? "pending" : "connected",
      accountSettings: safeRows.settingsReady ? "legacy_safe_projection" : "pending",
      filters: safeRows.filtersReady ? "legacy_safe_projection" : "pending",
      packageModel: "pending",
      runtimeProof: "pending",
    },
    sourceDetails: {
      manageOverview: {
        label: manageData.summary.sourceStatus.backendApi.label,
        description: "Account, package, subscription, and client labels come from the safe Manage contract.",
      },
      accountSettings: {
        label: safeRows.settingsReady ? "Safe settings projection" : "Settings source pending",
        description: "Whitelist read from ig_account_settings. Raw settings payloads and sensitive fields are not rendered.",
      },
      filters: {
        label: safeRows.filtersReady ? "Safe filters projection" : "Filters source pending",
        description: "Whitelist read from ig_account_filters. Raw filter payloads are not rendered.",
      },
      packageModel: {
        label: "Package model review",
        description: "Package limits are shown for operator review.",
      },
      runtimeProof: {
        label: "Runtime review",
        description: "Runtime readiness is shown as an operator review status.",
      },
    },
    errors: [...manageData.errors, ...safeRows.errors],
  };
}
