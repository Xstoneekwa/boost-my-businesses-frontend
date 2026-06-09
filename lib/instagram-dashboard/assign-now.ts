import { getActiveRunRequest, accountHasActiveIgRun, evaluateRunStartEligibility, runStartBlockMessage } from "@/lib/instagram-dashboard/run-control";
import { assignmentWindowContainsNow, mapScheduleGateReasonToRunStart, scheduleBlockMessage, type ScheduleBlockReason } from "@/lib/instagram-dashboard/schedule";
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

function readObject(value: unknown): SupabaseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SupabaseRecord : {};
}

function readArray(value: unknown): SupabaseRecord[] {
  return Array.isArray(value) ? value.filter((row): row is SupabaseRecord => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
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
  if (error) return { ok: false, reason: "assignment_missing" };
  const row = readObject(data);
  return {
    ok: row.ok === true,
    reason: readString(row.reason, row.ok === true ? "assignment_window_open" : "assignment_missing"),
  };
}

function chooseCurrentAvailableSlot(slotPayload: SupabaseRecord, now = new Date()) {
  const slots = readArray(slotPayload.slots);
  return slots.find((slot) => {
    if (slot.available !== true) return false;
    const startsAt = readString(slot.starts_at, "");
    const endsAt = readString(slot.ends_at, "");
    return assignmentWindowContainsNow(startsAt, endsAt, now);
  }) ?? null;
}

function capacityUnavailable(reason = "capacity_unavailable"): AssignNowResult {
  return {
    assignment_created: false,
    assignment_repaired: false,
    status: "capacity_unavailable",
    reason,
    message: "No phone is available right now.",
  };
}

export async function assignNowForAccount(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  actorId: string | null,
): Promise<AssignNowResult> {
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
  if (scheduleGate.ok) {
    return {
      assignment_created: false,
      assignment_repaired: false,
      status: "already_assigned",
      reason: "already_assigned",
      message: "Account already has a valid assignment window.",
    };
  }

  const currentEligibility = await evaluateRunStartEligibility(accountId, "account_session");
  if (!currentEligibility.ok && !assignableScheduleReasons.has(currentEligibility.reason)) {
    return safeNotReady(currentEligibility.reason, runStartBlockMessage(currentEligibility.reason));
  }

  const scheduleReason = mapScheduleGateReasonToRunStart(scheduleGate.reason) ?? (currentEligibility.ok ? null : currentEligibility.reason);
  if (scheduleReason && !assignableScheduleReasons.has(scheduleReason)) {
    return safeNotReady(scheduleReason, scheduleBlockMessage(scheduleReason as ScheduleBlockReason));
  }

  const { data: slotData, error: slotError } = await supabase.rpc("list_available_assignment_slots", {
    p_account_id: accountId,
  });
  if (slotError) return capacityUnavailable("capacity_unavailable");

  const slotPayload = readObject(slotData);
  const deviceId = readString(slotPayload.device_id, "");
  const selectedSlot = chooseCurrentAvailableSlot(slotPayload);
  if (!deviceId || !selectedSlot) return capacityUnavailable("capacity_unavailable");

  const startsAt = readString(selectedSlot.starts_at, "");
  const endsAt = readString(selectedSlot.ends_at, "");
  if (!startsAt || !endsAt) return capacityUnavailable("capacity_unavailable");

  const currentAssignment = readObject(slotPayload.current_assignment);
  const { error: assignError } = await supabase.rpc("assign_account_slot", {
    p_account_id: accountId,
    p_device_id: deviceId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_clone_id: readString(currentAssignment.clone_id, "") || null,
    p_assignment_source: "assign_now_admin",
    p_actor_id: actorId,
  });
  if (assignError) {
    const normalized = assignError.message.toLowerCase();
    if (normalized.includes("assignment_slot_conflict")) return capacityUnavailable("assignment_slot_conflict");
    if (normalized.includes("no_app_instance_available") || normalized.includes("no_capacity_available")) return capacityUnavailable("capacity_unavailable");
    if (normalized.includes("device_unavailable")) return capacityUnavailable("device_unavailable");
    return {
      assignment_created: false,
      assignment_repaired: false,
      status: "not_ready",
      reason: "assign_now_failed",
      message: "Assign now could not complete. Try again later.",
    };
  }

  const repaired = scheduleGate.reason === "assignment_window_closed";
  return {
    assignment_created: !repaired,
    assignment_repaired: repaired,
    status: repaired ? "assignment_repaired" : "assigned_now",
    reason: repaired ? "assignment_window_closed" : "assignment_missing",
    message: repaired ? "Assignment window repaired for now." : "Assignment created for now.",
  };
}
