import { getCredentialsActionsData } from "./credentials-actions-data";
import { getManageData, type ManageAccount, type ManageSourceStatus } from "./manage-data";

export type ClientAccountPasswordStatus = "configured" | "missing" | "reauth_required" | "update_needed" | "unknown";
export type ClientAccountOperationsStatus = "active" | "pending" | "cancelled" | "onboarding" | "paused" | "unknown";
export type ClientAccountLifecycleStatus = "active" | "archived" | "trashed";
export type ClientAccountBackendStatus = "pending_backend" | "connected" | "disabled";
export type ClientAccountsSourceStatusCode = "connected" | "pending" | "unknown" | "disabled";
export type ClientAccountProfileImageSource = "admin_dashboard" | "supabase" | "legacy" | "pending" | "unknown";
export type InstagramVerificationStatus = "verified" | "not_found" | "username_changed" | "private_or_limited" | "inaccessible" | "rate_limited" | "provider_error" | "verification_unavailable" | "invalid_format" | "pending" | "unknown";

export type ClientAccountStatusTransition = {
  from: ClientAccountOperationsStatus;
  to: Exclude<ClientAccountOperationsStatus, "unknown">;
  label: string;
  requiresReason: boolean;
  disabledReason: string;
  backendStatus: ClientAccountBackendStatus;
};

export type ClientAccountOperationAction = {
  key: string;
  label: string;
  description: string;
  disabled: boolean;
  disabledReason: string | null;
  targetHref: string | null;
  backendStatus: ClientAccountBackendStatus;
};

export type ClientAccountOperationsItem = {
  accountId: string;
  username: string;
  clientName: string | null;
  emailDisplay: string;
  profileImageUrl?: string | null;
  profileImageSource?: ClientAccountProfileImageSource;
  instagramVerificationStatus?: InstagramVerificationStatus;
  instagramCanonicalUsername?: string | null;
  passwordStatus: ClientAccountPasswordStatus;
  twoFactorStatus: string;
  createdAt: string | null;
  adminStatus: string;
  customerStatus: string;
  subscriptionStatus: string;
  operationsStatus: ClientAccountOperationsStatus;
  lifecycleStatus: ClientAccountLifecycleStatus;
  availableStatusTransitions: ClientAccountStatusTransition[];
  actions: ClientAccountOperationAction[];
  sourceLabel: string;
  lastSafeUpdate: string | null;
  needsAssistance: boolean;
  reauthRequired: boolean;
};

export type ClientAccountsOperationsSummary = {
  total: number;
  active: number;
  pending: number;
  onboarding: number;
  paused: number;
  cancelled: number;
  needsAssistance: number;
  reauthRequired: number;
};

export type ClientAccountsOperationsSourceStatus = {
  manageOverview: ClientAccountsSourceStatusCode;
  credentialsActions: ClientAccountsSourceStatusCode;
  statusMutations: ClientAccountsSourceStatusCode;
  botAppSync: ClientAccountsSourceStatusCode;
  clientDashboardSync: ClientAccountsSourceStatusCode;
};

export type ClientAccountsSourceDetail = {
  label: string;
  description: string;
};

export type ClientAccountsOperationsOverview = {
  items: ClientAccountOperationsItem[];
  summary: ClientAccountsOperationsSummary;
  sourceStatus: ClientAccountsOperationsSourceStatus;
  sourceDetails: Record<keyof ClientAccountsOperationsSourceStatus, ClientAccountsSourceDetail>;
  errors: string[];
};

const transitionStatuses: Array<Exclude<ClientAccountOperationsStatus, "unknown">> = ["active", "pending", "onboarding", "paused", "cancelled"];
const profileImageKeys = ["profileImageUrl", "profile_image_url", "profile_picture_url", "avatar_url", "instagram_profile_picture_url", "picture_url", "image_url"] as const;
const verificationStatusKeys = ["instagramVerificationStatus", "username_verification_status", "instagram_verification_status", "verification_status"] as const;
const canonicalUsernameKeys = ["instagramCanonicalUsername", "instagram_canonical_username", "canonical_username"] as const;

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function includesAny(value: string | null | undefined, terms: string[]) {
  const normalized = normalize(value);
  return terms.some((term) => normalized.includes(term));
}

function readString(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function safeProfileImageUrl(account: ManageAccount) {
  const row = account as unknown as Record<string, unknown>;
  const rawUrl = readString(row, profileImageKeys);
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

function profileImageSource(account: ManageAccount, profileImageUrl: string | null): ClientAccountProfileImageSource {
  if (!profileImageUrl) return "pending";
  if (account.sourceLabel.includes("admin-dashboard")) return "admin_dashboard";
  if (account.sourceLabel.includes("legacy")) return "legacy";
  if (account.sourceLabel.includes("supabase")) return "supabase";
  return "unknown";
}

function instagramVerificationStatus(account: ManageAccount): InstagramVerificationStatus {
  const row = account as unknown as Record<string, unknown>;
  const status = normalize(readString(row, verificationStatusKeys));

  if (!status) return "pending";
  if (status === "verified") return "verified";
  if (status === "not_found") return "not_found";
  if (status === "username_changed") return "username_changed";
  if (status === "private_or_limited") return "private_or_limited";
  if (status === "inaccessible") return "inaccessible";
  if (status === "rate_limited") return "rate_limited";
  if (status === "provider_error") return "provider_error";
  if (status === "verification_unavailable") return "verification_unavailable";
  if (status === "invalid_format") return "invalid_format";
  if (status === "pending") return "pending";
  return "unknown";
}

function instagramCanonicalUsername(account: ManageAccount) {
  const row = account as unknown as Record<string, unknown>;
  return readString(row, canonicalUsernameKeys) || null;
}

function sourceStatusFromManage(status: ManageSourceStatus): ClientAccountsSourceStatusCode {
  if (status.status === "connected" || status.status === "legacy_ready") return "connected";
  if (status.status === "pending") return "pending";
  return "unknown";
}

function lifecycleStatus(account: ManageAccount): ClientAccountLifecycleStatus {
  const status = normalize(account.adminStatus);
  if (status === "archived" || account.archivedAt) return "archived";
  if (status === "trashed" || status === "trash" || account.trashedAt) return "trashed";
  return "active";
}

function passwordStatus(account: ManageAccount): ClientAccountPasswordStatus {
  const text = `${account.credentialsStatus} ${account.passwordDisplay}`;
  if (account.reauthRequired || includesAny(text, ["reauth"])) return "reauth_required";
  if (account.credentialsConfigured === false || includesAny(text, ["missing"])) return "missing";
  if (includesAny(text, ["update"])) return "update_needed";
  if (account.credentialsConfigured === true || includesAny(text, ["configured", "ok"])) return "configured";
  return "unknown";
}

function twoFactorStatus(account: ManageAccount) {
  const value = normalize(account.twoFactorDisplay);
  if (!value) return "unknown";
  if (includesAny(value, ["needs_2fa", "code", "required"])) return "code required";
  if (includesAny(value, ["pending"])) return "pending action";
  if (includesAny(value, ["enabled", "configured"])) return "enabled";
  if (includesAny(value, ["disabled", "missing"])) return "disabled";
  if (["unknown", "ok", "checkpoint", "blocked"].includes(value)) return value;
  return "unknown";
}

function operationsStatus(account: ManageAccount): ClientAccountOperationsStatus {
  const lifecycle = lifecycleStatus(account);
  const admin = normalize(account.adminStatus);
  const customer = normalize(account.customerStatus);
  const subscription = normalize(account.subscriptionStatus);
  const onboarding = normalize(account.onboardingStatus);
  const provisioning = normalize(account.provisioningStatus);
  const combined = `${admin} ${customer} ${subscription} ${onboarding} ${provisioning}`;

  if (includesAny(combined, ["cancelled", "canceled"])) return "cancelled";
  if (includesAny(admin, ["paused"])) return "paused";
  if (includesAny(onboarding, ["onboarding"])) return "onboarding";
  if (includesAny(combined, ["pending"])) return "pending";
  if (lifecycle === "active" && admin === "active") return "active";
  return "unknown";
}

function transitionLabel(status: Exclude<ClientAccountOperationsStatus, "unknown">) {
  if (status === "active") return "Set active";
  if (status === "pending") return "Set pending";
  if (status === "onboarding") return "Set onboarding";
  if (status === "paused") return "Set paused";
  return "Set cancelled";
}

function buildTransitions(from: ClientAccountOperationsStatus): ClientAccountStatusTransition[] {
  return transitionStatuses.map((to) => ({
    from,
    to,
    label: transitionLabel(to),
    requiresReason: to !== "active",
    disabledReason: "Status changes require audited backend sync.",
    backendStatus: "pending_backend",
  }));
}

function buildActions(account: ManageAccount): ClientAccountOperationAction[] {
  const detailHref = `/instagram-dashboard/accounts/${encodeURIComponent(account.accountId || account.username)}`;

  return [
    {
      key: "view_account",
      label: "View Account",
      description: "Open the read-only account detail.",
      disabled: false,
      disabledReason: null,
      targetHref: detailHref,
      backendStatus: "connected",
    },
    {
      key: "open_credentials",
      label: "Open Credentials",
      description: "Open the credential action worklist.",
      disabled: false,
      disabledReason: null,
      targetHref: "/instagram-dashboard/credentials-actions",
      backendStatus: "connected",
    },
    {
      key: "request_password_update",
      label: "Request password update",
      description: "Future secure update link flow. Password values are never displayed.",
      disabled: true,
      disabledReason: "Requires credential assistance backend.",
      targetHref: null,
      backendStatus: "pending_backend",
    },
    {
      key: "mark_needs_assistance",
      label: "Mark needs assistance",
      description: "Future support flag with activity audit and cross-surface sync.",
      disabled: true,
      disabledReason: "Requires audited status/action backend.",
      targetHref: null,
      backendStatus: "pending_backend",
    },
  ];
}

function isAssistanceNeeded(account: ManageAccount, hasDashboardAction: boolean) {
  return (
    hasDashboardAction ||
    account.reauthRequired ||
    account.pendingActionsCount > 0 ||
    account.blockingCampaign ||
    passwordStatus(account) === "missing" ||
    includesAny(`${account.loginStatus} ${account.credentialsStatus} ${account.latestIncidentSeverity}`, ["problem", "error", "failed", "blocked", "checkpoint", "challenge"])
  );
}

function mapAccount(account: ManageAccount, hasDashboardAction: boolean): ClientAccountOperationsItem {
  const status = operationsStatus(account);
  const profileImageUrl = safeProfileImageUrl(account);

  return {
    accountId: account.accountId,
    username: account.username,
    clientName: account.clientName,
    emailDisplay: account.emailDisplay,
    profileImageUrl,
    profileImageSource: profileImageSource(account, profileImageUrl),
    instagramVerificationStatus: instagramVerificationStatus(account),
    instagramCanonicalUsername: instagramCanonicalUsername(account),
    passwordStatus: passwordStatus(account),
    twoFactorStatus: twoFactorStatus(account),
    createdAt: account.createdAt,
    adminStatus: account.adminStatus,
    customerStatus: account.customerStatus,
    subscriptionStatus: account.subscriptionStatus,
    operationsStatus: status,
    lifecycleStatus: lifecycleStatus(account),
    availableStatusTransitions: buildTransitions(status),
    actions: buildActions(account),
    sourceLabel: account.sourceLabel,
    lastSafeUpdate: account.lastSafeUpdate,
    needsAssistance: isAssistanceNeeded(account, hasDashboardAction),
    reauthRequired: account.reauthRequired,
  };
}

function buildSummary(items: ClientAccountOperationsItem[]): ClientAccountsOperationsSummary {
  return {
    total: items.length,
    active: items.filter((item) => item.operationsStatus === "active").length,
    pending: items.filter((item) => item.operationsStatus === "pending").length,
    onboarding: items.filter((item) => item.operationsStatus === "onboarding").length,
    paused: items.filter((item) => item.operationsStatus === "paused").length,
    cancelled: items.filter((item) => item.operationsStatus === "cancelled").length,
    needsAssistance: items.filter((item) => item.needsAssistance).length,
    reauthRequired: items.filter((item) => item.reauthRequired).length,
  };
}

// TODO: Future backend should verify Instagram account existence at account
// creation/update time, normalize the username, store/cache canonical username
// and safe profile picture URL, and block auto-login/provisioning when
// instagramVerificationStatus is not_found or critically failed.
// TODO: Future status changes need an audited account status backend with
// source_surface, actor_type, actor_id, reason, changed_at, sync_status, and
// audit_event_id, then sync admin dashboard, client dashboard, BotApp, and DB.
export async function getClientAccountsOperationsData(): Promise<ClientAccountsOperationsOverview> {
  const [manageData, credentialsData] = await Promise.all([getManageData(), getCredentialsActionsData()]);
  const actionAccountIds = new Set(credentialsData.actionGroups.map((group) => group.accountId || group.username));
  const items = manageData.allAccounts.map((account) => mapAccount(account, actionAccountIds.has(account.accountId || account.username)));

  return {
    items,
    summary: buildSummary(items),
    sourceStatus: {
      manageOverview: sourceStatusFromManage(manageData.summary.sourceStatus.backendApi),
      credentialsActions: credentialsData.sourceStatus.dashboardActions === "disabled" ? "disabled" : credentialsData.sourceStatus.dashboardActions === "pending" ? "pending" : "connected",
      statusMutations: "pending",
      botAppSync: "pending",
      clientDashboardSync: "pending",
    },
    sourceDetails: {
      manageOverview: {
        label: manageData.summary.sourceStatus.backendApi.label,
        description: "Client account rows use the safe Manage data contract.",
      },
      credentialsActions: {
        label: credentialsData.sourceDetails.dashboardActions.label,
        description: "Assistance signals are derived from the read-only Credentials Actions contract.",
      },
      statusMutations: {
        label: "Status mutations pending backend",
        description: "Business status changes require audited backend sync before enabling selectors.",
      },
      botAppSync: {
        label: "BotApp sync pending backend",
        description: "Future status changes must sync to BotApp/Mac app through backend DB.",
      },
      clientDashboardSync: {
        label: "Client dashboard sync pending backend",
        description: "Future status changes must be reflected in the client dashboard.",
      },
    },
    errors: [...manageData.errors, ...credentialsData.errors],
  };
}
