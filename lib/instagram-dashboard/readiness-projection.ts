export type AdminReadinessStatus =
  | "ready"
  | "needs_credentials"
  | "needs_login_verification"
  | "needs_phone_assignment"
  | "waiting_scheduled_assignment"
  | "waiting_auto_login_check"
  | "blocked"
  | "paused"
  | "cancelled"
  | "pending_backend_wiring"
  | "unknown";

export type ComponentReadinessStatus = "ready" | "missing" | "waiting" | "blocked" | "pending_backend_wiring" | "unknown";

export type AdminReadinessInput = {
  accountId: string;
  username: string;
  clientId: string | null;
  clientName: string | null;
  adminStatus: string;
  customerStatus: string;
  subscriptionStatus: string;
  packageName: string;
  commercialAddonsLabel?: string;
  entitlementSummary?: string;
  runtimeProfilesLabel: string;
  credentialsConfigured: boolean | null;
  credentialsStatus: string;
  reauthRequired: boolean;
  loginStatus: string;
  provisioningStatus: string;
  onboardingStatus: string;
  assignmentStatus: string | null;
  assignmentStartsAt: string | null;
  phoneStatus: string | null;
  appInstanceStatus: string | null;
  appPackageName: string | null;
  appInstanceLaunchable: boolean | null;
  appInstanceUsableForAutoLogin: boolean | null;
  dmSettingsPresent: boolean;
  welcomeSettingsPresent: boolean;
  unfollowSettingsPresent: boolean;
  dashboardActionsCount: number;
  blockingActionsCount: number;
};

export type AdminReadinessProjection = {
  account_id: string;
  username: string;
  client_id: string | null;
  client_name: string | null;
  package_name: string;
  package_readiness_status: ComponentReadinessStatus;
  credential_status: string;
  credential_next_action: string;
  login_status: string;
  provisioning_status: string;
  onboarding_status: string;
  assignment_status: ComponentReadinessStatus;
  assignment_reason: string;
  phone_readiness_status: ComponentReadinessStatus;
  app_instance_readiness_status: ComponentReadinessStatus;
  runtime_gates_status: ComponentReadinessStatus;
  dm_settings_status: ComponentReadinessStatus;
  dashboard_actions_count: number;
  blocking_actions_count: number;
  next_scheduled_session_at: string | null;
  auto_login_preflight_status: ComponentReadinessStatus;
  overall_readiness_status: AdminReadinessStatus;
  overall_readiness_reason: string;
  next_admin_action: string | null;
  next_client_action: string | null;
  pending_backend_wiring: string[];
};

const pendingPackageLabels = new Set(["", "package pending", "unknown"]);
const pendingRuntimeLabels = new Set(["", "runtime profile pending", "unknown"]);
const connectedLoginStatuses = new Set(["connected"]);
const loginVerificationStatuses = new Set([
  "needs_2fa",
  "2fa_required",
  "checkpoint",
  "login_failed",
  "failed",
  "logged_out",
  "mismatch",
  "password_invalid",
]);
const waitingLoginStatuses = new Set(["unknown", "verification_pending", "login_pending", "pending_login", "not_started"]);
const readyProvisioningStatuses = new Set(["ready"]);
const readyOnboardingStatuses = new Set(["ready"]);
const activeCredentialStatuses = new Set(["active", "configured"]);
const openAssignmentStatuses = new Set(["reserved", "active"]);
const activeAppStatuses = new Set(["available", "occupied"]);
const activePhoneStatuses = new Set(["available", "active", "online", "occupied"]);

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function includesAny(value: string, terms: string[]) {
  const normalized = normalize(value);
  return terms.some((term) => normalized.includes(term));
}

function hasPackage(input: AdminReadinessInput) {
  return !pendingPackageLabels.has(normalize(input.packageName));
}

function hasRuntimeProfile(input: AdminReadinessInput) {
  return !pendingRuntimeLabels.has(normalize(input.runtimeProfilesLabel));
}

function textHasUnfollow(value: string | null | undefined) {
  return normalize(value).split(/[\s,;|/]+/).some((part) => part === "unfollow" || part.startsWith("unfollow_"));
}

function unfollowSettingsRequired(input: AdminReadinessInput) {
  return (
    textHasUnfollow(input.commercialAddonsLabel) ||
    textHasUnfollow(input.entitlementSummary)
  );
}

function credentialNextAction(input: AdminReadinessInput) {
  if (input.reauthRequired) return "update_credentials";
  if (!input.credentialsConfigured || !activeCredentialStatuses.has(normalize(input.credentialsStatus))) {
    return "submit_credentials";
  }
  return "none";
}

function packageStatus(input: AdminReadinessInput): ComponentReadinessStatus {
  if (!hasPackage(input) || !hasRuntimeProfile(input)) return "pending_backend_wiring";
  return "ready";
}

function phoneStatus(input: AdminReadinessInput): ComponentReadinessStatus {
  if (!input.assignmentStatus) return "missing";
  const status = normalize(input.phoneStatus);
  if (!status) return "unknown";
  if (activePhoneStatuses.has(status)) return "ready";
  if (status === "disabled" || status === "blocked") return "blocked";
  return "unknown";
}

function appInstanceStatus(input: AdminReadinessInput): ComponentReadinessStatus {
  if (!input.assignmentStatus) return "missing";
  if (!input.appPackageName) return "missing";
  if (input.appInstanceLaunchable === false || input.appInstanceUsableForAutoLogin === false) return "blocked";
  const status = normalize(input.appInstanceStatus);
  if (!status) return "unknown";
  if (activeAppStatuses.has(status)) return "ready";
  if (status === "disabled") return "blocked";
  return "unknown";
}

function dmSettingsStatus(input: AdminReadinessInput): ComponentReadinessStatus {
  if (!input.dmSettingsPresent) return "pending_backend_wiring";
  return "ready";
}

function runtimeGatesStatus(input: AdminReadinessInput): ComponentReadinessStatus {
  if (
    !input.welcomeSettingsPresent ||
    (unfollowSettingsRequired(input) && !input.unfollowSettingsPresent) ||
    packageStatus(input) !== "ready"
  ) {
    return "pending_backend_wiring";
  }
  return "ready";
}

function assignmentStatus(input: AdminReadinessInput): [ComponentReadinessStatus, string] {
  const status = normalize(input.assignmentStatus);
  if (status && openAssignmentStatuses.has(status)) return ["ready", "assignment_resolved"];
  if (hasPackage(input) && hasRuntimeProfile(input)) {
    return ["waiting", "waiting_scheduled_assignment"];
  }
  return ["missing", "assignment_missing"];
}

function autoLoginStatus(input: AdminReadinessInput): ComponentReadinessStatus {
  if (!activeCredentialStatuses.has(normalize(input.credentialsStatus)) || input.reauthRequired) return "missing";
  if (connectedLoginStatuses.has(normalize(input.loginStatus)) && readyProvisioningStatuses.has(normalize(input.provisioningStatus))) {
    return "ready";
  }
  if (waitingLoginStatuses.has(normalize(input.loginStatus)) || normalize(input.provisioningStatus) === "login_pending") {
    return "waiting";
  }
  if (loginVerificationStatuses.has(normalize(input.loginStatus))) return "blocked";
  return "unknown";
}

function pendingBackendWiring(input: AdminReadinessInput) {
  const pending: string[] = [];
  if (packageStatus(input) === "pending_backend_wiring") pending.push("package_runtime_preset");
  if (!input.dmSettingsPresent) pending.push("dm_settings_projection");
  if (!input.welcomeSettingsPresent) pending.push("welcome_settings_projection");
  if (unfollowSettingsRequired(input) && !input.unfollowSettingsPresent) pending.push("missing_unfollow_settings");
  if (normalize(input.onboardingStatus) === "unknown") pending.push("onboarding_status_projection");
  return [...new Set(pending)].sort();
}

export function readinessLabel(status: AdminReadinessStatus) {
  return {
    ready: "Ready",
    needs_credentials: "Needs credentials",
    needs_login_verification: "Needs login verification",
    needs_phone_assignment: "Needs phone assignment",
    waiting_scheduled_assignment: "Waiting scheduled assignment",
    waiting_auto_login_check: "Waiting auto-login check",
    blocked: "Blocked",
    paused: "Paused",
    cancelled: "Cancelled",
    pending_backend_wiring: "Pending backend wiring",
    unknown: "Unknown",
  }[status];
}

export function readinessTone(status: AdminReadinessStatus) {
  if (status === "ready") return "#86EFAC";
  if (status === "waiting_scheduled_assignment" || status === "waiting_auto_login_check") return "#FBBF24";
  if (status === "pending_backend_wiring" || status === "unknown") return "#93C5FD";
  if (status === "cancelled" || status === "paused") return "rgba(255,255,255,0.52)";
  return "#FCA5A5";
}

export function buildAdminReadinessProjection(input: AdminReadinessInput): AdminReadinessProjection {
  const normalizedAdmin = normalize(input.adminStatus);
  const normalizedCustomer = normalize(input.customerStatus);
  const normalizedSubscription = normalize(input.subscriptionStatus);
  const normalizedLogin = normalize(input.loginStatus);
  const normalizedProvisioning = normalize(input.provisioningStatus);
  const normalizedOnboarding = normalize(input.onboardingStatus);
  const normalizedCredentials = normalize(input.credentialsStatus);
  const pending = pendingBackendWiring(input);
  const [assignment_readiness, assignment_reason] = assignmentStatus(input);
  const phone_readiness = phoneStatus(input);
  const app_readiness = appInstanceStatus(input);
  const dm_readiness = dmSettingsStatus(input);
  const runtime_readiness = runtimeGatesStatus(input);
  const auto_login_readiness = autoLoginStatus(input);
  const package_readiness = packageStatus(input);
  let overall: AdminReadinessStatus = "unknown";
  let reason = "readiness_unknown";
  let nextAdminAction: string | null = null;
  let nextClientAction: string | null = null;

  if (includesAny(`${normalizedAdmin} ${normalizedCustomer} ${normalizedSubscription}`, ["cancelled", "canceled", "trashed"])) {
    overall = "cancelled";
    reason = "account_cancelled";
  } else if (includesAny(normalizedAdmin, ["paused", "archived"])) {
    overall = "paused";
    reason = "account_paused";
  } else if (input.blockingActionsCount > 0 || includesAny(`${normalizedAdmin} ${normalizedOnboarding} ${normalizedProvisioning}`, ["blocked", "support_required"])) {
    overall = "blocked";
    reason = "blocking_action_or_status";
    nextAdminAction = "review_dashboard_actions";
  } else if (!input.credentialsConfigured || !activeCredentialStatuses.has(normalizedCredentials) || input.reauthRequired) {
    overall = "needs_credentials";
    reason = input.reauthRequired ? "credentials_reauth_required" : "credentials_missing_or_inactive";
    nextClientAction = "submit_or_update_credentials";
  } else if (loginVerificationStatuses.has(normalizedLogin)) {
    overall = "needs_login_verification";
    reason = `login_status_${normalizedLogin}`;
    nextAdminAction = "review_login_action";
    if (normalizedLogin === "needs_2fa" || normalizedLogin === "2fa_required" || normalizedLogin === "checkpoint") {
      nextClientAction = "complete_instagram_verification";
    }
  } else if (assignment_readiness === "missing") {
    overall = "needs_phone_assignment";
    reason = assignment_reason;
    nextAdminAction = "assign_phone_or_schedule";
  } else if (assignment_readiness === "waiting") {
    overall = "waiting_scheduled_assignment";
    reason = assignment_reason;
  } else if (auto_login_readiness === "waiting" || !connectedLoginStatuses.has(normalizedLogin) || !readyProvisioningStatuses.has(normalizedProvisioning)) {
    overall = "waiting_auto_login_check";
    reason = "login_preflight_pending";
  } else if (pending.length > 0 || package_readiness !== "ready" || runtime_readiness !== "ready" || dm_readiness !== "ready") {
    overall = "pending_backend_wiring";
    reason = pending[0] || "runtime_projection_incomplete";
  } else if (
    connectedLoginStatuses.has(normalizedLogin)
    && readyProvisioningStatuses.has(normalizedProvisioning)
    && readyOnboardingStatuses.has(normalizedOnboarding)
    && assignment_readiness === "ready"
    && phone_readiness === "ready"
    && app_readiness === "ready"
  ) {
    overall = "ready";
    reason = "all_required_readiness_checks_passed";
  } else {
    overall = "pending_backend_wiring";
    reason = "onboarding_status_not_ready_or_projection_incomplete";
  }

  return {
    account_id: input.accountId,
    username: input.username,
    client_id: input.clientId,
    client_name: input.clientName,
    package_name: input.packageName,
    package_readiness_status: package_readiness,
    credential_status: input.reauthRequired ? "reauth_required" : input.credentialsStatus,
    credential_next_action: credentialNextAction(input),
    login_status: input.loginStatus,
    provisioning_status: input.provisioningStatus,
    onboarding_status: input.onboardingStatus,
    assignment_status: assignment_readiness,
    assignment_reason,
    phone_readiness_status: phone_readiness,
    app_instance_readiness_status: app_readiness,
    runtime_gates_status: runtime_readiness,
    dm_settings_status: dm_readiness,
    dashboard_actions_count: input.dashboardActionsCount,
    blocking_actions_count: input.blockingActionsCount,
    next_scheduled_session_at: input.assignmentStartsAt,
    auto_login_preflight_status: auto_login_readiness,
    overall_readiness_status: overall,
    overall_readiness_reason: reason,
    next_admin_action: nextAdminAction,
    next_client_action: nextClientAction,
    pending_backend_wiring: pending,
  };
}
