import { getManageData, type ManageAccount, type ManageSourceStatus } from "./manage-data";
import { getRadarData, type RadarOverview } from "./radar-data";
import { createSupabaseClient } from "@/lib/supabase";

export type CredentialsActionType =
  | "submit_instagram_credentials"
  | "update_instagram_password"
  | "reconnect_instagram"
  | "complete_two_factor"
  | "resolve_checkpoint"
  | "enter_email_verification_code"
  | "review_login_challenge"
  | "review_login_failure"
  | "review_account_mismatch"
  | "review_credentials"
  | "unknown";

export type DashboardActionSeverity = "info" | "warning" | "error" | "critical" | "unknown";
export type DashboardActionStatus = "pending" | "acknowledged" | "pending_verification" | "code_submitted" | "resolved" | "dismissed" | "ignored" | "unknown";
export type DashboardActionAudience = "client" | "admin" | "assistant" | "ops" | "internal" | "unknown";
export type BackendMutationStatus = "pending_backend" | "connected" | "disabled";
export type CredentialsSourceStatus = "connected" | "pending" | "unknown" | "disabled";

export type CredentialsActionAccount = {
  accountId: string;
  username: string;
  clientName: string | null;
  packageLabel: string | null;
  credentialsStatus: string;
  credentialsConfigured: boolean | null;
  reauthRequired: boolean | null;
  passwordDisplay: string;
  twoFactorDisplay: string;
  loginStatus: string;
  provisioningStatus: string;
  onboardingStatus: string;
  pendingActionsCount: number;
  blockingCampaign: boolean;
  latestIncidentSeverity: string | null;
  dashboardActivityStatus: string | null;
  sourceLabel: string;
  lastSafeUpdate: string | null;
};

export type DashboardActionItem = {
  id: string;
  accountId: string;
  username: string;
  actionType: CredentialsActionType;
  title: string;
  description: string;
  severity: DashboardActionSeverity;
  status: DashboardActionStatus;
  requiresClientAction: boolean;
  blockingCampaign: boolean;
  audience: DashboardActionAudience;
  sourceLabel: string;
  deepLink: string | null;
  backendMutationStatus: BackendMutationStatus;
};

export type DashboardActionSignal = {
  label: string;
  detail: string;
  actionType: CredentialsActionType | "status_signal";
};

export type DashboardActionGroup = {
  accountId: string;
  username: string;
  clientName: string | null;
  mainIssue: string;
  description: string;
  recommendedAction: string;
  severity: DashboardActionSeverity;
  audience: DashboardActionAudience;
  status: DashboardActionStatus;
  sourceLabel: string;
  backendMutationStatus: BackendMutationStatus;
  deepLink: string | null;
  credentialsStatus: string;
  reauthRequired: boolean | null;
  loginStatus: string;
  provisioningStatus: string;
  pendingActionsCount: number;
  blockingCampaign: boolean;
  signals: DashboardActionSignal[];
  actionTypes: CredentialsActionType[];
};

export type CredentialsActionsSummary = {
  accountsCount: number;
  credentialsMissingCount: number;
  reauthRequiredCount: number;
  loginProblemCount: number;
  pendingActionsCount: number;
  blockingCampaignCount: number;
  clientActionRequiredCount: number;
  adminReviewRequiredCount: number;
};

export type CredentialsActionsSourceStatus = {
  manageOverview: CredentialsSourceStatus;
  radarOverview: CredentialsSourceStatus;
  accountCredentials: CredentialsSourceStatus;
  dashboardActions: CredentialsSourceStatus;
  mutations: CredentialsSourceStatus;
};

export type CredentialsActionsSourceDetail = {
  label: string;
  description: string;
};

export type CredentialsActionsOverview = {
  accounts: CredentialsActionAccount[];
  actions: DashboardActionItem[];
  actionGroups: DashboardActionGroup[];
  summary: CredentialsActionsSummary;
  sourceStatus: CredentialsActionsSourceStatus;
  sourceDetails: Record<keyof CredentialsActionsSourceStatus, CredentialsActionsSourceDetail>;
  errors: string[];
};

const derivedSourceLabel = "derived from dashboard overview";
const persistedSourceLabel = "account_dashboard_actions";
const activeDashboardActionStatuses = ["pending", "acknowledged", "pending_verification", "code_submitted"];

type PersistedDashboardActionRow = {
  id?: unknown;
  account_id?: unknown;
  action_type?: unknown;
  status?: unknown;
  severity?: unknown;
  audience?: unknown;
  requires_client_action?: unknown;
  blocking_campaign?: unknown;
  title?: unknown;
  safe_client_message?: unknown;
  action_deep_link?: unknown;
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function includesAny(value: string | null | undefined, terms: string[]) {
  const normalized = normalize(value);
  return terms.some((term) => normalized.includes(term));
}

function asActionType(value: unknown): CredentialsActionType {
  const normalized = normalize(typeof value === "string" ? value : "");
  if (
    normalized === "submit_instagram_credentials" ||
    normalized === "update_instagram_password" ||
    normalized === "reconnect_instagram" ||
    normalized === "complete_two_factor" ||
    normalized === "resolve_checkpoint" ||
    normalized === "enter_email_verification_code" ||
    normalized === "review_login_challenge" ||
    normalized === "review_login_failure" ||
    normalized === "review_account_mismatch" ||
    normalized === "review_credentials"
  ) {
    return normalized;
  }
  return "unknown";
}

function asSeverity(value: unknown): DashboardActionSeverity {
  const normalized = normalize(typeof value === "string" ? value : "");
  if (normalized === "info" || normalized === "warning" || normalized === "error" || normalized === "critical") {
    return normalized;
  }
  return "unknown";
}

function asStatus(value: unknown): DashboardActionStatus {
  const normalized = normalize(typeof value === "string" ? value : "");
  if (
    normalized === "pending" ||
    normalized === "acknowledged" ||
    normalized === "pending_verification" ||
    normalized === "code_submitted" ||
    normalized === "resolved" ||
    normalized === "dismissed" ||
    normalized === "ignored"
  ) {
    return normalized;
  }
  return "unknown";
}

function asAudience(value: unknown): DashboardActionAudience {
  const normalized = normalize(typeof value === "string" ? value : "");
  if (normalized === "client" || normalized === "admin" || normalized === "assistant" || normalized === "ops") {
    return normalized;
  }
  return "unknown";
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function sourceStatusFromManage(status: ManageSourceStatus): CredentialsSourceStatus {
  if (status.status === "connected" || status.status === "legacy_ready") return "connected";
  if (status.status === "pending") return "pending";
  return "unknown";
}

function sourceStatusFromRadar(radarData: RadarOverview): CredentialsSourceStatus {
  const backendStatus = radarData.summary.sourceStatus.backendApi.status;
  if (backendStatus === "connected" || backendStatus === "legacy_ready") return "connected";
  if (backendStatus === "pending") return "pending";
  return "unknown";
}

function mapAccount(account: ManageAccount): CredentialsActionAccount {
  return {
    accountId: account.accountId,
    username: account.username,
    clientName: account.clientName,
    packageLabel: account.packageLabel,
    credentialsStatus: account.credentialsStatus,
    credentialsConfigured: account.credentialsConfigured,
    reauthRequired: account.reauthRequired,
    passwordDisplay: account.passwordDisplay,
    twoFactorDisplay: account.twoFactorDisplay,
    loginStatus: account.loginStatus,
    provisioningStatus: account.provisioningStatus,
    onboardingStatus: account.onboardingStatus,
    pendingActionsCount: account.pendingActionsCount,
    blockingCampaign: account.blockingCampaign,
    latestIncidentSeverity: account.latestIncidentSeverity,
    dashboardActivityStatus: null,
    sourceLabel: account.sourceLabel,
    lastSafeUpdate: account.lastSafeUpdate,
  };
}

function action(
  account: CredentialsActionAccount,
  actionType: CredentialsActionType,
  title: string,
  description: string,
  severity: DashboardActionSeverity,
  audience: DashboardActionAudience,
  requiresClientAction: boolean,
): DashboardActionItem {
  return {
    id: `${account.accountId || account.username}-${actionType}`,
    accountId: account.accountId,
    username: account.username,
    actionType,
    title,
    description,
    severity,
    status: "pending",
    requiresClientAction,
    blockingCampaign: account.blockingCampaign,
    audience,
    sourceLabel: derivedSourceLabel,
    deepLink: `/instagram-dashboard/accounts/${encodeURIComponent(account.accountId || account.username)}?from=manage`,
    backendMutationStatus: "pending_backend",
  };
}

function severityFromIncident(value: string | null): DashboardActionSeverity {
  const normalized = normalize(value);
  if (["critical", "blocked", "checkpoint", "challenge"].some((term) => normalized.includes(term))) return "critical";
  if (["error", "failed", "problem", "warning", "monitor"].some((term) => normalized.includes(term))) return "warning";
  return "info";
}

function buildActionsForAccount(account: CredentialsActionAccount): DashboardActionItem[] {
  const actions: DashboardActionItem[] = [];
  const credentialText = `${account.credentialsStatus} ${account.passwordDisplay} ${account.twoFactorDisplay}`;
  const loginText = `${account.loginStatus} ${account.latestIncidentSeverity ?? ""}`;

  if (account.credentialsConfigured === false || includesAny(credentialText, ["missing"])) {
    actions.push(action(account, "submit_instagram_credentials", "Submit credentials", "Credentials appear missing from the safe dashboard status.", "warning", "client", true));
  }

  if (account.reauthRequired || includesAny(credentialText, ["reauth"])) {
    actions.push(action(account, "update_instagram_password", "Update password / reauth", "Reauthentication is required before campaigns should continue.", "critical", "client", true));
  }

  if (includesAny(credentialText, ["2fa", "two_factor", "needs_2fa"])) {
    actions.push(action(account, "complete_two_factor", "Complete 2FA", "Two-factor completion is required from a safe credential workflow.", "critical", "client", true));
  }

  if (includesAny(loginText, ["verification_pending", "email_verification"])) {
    actions.push(action(account, "enter_email_verification_code", "Enter email verification code", "Instagram is waiting for the email verification code.", "critical", "client", true));
  }

  if (includesAny(loginText, ["unsupported_post_submit", "review_login_challenge"])) {
    actions.push(action(account, "review_login_challenge", "Review login challenge", "Instagram shows an unsupported verification step that needs human review.", "warning", "admin", false));
  }

  if (includesAny(loginText, ["checkpoint", "challenge"])) {
    actions.push(action(account, "resolve_checkpoint", "Resolve checkpoint", "Instagram checkpoint or challenge signal needs review.", "critical", "client", true));
  }

  if (includesAny(loginText, ["blocked", "problem", "error", "failed"])) {
    actions.push(action(account, "review_login_failure", "Review login failure", "Login status indicates a problem that needs operator review.", "warning", "admin", false));
  }

  if (includesAny(loginText, ["mismatch"])) {
    actions.push(action(account, "review_account_mismatch", "Review account mismatch", "Account mismatch signal needs admin review before further actions.", "warning", "admin", false));
  }

  if (account.pendingActionsCount > 0 || account.blockingCampaign) {
    actions.push(action(
      account,
      account.blockingCampaign ? "reconnect_instagram" : "review_credentials",
      account.blockingCampaign ? "Reconnect Instagram" : "Review credentials",
      account.blockingCampaign ? "Campaign is blocked by a current account signal." : "Pending dashboard action count is greater than zero.",
      account.blockingCampaign ? "critical" : severityFromIncident(account.latestIncidentSeverity),
      "admin",
      false,
    ));
  }

  return actions;
}

async function loadPersistedDashboardActions(accounts: CredentialsActionAccount[]): Promise<{
  actions: DashboardActionItem[];
  connected: boolean;
  error: string | null;
}> {
  const accountIds = accounts.map((account) => account.accountId).filter(Boolean);
  if (!accountIds.length) return { actions: [], connected: true, error: null };

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("account_dashboard_actions")
      .select("id,account_id,action_type,status,severity,audience,requires_client_action,blocking_campaign,title,safe_client_message,action_deep_link")
      .in("account_id", accountIds)
      .in("status", activeDashboardActionStatuses)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return { actions: [], connected: false, error: "dashboard_actions_unavailable" };

    const byAccount = new Map(accounts.map((account) => [account.accountId, account]));
    const actions = (Array.isArray(data) ? data : [])
      .map((row: PersistedDashboardActionRow): DashboardActionItem | null => {
        const accountId = readText(row.account_id);
        const account = byAccount.get(accountId);
        if (!account) return null;

        return {
          id: readText(row.id, `${accountId}-${readText(row.action_type, "dashboard_action")}`),
          accountId,
          username: account.username,
          actionType: asActionType(row.action_type),
          title: readText(row.title, "Dashboard action"),
          description: readText(row.safe_client_message, "Safe dashboard action requires review."),
          severity: asSeverity(row.severity),
          status: asStatus(row.status),
          requiresClientAction: row.requires_client_action === true,
          blockingCampaign: row.blocking_campaign === true,
          audience: asAudience(row.audience),
          sourceLabel: persistedSourceLabel,
          deepLink: readText(row.action_deep_link) || `/instagram-dashboard/accounts/${encodeURIComponent(accountId)}`,
          backendMutationStatus: "connected",
        };
      })
      .filter((action): action is DashboardActionItem => Boolean(action));

    return { actions, connected: true, error: null };
  } catch {
    return { actions: [], connected: false, error: "dashboard_actions_unavailable" };
  }
}

function uniqueActions(items: DashboardActionItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.accountId}:${item.actionType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const severityRank: Record<DashboardActionSeverity, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
  unknown: 4,
};

function chooseSeverity(actions: DashboardActionItem[]): DashboardActionSeverity {
  return actions.reduce<DashboardActionSeverity>((current, item) => {
    return severityRank[item.severity] < severityRank[current] ? item.severity : current;
  }, "unknown");
}

function chooseAudience(actions: DashboardActionItem[]): DashboardActionAudience {
  if (actions.some((item) => item.requiresClientAction || item.audience === "client")) return "client";
  if (actions.some((item) => item.audience === "admin")) return "admin";
  if (actions.some((item) => item.audience === "internal")) return "internal";
  return "unknown";
}

function actionGroupForAccount(account: CredentialsActionAccount, actions: DashboardActionItem[]): DashboardActionGroup | null {
  if (!actions.length) return null;

  const sortedActions = [...actions].sort((a, b) => {
    const severityDelta = severityRank[a.severity] - severityRank[b.severity];
    if (severityDelta !== 0) return severityDelta;
    return a.title.localeCompare(b.title);
  });
  const mainAction = sortedActions[0];
  const signals: DashboardActionSignal[] = sortedActions.map((item) => ({
    label: item.title,
    detail: item.description,
    actionType: item.actionType,
  }));

  if (account.reauthRequired) {
    signals.push({ label: "Reauth required", detail: "Safe reauth flag is active.", actionType: "status_signal" });
  }

  if (account.blockingCampaign) {
    signals.push({ label: "Blocking campaign", detail: "Campaign is blocked by current account status.", actionType: "status_signal" });
  }

  if (account.pendingActionsCount > 0) {
    signals.push({ label: `Pending actions: ${account.pendingActionsCount}`, detail: "Derived pending dashboard action count.", actionType: "status_signal" });
  }

  signals.push({ label: `Login: ${account.loginStatus}`, detail: "Safe login status from dashboard overview.", actionType: "status_signal" });

  return {
    accountId: account.accountId,
    username: account.username,
    clientName: account.clientName,
    mainIssue: mainAction.title,
    description: mainAction.description,
    recommendedAction: sortedActions.map((item) => item.title).join(" / "),
    severity: chooseSeverity(sortedActions),
    audience: chooseAudience(sortedActions),
    status: "pending",
    sourceLabel: derivedSourceLabel,
    backendMutationStatus: "pending_backend",
    deepLink: mainAction.deepLink,
    credentialsStatus: account.credentialsStatus,
    reauthRequired: account.reauthRequired,
    loginStatus: account.loginStatus,
    provisioningStatus: account.provisioningStatus,
    pendingActionsCount: account.pendingActionsCount,
    blockingCampaign: account.blockingCampaign,
    signals,
    actionTypes: sortedActions.map((item) => item.actionType),
  };
}

function buildActionGroups(accounts: CredentialsActionAccount[], actions: DashboardActionItem[]): DashboardActionGroup[] {
  const actionsByAccount = new Map<string, DashboardActionItem[]>();
  for (const item of actions) {
    const key = item.accountId || item.username;
    actionsByAccount.set(key, [...(actionsByAccount.get(key) ?? []), item]);
  }

  return accounts
    .map((account) => actionGroupForAccount(account, actionsByAccount.get(account.accountId || account.username) ?? []))
    .filter((group): group is DashboardActionGroup => Boolean(group))
    .sort((a, b) => {
      const severityDelta = severityRank[a.severity] - severityRank[b.severity];
      if (severityDelta !== 0) return severityDelta;
      return b.pendingActionsCount - a.pendingActionsCount;
    });
}

function buildSummary(accounts: CredentialsActionAccount[], groups: DashboardActionGroup[]): CredentialsActionsSummary {
  return {
    accountsCount: accounts.length,
    credentialsMissingCount: accounts.filter((account) => account.credentialsConfigured === false || includesAny(`${account.credentialsStatus} ${account.passwordDisplay}`, ["missing"])).length,
    reauthRequiredCount: accounts.filter((account) => account.reauthRequired || includesAny(`${account.credentialsStatus} ${account.passwordDisplay}`, ["reauth"])).length,
    loginProblemCount: accounts.filter((account) => includesAny(account.loginStatus, ["problem", "error", "failed", "blocked", "checkpoint", "challenge"])).length,
    pendingActionsCount: groups.length,
    blockingCampaignCount: accounts.filter((account) => account.blockingCampaign).length,
    clientActionRequiredCount: groups.filter((item) => item.audience === "client").length,
    adminReviewRequiredCount: groups.filter((item) => item.audience === "admin").length,
  };
}

export async function getCredentialsActionsData(): Promise<CredentialsActionsOverview> {
  const [manageData, radarData] = await Promise.all([getManageData(), getRadarData()]);
  const accounts = manageData.allAccounts.map(mapAccount);
  const persistedDashboardActions = await loadPersistedDashboardActions(accounts);
  const actions = uniqueActions([...persistedDashboardActions.actions, ...accounts.flatMap(buildActionsForAccount)]);
  const actionGroups = buildActionGroups(accounts, actions);

  // TODO: Replace derived actions with account_dashboard_actions once available.
  // TODO: Future mutations should call instagram-credentials / instagram-account-status,
  // then write Activity Log audit events for submit credentials, update password,
  // reconnect requested, complete 2FA, resolve checkpoint, acknowledge, dismiss,
  // resolve, and review mismatch. Decrement badges only after backend terminal status.

  return {
    accounts,
    actions,
    actionGroups,
    summary: buildSummary(accounts, actionGroups),
    sourceStatus: {
      manageOverview: sourceStatusFromManage(manageData.summary.sourceStatus.backendApi),
      radarOverview: sourceStatusFromRadar(radarData),
      accountCredentials: "pending",
      dashboardActions: persistedDashboardActions.connected ? "connected" : "pending",
      mutations: "disabled",
    },
    sourceDetails: {
      manageOverview: {
        label: manageData.summary.sourceStatus.backendApi.label,
        description: "Credentials statuses come from the safe Manage data contract.",
      },
      radarOverview: {
        label: radarData.summary.sourceStatus.backendApi.label,
        description: "Risk and action signals are cross-checked with the Radar data contract.",
      },
      accountCredentials: {
        label: "Account credentials unavailable",
        description: "Credentials status is shown from the safe Manage projection.",
      },
      dashboardActions: {
        label: persistedDashboardActions.connected ? "Dashboard actions connected" : "Dashboard actions unavailable",
        description: persistedDashboardActions.connected
          ? "Open account_dashboard_actions are merged with derived read-only signals. Metadata is not rendered."
          : "Falling back to derived read-only signals because account_dashboard_actions could not be loaded.",
      },
      mutations: {
        label: "Actions read-only",
        description: "This view surfaces review actions without running credential mutations.",
      },
    },
    errors: [...manageData.errors, ...radarData.errors, ...(persistedDashboardActions.error ? [persistedDashboardActions.error] : [])],
  };
}
