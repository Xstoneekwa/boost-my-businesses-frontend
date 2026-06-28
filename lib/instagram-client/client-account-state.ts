import {
  clientReadinessIsAutomaticPreparationInProgress,
  clientReadinessMessage,
  type ClientReadinessStatus,
} from "./client-readiness-projection.ts";
import { clientConnectMessage, type ClientConnectStatus } from "./connect-client-contract.ts";
import {
  isActiveClientConnectStatus,
  labelForActiveConnectStatus,
} from "./connect-operation-state.ts";

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
  clientReadinessStatus?: string | null;
  activeConnectStatus?: string | null;
};

export type ClientAccountStateUi = {
  phase: ClientAccountPresentationPhase;
  badgeLabel: string;
  badgeTone: "success" | "warning" | "neutral";
  subtext: string | null;
  readinessLabel: string;
  readinessTone: "success" | "warning" | "neutral";
  readinessDisabled: boolean;
  showRecheckReadiness: boolean;
  recheckReadinessLabel: string;
  connectLabel: string;
  connectTone: "success" | "primary" | "neutral";
  connectDisabled: boolean;
  connectPrimary: boolean;
  showRefresh: boolean;
  isAsyncPending: boolean;
  showVerificationReopen: boolean;
  verificationReopenLabel: string;
  showCancelRestart: boolean;
  cancelRestartLabel: string;
};

function label(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function recheckDefaults(lang: "fr" | "en") {
  return {
    showRecheckReadiness: false,
    recheckReadinessLabel: label(lang, "Revérifier", "Check again"),
    connectPrimary: false,
    showVerificationReopen: false,
    verificationReopenLabel: label(lang, "Saisir le code de vérification", "Enter verification code"),
    showCancelRestart: false,
    cancelRestartLabel: label(lang, "Annuler et recommencer", "Cancel and start over"),
  };
}

function shouldOfferCancelRestart(input: ClientAccountStateInput) {
  const status = normalize(input.activeConnectStatus);
  if (isActiveClientConnectStatus(status)) return true;
  return status === "failed" || status === "blocked";
}

function activeConnectPresentation(status: ClientConnectStatus, lang: "fr" | "en"): ClientAccountStateUi {
  const badgeLabel = labelForActiveConnectStatus(status, lang);

  if (status === "verification_required") {
    return {
      phase: "action_required",
      badgeLabel,
      badgeTone: "warning",
      subtext: label(
        lang,
        "Instagram demande une vérification avant de terminer la connexion de votre compte.",
        "Instagram requires verification before your account connection can finish.",
      ),
      readinessLabel: label(lang, "Connexion en cours", "Connection in progress"),
      readinessTone: "warning",
      readinessDisabled: true,
      connectLabel: label(lang, "Vérification requise", "Verification required"),
      connectTone: "neutral",
      connectDisabled: true,
      showRefresh: true,
      isAsyncPending: true,
      ...recheckDefaults(lang),
      showVerificationReopen: true,
      verificationReopenLabel: label(lang, "Saisir le code de vérification", "Enter verification code"),
    };
  }

  if (status === "verification_code_accepted") {
    return {
      phase: "connection_check",
      badgeLabel,
      badgeTone: "neutral",
      subtext: label(
        lang,
        "Code enregistré. Nous préparons la reprise de la connexion.",
        "Code saved. We are preparing to resume the connection.",
      ),
      readinessLabel: label(lang, "Connexion en cours", "Connection in progress"),
      readinessTone: "neutral",
      readinessDisabled: true,
      connectLabel: label(lang, "Connexion en cours", "Connection in progress"),
      connectTone: "neutral",
      connectDisabled: true,
      showRefresh: true,
      isAsyncPending: true,
      ...recheckDefaults(lang),
    };
  }

  if (status === "verification_resume_active" || status === "verification_code_submitted") {
    return {
      phase: "connection_check",
      badgeLabel,
      badgeTone: "neutral",
      subtext: label(
        lang,
        "Vérification en cours. Nous reprenons la connexion automatiquement.",
        "Verification in progress. We are resuming the connection automatically.",
      ),
      readinessLabel: label(lang, "Connexion en cours", "Connection in progress"),
      readinessTone: "neutral",
      readinessDisabled: true,
      connectLabel: label(lang, "Connexion en cours", "Connection in progress"),
      connectTone: "neutral",
      connectDisabled: true,
      showRefresh: true,
      isAsyncPending: true,
      ...recheckDefaults(lang),
    };
  }

  return {
    phase: "connection_check",
    badgeLabel,
    badgeTone: "neutral",
    subtext: label(
      lang,
      "La connexion Instagram est déjà en cours sur le téléphone préparé pour votre compte.",
      "The Instagram connection is already in progress on the phone prepared for your account.",
    ),
    readinessLabel: label(lang, "Connexion en cours", "Connection in progress"),
    readinessTone: "neutral",
    readinessDisabled: true,
    connectLabel: label(lang, "Connexion en cours", "Connection in progress"),
    connectTone: "neutral",
    connectDisabled: true,
    showRefresh: true,
    isAsyncPending: true,
    ...recheckDefaults(lang),
  };
}

function clientReadinessSubtext(status: string | null | undefined, lang: "fr" | "en") {
  const normalized = normalize(status);
  if (!normalized || normalized === "ready_to_connect" || normalized === "already_connected") return null;
  if (
    normalized === "preparation_pending"
    || normalized === "preparation_blocked"
    || normalized === "secure_preparation_in_progress"
    || normalized === "credentials_need_attention"
    || normalized === "device_temporarily_unavailable"
    || normalized === "schedule_not_ready"
  ) {
    return clientReadinessMessage(normalized as ClientReadinessStatus, lang);
  }
  return null;
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
  const activeConnectStatus = normalize(input.activeConnectStatus);

  if (isActiveClientConnectStatus(activeConnectStatus)) return true;
  if (input.operationPending && isActiveClientConnectStatus(activeConnectStatus)) return true;
  if (["connecting", "queued", "running", "in_progress", "checking_connection"].includes(loginStatus)) return true;
  if (["in_progress", "running", "provisioning"].includes(provisioningStatus)) return true;
  if (
    assignmentStatus.includes("pending")
    && provisioningStatus === "pending"
    && loginStatus !== "unknown"
  ) {
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
  const clientReadinessStatus = normalize(input.clientReadinessStatus);
  const activeConnectStatus = normalize(input.activeConnectStatus);
  const defaults = recheckDefaults(lang);
  const offerCancelRestart = shouldOfferCancelRestart(input);

  if (isActiveClientConnectStatus(activeConnectStatus)) {
    return {
      ...activeConnectPresentation(activeConnectStatus, lang),
      showCancelRestart: offerCancelRestart,
      cancelRestartLabel: defaults.cancelRestartLabel,
    };
  }

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
      ...defaults,
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
      ...defaults,
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
      ...defaults,
    };
  }

  if (activeConnectStatus === "failed" || activeConnectStatus === "blocked") {
    return {
      phase: "added",
      badgeLabel: label(lang, "Compte ajouté", "Account added"),
      badgeTone: "neutral",
      subtext: clientConnectMessage(activeConnectStatus, lang),
      readinessLabel: label(lang, "Vérifier la préparation", "Check readiness"),
      readinessTone: "neutral",
      readinessDisabled: false,
      connectLabel: label(lang, "Connecter le compte", "Connect account"),
      connectTone: "primary",
      connectDisabled: true,
      showRefresh: false,
      isAsyncPending: false,
      showCancelRestart: true,
      cancelRestartLabel: defaults.cancelRestartLabel,
      showRecheckReadiness: false,
      recheckReadinessLabel: defaults.recheckReadinessLabel,
      connectPrimary: false,
      showVerificationReopen: false,
      verificationReopenLabel: defaults.verificationReopenLabel,
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
      connectLabel: label(lang, "Connecter le compte", "Connect account"),
      connectTone: "primary",
      connectDisabled: true,
      showRefresh: true,
      isAsyncPending: true,
      ...defaults,
    };
  }

  const readinessPrepared = clientReadinessStatus === "ready_to_connect";
  const automaticPreparationInProgress = clientReadinessIsAutomaticPreparationInProgress(clientReadinessStatus);
  const readinessChecked = Boolean(clientReadinessStatus)
    && !automaticPreparationInProgress;
  const pendingSubtext = clientReadinessSubtext(input.clientReadinessStatus, lang);

  if (readinessPrepared) {
    return {
      ...defaults,
      phase: "added",
      badgeLabel: label(lang, "Prêt à connecter", "Ready to connect"),
      badgeTone: "success",
      subtext: label(lang, "Votre compte est prêt à être connecté.", "Your account is ready to connect."),
      readinessLabel: label(lang, "Préparation vérifiée", "Readiness verified"),
      readinessTone: "success",
      readinessDisabled: true,
      showRecheckReadiness: true,
      recheckReadinessLabel: label(lang, "Revérifier", "Check again"),
      connectLabel: label(lang, "Connecter le compte", "Connect account"),
      connectTone: "primary",
      connectDisabled: false,
      connectPrimary: true,
      showRefresh: false,
      isAsyncPending: false,
    };
  }

  return {
    phase: "added",
    badgeLabel: automaticPreparationInProgress
      ? label(lang, "Préparation en cours", "Setup in progress")
      : label(lang, "Compte ajouté", "Account added"),
    badgeTone: "neutral",
    subtext: pendingSubtext,
    readinessLabel: readinessChecked
      ? label(lang, "Revérifier", "Check again")
      : label(lang, "Vérifier la préparation", "Check readiness"),
    readinessTone: readinessChecked ? "warning" : "neutral",
    readinessDisabled: false,
    connectLabel: label(lang, "Connecter le compte", "Connect account"),
    connectTone: "primary",
    connectDisabled: true,
    showRefresh: automaticPreparationInProgress,
    isAsyncPending: automaticPreparationInProgress,
    ...defaults,
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
    backend: "clientReadinessStatus=ready_to_connect",
    clientLabel: "Prêt à connecter",
    color: "success",
    actions: "Connecter le compte / Préparation vérifiée / Revérifier",
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
  connectStatus?: string;
  connected?: boolean;
}) {
  const connectStatus = normalize(data.connectStatus || data.status);
  if (data.request_queued) return true;
  if ([
    "queued",
    "already_queued",
    "running",
    "connecting",
    "checking_connection",
    "verification_required",
    "verification_code_accepted",
    "verification_resume_active",
    "verification_code_submitted",
  ].includes(connectStatus)) {
    return true;
  }
  return false;
}

export function operationPendingFromReadinessResult(data: {
  status?: string;
  connected?: boolean;
}) {
  const status = normalize(data.status);
  return status === "checking_connection";
}
