import type { ClientConnectStatus } from "./connect-client-contract.ts";
import type { ClientConnectProgressSnapshot } from "./connect-progress-projection.ts";
import { readString } from "./guards.ts";

export const ACTIVE_CLIENT_CONNECT_STATUSES = new Set<ClientConnectStatus>([
  "queued",
  "already_queued",
  "running",
  "verification_required",
  "verification_code_accepted",
  "verification_resume_active",
  "verification_code_submitted",
]);

export const ACTIVE_LOGIN_PROVISIONING_REQUEST_STATUSES = [
  "queued",
  "claimed",
  "starting",
  "running",
] as const;

export function isActiveClientConnectStatus(status: string | null | undefined): status is ClientConnectStatus {
  if (!status) return false;
  return ACTIVE_CLIENT_CONNECT_STATUSES.has(status as ClientConnectStatus);
}

export function shouldSuppressPassiveReadyToConnect(status: string | null | undefined) {
  return isActiveClientConnectStatus(status);
}

export function shouldBlockClientConnect(status: string | null | undefined) {
  return isActiveClientConnectStatus(status);
}

export function isTerminalClientConnectProgress(snapshot: ClientConnectProgressSnapshot | null | undefined) {
  if (!snapshot) return true;
  if (snapshot.connected || snapshot.failed) return true;
  return !isActiveClientConnectStatus(snapshot.connect_status);
}

export function labelForActiveConnectStatus(status: ClientConnectStatus, lang: "fr" | "en" = "fr") {
  const labels: Partial<Record<ClientConnectStatus, { fr: string; en: string }>> = {
    queued: { fr: "Connexion en file", en: "Connection queued" },
    already_queued: { fr: "Connexion en file", en: "Connection queued" },
    running: { fr: "Connexion en cours", en: "Connection in progress" },
    verification_required: { fr: "Vérification requise", en: "Verification required" },
    verification_code_accepted: { fr: "Code enregistré", en: "Code saved" },
    verification_resume_active: { fr: "Vérification en cours", en: "Verification in progress" },
    verification_code_submitted: { fr: "Vérification en cours", en: "Verification in progress" },
  };
  return labels[status]?.[lang] ?? (lang === "fr" ? "Connexion en cours" : "Connection in progress");
}

export function isCanonicalVerificationPending(input: {
  loginStatus?: string | null;
  provisioningStatus?: string | null;
}) {
  const loginStatus = readString(input.loginStatus).toLowerCase();
  const provisioningStatus = readString(input.provisioningStatus).toLowerCase();
  if (["verification_pending", "needs_2fa", "checkpoint"].includes(loginStatus)) return true;
  return provisioningStatus === "login_verification_pending";
}
