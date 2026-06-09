import { runReadinessNow, type ReadinessNowResult } from "@/lib/instagram-dashboard/readiness-now";

export type ConnectNowStatus =
  | "connected"
  | "connecting"
  | "code_required"
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

type SupabaseLike = Parameters<typeof runReadinessNow>[0];
type Row = Record<string, unknown>;

const ACTIVE_EMAIL_CODE_STATUSES = ["pending", "acknowledged", "pending_verification", "code_submitted"];
export const CONNECT_EMAIL_CODE_ACTION_TTL_MS = 10 * 60 * 1000;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function readMetadata(row: Row) {
  return row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function actionExpiryMs(row: Row, now: Date) {
  const metadata = readMetadata(row);
  const explicitExpiry = Date.parse(readString(metadata.action_expires_at, readString(metadata.expires_at, "")));
  if (Number.isFinite(explicitExpiry)) return explicitExpiry;

  const updatedAt = Date.parse(readString(row.updated_at, readString(row.created_at, "")));
  if (!Number.isFinite(updatedAt)) return now.getTime() - 1;
  return updatedAt + CONNECT_EMAIL_CODE_ACTION_TTL_MS;
}

async function listEmailCodeActions(supabase: SupabaseLike, accountId: string) {
  const result = ((supabase.from("account_dashboard_actions") as {
    select: (...args: unknown[]) => unknown;
  })
    .select("id,account_id,status,updated_at,created_at,metadata")) as {
      eq: (...args: unknown[]) => {
        eq: (...args: unknown[]) => {
          in: (...args: unknown[]) => {
            order: (...args: unknown[]) => {
              limit: (...args: unknown[]) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
            };
          };
        };
      };
    };
  const response = await result
    .eq("account_id", accountId)
    .eq("action_type", "enter_email_verification_code")
    .in("status", ACTIVE_EMAIL_CODE_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (response.error) throw new Error(response.error.message || "email_code_actions_unavailable");
  return readRows(response.data);
}

async function dismissStaleEmailCodeActions(supabase: SupabaseLike, actions: Row[], now: Date) {
  const staleIds = actions
    .filter((row) => actionExpiryMs(row, now) <= now.getTime())
    .map((row) => readString(row.id))
    .filter(Boolean);
  if (!staleIds.length) return 0;

  const result = await (supabase.from("account_dashboard_actions") as {
    update: (...args: unknown[]) => {
      in: (...args: unknown[]) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
    };
  })
    .update({
      status: "dismissed",
      updated_at: now.toISOString(),
    })
    .in("id", staleIds);
  if (result.error) throw new Error(result.error.message || "email_code_action_cleanup_failed");
  return staleIds.length;
}

function statusMessage(status: ConnectNowStatus) {
  switch (status) {
    case "connected":
      return "Compte connecté.";
    case "connecting":
      return "Connexion en cours.";
    case "code_required":
      return "Code requis. Entrez le code reçu pour continuer la connexion.";
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

function codeRequiredResult(reason: string): ConnectNowResult {
  return {
    status: "code_required",
    reason,
    message: statusMessage("code_required"),
    request_queued: false,
    idempotent: true,
    next_action: "enter_email_verification_code",
  };
}

export async function connectNowForAccount(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    actorId?: string | null;
    now?: Date;
  },
): Promise<ConnectNowResult> {
  const now = input.now ?? new Date();
  const emailCodeActions = await listEmailCodeActions(supabase, input.accountId);
  await dismissStaleEmailCodeActions(supabase, emailCodeActions, now);
  if (emailCodeActions.some((row) => actionExpiryMs(row, now) > now.getTime())) {
    return codeRequiredResult("email_verification_code_action_pending");
  }

  const readiness = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.actorId,
    audience: "admin",
    now,
  });
  return connectNowFromReadiness(readiness);
}
