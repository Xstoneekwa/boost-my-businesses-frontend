import {
  formatScheduleLocalLabel,
  readScheduleSlot,
  scheduleBlockMessage,
  type ScheduleAssignmentProjection,
  type ScheduleGateProjection,
  type SchedulePatchPayload,
  type ScheduleProjection,
  type ScheduleRestWindowProjection,
  type ScheduleSlotProjection,
} from "@/lib/instagram-dashboard/schedule";
import { normalizeLegacyScheduleTimezone } from "@/lib/instagram-dashboard/business-timezone";
import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  validateAccountId,
  type SupabaseRecord,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

function readRpcObject(value: unknown): SupabaseRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SupabaseRecord;
  }
  return {};
}

function readSlotArray(value: unknown): ScheduleSlotProjection[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => readScheduleSlot(row as SupabaseRecord));
}

function normalizeSlotLabel(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, "").trim();
}

function slotLabel(startsAt: string, endsAt: string, timezone: string) {
  return normalizeSlotLabel(formatScheduleLocalLabel(startsAt, endsAt, timezone));
}

function slotMatches(startsA: string, endsA: string, startsB: string, endsB: string, timezone: string) {
  const labelA = slotLabel(startsA, endsA, timezone);
  const labelB = slotLabel(startsB, endsB, timezone);
  return Boolean(labelA && labelA === labelB);
}

async function fetchScheduledAssignmentsForDevice(
  supabase: ReturnType<typeof createSupabaseClient>,
  deviceId: string | null,
) {
  if (!deviceId) return [];
  const { data, error } = await supabase
    .from("account_assignments")
    .select("id,account_id,device_id,starts_at,ends_at,status,schedule_mode,ig_accounts(username,status)")
    .eq("device_id", deviceId)
    .eq("schedule_mode", "scheduled")
    .in("status", ["pending", "reserved", "active"])
    .limit(200);
  if (error) return [];
  return (data ?? []) as SupabaseRecord[];
}

function assignmentUsername(row: SupabaseRecord) {
  const account = row.ig_accounts as SupabaseRecord | SupabaseRecord[] | undefined;
  const first = Array.isArray(account) ? account[0] : account;
  return readString(first?.username, readString(row.account_id, "assigned account"));
}

function applyEditSlotAvailability(input: {
  slots: ScheduleSlotProjection[];
  assignments: SupabaseRecord[];
  accountId: string;
  currentAssignment: ScheduleAssignmentProjection | null;
  timezone: string;
}) {
  return input.slots.map((slot) => {
    const baseSlot = {
      ...slot,
      slot_id: slot.slot_id ?? `${slot.slot_kind}:${slot.starts_at}:${slot.ends_at}`,
      selectable: slot.available,
      availability: slot.available ? "available" as const : "blocked" as const,
      is_current: false,
      is_conflict: false,
    };
    if (slot.slot_kind === "manual_only") return baseSlot;
    const occupants = input.assignments.filter((assignment) => {
      if (readString(assignment.account_id, "") === input.accountId) return false;
      return slotMatches(
        slot.starts_at,
        slot.ends_at,
        readString(assignment.starts_at, ""),
        readString(assignment.ends_at, ""),
        input.timezone,
      );
    });
    const isCurrent = input.currentAssignment?.schedule_mode === "scheduled" && slotMatches(
      slot.starts_at,
      slot.ends_at,
      input.currentAssignment.starts_at,
      input.currentAssignment.ends_at,
      input.timezone,
    );
    if (isCurrent && occupants.length) {
      return {
        ...baseSlot,
        available: true,
        selectable: true,
        availability: "conflict" as const,
        is_current: true,
        is_conflict: true,
        reason: "current_conflict" as const,
        occupied_by: assignmentUsername(occupants[0]),
      };
    }
    if (isCurrent) {
      return {
        ...baseSlot,
        available: true,
        selectable: true,
        availability: "current" as const,
        is_current: true,
        is_conflict: false,
        reason: "current" as const,
        occupied_by: null,
      };
    }
    if (occupants.length) {
      return {
        ...baseSlot,
        available: false,
        selectable: false,
        availability: "occupied" as const,
        is_current: false,
        is_conflict: false,
        reason: "occupied" as const,
        occupied_by: assignmentUsername(occupants[0]),
      };
    }
    if (slot.reason === "phone_rest" || slot.reason === "outreach_rest_reserved") return {
      ...baseSlot,
      available: false,
      selectable: false,
      availability: "blocked" as const,
    };
    return {
      ...baseSlot,
      available: true,
      selectable: true,
      availability: "available" as const,
      reason: "available" as const,
      occupied_by: null,
    };
  });
}

async function findDeviceSlotConflict(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: { accountId: string; deviceId: string; startsAt: string; endsAt: string; timezone: string },
) {
  const assignments = await fetchScheduledAssignmentsForDevice(supabase, input.deviceId);
  return assignments.find((assignment) => {
    if (readString(assignment.account_id, "") === input.accountId) return false;
    return slotMatches(
      input.startsAt,
      input.endsAt,
      readString(assignment.starts_at, ""),
      readString(assignment.ends_at, ""),
      input.timezone,
    );
  }) ?? null;
}

function isScheduleSchemaPending(message: string) {
  return /list_available_assignment_slots|evaluate_account_schedule_gate|assign_account_slot|phone_rest_windows|schema cache|could not find the function/i.test(message);
}

function pendingScheduleProjection(accountId: string, reason = "schedule_schema_pending"): ScheduleProjection {
  return {
    account_id: accountId,
    assignment_type: null,
    slot_kind: null,
    device_id: null,
    device_label: null,
    device_timezone: null,
    slot_date: null,
    current_assignment: null,
    available_slots: [],
    rest_windows: [],
    app_instance_availability: null,
    gates: {
      ok: false,
      reason,
      assignment_id: null,
      window_active: false,
      phone_rest_active: false,
      next_eligible_starts_at: null,
      run_start_gate: "blocked",
      dispatcher_gate: "env_fallback",
      auto_restart_gate: "blocked",
    },
    save_ready: false,
    runtime_status: "pending",
  };
}

function readCurrentAssignment(value: unknown, deviceLabel: string | null): ScheduleAssignmentProjection | null {
  const row = readRpcObject(value);
  const assignmentId = readString(row.assignment_id, "");
  if (!assignmentId) return null;
  const startsAt = readString(row.starts_at, "");
  const endsAt = readString(row.ends_at, "");
  const scheduleMode = readString(row.schedule_mode, "scheduled");
  return {
    assignment_id: assignmentId,
    device_id: readString(row.device_id, ""),
    clone_id: readString(row.clone_id, "") || null,
    app_instance_id: readString(row.app_instance_id, "") || null,
    assignment_type: readString(row.assignment_type, ""),
    slot_kind: readString(row.slot_kind, ""),
    schedule_mode: scheduleMode,
    status: readString(row.status, ""),
    starts_at: startsAt,
    ends_at: endsAt,
    assignment_source: readString(row.assignment_source, "manual_dashboard"),
    device_label: deviceLabel,
    local_label: scheduleMode === "manual_only" ? "Manual-only · no scheduled window" : formatScheduleLocalLabel(startsAt, endsAt, null),
  };
}

function readAppInstanceAvailability(value: unknown): ScheduleProjection["app_instance_availability"] {
  const row = readRpcObject(value);
  if (!Object.keys(row).length) return null;
  return {
    total: Number(row.total ?? 0),
    available: Number(row.available ?? 0),
    occupied: Number(row.occupied ?? 0),
    disabled: Number(row.disabled ?? 0),
    unknown: Number(row.unknown ?? 0),
    primary_app: Number(row.primary_app ?? 0),
    clones: Number(row.clones ?? 0),
  };
}

async function fetchDeviceLabel(supabase: ReturnType<typeof createSupabaseClient>, deviceId: string | null) {
  if (!deviceId) return null;
  const { data, error } = await supabase
    .from("phone_devices")
    .select("id,name,timezone,status")
    .eq("id", deviceId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (error || !data) return null;
  return readString(data.name, "") || null;
}

async function fetchRestWindows(
  supabase: ReturnType<typeof createSupabaseClient>,
  deviceId: string | null,
): Promise<ScheduleRestWindowProjection[]> {
  if (!deviceId) return [];
  const { data, error } = await supabase
    .from("phone_rest_windows")
    .select("id,weekday,starts_at_local,ends_at_local,timezone,status,reason")
    .eq("device_id", deviceId)
    .eq("status", "active")
    .order("weekday", { ascending: true, nullsFirst: true })
    .limit(50);
  if (error) return [];
  return ((data ?? []) as SupabaseRecord[]).map((row) => ({
    id: readString(row.id, ""),
    weekday: typeof row.weekday === "number" ? row.weekday : null,
    local_start_time: readString(row.local_start_time, readString(row.starts_at_local, "")),
    local_end_time: readString(row.local_end_time, readString(row.ends_at_local, "")),
    timezone: readString(row.timezone, "UTC"),
    status: readString(row.status, "active"),
    reason: readString(row.reason, "") || null,
  }));
}

function buildGateProjection(gateRow: SupabaseRecord): ScheduleGateProjection {
  const ok = gateRow.ok === true;
  const reason = readString(gateRow.reason, ok ? "assignment_window_open" : "assignment_missing");
  const dispatcherEnvEnabled = process.env.RUN_CONTROL_DISPATCHER_ENFORCE_ASSIGNMENT_WINDOW === "true";
  return {
    ok,
    reason,
    assignment_id: readString(gateRow.assignment_id, "") || null,
    window_active: gateRow.window_active === true,
    phone_rest_active: gateRow.phone_rest_active === true,
    next_eligible_starts_at: readString(gateRow.next_eligible_starts_at, "") || null,
    run_start_gate: ok ? "ready" : "blocked",
    dispatcher_gate: ok ? "ready" : dispatcherEnvEnabled ? "blocked" : "env_fallback",
    auto_restart_gate: ok ? "ready" : "blocked",
  };
}

async function buildScheduleProjection(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
): Promise<ScheduleProjection> {
  const [{ data: slotData, error: slotError }, { data: gateData, error: gateError }] = await Promise.all([
    supabase.rpc("list_available_assignment_slots", { p_account_id: accountId }),
    supabase.rpc("evaluate_account_schedule_gate", { p_account_id: accountId }),
  ]);

  if (slotError) {
    if (isScheduleSchemaPending(slotError.message)) return pendingScheduleProjection(accountId);
    throw new Error(slotError.message);
  }
  if (gateError) {
    if (isScheduleSchemaPending(gateError.message)) return pendingScheduleProjection(accountId);
    throw new Error(gateError.message);
  }

  const slotPayload = readRpcObject(slotData);
  const deviceId = readString(slotPayload.device_id, "") || null;
  const deviceTimezone = normalizeLegacyScheduleTimezone(readString(slotPayload.device_timezone, ""));
  const deviceLabel = await fetchDeviceLabel(supabase, deviceId);
  const restWindows = await fetchRestWindows(supabase, deviceId);
  const availableSlots = readSlotArray(slotPayload.slots).map((slot) => ({
    ...slot,
    local_label: formatScheduleLocalLabel(slot.starts_at, slot.ends_at, deviceTimezone) ?? slot.local_label,
  }));
  const currentAssignmentRaw = readCurrentAssignment(slotPayload.current_assignment, deviceLabel);
  const currentAssignment = currentAssignmentRaw
    ? {
        ...currentAssignmentRaw,
        local_label: currentAssignmentRaw.schedule_mode === "manual_only" ? "Manual-only · no scheduled window" : formatScheduleLocalLabel(
          currentAssignmentRaw.starts_at,
          currentAssignmentRaw.ends_at,
          deviceTimezone,
        ),
      }
    : null;
  const gates = buildGateProjection(readRpcObject(gateData));
  const scheduledAssignments = await fetchScheduledAssignmentsForDevice(supabase, deviceId);
  const editAvailableSlots = applyEditSlotAvailability({
    slots: availableSlots,
    assignments: scheduledAssignments,
    accountId,
    currentAssignment,
    timezone: deviceTimezone,
  });
  const slotsWithManual = [
    ...editAvailableSlots,
    {
      slot_id: "manual_only",
      slot_index: 999,
      slot_kind: "manual_only",
      slot_kind_label: "Manual-only",
      local_label: "Run manually",
      starts_at: "",
      ends_at: "",
      available: currentAssignmentRaw?.schedule_mode !== "manual_only",
      selectable: true,
      availability: "manual_only" as const,
      is_current: currentAssignmentRaw?.schedule_mode === "manual_only",
      is_conflict: false,
      reason: (currentAssignmentRaw?.schedule_mode === "manual_only" ? "current" : "manual_only") as ScheduleSlotProjection["reason"],
      occupied_by: null,
    } satisfies ScheduleSlotProjection,
  ];
  const saveReady = slotPayload.ok === true && (
    editAvailableSlots.some((slot) => slot.available)
    || currentAssignmentRaw?.schedule_mode === "manual_only"
    || slotsWithManual.some((slot) => slot.available)
  );

  return {
    account_id: accountId,
    assignment_type: readString(slotPayload.assignment_type, "") || null,
    slot_kind: readString(slotPayload.slot_kind, "") || editAvailableSlots.find((slot) => slot.slot_kind)?.slot_kind || null,
    device_id: deviceId,
    device_label: deviceLabel,
    device_timezone: deviceTimezone,
    slot_date: readString(slotPayload.slot_date, "") || null,
    current_assignment: currentAssignment,
    available_slots: slotsWithManual,
    rest_windows: restWindows,
    app_instance_availability: readAppInstanceAvailability(slotPayload.app_instance_availability),
    gates,
    save_ready: saveReady,
    runtime_status: saveReady || currentAssignment ? "active" : gates.ok ? "active" : "blocked",
  };
}

async function recordAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    actorId: string | null;
    fieldsChanged: string[];
    oldSummary: Record<string, unknown>;
    newSummary: Record<string, unknown>;
  },
) {
  await supabase.from("ig_action_logs").insert({
    account_id: input.accountId,
    run_id: null,
    target_username: null,
    action_type: "schedule_domain_settings_saved",
    status: "success",
    message: "Schedule assignment saved from admin dashboard.",
    payload: {
      actor_type: "admin",
      actor_id: input.actorId,
      source_surface: "instagram_dashboard",
      domain: "schedule",
      fields_changed: input.fieldsChanged,
      old_summary: input.oldSummary,
      new_summary: input.newSummary,
    },
    created_at: new Date().toISOString(),
  });
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Schedule relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const projection = await buildScheduleProjection(supabase, accountId);
    return jsonOk(projection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Schedule settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not load Schedule settings."), 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<SchedulePatchPayload & { schedule_mode?: unknown; app_instance_id?: unknown }>(request);
    if (!body) return jsonError("Invalid Schedule settings payload.", 400);

    const accountId = readString(body.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const scheduleMode = readString(body.schedule_mode, "scheduled").trim() || "scheduled";
    const deviceId = readString(body.device_id, "").trim();
    const startsAt = readString(body.starts_at, "").trim();
    const endsAt = readString(body.ends_at, "").trim();
    const appInstanceId = readString(body.app_instance_id, "").trim();

    const supabase = createSupabaseClient();
    const before = await buildScheduleProjection(supabase, accountId);
    if (!before.save_ready) {
      return jsonError("Schedule slot assignment is unavailable until Schedule RPCs are applied.", 409);
    }
    const actorContext = await getInstagramAdminUserContext();
    const actorId = actorContext?.userId ?? null;

    if (scheduleMode === "manual_only") {
      const resolvedAppInstanceId = appInstanceId || readString(before.current_assignment?.app_instance_id, "") || "";
      if (!deviceId || !resolvedAppInstanceId) {
        return jsonError("manual_only_requires_app_instance", 400);
      }
      const { data, error } = await supabase.rpc("assign_account_manual_only", {
        p_account_id: accountId,
        p_device_id: deviceId,
        p_app_instance_id: resolvedAppInstanceId,
        p_assignment_source: "manual_dashboard",
        p_actor_id: actorId,
      });
      if (error) {
        const normalized = error.message.toLowerCase();
        if (normalized.includes("app_instance")) {
          return jsonError(scheduleBlockMessage("no_app_instance_available"), 409);
        }
        return jsonError(sanitizeRunControlReason(error.message, "Could not save Schedule settings."), 500);
      }
      const assignResult = readRpcObject(data);
      const after = await buildScheduleProjection(supabase, accountId);
      const fieldsChanged = sameAssignmentChanged(before.current_assignment, after.current_assignment)
        ? []
        : ["assignment_manual_only"];
      if (fieldsChanged.length) {
        await recordAudit(supabase, {
          accountId,
          actorId,
          fieldsChanged,
          oldSummary: redactAssignmentSummary(before.current_assignment),
          newSummary: redactAssignmentSummary(after.current_assignment),
        }).catch(() => undefined);
      }
      return jsonOk({
        ...after,
        changed_fields: fieldsChanged,
        assignment_result: {
          idempotent: assignResult.idempotent === true,
          assignment_id: readString(assignResult.assignment_id, "") || null,
        },
      });
    }

    if (!deviceId || !startsAt || !endsAt) {
      return jsonError("Schedule save requires device_id, starts_at, and ends_at.", 400);
    }

    const deviceTimezone = before.device_timezone || normalizeLegacyScheduleTimezone("");
    const conflict = await findDeviceSlotConflict(supabase, {
      accountId,
      deviceId,
      startsAt,
      endsAt,
      timezone: deviceTimezone,
    });
    if (conflict) {
      return jsonError(scheduleBlockMessage("assignment_slot_conflict"), 409, {
        reason: "assignment_slot_conflict",
        occupied_by: assignmentUsername(conflict),
      });
    }

    const { data, error } = await supabase.rpc("assign_account_slot", {
      p_account_id: accountId,
      p_device_id: deviceId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_clone_id: before.current_assignment?.app_instance_id ?? before.current_assignment?.clone_id ?? null,
      p_assignment_source: "manual_dashboard",
      p_actor_id: actorId,
    });

    if (error) {
      const normalized = error.message.toLowerCase();
      if (isScheduleSchemaPending(error.message)) {
        return jsonError("Schedule slot assignment is unavailable until Schedule RPCs are applied.", 409);
      }
      if (normalized.includes("assignment_slot_conflict")) {
        return jsonError(scheduleBlockMessage("assignment_slot_conflict"), 409);
      }
      if (normalized.includes("phone_rest_active")) {
        return jsonError(scheduleBlockMessage("phone_rest_active"), 409);
      }
      if (normalized.includes("outreach_rest_reserved")) {
        return jsonError(scheduleBlockMessage("outreach_rest_reserved"), 409);
      }
      if (normalized.includes("no_app_instance_available") || normalized.includes("no_capacity_available")) {
        return jsonError(scheduleBlockMessage("no_app_instance_available"), 409);
      }
      if (normalized.includes("device_unavailable")) {
        return jsonError(scheduleBlockMessage("device_unavailable"), 409);
      }
      if (normalized.includes("assignment_profile_mismatch")) {
        return jsonError(scheduleBlockMessage("assignment_profile_mismatch"), 409);
      }
      return jsonError(sanitizeRunControlReason(error.message, "Could not save Schedule settings."), 500);
    }

    const assignResult = readRpcObject(data);
    const after = await buildScheduleProjection(supabase, accountId);
    const fieldsChanged = sameAssignmentChanged(before.current_assignment, after.current_assignment)
      ? []
      : ["assignment_slot"];

    if (fieldsChanged.length) {
      await recordAudit(supabase, {
        accountId,
        actorId,
        fieldsChanged,
        oldSummary: redactAssignmentSummary(before.current_assignment),
        newSummary: redactAssignmentSummary(after.current_assignment),
      }).catch(() => undefined);
    }

    return jsonOk({
      ...after,
      changed_fields: fieldsChanged,
      assignment_result: {
        idempotent: assignResult.idempotent === true,
        assignment_id: readString(assignResult.assignment_id, "") || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save Schedule settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not save Schedule settings."), 500);
  }
}

function sameAssignmentChanged(
  before: ScheduleAssignmentProjection | null,
  after: ScheduleAssignmentProjection | null,
) {
  if (!before && !after) return true;
  if (!before || !after) return false;
  return (
    before.device_id === after.device_id &&
    before.schedule_mode === after.schedule_mode &&
    before.starts_at === after.starts_at &&
    before.ends_at === after.ends_at &&
    before.assignment_type === after.assignment_type
  );
}

function redactAssignmentSummary(assignment: ScheduleAssignmentProjection | null) {
  if (!assignment) return { assignment: null };
  return {
    assignment_id: assignment.assignment_id,
    device_id: assignment.device_id,
    assignment_type: assignment.assignment_type,
    slot_kind: assignment.slot_kind,
    schedule_mode: assignment.schedule_mode,
    starts_at: assignment.starts_at,
    ends_at: assignment.ends_at,
    assignment_source: assignment.assignment_source,
    status: assignment.status,
  };
}
