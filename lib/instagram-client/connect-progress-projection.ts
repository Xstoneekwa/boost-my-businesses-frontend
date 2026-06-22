import {
  type ClientConnectStatus,
  clientConnectMessage,
} from "./connect-client-contract.ts";
import { readString } from "./guards.ts";

export type ClientConnectProgressAction = {
  id: string;
  action_type: string;
  status: string;
  title: string;
  message: string;
  resume_status?: string | null;
  can_submit_code: boolean;
};

export type ClientConnectProgressStep = {
  id: string;
  label: string;
  subtitle: string;
  status: string;
};

export type ClientConnectProgressSnapshot = {
  account_id: string;
  connect_status: ClientConnectStatus;
  message: string;
  request_id: string | null;
  request_status: string | null;
  run_status: string | null;
  verification: {
    required: boolean;
    code_submitted: boolean;
    challenge_status: string | null;
  };
  action_required: ClientConnectProgressAction | null;
  steps: ClientConnectProgressStep[];
  connected: boolean;
  failed: boolean;
  generated_at: string;
};

const EMAIL_CODE_ACTION = "enter_email_verification_code";
const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted", "open"]);
const SUBMITTABLE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification"]);

type ProgressInput = {
  accountId: string;
  overallStatus: string;
  requestStatus?: string | null;
  runStatus?: string | null;
  requestId?: string | null;
  reason?: string | null;
  loginStatus?: string | null;
  actionRequired?: {
    id?: string;
    action_type?: string;
    status?: string;
    title?: string;
    message?: string;
    resume_status?: string | null;
  } | null;
  steps?: Array<{
    id?: string;
    label?: string;
    subtitle?: string;
    status?: string;
  }>;
  lang?: "fr" | "en";
};

function readMetadataResumeStatus(action: ProgressInput["actionRequired"]) {
  return readString(action?.resume_status, "");
}

function mapVerificationState(action: ProgressInput["actionRequired"]) {
  const actionType = readString(action?.action_type);
  const actionStatus = readString(action?.status).toLowerCase();
  if (actionType !== EMAIL_CODE_ACTION || !ACTIVE_ACTION_STATUSES.has(actionStatus)) {
    return { required: false, code_submitted: false, challenge_status: null as string | null };
  }
  if (actionStatus === "code_submitted") {
    return { required: true, code_submitted: true, challenge_status: "code_submitted" };
  }
  return { required: true, code_submitted: false, challenge_status: actionStatus || "pending" };
}

export function mapProgressToClientConnectStatus(input: ProgressInput): ClientConnectStatus {
  const overall = readString(input.overallStatus).toLowerCase();
  const requestStatus = readString(input.requestStatus).toLowerCase();
  const runStatus = readString(input.runStatus).toLowerCase();
  const loginStatus = readString(input.loginStatus).toLowerCase();
  const verification = mapVerificationState(input.actionRequired);

  if (loginStatus === "connected" || overall === "connected") return "connected";
  if (verification.required && verification.code_submitted) return "verification_code_submitted";
  if (verification.required) return "verification_required";
  if (overall === "failed" || runStatus === "failed" || requestStatus === "failed") return "failed";
  if (overall === "blocked" || requestStatus === "blocked") return "blocked";
  if (requestStatus === "queued" || overall === "queued") return "queued";
  if (["running", "claimed", "starting"].includes(requestStatus) || ["running", "claimed", "starting"].includes(overall) || ["running", "started", "in_progress"].includes(runStatus)) {
    return "running";
  }
  if (!input.requestId && !input.requestStatus) return "not_created";
  if (overall === "action_required") return "verification_required";
  return "running";
}

function clientSafeStepLabel(label: string, lang: "fr" | "en") {
  const replacements: Record<string, { fr: string; en: string }> = {
    "Queue request": { fr: "Demande en file", en: "Queue request" },
    "Dispatcher claim": { fr: "Prise en charge", en: "Dispatcher claim" },
    "Open Instagram": { fr: "Ouverture Instagram", en: "Open Instagram" },
    "Check current session": { fr: "Vérification session", en: "Check current session" },
    "Enter credentials": { fr: "Connexion sécurisée", en: "Secure sign-in" },
    "Verify identity": { fr: "Vérification identité", en: "Verify identity" },
    "Save login status": { fr: "Finalisation", en: "Save login status" },
  };
  return replacements[label]?.[lang] ?? label;
}

function clientSafeStepSubtitle(subtitle: string) {
  return subtitle
    .replace(/request [a-f0-9-]{8,}/gi, "demande en cours")
    .replace(/run [a-f0-9-]{8,}/gi, "connexion en cours")
    .replace(/Vault credentials could not be read\./gi, "Identifiants temporairement indisponibles.")
    .replace(/Username\/password field not found on the login form\./gi, "Écran de connexion non reconnu.")
    .replace(/Android autofill interrupted login before credentials were submitted\./gi, "Connexion interrompue avant validation.")
    .slice(0, 180);
}

export function projectClientConnectProgress(input: ProgressInput): ClientConnectProgressSnapshot {
  const lang = input.lang ?? "fr";
  const connectStatus = mapProgressToClientConnectStatus(input);
  const verification = mapVerificationState(input.actionRequired);
  const actionStatus = readString(input.actionRequired?.status).toLowerCase();
  const resumeStatus = readMetadataResumeStatus(input.actionRequired) || null;
  const canSubmitCode = verification.required
    && !verification.code_submitted
    && (SUBMITTABLE_ACTION_STATUSES.has(actionStatus) || resumeStatus === "needs_new_code");

  const actionRequired = input.actionRequired && verification.required ? {
    id: readString(input.actionRequired.id),
    action_type: readString(input.actionRequired.action_type),
    status: actionStatus,
    title: readString(input.actionRequired.title, lang === "fr" ? "Vérification requise" : "Verification required"),
    message: readString(
      input.actionRequired.message,
      lang === "fr"
        ? "Instagram demande une vérification avant de terminer la connexion de votre compte."
        : "Instagram requires verification before your account connection can finish.",
    ),
    resume_status: resumeStatus,
    can_submit_code: canSubmitCode,
  } : null;

  const message = connectStatus === "verification_required"
    ? (lang === "fr"
      ? "Instagram demande une vérification avant de terminer la connexion de votre compte."
      : "Instagram requires verification before your account connection can finish.")
    : connectStatus === "verification_code_submitted"
      ? (lang === "fr"
        ? "Code reçu. Nous reprenons la connexion automatiquement."
        : "Code received. We are resuming the connection automatically.")
      : clientConnectMessage(connectStatus, lang);

  const steps = (input.steps ?? []).slice(0, 7).map((step) => ({
    id: readString(step.id, "step"),
    label: clientSafeStepLabel(readString(step.label, "Progress"), lang),
    subtitle: clientSafeStepSubtitle(readString(step.subtitle, "")),
    status: readString(step.status, "pending"),
  }));

  return {
    account_id: input.accountId,
    connect_status: connectStatus,
    message,
    request_id: readString(input.requestId, "") || null,
    request_status: readString(input.requestStatus, "") || null,
    run_status: readString(input.runStatus, "") || null,
    verification,
    action_required: actionRequired,
    steps,
    connected: connectStatus === "connected",
    failed: connectStatus === "failed" || connectStatus === "blocked",
    generated_at: new Date().toISOString(),
  };
}
