import type { ReadinessNowClientStatus } from "@/lib/instagram-dashboard/readiness-now";
import type { ConnectNowStatus } from "@/lib/instagram-dashboard/connect-now";
import { projectClientAccountRow as projectRow } from "./guards";

export type ClientAccountRow = ReturnType<typeof projectRow>;

const CLIENT_READINESS_LABELS: Record<ReadinessNowClientStatus, { fr: string; en: string }> = {
  connected_ready: { fr: "Compte connecté", en: "Account connected" },
  ready_to_connect: { fr: "Prêt à connecter", en: "Ready to connect" },
  checking_connection: { fr: "Connexion en cours", en: "Connecting" },
  action_required_2fa: { fr: "Vérification requise", en: "Login verification required" },
  action_required_checkpoint: { fr: "Vérification requise", en: "Login verification required" },
  update_password: { fr: "Mot de passe requis", en: "Needs credentials" },
  capacity_unavailable: { fr: "Configuration en attente", en: "Device setup pending" },
  waiting_next_slot: { fr: "En attente du prochain créneau", en: "Waiting for assignment" },
  try_again_later: { fr: "Réessayez plus tard", en: "Try again later" },
};

export function clientReadinessLabel(status: ReadinessNowClientStatus, lang: "fr" | "en" = "en") {
  return CLIENT_READINESS_LABELS[status]?.[lang] ?? (lang === "fr" ? "Statut en cours" : "Status pending");
}

export function clientConnectLabel(status: ConnectNowStatus, lang: "fr" | "en" = "en") {
  const map: Record<ConnectNowStatus, { fr: string; en: string }> = {
    connected: { fr: "Connecté", en: "Connected" },
    connecting: { fr: "Connexion en cours", en: "Connecting" },
    code_required: { fr: "Code requis", en: "Verification required" },
    two_factor_required: { fr: "Code requis", en: "Verification required" },
    checkpoint_required: { fr: "Assistance requise", en: "Needs assistance" },
    update_password: { fr: "Mot de passe requis", en: "Needs credentials" },
    credentials_missing: { fr: "Identifiants requis", en: "Needs credentials" },
    phone_unavailable: { fr: "Configuration en attente", en: "Device setup pending" },
    assignment_required: { fr: "Configuration en attente", en: "Waiting for assignment" },
    try_again_later: { fr: "Réessayez plus tard", en: "Try again later" },
  };
  return map[status]?.[lang] ?? (lang === "fr" ? "Statut en cours" : "Status pending");
}

export function projectClientAccountRow(input: Parameters<typeof projectRow>[0]): ClientAccountRow {
  return projectRow(input);
}
