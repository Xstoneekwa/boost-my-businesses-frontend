import type { ReadinessNowClientStatus } from "@/lib/instagram-dashboard/readiness-now";
import type { ConnectNowStatus } from "@/lib/instagram-dashboard/connect-now";
import { projectClientAccountRow as projectRow } from "./guards";

export type ClientAccountRow = ReturnType<typeof projectRow>;

const CLIENT_READINESS_LABELS: Record<ReadinessNowClientStatus, { fr: string; en: string }> = {
  connected_ready: { fr: "Préparation vérifiée", en: "Readiness checked" },
  ready_to_connect: { fr: "Compte ajouté", en: "Account added" },
  checking_connection: { fr: "Préparation en cours", en: "Setup in progress" },
  action_required_2fa: { fr: "Connexion à vérifier", en: "Connection check required" },
  action_required_checkpoint: { fr: "Connexion à vérifier", en: "Connection check required" },
  update_password: { fr: "Connexion à vérifier", en: "Connection check required" },
  capacity_unavailable: { fr: "Préparation en cours", en: "Setup in progress" },
  waiting_next_slot: { fr: "Préparation en cours", en: "Setup in progress" },
  try_again_later: { fr: "Réessayez plus tard", en: "Try again later" },
};

export function clientReadinessLabel(status: ReadinessNowClientStatus, lang: "fr" | "en" = "fr") {
  return CLIENT_READINESS_LABELS[status]?.[lang] ?? (lang === "fr" ? "Préparation en cours" : "Setup in progress");
}

export function clientConnectLabel(status: ConnectNowStatus, lang: "fr" | "en" = "fr") {
  const map: Record<ConnectNowStatus, { fr: string; en: string }> = {
    connected: { fr: "Connecté", en: "Connected" },
    connecting: { fr: "Préparation en cours", en: "Setup in progress" },
    code_required: { fr: "Connexion à vérifier", en: "Connection check required" },
    two_factor_required: { fr: "Connexion à vérifier", en: "Connection check required" },
    checkpoint_required: { fr: "Connexion à vérifier", en: "Connection check required" },
    update_password: { fr: "Connexion à vérifier", en: "Connection check required" },
    credentials_missing: { fr: "Connexion à vérifier", en: "Connection check required" },
    phone_unavailable: { fr: "Préparation en cours", en: "Setup in progress" },
    assignment_required: { fr: "Préparation en cours", en: "Setup in progress" },
    try_again_later: { fr: "Réessayez plus tard", en: "Try again later" },
  };
  return map[status]?.[lang] ?? (lang === "fr" ? "Préparation en cours" : "Setup in progress");
}

export function projectClientAccountRow(input: Parameters<typeof projectRow>[0]): ClientAccountRow {
  return projectRow(input);
}
