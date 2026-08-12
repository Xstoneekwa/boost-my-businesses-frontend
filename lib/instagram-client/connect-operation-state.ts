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
  if (!snapshot) return false;
  return isExplicitTerminalClientConnectProgress(snapshot);
}

export function isExplicitTerminalClientConnectProgress(
  snapshot: ClientConnectProgressSnapshot | null | undefined,
) {
  if (!snapshot) return false;
  return snapshot.connected
    || snapshot.failed
    || ["connected", "failed", "blocked", "cancelled"].includes(snapshot.connect_status);
}

export function hasCanonicalClientConnectLineage(
  snapshot: ClientConnectProgressSnapshot | null | undefined,
  operationToken?: string | null,
) {
  return Boolean(
    readString(operationToken)
    || readString(snapshot?.request_id)
    || readString(snapshot?.action_required?.id),
  );
}

export function reconcileClientConnectProgressLineage(input: {
  previous: ClientConnectProgressSnapshot | null | undefined;
  incoming: ClientConnectProgressSnapshot | null | undefined;
  operationToken?: string | null;
}) {
  const { previous, incoming, operationToken } = input;
  if (!incoming) return previous ?? null;
  if (isActiveClientConnectStatus(incoming.connect_status)) return incoming;
  if (isExplicitTerminalClientConnectProgress(incoming)) return incoming;
  if (
    incoming.connect_status === "not_created"
    && hasCanonicalClientConnectLineage(previous, operationToken)
  ) {
    return previous ?? null;
  }
  return incoming;
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
