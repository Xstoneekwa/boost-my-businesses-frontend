import { resolveClientAccountState, type ClientAccountStateInput } from "./client-account-state.ts";

export type ProcessStepStatus = "pending" | "running" | "done" | "failed" | "action_required";

export type ClientProcessStep = {
  id: string;
  label: string;
  subtitle: string | null;
  status: ProcessStepStatus;
};

export type ClientProcessMode = "add_account" | "connect" | "check_readiness";

export type ClientProcessOutcome = "running" | "success" | "action_required" | "error" | "long_running";

export type ClientProcessProjection = {
  title: string;
  subtitle: string;
  statusChip: string;
  statusTone: "running" | "success" | "warning" | "error";
  steps: ClientProcessStep[];
  finalMessage: string | null;
  showRefresh: boolean;
  isComplete: boolean;
  isAsyncPending: boolean;
  outcome: ClientProcessOutcome;
};

export type AddAccountProcessInput = {
  lang: "fr" | "en";
  phase: "submitting" | "creating" | "refreshing" | "complete" | "error";
  account?: ClientAccountStateInput & { username?: string; accountId?: string } | null;
  errorMessage?: string | null;
  errorCode?: string | null;
};

export type ConnectProcessInput = {
  lang: "fr" | "en";
  phase: "starting" | "submitting" | "polling" | "complete" | "error" | "long_running";
  account?: ClientAccountStateInput & { username?: string; accountId?: string } | null;
  errorMessage?: string | null;
  timedOut?: boolean;
};

function label(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function step(
  id: string,
  labelText: string,
  subtitle: string | null,
  status: ProcessStepStatus,
): ClientProcessStep {
  return { id, label: labelText, subtitle, status };
}

function provisioningActive(status: string) {
  return ["in_progress", "running", "pending", "provisioning"].includes(status);
}

const USERNAME_VALIDATION_ERROR_CODES = new Set([
  "username_required",
  "username_invalid",
  "username_not_found",
  "username_verification_failed",
]);

function isUsernameValidationError(code?: string | null) {
  return Boolean(code && USERNAME_VALIDATION_ERROR_CODES.has(code));
}

function addAccountValidateStepStatus(phase: AddAccountProcessInput["phase"], errorCode?: string | null): ProcessStepStatus {
  if (phase === "submitting") return "running";
  if (phase === "error" && isUsernameValidationError(errorCode)) return "failed";
  if (phase === "error") return "done";
  return "done";
}

function addAccountWorkspaceStepStatus(
  phase: AddAccountProcessInput["phase"],
  errorCode: string | null | undefined,
  hasAccount: boolean,
): ProcessStepStatus {
  if (phase === "creating" || phase === "submitting") return "running";
  if (phase === "error" && isUsernameValidationError(errorCode)) return "pending";
  if (phase === "error") return "failed";
  if (hasAccount) return "done";
  if (phase === "refreshing") return "running";
  return "pending";
}

export function clientSafeProcessErrorMessage(
  lang: "fr" | "en",
  code?: string | null,
  fallback?: string | null,
) {
  const messages: Record<string, { fr: string; en: string }> = {
    username_required: {
      fr: "Indiquez un nom d'utilisateur Instagram.",
      en: "Enter an Instagram username.",
    },
    username_invalid: {
      fr: "Ce nom d'utilisateur Instagram n'est pas valide.",
      en: "This Instagram username is not valid.",
    },
    username_not_found: {
      fr: "Ce compte Instagram est introuvable.",
      en: "This Instagram account could not be found.",
    },
    username_already_linked: {
      fr: "Ce compte Instagram est déjà lié à votre espace.",
      en: "This Instagram account is already linked to your workspace.",
    },
    username_verification_failed: {
      fr: "Impossible de vérifier ce nom d'utilisateur.",
      en: "We could not verify this username.",
    },
    subscription_inactive: {
      fr: "Votre abonnement n'est pas actif. Contactez votre chargé de compte.",
      en: "Your subscription is not active. Contact your account manager.",
    },
    max_accounts_reached: {
      fr: "Nombre maximum de comptes atteint pour votre offre.",
      en: "Maximum number of accounts reached for your plan.",
    },
    credentials_unavailable: {
      fr: "L'ajout de compte est temporairement indisponible. Réessayez plus tard.",
      en: "Account setup is temporarily unavailable. Try again later.",
    },
    credentials_ingestion_failed: {
      fr: "Impossible d'enregistrer les identifiants pour le moment.",
      en: "We could not save your login details right now.",
    },
    account_create_failed: {
      fr: "Impossible d'ajouter le compte pour le moment.",
      en: "We could not add the account right now.",
    },
  };
  if (code && messages[code]) return messages[code][lang];
  if (fallback) return fallback;
  return label(lang, "Une erreur est survenue. Réessayez plus tard.", "Something went wrong. Please try again later.");
}

export function projectAddAccountProcess(input: AddAccountProcessInput): ClientProcessProjection {
  const { lang, phase, account, errorMessage, errorCode } = input;
  const ui = account ? resolveClientAccountState(account, lang) : null;
  const provisioningStatus = normalize(account?.provisioningStatus);
  const hasAccount = Boolean(account?.accountId);

  const steps: ClientProcessStep[] = [
    step(
      "validate",
      label(lang, "Validation du compte", "Account validation"),
      label(lang, "Nous vérifions le nom d'utilisateur.", "We verify the username."),
      addAccountValidateStepStatus(phase, errorCode),
    ),
    step(
      "add",
      label(lang, "Ajout du compte à votre espace", "Adding account to your workspace"),
      label(lang, "Création du compte dans votre espace client.", "Creating the account in your client workspace."),
      addAccountWorkspaceStepStatus(phase, errorCode, hasAccount),
    ),
    step(
      "prepare",
      label(lang, "Préparation de la connexion", "Connection setup"),
      provisioningActive(provisioningStatus)
        ? label(lang, "Nous préparons la connexion.", "We are preparing the connection.")
        : label(lang, "La connexion pourra être lancée ensuite.", "You can start the connection next."),
      !hasAccount
        ? "pending"
        : provisioningActive(provisioningStatus)
          ? "running"
          : ui?.phase === "action_required"
            ? "action_required"
            : "done",
    ),
    step(
      "complete",
      label(lang, "Compte ajouté", "Account added"),
      label(lang, "Votre compte apparaît dans la liste.", "Your account appears in the list."),
      !hasAccount
        ? "pending"
        : ui?.phase === "action_required"
          ? "action_required"
          : phase === "complete" && hasAccount
            ? "done"
            : phase === "refreshing"
              ? "running"
              : hasAccount
                ? "done"
                : "pending",
    ),
  ];

  if (phase === "error") {
    return {
      title: label(lang, "Ajout du compte", "Add account"),
      subtitle: label(lang, "Le compte n'a pas pu être ajouté.", "The account could not be added."),
      statusChip: label(lang, "Erreur", "Error"),
      statusTone: "error",
      steps,
      finalMessage: errorMessage || label(lang, "Réessayez dans quelques instants.", "Try again in a moment."),
      showRefresh: false,
      isComplete: true,
      isAsyncPending: false,
      outcome: "error",
    };
  }

  if (ui?.phase === "action_required") {
    return {
      title: label(lang, "Compte ajouté", "Account added"),
      subtitle: label(lang, "Une action supplémentaire est nécessaire.", "An extra step is required."),
      statusChip: label(lang, "Action requise", "Action required"),
      statusTone: "warning",
      steps,
      finalMessage: label(
        lang,
        "Votre compte a été ajouté, mais une action supplémentaire est nécessaire pour terminer la connexion.",
        "Your account was added, but an extra step is required to finish connecting.",
      ),
      showRefresh: true,
      isComplete: true,
      isAsyncPending: false,
      outcome: "action_required",
    };
  }

  if (phase === "complete" && hasAccount) {
    return {
      title: label(lang, "Compte ajouté", "Account added"),
      subtitle: label(lang, "Votre compte est prêt dans votre espace.", "Your account is ready in your workspace."),
      statusChip: label(lang, "Terminé", "Done"),
      statusTone: "success",
      steps,
      finalMessage: label(
        lang,
        "Votre compte a été ajouté. Nous préparons sa connexion.",
        "Your account was added. We are preparing its connection.",
      ),
      showRefresh: false,
      isComplete: true,
      isAsyncPending: false,
      outcome: "success",
    };
  }

  return {
    title: label(lang, "Ajout du compte", "Add account"),
    subtitle: label(lang, "Nous ajoutons votre compte Instagram.", "We are adding your Instagram account."),
    statusChip: label(lang, "En cours", "In progress"),
    statusTone: "running",
    steps,
    finalMessage: null,
    showRefresh: false,
    isComplete: false,
    isAsyncPending: true,
    outcome: "running",
  };
}

export function projectConnectProcess(input: ConnectProcessInput): ClientProcessProjection {
  const { lang, phase, account, errorMessage, timedOut } = input;
  const ui = account ? resolveClientAccountState(account, lang) : null;
  const loginStatus = normalize(account?.loginStatus);
  const provisioningStatus = normalize(account?.provisioningStatus);
  const onboardingStatus = normalize(account?.onboardingStatus);
  const connected = account?.connected === true || loginStatus === "connected";
  const onboardingReady = onboardingStatus === "ready";
  const actionRequired = ui?.phase === "action_required";
  const preparing = ui?.phase === "preparing" || ui?.isAsyncPending;

  const connectAccepted = phase !== "starting" && phase !== "error";
  const sessionVerified = connected || actionRequired;
  const prepRunning = connected && !onboardingReady && !actionRequired;
  const prepDone = connected && (onboardingReady || provisioningStatus === "ready");
  const finalDone = onboardingReady && connected;

  const steps: ClientProcessStep[] = [
    step(
      "connect",
      label(lang, "Connexion au compte", "Account connection"),
      label(lang, "Lancement de la connexion automatique.", "Starting automatic connection."),
      phase === "starting" || phase === "submitting"
        ? "running"
        : phase === "error"
          ? "failed"
          : connectAccepted
            ? "done"
            : "pending",
    ),
    step(
      "session",
      label(lang, "Vérification de la session", "Session verification"),
      preparing && !connected
        ? label(lang, "Connexion en cours.", "Connection in progress.")
        : label(lang, "Validation de la session Instagram.", "Validating the Instagram session."),
      !connectAccepted
        ? "pending"
        : actionRequired
          ? "action_required"
          : connected
            ? "done"
            : preparing || loginStatus === "connecting" || loginStatus === "queued"
              ? "running"
              : sessionVerified
                ? "done"
                : "running",
    ),
    step(
      "prepare",
      label(lang, "Préparation du compte", "Account setup"),
      connected && !onboardingReady
        ? label(lang, "Préparation en cours.", "Setup in progress.")
        : label(lang, "Nous préparons votre compte.", "We are preparing your account."),
      !sessionVerified
        ? "pending"
        : actionRequired
          ? "action_required"
          : prepDone
            ? "done"
            : prepRunning || preparing
              ? "running"
              : connected
                ? "running"
                : "pending",
    ),
    step(
      "final",
      label(lang, "Vérification finale", "Final check"),
      onboardingReady
        ? label(lang, "Préparation vérifiée.", "Readiness checked.")
        : label(lang, "Dernière vérification avant mise en service.", "Final check before going live."),
      !connected
        ? "pending"
        : actionRequired
          ? "action_required"
          : finalDone
            ? "done"
            : connected
              ? "running"
              : "pending",
    ),
  ];

  if (phase === "error") {
    return {
      title: label(lang, "Connexion automatique", "Automatic connection"),
      subtitle: label(lang, "La connexion n'a pas pu démarrer.", "The connection could not start."),
      statusChip: label(lang, "Erreur", "Error"),
      statusTone: "error",
      steps,
      finalMessage: errorMessage || label(lang, "Réessayez dans quelques instants.", "Try again in a moment."),
      showRefresh: false,
      isComplete: true,
      isAsyncPending: false,
      outcome: "error",
    };
  }

  if (actionRequired) {
    return {
      title: label(lang, "Connexion à vérifier", "Connection check required"),
      subtitle: label(lang, "Une vérification est nécessaire pour continuer.", "A verification is required to continue."),
      statusChip: label(lang, "Action requise", "Action required"),
      statusTone: "warning",
      steps,
      finalMessage: label(
        lang,
        "Une action supplémentaire est nécessaire pour terminer la connexion.",
        "An extra step is required to finish connecting.",
      ),
      showRefresh: true,
      isComplete: true,
      isAsyncPending: false,
      outcome: "action_required",
    };
  }

  if (ui?.phase === "ready") {
    return {
      title: label(lang, "Compte connecté", "Account connected"),
      subtitle: label(lang, "Votre compte est connecté et prêt.", "Your account is connected and ready."),
      statusChip: label(lang, "Terminé", "Done"),
      statusTone: "success",
      steps,
      finalMessage: label(lang, "Compte connecté et préparation vérifiée.", "Account connected and readiness checked."),
      showRefresh: false,
      isComplete: true,
      isAsyncPending: false,
      outcome: "success",
    };
  }

  if (timedOut && preparing) {
    return {
      title: label(lang, "Connexion en cours", "Connection in progress"),
      subtitle: label(lang, "Le processus continue côté serveur.", "The process is still running on our side."),
      statusChip: label(lang, "En cours", "In progress"),
      statusTone: "running",
      steps,
      finalMessage: label(
        lang,
        "La connexion prend plus de temps que prévu. Actualisez dans quelques instants.",
        "Connection is taking longer than expected. Refresh in a moment.",
      ),
      showRefresh: true,
      isComplete: true,
      isAsyncPending: true,
      outcome: "long_running",
    };
  }

  if (ui?.phase === "connected" && phase === "complete") {
    return {
      title: label(lang, "Compte connecté", "Account connected"),
      subtitle: label(lang, "Vous pouvez vérifier la préparation.", "You can check readiness."),
      statusChip: label(lang, "Connecté", "Connected"),
      statusTone: "success",
      steps,
      finalMessage: label(lang, "Compte connecté. Vérifiez la préparation pour finaliser.", "Account connected. Check readiness to finish."),
      showRefresh: false,
      isComplete: true,
      isAsyncPending: false,
      outcome: "success",
    };
  }

  return {
    title: label(lang, "Connexion automatique", "Automatic connection"),
    subtitle: label(lang, "Nous vérifions votre compte.", "We are verifying your account."),
    statusChip: label(lang, "En cours", "In progress"),
    statusTone: "running",
    steps,
    finalMessage: null,
    showRefresh: Boolean(preparing),
    isComplete: false,
    isAsyncPending: Boolean(preparing) || phase === "submitting" || phase === "polling",
    outcome: "running",
  };
}

export function projectReadinessProcess(input: ConnectProcessInput): ClientProcessProjection {
  const lang = input.lang;
  const phase = input.phase;
  const readinessStatus = normalize(input.account?.clientReadinessStatus);
  const ready = readinessStatus === "ready_to_connect";
  const complete = phase === "complete";
  const running = phase === "starting" || phase === "submitting";
  const errored = phase === "error";

  const accountStepStatus: ProcessStepStatus = "done";
  const configStepStatus: ProcessStepStatus = running
    ? "running"
    : errored
      ? "failed"
      : complete
        ? "done"
        : "pending";
  const preparationStepStatus: ProcessStepStatus = running
    ? "running"
    : errored
      ? "pending"
      : complete
        ? (ready ? "done" : "failed")
        : "pending";

  const steps: ClientProcessStep[] = [
    step(
      "account_added",
      label(lang, "Compte ajouté", "Account added"),
      null,
      accountStepStatus,
    ),
    step(
      "configuration_checked",
      label(lang, "Configuration vérifiée", "Configuration checked"),
      null,
      configStepStatus,
    ),
    step(
      "preparation_checked",
      label(lang, "Préparation vérifiée", "Readiness verified"),
      null,
      preparationStepStatus,
    ),
  ];

  if (errored) {
    return {
      title: label(lang, "Vérification de la préparation", "Readiness check"),
      subtitle: label(lang, "La vérification n'a pas pu aboutir.", "The readiness check could not complete."),
      statusChip: label(lang, "À compléter", "Pending"),
      statusTone: "error",
      steps,
      finalMessage: input.errorMessage
        || label(lang, "Impossible de vérifier la préparation pour le moment.", "Could not verify readiness right now."),
      showRefresh: false,
      isComplete: true,
      isAsyncPending: false,
      outcome: "error",
    };
  }

  if (complete && ready) {
    return {
      title: label(lang, "Vérification de la préparation", "Readiness check"),
      subtitle: label(lang, "Votre compte est prêt à être connecté.", "Your account is ready to connect."),
      statusChip: label(lang, "Prêt", "Ready"),
      statusTone: "success",
      steps,
      finalMessage: label(lang, "Votre compte est prêt à être connecté.", "Your account is ready to connect."),
      showRefresh: false,
      isComplete: true,
      isAsyncPending: false,
      outcome: "success",
    };
  }

  if (complete) {
    const ui = input.account ? resolveClientAccountState(input.account, lang) : null;
    return {
      title: label(lang, "Vérification de la préparation", "Readiness check"),
      subtitle: label(lang, "La préparation n'est pas encore complète.", "Setup is not complete yet."),
      statusChip: label(lang, "À compléter", "Pending"),
      statusTone: "warning",
      steps,
      finalMessage: ui?.subtext
        || label(lang, "La préparation est en cours. Réessayez dans quelques instants.", "Setup is still in progress. Try again in a moment."),
      showRefresh: false,
      isComplete: true,
      isAsyncPending: false,
      outcome: "action_required",
    };
  }

  return {
    title: label(lang, "Vérification de la préparation", "Readiness check"),
    subtitle: label(
      lang,
      "Nous vérifions la préparation de votre compte, sans lancer de connexion.",
      "We are checking your account setup without starting a connection.",
    ),
    statusChip: label(lang, "En cours", "In progress"),
    statusTone: "running",
    steps,
    finalMessage: null,
    showRefresh: false,
    isComplete: false,
    isAsyncPending: false,
    outcome: "running",
  };
}

export const PASSIVE_READINESS_FORBIDDEN_LABELS = [
  "Connexion au compte",
  "Lancement de la connexion automatique",
  "Vérification de la session Instagram",
  "Vérification de la session",
  "Préparation du compte",
  "Vérification finale",
] as const;

export const CLIENT_PROCESS_FORBIDDEN_LABELS = [
  "vault",
  "slot",
  "device",
  "clone",
  "assignment",
  "worker",
  "backend",
  "rpc",
  "supabase",
  "botapp",
  "dispatcher",
  "run_id",
];
