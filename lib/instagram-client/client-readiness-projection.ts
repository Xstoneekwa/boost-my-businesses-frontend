import type { ReadinessNowResult } from "../instagram-dashboard/readiness-now.ts";

export type ClientReadinessStatus =
  | "ready_to_connect"
  | "preparation_pending"
  | "preparation_blocked"
  | "secure_preparation_in_progress"
  | "credentials_need_attention"
  | "device_temporarily_unavailable"
  | "schedule_not_ready"
  | "already_connected";

const CLIENT_READINESS_MESSAGES: Record<ClientReadinessStatus, { fr: string; en: string }> = {
  ready_to_connect: {
    fr: "Votre compte est prêt à être connecté.",
    en: "Your account is ready to connect.",
  },
  preparation_pending: {
    fr: "Nous préparons votre compte automatiquement. Actualisez cette vérification dans quelques instants.",
    en: "We're preparing your account automatically. Refresh this check in a moment.",
  },
  preparation_blocked: {
    fr: "La préparation est temporairement bloquée. Contactez le support si cela persiste.",
    en: "Setup is temporarily blocked. Contact support if this continues.",
  },
  secure_preparation_in_progress: {
    fr: "Nous finalisons une étape sécurisée de préparation. Actualisez dans quelques instants.",
    en: "We're completing a secure preparation step. Refresh in a moment.",
  },
  credentials_need_attention: {
    fr: "Vérifiez votre nom d'utilisateur et votre mot de passe Instagram, puis relancez la vérification.",
    en: "Check your Instagram username and password, then run the readiness check again.",
  },
  device_temporarily_unavailable: {
    fr: "Nous finalisons la préparation de votre compte. Actualisez dans quelques instants.",
    en: "We're finishing your account setup. Refresh in a moment.",
  },
  schedule_not_ready: {
    fr: "La connexion sera disponible pendant la prochaine fenêtre horaire prévue.",
    en: "Connection will be available during the next scheduled window.",
  },
  already_connected: {
    fr: "Votre compte Instagram est déjà connecté.",
    en: "Your Instagram account is already connected.",
  },
};

export function projectClientReadinessStatus(readiness: ReadinessNowResult): ClientReadinessStatus {
  if (readiness.reason === "orphan_login_challenge_pending" || readiness.orphan_recovery?.blocking_client) {
    return "secure_preparation_in_progress";
  }
  if (readiness.client_status === "connected_ready") return "already_connected";
  if (readiness.readiness_status === "ready_to_connect" && readiness.client_status === "ready_to_connect") {
    return "ready_to_connect";
  }
  if (readiness.blockers?.includes("missing_assignment")) {
    return "preparation_pending";
  }
  if (
    readiness.reason === "credentials_missing_or_inactive"
    || readiness.client_status === "update_password"
    || readiness.client_status === "action_required_2fa"
    || readiness.client_status === "action_required_checkpoint"
  ) {
    return "credentials_need_attention";
  }
  if (readiness.reason === "phone_or_app_unavailable") {
    return "device_temporarily_unavailable";
  }
  if (
    readiness.reason === "waiting_scheduled_assignment"
    || readiness.client_status === "waiting_next_slot"
    || readiness.assignment_status === "missing"
    || readiness.assignment_status === "waiting_scheduled_assignment"
  ) {
    return "preparation_pending";
  }
  if (readiness.reason === "assignment_window_closed") {
    return "schedule_not_ready";
  }
  if (readiness.client_status === "capacity_unavailable") {
    return "device_temporarily_unavailable";
  }
  if (readiness.client_status === "try_again_later") {
    return "preparation_blocked";
  }
  return "preparation_pending";
}

export function clientReadinessMessage(status: ClientReadinessStatus, lang: "fr" | "en" = "fr") {
  return CLIENT_READINESS_MESSAGES[status]?.[lang] ?? CLIENT_READINESS_MESSAGES.preparation_pending[lang];
}

export function clientReadinessAllowsConnect(status: ClientReadinessStatus) {
  return status === "ready_to_connect";
}

export function clientReadinessIsAutomaticPreparationInProgress(status: ClientReadinessStatus | string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "preparation_pending" || normalized === "secure_preparation_in_progress";
}

export function clientReadinessIsBlocked(status: ClientReadinessStatus | string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "preparation_blocked"
    || normalized === "credentials_need_attention"
    || normalized === "device_temporarily_unavailable"
    || normalized === "schedule_not_ready";
}
