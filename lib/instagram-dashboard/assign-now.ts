import { resolveLiveAssignmentTarget } from "@/lib/instagram-dashboard/assignment-live-capacity";
import { getActiveRunRequest, accountHasActiveIgRun, evaluateRunStartEligibility, runStartBlockMessage } from "@/lib/instagram-dashboard/run-control";
import { mapScheduleGateReasonToRunStart, scheduleBlockMessage, type ScheduleBlockReason } from "@/lib/instagram-dashboard/schedule";
import { createSupabaseClient } from "@/lib/supabase";
import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";

export type AssignNowStatus =
  | "assigned_now"
  | "assignment_repaired"
  | "already_assigned"
  | "capacity_unavailable"
  | "not_ready"
  | "active_run_exists"
  | "active_request_exists";

export type AssignNowResult = {
  assignment_created: boolean;
  assignment_repaired: boolean;
  status: AssignNowStatus;
  reason: string;
  message: string;
};

const assignableScheduleReasons = new Set<string>([
  "assignment_missing",
  "assignment_window_closed",
  "no_app_instance_available",
  "device_unavailable",
]);

const ASSIGN_NOW_RPC_SOURCE = "manual_dashboard";

function readObject(value: unknown): SupabaseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SupabaseRecord : {};
}

function safeNotReady(reason: string, message = runStartBlockMessage(reason as never)): AssignNowResult {
  return {
    assignment_created: false,
    assignment_repaired: false,
    status: "not_ready",
    reason,
    message,
  };
}

function capacityUnavailable(reason: string, message: string): AssignNowResult {
  return {
    assignment_created: false,
    assignment_repaired: false,
    status: "capacity_unavailable",
    reason,
    message,
  };
}

export function mapAssignAccountSlotFailure(errorMessage: string): AssignNowResult {
  const normalized = readString(errorMessage, "").toLowerCase();
  if (normalized.includes("assignment_slot_conflict")) {
    return capacityUnavailable(
      "account_has_active_assignment_conflict",
      "The selected slot is already occupied on this phone.",
    );
  }
  if (normalized.includes("phone_rest_active")) {
    return capacityUnavailable(
      "schedule_gate_still_closed",
      "Manual assignment is blocked because the phone is in a rest window.",
    );
  }
  if (normalized.includes("outreach_rest_reserved")) {
    return capacityUnavailable(
      "schedule_gate_still_closed",
      "Manual assignment is blocked because this Outreach slot is reserved for phone rest.",
    );
  }
  if (normalized.includes("no_app_instance_available") || normalized.includes("no_capacity_available")) {
    return capacityUnavailable(
      "app_instance_capacity_unavailable",
      "No Instagram app instance is available on the assigned phone.",
    );
  }
  if (normalized.includes("preferred_app_instance_incompatible")) {
    return capacityUnavailable(
      "app_instance_capacity_unavailable",
      "The preferred app instance cannot be used for this assignment window.",
    );
  }
  if (normalized.includes("device_unavailable")) {
    return capacityUnavailable(
      "phone_capacity_unavailable",
      "The assigned phone is unavailable for assignment.",
    );
  }
  if (normalized.includes("assignment_profile_mismatch")) {
    return safeNotReady(
      "account_not_assignable",
      "This account cannot be assigned to the selected phone profile.",
    );
  }
  if (normalized.includes("subscription_not_active")) {
    return safeNotReady(
      "account_not_assignable",
      "This account does not have an active subscription for assignment.",
    );
  }
  if (normalized.includes("invalid_assignment_window") || normalized.includes("assignment_slot_kind_window_mismatch")) {
    return capacityUnavailable(
      "assign_account_slot_failed",
      "The selected assignment window is invalid for this account schedule.",
    );
  }
  if (normalized.includes("invalid_assignment_source") || normalized.includes("invalid_assignment_payload")) {
    return {
      assignment_created: false,
      assignment_repaired: false,
      status: "not_ready",
      reason: "assign_account_slot_failed",
      message: "Assignment RPC rejected the request payload.",
    };
  }
  return {
    assignment_created: false,
    assignment_repaired: false,
    status: "not_ready",
    reason: "assign_account_slot_failed",
    message: "Assign now could not save the assignment slot.",
  };
}

async function accountLifecycleBlock(supabase: ReturnType<typeof createSupabaseClient>, accountId: string) {
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("id,status,admin_lifecycle_status")
    .eq("id", accountId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (error || !data) return safeNotReady("account_not_found", "Account was not found.");
  const status = readString(data.status, "active").toLowerCase();
  const adminStatus = readString(data.admin_lifecycle_status, status).toLowerCase();
  if (adminStatus === "paused") return safeNotReady("paused", "Paused accounts cannot be assigned now.");
  if (adminStatus === "needs_assistance") return safeNotReady("blocked", "This account needs assistance before assignment.");
  if (adminStatus === "cancelled" || adminStatus === "pending_cancellation" || status === "cancelled" || status === "canceled") {
    return safeNotReady("cancelled", "Cancelled accounts cannot be assigned now.");
  }
  if (status === "archived" || status === "trashed" || status === "deleted") {
    return safeNotReady("blocked", "Inactive accounts cannot be assigned now.");
  }
  return null;
}

async function evaluateScheduleGate(supabase: ReturnType<typeof createSupabaseClient>, accountId: string) {
  const { data, error } = await supabase.rpc("evaluate_account_schedule_gate", {
    p_account_id: accountId,
    p_requested_run_type: "account_session",
  });
  if (error) {
    return { ok: false, reason: "rpc_error_safe", rpcFailed: true as const };
  }
  const row = readObject(data);
  return {
    ok: row.ok === true,
    reason: readString(row.reason, row.ok === true ? "assignment_window_open" : "assignment_missing"),
    rpcFailed: false as const,
  };
}

function readPreferredCloneId(currentAssignment: SupabaseRecord) {
  return readString(currentAssignment.clone_id, "") || readString(currentAssignment.app_instance_id, "") || null;
}

async function recordAssignNowAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    actorId: string | null;
    deviceId?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    status: AssignNowStatus;
    reason: string;
  },
) {
  try {
    await supabase.from("ig_action_logs").insert({
      account_id: input.accountId,
      run_id: null,
      target_username: null,
      action_type: "assignment_now_saved",
      status: "success",
      message: "Account assignment saved from Assign Now.",
      payload: {
        actor_type: input.actorId ? "admin" : "botapp",
        actor_id: input.actorId,
        source_surface: input.actorId ? "instagram_dashboard_assign_now" : "botapp_profiles_assign_now",
        device_id: input.deviceId ?? null,
        starts_at: input.startsAt ?? null,
        ends_at: input.endsAt ?? null,
        result_status: input.status,
        reason: input.reason,
        run_started: false,
        provisioning_started: false,
        login_started: false,
      },
      created_at: new Date().toISOString(),
    });
  } catch {
    // Assignment is the source of truth; audit failures are surfaced by logs/tests but do not roll back the slot.
  }
}

export async function assignNowForAccount(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  actorId: string | null,
  options?: { now?: Date },
): Promise<AssignNowResult> {
  const now = options?.now ?? new Date();
  const lifecycleBlock = await accountLifecycleBlock(supabase, accountId);
  if (lifecycleBlock) return lifecycleBlock;

  if (await accountHasActiveIgRun(accountId)) {
    return {
      assignment_created: false,
      assignment_repaired: false,
      status: "active_run_exists",
      reason: "active_run_exists",
      message: "Assign now is unavailable while a run is active.",
    };
  }

  const activeRequest = await getActiveRunRequest(accountId);
  if (activeRequest) {
    return {
      assignment_created: false,
      assignment_repaired: false,
      status: "active_request_exists",
      reason: "active_request_exists",
      message: "Assign now is unavailable while a run request is active.",
    };
  }

  const scheduleGate = await evaluateScheduleGate(supabase, accountId);
  if (scheduleGate.rpcFailed) {
    return safeNotReady("rpc_error_safe", "Could not evaluate the account schedule gate.");
  }
  if (scheduleGate.ok) {
    await recordAssignNowAudit(supabase, {
      accountId,
      actorId,
      status: "already_assigned",
      reason: "already_assigned",
    });
    return {
      assignment_created: false,
      assignment_repaired: false,
      status: "already_assigned",
      reason: "already_assigned",
      message: "Account already has a valid assignment window.",
    };
  }

  const currentEligibility = await evaluateRunStartEligibility(accountId, "account_session");
  const scheduleReason = mapScheduleGateReasonToRunStart(scheduleGate.reason) ?? (currentEligibility.ok ? null : currentEligibility.reason);
  if (scheduleReason && !assignableScheduleReasons.has(scheduleReason)) {
    return safeNotReady(scheduleReason, scheduleBlockMessage(scheduleReason as ScheduleBlockReason));
  }

  const { data: slotData, error: slotError } = await supabase.rpc("list_available_assignment_slots", {
    p_account_id: accountId,
  });
  if (slotError) {
    return capacityUnavailable("rpc_error_safe", "Could not load available assignment slots.");
  }

  const liveResolution = await resolveLiveAssignmentTarget(supabase, accountId, {
    requireCurrentWindow: true,
    deviceKindPolicy: "physical_phone_only",
    now,
    skipIfAssigned: false,
  });
  if (!liveResolution.ok) {
    if (liveResolution.reason === "live_device_unavailable") {
      return capacityUnavailable("phone_capacity_unavailable", "No connected phone is available right now.");
    }
    if (liveResolution.reason === "no_available_clone") {
      return capacityUnavailable("app_instance_capacity_unavailable", "No Instagram app instance is available on a connected phone.");
    }
    return capacityUnavailable(
      liveResolution.reason === "no_available_slot" ? "no_available_slot_now" : "phone_capacity_unavailable",
      liveResolution.reason === "no_available_slot"
        ? "No assignment slot is available for the current time window."
        : "No connected phone is available right now.",
    );
  }

  const slotPayload = readObject(slotData);
  const deviceTimezone = readString(slotPayload.device_timezone, "");
  if (!deviceTimezone) {
    return capacityUnavailable("business_timezone_missing", "Phone business timezone is missing for assignment.");
  }

  const deviceId = liveResolution.target.deviceId;
  const selectedSlot = {
    starts_at: liveResolution.target.startsAt,
    ends_at: liveResolution.target.endsAt,
  };
  const startsAt = readString(selectedSlot.starts_at, "");
  const endsAt = readString(selectedSlot.ends_at, "");
  if (!startsAt || !endsAt) {
    return capacityUnavailable("no_available_slot_now", "No assignment slot is available for the current time window.");
  }

  const currentAssignment = readObject(slotPayload.current_assignment);
  const hadClosedWindow = scheduleGate.reason === "assignment_window_closed";
  const { error: assignError } = await supabase.rpc("assign_account_slot", {
    p_account_id: accountId,
    p_device_id: deviceId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_clone_id: readPreferredCloneId(currentAssignment) || liveResolution.target.appInstanceId,
    p_assignment_source: ASSIGN_NOW_RPC_SOURCE,
    p_actor_id: actorId,
  });
  if (assignError) {
    return mapAssignAccountSlotFailure(assignError.message);
  }

  const status = hadClosedWindow ? "assignment_repaired" : "assigned_now";
  const reason = hadClosedWindow ? "assignment_window_closed" : "assignment_missing";
  await recordAssignNowAudit(supabase, {
    accountId,
    actorId,
    deviceId,
    startsAt,
    endsAt,
    status,
    reason,
  });

  return {
    assignment_created: !hadClosedWindow,
    assignment_repaired: hadClosedWindow,
    status,
    reason,
    message: hadClosedWindow ? "Assignment window repaired for now." : "Assignment created for now.",
  };
}
