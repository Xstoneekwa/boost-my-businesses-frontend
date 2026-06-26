import { createSupabaseClient } from "../supabase.ts";
import { ACTIVE_RUN_REQUEST_STATUSES } from "./run-request-statuses.ts";

type SupabaseRecord = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export const ORPHAN_RECOVERY_RUN_TYPE = "login_orphan_challenge_recovery" as const;

export const ORPHAN_RECOVERY_EVENT_TYPES = [
  "orphan_login_challenge_detected",
  "login_orphan_recovery_started",
  "login_surface_restored",
  "login_orphan_recovery_blocked",
  "login_orphan_recovery_failed",
] as const;

export type OrphanRecoveryState =
  | "none"
  | "orphan_challenge_detected"
  | "recovery_in_progress"
  | "login_surface_restored"
  | "recovery_blocked"
  | "recovery_failed";

const EVENT_TO_STATE: Record<string, OrphanRecoveryState> = {
  orphan_login_challenge_detected: "orphan_challenge_detected",
  login_orphan_recovery_started: "recovery_in_progress",
  login_surface_restored: "login_surface_restored",
  login_orphan_recovery_blocked: "recovery_blocked",
  login_orphan_recovery_failed: "recovery_failed",
};

const CLIENT_BLOCKING_STATES = new Set<OrphanRecoveryState>([
  "orphan_challenge_detected",
  "recovery_in_progress",
  "recovery_blocked",
  "recovery_failed",
]);

export type OrphanLoginRecoveryProjection = {
  state: OrphanRecoveryState;
  blockingClient: boolean;
  botappActionAvailable: boolean;
  detectedAt: string | null;
  hasActiveLoginProvisioning: boolean;
};

function eventToState(actionType: string): OrphanRecoveryState {
  return EVENT_TO_STATE[readString(actionType, "").toLowerCase()] ?? "none";
}

async function loadRecentRecoveryEvents(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_action_logs")
    .select("action_type,status,message,payload,created_at")
    .eq("account_id", accountId)
    .in("action_type", [...ORPHAN_RECOVERY_EVENT_TYPES])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("Could not load orphan recovery events.");
  return (data ?? []) as SupabaseRecord[];
}

async function loadRecentOrphanBlockedRequest(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("account_run_requests")
    .select("id,status,error_code,finished_at,created_at")
    .eq("account_id", accountId)
    .eq("requested_run_type", "login_provisioning")
    .eq("status", "blocked")
    .eq("error_code", "orphan_challenge_provenance_weak")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Could not load orphan blocked request.");
  return data as SupabaseRecord | null;
}

export async function hasActiveLoginProvisioningRequest(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("account_run_requests")
    .select("id,status,requested_run_type")
    .eq("account_id", accountId)
    .in("status", [...ACTIVE_RUN_REQUEST_STATUSES])
    .in("requested_run_type", ["login_provisioning", "login_email_code_resume"])
    .limit(1);
  if (error) throw new Error("Could not verify active login provisioning.");
  return Boolean((data ?? []).length);
}

export async function resolveOrphanLoginRecoveryProjection(accountId: string): Promise<OrphanLoginRecoveryProjection> {
  const [events, blockedRequest, hasActiveLoginProvisioning] = await Promise.all([
    loadRecentRecoveryEvents(accountId),
    loadRecentOrphanBlockedRequest(accountId),
    hasActiveLoginProvisioningRequest(accountId),
  ]);

  const latestEvent = events[0];
  let state: OrphanRecoveryState = latestEvent ? eventToState(readString(latestEvent.action_type, "")) : "none";
  let detectedAt = latestEvent ? readString(latestEvent.created_at, "") || null : null;

  if (state === "none" && blockedRequest) {
    state = "orphan_challenge_detected";
    detectedAt = readString(blockedRequest.finished_at, "") || readString(blockedRequest.created_at, "") || null;
  }

  const blockingClient = CLIENT_BLOCKING_STATES.has(state);
  const botappActionAvailable = !hasActiveLoginProvisioning
    && (state === "orphan_challenge_detected" || state === "recovery_blocked" || state === "recovery_failed");

  return {
    state,
    blockingClient,
    botappActionAvailable,
    detectedAt,
    hasActiveLoginProvisioning,
  };
}

export function clientSecurePreparationMessage(locale: "fr" | "en" = "fr") {
  return locale === "fr"
    ? "La préparation sécurisée de votre compte est en cours."
    : "Secure account preparation is in progress.";
}
