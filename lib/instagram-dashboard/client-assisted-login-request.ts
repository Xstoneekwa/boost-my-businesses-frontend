import {
  loadProvisioningReservationById,
  markProvisioningAssistedRequested,
  type ClientProvisioningSlotReservationRow,
} from "./client-provisioning-slot-reservations.ts";
import { sendClientAssistedLoginNotification } from "./client-assisted-login-notifications.ts";

export const CLIENT_ASSISTED_LOGIN_REQUESTED_ACTION_TYPE =
  "client_assisted_login_requested" as const;

const ACTIVE_ACTION_STATUSES = ["pending", "acknowledged", "pending_verification"] as const;

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function assistedActionDedupeKey(reservationId: string) {
  return `client_assisted_login:${reservationId}`;
}

async function loadUsername(supabase: SupabaseLike, igAccountId: string) {
  const result = await (supabase.from("ig_accounts") as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        limit: (n: number) => { maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }> };
      };
    };
  })
    .select("username")
    .eq("id", igAccountId)
    .limit(1)
    .maybeSingle();
  return readString((result.data as Row | null)?.username, "unknown");
}

async function loadActiveAssistedAction(supabase: SupabaseLike, reservationId: string) {
  const dedupeKey = assistedActionDedupeKey(reservationId);
  const result = await (supabase.from("account_dashboard_actions") as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        in: (col2: string, values: string[]) => {
          limit: (n: number) => { maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }> };
        };
      };
    };
  })
    .select("id,status,action_deep_link,metadata")
    .eq("dedupe_key", dedupeKey)
    .in("status", [...ACTIVE_ACTION_STATUSES])
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "assisted_action_unavailable");
  return result.data as Row | null;
}

function buildActionDeepLink(actionId: string) {
  return `/instagram-dashboard/credentials-actions?action_id=${encodeURIComponent(actionId)}`;
}

export type RequestClientAssistedLoginInput = {
  igAccountId: string;
  clientId: string;
  reservationId: string;
  actorUserId?: string | null;
};

export type RequestClientAssistedLoginResult =
  | { ok: true; actionId: string; idempotent: boolean; deepLink: string }
  | { ok: false; reason: string };

export async function requestClientAssistedLogin(
  supabase: SupabaseLike,
  input: RequestClientAssistedLoginInput,
): Promise<RequestClientAssistedLoginResult> {
  const reservation = await loadProvisioningReservationById(supabase, input.reservationId);
  if (!reservation || reservation.ig_account_id !== input.igAccountId) {
    return { ok: false, reason: "provisioning_reservation_not_found" };
  }
  if (reservation.client_id !== input.clientId) {
    return { ok: false, reason: "forbidden" };
  }
  if (!["reserved", "window_open", "assisted_requested"].includes(reservation.status)) {
    return { ok: false, reason: "provisioning_reservation_not_assistable" };
  }

  const existing = await loadActiveAssistedAction(supabase, reservation.id);
  if (existing?.id) {
    return {
      ok: true,
      actionId: readString(existing.id),
      idempotent: true,
      deepLink: readString(existing.action_deep_link) || buildActionDeepLink(readString(existing.id)),
    };
  }

  await markProvisioningAssistedRequested(supabase, reservation.id, input.igAccountId);
  const username = await loadUsername(supabase, input.igAccountId);
  const safeMetadata = {
    reservation_id: reservation.id,
    client_instagram_account_id: reservation.client_instagram_account_id,
    assignment_id: reservation.assignment_id,
    device_id: reservation.device_id,
    app_instance_id: reservation.app_instance_id,
    window_start_utc: reservation.window_start_utc,
    window_end_utc: reservation.window_end_utc,
    source: "cp6_client_assisted_connect",
  };

  const { data, error } = await supabase.rpc("upsert_account_dashboard_action", {
    p_account_id: input.igAccountId,
    p_client_id: input.clientId,
    p_incident_id: null,
    p_action_type: CLIENT_ASSISTED_LOGIN_REQUESTED_ACTION_TYPE,
    p_status: "pending",
    p_title: "Client requested assisted connection",
    p_dedupe_key: assistedActionDedupeKey(reservation.id),
    p_severity: "warning",
    p_audience: "admin",
    p_requires_client_action: false,
    p_blocking_campaign: false,
    p_safe_client_message: null,
    p_assistant_message: null,
    p_admin_message: `Client requested assisted Instagram login for @${username}.`,
    p_action_label: "Start Auto Login",
    p_action_deep_link: null,
    p_metadata: safeMetadata,
  });
  if (error) return { ok: false, reason: "assisted_action_create_failed" };

  const actionId = readString((data as Row | null)?.id);
  if (!actionId) return { ok: false, reason: "assisted_action_create_failed" };

  const deepLink = buildActionDeepLink(actionId);
  await (supabase.from("account_dashboard_actions") as {
    update: (values: Record<string, unknown>) => {
      eq: (col: string, value: string) => Promise<{ error?: { message?: string } | null }>;
    };
  })
    .update({ action_deep_link: deepLink })
    .eq("id", actionId);

  await sendClientAssistedLoginNotification({
    accountUsername: username,
    actionId,
    deepLink,
    reservationId: reservation.id,
  }).catch(() => undefined);

  return { ok: true, actionId, idempotent: false, deepLink };
}

export function projectAssistedLoginActionMetadata(
  reservation: ClientProvisioningSlotReservationRow,
  actionId: string,
) {
  return {
    actionId,
    reservationId: reservation.id,
    accountId: reservation.ig_account_id,
    assignmentId: reservation.assignment_id,
    deviceId: reservation.device_id,
    appInstanceId: reservation.app_instance_id,
    windowStartUtc: reservation.window_start_utc,
    windowEndUtc: reservation.window_end_utc,
    expectedPackage: reservation.expected_package,
    deepLink: buildActionDeepLink(actionId),
  };
}
