import { runReadinessNow, type ReadinessNowResult } from "@/lib/instagram-dashboard/readiness-now";

export type ConnectNowStatus =
  | "connected"
  | "connecting"
  | "two_factor_required"
  | "checkpoint_required"
  | "update_password"
  | "credentials_missing"
  | "phone_unavailable"
  | "assignment_required"
  | "try_again_later";

export type ConnectNowResult = {
  status: ConnectNowStatus;
  reason: string;
  message: string;
  request_queued: boolean;
  idempotent: boolean;
  next_action: string;
};

function statusMessage(status: ConnectNowStatus) {
  switch (status) {
    case "connected":
      return "Compte connecté.";
    case "connecting":
      return "Connexion en cours.";
    case "two_factor_required":
      return "Code requis. Entrez le code reçu pour continuer la connexion.";
    case "checkpoint_required":
      return "Checkpoint requis. Suivez l'action de vérification affichée.";
    case "update_password":
      return "Mot de passe à mettre à jour.";
    case "credentials_missing":
      return "Identifiants Instagram manquants ou inactifs.";
    case "phone_unavailable":
      return "Phone ou app Instagram indisponible.";
    case "assignment_required":
      return "Assignment phone/app requis avant connexion.";
    default:
      return "Connexion indisponible. Réessayez plus tard.";
  }
}

export function connectNowFromReadiness(readiness: ReadinessNowResult): ConnectNowResult {
  const requestQueued = readiness.preflight_request_created === true;
  const idempotent = readiness.idempotent === true;
  let status: ConnectNowStatus;

  if (readiness.client_status === "connected_ready") {
    status = "connected";
  } else if (readiness.client_status === "checking_connection") {
    status = "connecting";
  } else if (readiness.client_status === "action_required_2fa") {
    status = "two_factor_required";
  } else if (readiness.client_status === "action_required_checkpoint") {
    status = "checkpoint_required";
  } else if (readiness.client_status === "update_password") {
    status = readiness.reason === "credentials_missing_or_inactive" ? "credentials_missing" : "update_password";
  } else if (readiness.client_status === "capacity_unavailable") {
    status = readiness.assignment_status === "missing" ? "assignment_required" : "phone_unavailable";
  } else if (readiness.client_status === "waiting_next_slot") {
    status = "assignment_required";
  } else {
    status = "try_again_later";
  }

  return {
    status,
    reason: readiness.reason,
    message: statusMessage(status),
    request_queued: requestQueued,
    idempotent,
    next_action: readiness.next_action,
  };
}

export async function connectNowForAccount(
  supabase: Parameters<typeof runReadinessNow>[0],
  input: {
    accountId: string;
    actorId?: string | null;
    now?: Date;
  },
): Promise<ConnectNowResult> {
  const readiness = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.actorId,
    audience: "admin",
    now: input.now,
  });
  return connectNowFromReadiness(readiness);
}
