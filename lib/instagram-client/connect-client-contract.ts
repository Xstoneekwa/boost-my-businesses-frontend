export const CLIENT_CONNECT_STATUSES = [
  "queued",
  "already_queued",
  "running",
  "verification_required",
  "verification_code_submitted",
  "connected",
  "blocked",
  "not_created",
  "failed",
] as const;

export type ClientConnectStatus = (typeof CLIENT_CONNECT_STATUSES)[number];

export type ClientConnectResponseBody = {
  ok: boolean;
  status: ClientConnectStatus;
  code?: string;
  message: string;
  reason?: string;
  client_readiness_status?: string;
  data?: Record<string, unknown>;
};

const ACTIVE_RUN_REQUEST_STATUSES = new Set(["queued", "claimed", "starting", "running"]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export type ClientConnectReadinessSnapshot = {
  idempotent?: boolean;
  reason?: string;
  run_request_status?: string | null;
  preflight_request_created?: boolean;
  client_status?: string;
  blockers?: string[];
};

export function mapReadinessToClientConnectStatus(input: {
  readiness: ClientConnectReadinessSnapshot;
  passiveBlocked?: boolean;
  enqueueRejected?: boolean;
}): ClientConnectStatus {
  if (input.passiveBlocked) return "blocked";
  if (input.enqueueRejected) return "not_created";

  const readiness = input.readiness;
  const runStatus = readString(readiness.run_request_status).toLowerCase();

  if (readiness.idempotent && readiness.reason === "already_requested") {
    return runStatus === "running" || runStatus === "claimed" || runStatus === "starting"
      ? "running"
      : "already_queued";
  }

  if (runStatus === "running" || runStatus === "claimed" || runStatus === "starting") {
    return "running";
  }

  if (readiness.preflight_request_created && runStatus === "queued") {
    return "queued";
  }

  if (
    readiness.reason === "login_preflight_request_not_active"
    || readiness.blockers?.includes("login_preflight_request_not_active")
    || readiness.blockers?.includes("enqueue_rejected")
  ) {
    return "not_created";
  }

  if (readiness.client_status === "try_again_later" && !readiness.preflight_request_created) {
    return "not_created";
  }

  return "failed";
}

export function clientConnectMessage(status: ClientConnectStatus, lang: "fr" | "en" = "fr") {
  const fr: Record<ClientConnectStatus, string> = {
    queued: "Connexion lancée. Nous préparons votre compte sur le téléphone assigné.",
    already_queued: "Connexion déjà en file d'attente pour ce compte.",
    running: "Connexion en cours sur le téléphone assigné.",
    verification_required: "Instagram demande une vérification avant de terminer la connexion de votre compte.",
    verification_code_submitted: "Code reçu. Nous reprenons la connexion automatiquement.",
    connected: "Compte connecté.",
    blocked: "La connexion ne peut pas démarrer pour le moment.",
    not_created: "La connexion n'a pas pu être lancée pour le moment.",
    failed: "La connexion n'a pas pu démarrer. Réessayez plus tard.",
  };
  const en: Record<ClientConnectStatus, string> = {
    queued: "Connection started. We are preparing your account on the assigned phone.",
    already_queued: "Connection is already queued for this account.",
    running: "Connection is in progress on the assigned phone.",
    verification_required: "Instagram requires verification before your account connection can finish.",
    verification_code_submitted: "Code received. We are resuming the connection automatically.",
    connected: "Account connected.",
    blocked: "Connection cannot start right now.",
    not_created: "Connection could not be started right now.",
    failed: "Connection could not start. Try again later.",
  };
  return (lang === "fr" ? fr : en)[status];
}

export function clientConnectOkBody(
  data: Record<string, unknown> & { connectStatus: ClientConnectStatus; message: string },
): ClientConnectResponseBody {
  return {
    ok: true,
    status: data.connectStatus,
    message: data.message,
    data,
  };
}

export function clientConnectErrorBody(input: {
  status: ClientConnectStatus;
  code: string;
  message: string;
  reason?: string;
  client_readiness_status?: string;
  data?: Record<string, unknown>;
}): ClientConnectResponseBody {
  return {
    ok: false,
    status: input.status,
    code: input.code,
    message: input.message,
    reason: input.reason,
    client_readiness_status: input.client_readiness_status,
    data: input.data,
  };
}

export function clientConnectHttpStatus(input: {
  status: ClientConnectStatus;
  httpStatus?: number;
}) {
  if (input.httpStatus) return input.httpStatus;
  return input.status === "blocked" || input.status === "not_created" ? 409 : 500;
}

export function mapRpcErrorToConnectStatus(errorMessage: string): {
  status: ClientConnectStatus;
  code: string;
} {
  const normalized = readString(errorMessage).toLowerCase();
  if (normalized.includes("invalid_actor_type")) {
    return { status: "not_created", code: "connect_request_rejected" };
  }
  if (normalized.includes("account_run_already_requested")) {
    return { status: "already_queued", code: "connect_already_queued" };
  }
  if (normalized.includes("account_already_running")) {
    return { status: "running", code: "connect_already_running" };
  }
  return { status: "not_created", code: "connect_request_rejected" };
}
