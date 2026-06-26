import {
  type ClientConnectStatus,
  clientConnectMessage,
} from "./connect-client-contract.ts";
import { isCanonicalVerificationPending } from "./connect-operation-state.ts";
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
const VERIFICATION_ACTION_TYPES = new Set([
  EMAIL_CODE_ACTION,
  "complete_two_factor",
  "resolve_checkpoint",
  "review_login_challenge",
]);
const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted", "open"]);
const SUBMITTABLE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification"]);

type ProgressInput = {
  accountId: string;
  overallStatus: string;
  requestStatus?: string | null;
  runStatus?: string | null;
  requestId?: string | null;
  resumeRequestStatus?: string | null;
  reason?: string | null;
  loginStatus?: string | null;
  provisioningStatus?: string | null;
  challengeChainActive?: boolean;
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

function isResumeRequestActive(status: string) {
  return ["queued", "claimed", "starting", "running"].includes(status);
}

function resolveEffectiveResumeStatus(input: ProgressInput): string {
  const raw = readMetadataResumeStatus(input.actionRequired);
  const resumeRequestStatus = readString(input.resumeRequestStatus).toLowerCase();
  if (!raw) return "";
  if (raw === "needs_new_code" && isResumeRequestActive(resumeRequestStatus)) {
    return "running";
  }
  return raw;
}

function resolveVerificationResumeState(input: ProgressInput) {
  const actionStatus = readString(input.actionRequired?.status).toLowerCase();
  const rawResumeStatus = readMetadataResumeStatus(input.actionRequired).toLowerCase();
  const resumeStatus = resolveEffectiveResumeStatus(input).toLowerCase();
  const resumeRequestStatus = readString(input.resumeRequestStatus).toLowerCase();
  const codeSubmitted = actionStatus === "code_submitted"
    || rawResumeStatus === "queued"
    || rawResumeStatus === "running"
    || resumeStatus === "running"
    || isResumeRequestActive(resumeRequestStatus);
  const resumeActive = isResumeRequestActive(resumeRequestStatus)
    || resumeStatus === "running"
    || (resumeStatus === "queued" && codeSubmitted);
  return { codeSubmitted, resumeActive };
}

function readMetadataResumeStatus(action: ProgressInput["actionRequired"]) {
  return readString(action?.resume_status, "");
}

function mapVerificationState(action: ProgressInput["actionRequired"]) {
  const actionType = readString(action?.action_type);
  const actionStatus = readString(action?.status).toLowerCase();
  const verificationAction = VERIFICATION_ACTION_TYPES.has(actionType) || !actionType;
  if (!verificationAction || !action) {
    return { required: false, code_submitted: false, challenge_status: null as string | null };
  }
  if (!ACTIVE_ACTION_STATUSES.has(actionStatus) && actionStatus !== "pending_verification") {
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
  const chainActive = input.challengeChainActive !== false;
  const accountVerificationPending = chainActive && isCanonicalVerificationPending({
    loginStatus: input.loginStatus,
    provisioningStatus: input.provisioningStatus,
  });

  if (loginStatus === "connected" || overall === "connected") return "connected";
  if (accountVerificationPending || verification.required) {
    const resumeState = resolveVerificationResumeState(input);
    if (resumeState.resumeActive) return "verification_resume_active";
    if (
      resumeState.codeSubmitted
      && (requestStatus === "failed" || runStatus === "failed" || overall === "failed")
    ) {
      return "failed";
    }
    if (resumeState.codeSubmitted || verification.code_submitted) return "verification_code_accepted";
    return "verification_required";
  }
  if (input.challengeChainActive === false) {
    if (requestStatus === "failed" || runStatus === "failed" || overall === "failed") return "failed";
    if (["canceled", "completed", "blocked"].includes(requestStatus) || overall === "blocked") {
      return requestStatus === "blocked" || overall === "blocked" ? "blocked" : "not_created";
    }
    if (!input.requestId && !input.requestStatus) return "not_created";
    if (!["queued", "claimed", "starting", "running"].includes(requestStatus) && !["running", "started", "in_progress"].includes(runStatus)) {
      return "not_created";
    }
  }
  if (overall === "failed" || runStatus === "failed" || requestStatus === "failed") return "failed";
  if (overall === "blocked" || requestStatus === "blocked") return "blocked";
  if (requestStatus === "queued" || overall === "queued") return "queued";
  if (["running", "claimed", "starting"].includes(requestStatus) || ["running", "claimed", "starting"].includes(overall) || ["running", "started", "in_progress"].includes(runStatus)) {
    return "running";
  }
  if (overall === "action_required" || verification.required) return "verification_required";
  if (!input.requestId && !input.requestStatus) return "not_created";
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
  const chainActive = input.challengeChainActive !== false;
  const accountVerificationPending = chainActive && isCanonicalVerificationPending({
    loginStatus: input.loginStatus,
    provisioningStatus: input.provisioningStatus,
  });
  const verification = mapVerificationState(input.actionRequired);
  const actionStatus = readString(input.actionRequired?.status).toLowerCase();
  const resumeStatus = resolveEffectiveResumeStatus(input) || null;
  const resumeState = resolveVerificationResumeState(input);
  const canSubmitCode = (verification.required || accountVerificationPending)
    && !resumeState.codeSubmitted
    && !resumeState.resumeActive
    && Boolean(readString(input.actionRequired?.id))
    && (SUBMITTABLE_ACTION_STATUSES.has(actionStatus) || actionStatus === "pending_verification");

  const actionRequired = input.actionRequired && (verification.required || accountVerificationPending) ? {
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
    : connectStatus === "verification_code_accepted"
      ? (lang === "fr"
        ? "Code enregistré. Nous préparons la reprise de la connexion."
        : "Code saved. We are preparing to resume the connection.")
      : connectStatus === "verification_resume_active" || connectStatus === "verification_code_submitted"
        ? (lang === "fr"
          ? "Vérification en cours. Nous reprenons la connexion automatiquement."
          : "Verification in progress. We are resuming the connection automatically.")
        : connectStatus === "blocked" && readString(input.reason)
        ? readString(input.reason)
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
