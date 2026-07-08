import { connectNowForAccount } from "./connect-now.ts";
import { evaluatePhoneIdleForClientConnect } from "./evaluate-phone-idle-for-client-connect.ts";
import {
  consumeProvisioningReservation,
  isProvisioningWindowOpen,
  loadProvisioningReservationById,
  type ClientProvisioningSlotReservationRow,
} from "./client-provisioning-slot-reservations.ts";
import { runReadinessNow } from "./readiness-now.ts";
import {
  deadlineForClientConnectAssignment,
  enqueueClientConnectRequest,
  loadClientConnectAssignment,
} from "../instagram-client/enqueue-client-connect.ts";

type SupabaseLike = Parameters<typeof connectNowForAccount>[0];

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export type StartAssistedAutoLoginInput = {
  accountId: string;
  reservationId: string;
  actionId?: string | null;
  actorId?: string | null;
  now?: Date;
};

export type StartAssistedAutoLoginResult =
  | { ok: true; connect: Awaited<ReturnType<typeof connectNowForAccount>>; reservation: ClientProvisioningSlotReservationRow | null }
  | { ok: false; reason: string; message: string };

function fail(reason: string, message: string): StartAssistedAutoLoginResult {
  return { ok: false, reason, message };
}

export async function startAssistedAutoLoginFromReservation(
  supabase: SupabaseLike,
  input: StartAssistedAutoLoginInput,
): Promise<StartAssistedAutoLoginResult> {
  const now = input.now ?? new Date();
  const reservation = await loadProvisioningReservationById(supabase, input.reservationId);
  if (!reservation || reservation.ig_account_id !== input.accountId) {
    return fail("provisioning_reservation_not_found", "Provisioning reservation not found.");
  }
  if (!["reserved", "window_open", "assisted_requested"].includes(reservation.status)) {
    return fail("provisioning_reservation_not_active", "Provisioning reservation is no longer active.");
  }

  if (input.actionId) {
    const actionResult = await (supabase.from("account_dashboard_actions") as {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          eq: (col2: string, value2: string) => {
            limit: (n: number) => { maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }> };
          };
        };
      };
    })
      .select("id,account_id,action_type,metadata")
      .eq("id", input.actionId)
      .eq("account_id", input.accountId)
      .limit(1)
      .maybeSingle();
    const action = actionResult.data as Record<string, unknown> | null;
    const metadata = action?.metadata && typeof action.metadata === "object" && !Array.isArray(action.metadata)
      ? action.metadata as Record<string, unknown>
      : {};
    if (!action || readString(metadata.reservation_id) !== reservation.id) {
      return fail("assisted_action_mismatch", "Assisted action does not match this reservation.");
    }
  }

  if (!isProvisioningWindowOpen(reservation, now)) {
    return fail("provisioning_window_not_open", "The reserved provisioning window is not open yet.");
  }

  const assignment = await loadClientConnectAssignment(supabase, input.accountId);
  if (!assignment) {
    return fail("assignment_required", "Assignment required before Auto Login.");
  }
  const assignmentId = readString(assignment.id);
  const assignmentDeviceId = readString(assignment.device_id);
  const assignmentAppInstanceId = readString(assignment.app_instance_id);
  if (
    assignmentId !== reservation.assignment_id
    || assignmentDeviceId !== reservation.device_id
    || assignmentAppInstanceId !== reservation.app_instance_id
  ) {
    return fail(
      "provisioning_reservation_resource_mismatch",
      "Reserved phone or clone no longer matches the assignment.",
    );
  }

  const idle = await evaluatePhoneIdleForClientConnect(supabase, {
    accountId: input.accountId,
    assignmentId: reservation.assignment_id,
    deviceId: reservation.device_id,
    appInstanceId: reservation.app_instance_id,
    now,
    excludeProvisioningReservationId: reservation.id,
  });
  if (!idle.idle) {
    return fail(idle.reason, "Phone is not idle. Wait for availability or use Stop separately before retrying.");
  }

  const readiness = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.actorId ?? null,
    audience: "admin",
    now,
    dryRun: true,
    mode: "readiness_only",
  });
  if (readiness.client_status !== "ready_to_connect" && readiness.readiness_status !== "ready_to_connect") {
    return fail(readiness.reason || "readiness_not_satisfied", "Account is not ready to connect.");
  }

  const deadlineAssignment = {
    id: reservation.assignment_id,
    device_id: reservation.device_id,
    app_instance_id: reservation.app_instance_id,
    starts_at: reservation.window_start_utc,
    ends_at: reservation.window_end_utc,
  };
  const deadline = deadlineForClientConnectAssignment(deadlineAssignment, now);
  const enqueue = await enqueueClientConnectRequest(supabase, {
    accountId: input.accountId,
    actorId: input.actorId ?? null,
    assignmentId: reservation.assignment_id,
    deadlineAt: deadline.toISOString(),
    deviceId: reservation.device_id,
    appInstanceId: reservation.app_instance_id,
  });
  if (!enqueue.preflight_request_created && !enqueue.idempotent) {
    return fail(enqueue.reason || "enqueue_rejected", "Could not start Auto Login for this reservation.");
  }

  let consumed: ClientProvisioningSlotReservationRow | null = null;
  try {
    consumed = await consumeProvisioningReservation(supabase, reservation.id, input.accountId);
  } catch {
    // Connect already started; consumption is best-effort after successful enqueue.
  }

  const connect = await connectNowForAccount(supabase, {
    accountId: input.accountId,
    actorId: input.actorId ?? null,
    now,
  });

  return { ok: true, connect, reservation: consumed };
}
