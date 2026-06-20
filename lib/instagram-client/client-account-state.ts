export type ClientAccountPresentationPhase =
  | "added"
  | "preparing"
  | "connection_check"
  | "connected"
  | "ready"
  | "action_required";

export type ClientAccountStateInput = {
  loginStatus?: string | null;
  onboardingStatus?: string | null;
  provisioningStatus?: string | null;
  assignmentStatus?: string | null;
  connected?: boolean;
  operationPending?: boolean;
};

export type ClientAccountStateUi = {
  phase: ClientAccountPresentationPhase;
  badgeLabel: string;
  badgeTone: "success" | "warning" | "neutral";
  subtext: string | null;
  readinessLabel: string;
  readinessTone: "success" | "warning" | "neutral";
  readinessDisabled: boolean;
  connectLabel: string;
  connectTone: "success" | "primary" | "neutral";
  connectDisabled: boolean;
  showRefresh: boolean;
  isAsyncPending: boolean;
};

function label(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function loginNeedsAction(loginStatus: string) {
  return [
    "needs_2fa",
    "checkpoint",
    "needs_assistance",
    "session_expired",
    "update_password",
    "credentials_missing",
    "code_required",
    "two_factor_required",
    "checkpoint_required",
  ].includes(loginStatus);
}

function isBackendPreparing(input: ClientAccountStateInput) {
  const loginStatus = normalize(input.loginStatus);
  const provisioningStatus = normalize(input.provisioningStatus);
  const assignmentStatus = normalize(input.assignmentStatus);

  if (input.operationPending) return true;
  if (["connecting", "queued", "running", "in_progress", "checking_connection"].includes(loginStatus)) return true;
  if (["in_progress", "running", "pending", "provisioning"].includes(provisioningStatus)) return true;
  if (assignmentStatus.includes("pending") && provisioningStatus !== "not_started" && loginStatus !== "unknown") {
    return true;
  }
  return false;
}

export function resolveClientAccountState(
  input: ClientAccountStateInput,
  lang: "fr" | "en" = "fr",
): ClientAccountStateUi {
  const loginStatus = normalize(input.loginStatus || "unknown");
  const onboardingStatus = normalize(input.onboardingStatus || "pending");
  const connected = input.connected === true || loginStatus === "connected";
  const onboardingReady = onboardingStatus === "ready";

  if (loginNeedsAction(loginStatus)) {
    return {
      phase: "action_required",
      badgeLabel: label(lang, "Action requise", "Action required"),
      badgeTone: "warning",
      subtext: label(lang, "Une vérification est nécessaire pour continuer.", "A verification is required to continue."),
      readinessLabel: label(lang, "Connexion à vérifier", "Connection check required"),
      readinessTone: "warning",
      readinessDisabled: false,
      connectLabel: label(lang, "Connexion à vérifier", "Connection check required"),
      connectTone: "neutral",
      connectDisabled: false,
      showRefresh: true,
      isAsyncPending: false,
    };
  }

  if (connected && onboardingReady) {
    return {
      phase: "ready",
      badgeLabel: label(lang, "Compte connecté", "Account connected"),
      badgeTone: "success",
      subtext: null,
      readinessLabel: label(lang, "Préparation vérifiée", "Readiness checked"),
      readinessTone: "success",
      readinessDisabled: true,
      connectLabel: label(lang, "Connecté", "Connected"),
      connectTone: "success",
      connectDisabled: true,
      showRefresh: false,
      isAsyncPending: false,
    };
  }

  if (connected) {
    return {
      phase: "connected",
      badgeLabel: label(lang, "Compte connecté", "Account connected"),
      badgeTone: "success",
      subtext: null,
      readinessLabel: label(lang, "Vérifier la préparation", "Check readiness"),
      readinessTone: "warning",
      readinessDisabled: false,
      connectLabel: label(lang, "Connecté", "Connected"),
      connectTone: "success",
      connectDisabled: true,
      showRefresh: false,
      isAsyncPending: false,
    };
  }

  if (isBackendPreparing(input)) {
    return {
      phase: "preparing",
      badgeLabel: label(lang, "Préparation en cours", "Setup in progress"),
      badgeTone: "neutral",
      subtext: label(lang, "Nous vérifions votre compte.", "We are verifying your account."),
      readinessLabel: label(lang, "Vérifier la préparation", "Check readiness"),
      readinessTone: "neutral",
      readinessDisabled: false,
      connectLabel: label(lang, "Connecter", "Connect"),
      connectTone: "primary",
      connectDisabled: true,
      showRefresh: true,
      isAsyncPending: true,
    };
  }

  return {
    phase: "added",
    badgeLabel: label(lang, "Compte ajouté", "Account added"),
    badgeTone: "neutral",
    subtext: null,
    readinessLabel: label(lang, "Vérifier la préparation", "Check readiness"),
    readinessTone: "neutral",
    readinessDisabled: false,
    connectLabel: label(lang, "Connecter", "Connect"),
    connectTone: "primary",
    connectDisabled: false,
    showRefresh: false,
    isAsyncPending: false,
  };
}

export const CLIENT_ACCOUNT_STATE_MATRIX = [
  {
    backend: "login_status in action-required set",
    clientLabel: "Action requise",
    color: "warning",
    actions: "Connexion à vérifier / Vérifier la préparation",
  },
  {
    backend: "account exists, login not connected, no async prep",
    clientLabel: "Compte ajouté",
    color: "neutral",
    actions: "Connecter / Vérifier la préparation",
  },
  {
    backend: "assignment pending after connect OR provisioning in progress OR connect queued",
    clientLabel: "Préparation en cours",
    color: "neutral",
    actions: "Actualiser / Vérifier la préparation",
  },
  {
    backend: "login_status=connected, onboarding_status!=ready",
    clientLabel: "Compte connecté",
    color: "success",
    actions: "Vérifier la préparation",
  },
  {
    backend: "login_status=connected, onboarding_status=ready",
    clientLabel: "Compte connecté + Préparation vérifiée",
    color: "success",
    actions: "Connecté (disabled)",
  },
] as const;

export function operationPendingFromConnectResult(data: {
  request_queued?: boolean;
  status?: string;
  connected?: boolean;
}) {
  if (data.request_queued) return true;
  const status = normalize(data.status);
  return status === "connecting" || status === "checking_connection";
}

export function operationPendingFromReadinessResult(data: {
  status?: string;
  connected?: boolean;
}) {
  const status = normalize(data.status);
  return status === "checking_connection" || status === "waiting_next_slot";
}
