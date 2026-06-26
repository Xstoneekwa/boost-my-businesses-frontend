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
    fr: "La préparation est en cours. Réessayez dans quelques instants.",
    en: "Setup is still in progress. Try again in a moment.",
  },
  preparation_blocked: {
    fr: "La préparation est temporairement bloquée. Contactez le support si cela persiste.",
    en: "Setup is temporarily blocked. Contact support if this continues.",
  },
  secure_preparation_in_progress: {
    fr: "La préparation sécurisée de votre compte est en cours.",
    en: "Secure account preparation is in progress.",
  },
  credentials_need_attention: {
    fr: "Vos identifiants Instagram nécessitent une vérification.",
    en: "Your Instagram credentials need attention.",
  },
  device_temporarily_unavailable: {
    fr: "Le téléphone préparé pour votre compte est temporairement indisponible.",
    en: "The phone prepared for your account is temporarily unavailable.",
  },
  schedule_not_ready: {
    fr: "La fenêtre de connexion n'est pas encore ouverte.",
    en: "The connection window is not open yet.",
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
