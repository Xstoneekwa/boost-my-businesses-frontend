import { createSupabaseClient } from "@/lib/supabase";
import { normalizeBusinessTimezone, normalizeLegacyScheduleTimezone } from "@/lib/instagram-dashboard/business-timezone";
import { jsonError, jsonOk, readString, requireInstagramAdmin, type SupabaseRecord } from "../../_utils";
import { relayAuthStatus, verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

const runtimeToAssignmentType: Record<string, "full_cycle" | "outreach_only"> = {
  safe_setup: "full_cycle",
  follow_only_test: "full_cycle",
  full_cycle: "full_cycle",
  outreach_only: "outreach_only",
};

function readDateForTimezone(timezone: string) {
  const businessTimezone = normalizeBusinessTimezone(timezone);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: businessTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Business timezone fallback keeps the route deterministic if a stored timezone is invalid.
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeBusinessTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const startA = Date.parse(aStart);
  const endA = Date.parse(aEnd);
  const startB = Date.parse(bStart);
  const endB = Date.parse(bEnd);
  return Number.isFinite(startA) && Number.isFinite(endA) && Number.isFinite(startB) && Number.isFinite(endB) && startA < endB && startB < endA;
}

function utcMinuteOfDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function minuteRanges(start: number, end: number) {
  if (end > start) return [[start, end]];
  return [[start, 1440], [0, end]];
}

function recurringTimeOverlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  if (overlaps(aStart, aEnd, bStart, bEnd)) return true;
  const startA = utcMinuteOfDay(aStart);
  const endA = utcMinuteOfDay(aEnd);
  const startB = utcMinuteOfDay(bStart);
  const endB = utcMinuteOfDay(bEnd);
  if (startA == null || endA == null || startB == null || endB == null) return false;
  return minuteRanges(startA, endA).some(([rangeStartA, rangeEndA]) =>
    minuteRanges(startB, endB).some(([rangeStartB, rangeEndB]) => rangeStartA < rangeEndB && rangeStartB < rangeEndA),
  );
}

function safeOccupant(assignment: SupabaseRecord | undefined, fallbackAccount: SupabaseRecord | null) {
  const account = assignment?.ig_accounts as SupabaseRecord | undefined;
  const accountId = readString(assignment?.account_id, "") || readString(fallbackAccount?.id, "");
  if (!assignment && !fallbackAccount) return null;
  return {
    assignment_id: readString(assignment?.id, "") || null,
    account_id: accountId || null,
    username: readString(account?.username, readString(fallbackAccount?.username, "")) || null,
    status: readString(account?.status, readString(fallbackAccount?.status, readString(assignment?.status, "unknown"))),
  };
}

function slotAvailability(assignment: SupabaseRecord | undefined, appInstanceOccupiedBy: SupabaseRecord | null) {
  if (appInstanceOccupiedBy && !assignment) return { availability: "occupied" as const, reason: "occupied_by_account" };
  const status = readString(assignment?.status, "");
  if (!status) return { availability: "available" as const, reason: "free" };
  if (status === "reserved" || status === "pending") return { availability: "reserved" as const, reason: "reserved" };
  return { availability: "occupied" as const, reason: "occupied_by_account" };
}

function readSlot(row: SupabaseRecord, assignments: SupabaseRecord[], appInstanceOccupiedBy: SupabaseRecord | null, timezone: string, assignmentType: string) {
  const startsAt = readString(row.starts_at, "");
  const endsAt = readString(row.ends_at, "");
  const occupant = assignments.find((assignment) => recurringTimeOverlaps(
    startsAt,
    endsAt,
    readString(assignment.starts_at, ""),
    readString(assignment.ends_at, ""),
  ));
  const availability = slotAvailability(occupant, appInstanceOccupiedBy);
  const label = readString(row.local_label, "") || `${startsAt.slice(11, 16)}-${endsAt.slice(11, 16)}`;
  return {
    slot_id: `${assignmentType}:${startsAt}:${endsAt}`,
    schedule_mode: "scheduled",
    slot_index: Number(row.slot_index ?? 0),
    slot_kind: readString(row.slot_kind, ""),
    slot_kind_label: readString(row.slot_kind, ""),
    local_label: label,
    label,
    starts_at: startsAt,
    ends_at: endsAt,
    runtime_mode: assignmentType,
    timezone,
    available: availability.availability === "available",
    availability: availability.availability,
    reason: availability.reason,
    occupied_by: safeOccupant(occupant, appInstanceOccupiedBy),
  };
}

function readManualSlot(appInstanceId: string, appInstanceOccupiedBy: SupabaseRecord | null, timezone: string) {
  const availability = appInstanceId
    ? slotAvailability(undefined, appInstanceOccupiedBy)
    : { availability: "disabled" as const, reason: "manual_only_requires_app_instance" };
  return {
    slot_id: "manual_only",
    schedule_mode: "manual_only",
    slot_index: 999,
    slot_kind: "manual_only",
    slot_kind_label: "manual_only",
    local_label: "Run manually",
    label: "Run manually",
    starts_at: null,
    ends_at: null,
    runtime_mode: "manual_only",
    timezone,
    available: availability.availability === "available",
    availability: availability.availability,
    reason: availability.availability === "available" ? "manual_only" : availability.reason,
    occupied_by: safeOccupant(undefined, appInstanceOccupiedBy),
    description: "Manual-only · no scheduled window",
  };
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Schedule slots relay authentication failed.", relayAuthStatus(relayAuth.reason), { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const url = new URL(request.url);
    const deviceId = url.searchParams.get("device_id")?.trim() ?? "";
    const appInstanceId = url.searchParams.get("app_instance_id")?.trim() ?? "";
    const runtimeMode = url.searchParams.get("runtime_mode")?.trim() || "safe_setup";
    const assignmentType = runtimeToAssignmentType[runtimeMode];
    if (!deviceId) return jsonError("Missing device_id.", 400);
    if (!assignmentType) return jsonError("Invalid runtime mode.", 400);

    const supabase = createSupabaseClient();
    const { data: device, error: deviceError } = await supabase
      .from("phone_devices")
      .select("id,name,timezone,status,pool_type")
      .eq("id", deviceId)
      .limit(1)
      .maybeSingle<SupabaseRecord>();
    if (deviceError || !device) return jsonError("device_unavailable", 404);

    const timezone = normalizeLegacyScheduleTimezone(readString(device.timezone, ""));
    let appInstanceOccupiedBy: SupabaseRecord | null = null;
    if (appInstanceId) {
      const { data: appInstance, error: appInstanceError } = await supabase
        .from("phone_app_instances")
        .select("id,device_id,status,current_account_id")
        .eq("id", appInstanceId)
        .limit(1)
        .maybeSingle<SupabaseRecord>();
      if (appInstanceError || !appInstance || readString(appInstance.device_id, "") !== deviceId) {
        return jsonError("app_instance_unavailable", 404);
      }
      if (readString(appInstance.current_account_id, "")) {
        const currentAccountId = readString(appInstance.current_account_id, "");
        const { data: currentAccount } = await supabase
          .from("ig_accounts")
          .select("id,username,status")
          .eq("id", currentAccountId)
          .limit(1)
          .maybeSingle<SupabaseRecord>();
        appInstanceOccupiedBy = currentAccount ?? {
          id: currentAccountId,
          status: readString(appInstance.status, "occupied"),
        };
      }
    }

    const slotDate = readDateForTimezone(timezone);
    const { data: slotRows, error: slotError } = await supabase.rpc("generate_assignment_slot_catalog", {
      p_assignment_type: assignmentType,
      p_slot_date: slotDate,
      p_timezone: timezone,
    });
    if (slotError) return jsonError("schedule_slots_unavailable", 409);

    const assignmentQuery = supabase
      .from("account_assignments")
      .select("id,account_id,device_id,app_instance_id,starts_at,ends_at,status,schedule_mode,ig_accounts(username,status)")
      .eq("device_id", deviceId)
      .in("status", ["pending", "reserved", "active"]);
    const { data: assignments } = await assignmentQuery;

    const assignmentRows = ((assignments ?? []) as SupabaseRecord[]);
    const slots = Array.isArray(slotRows)
      ? (slotRows as SupabaseRecord[]).map((slot) => readSlot(slot, assignmentRows, appInstanceOccupiedBy, timezone, assignmentType))
      : [];
    const slotsWithManual = [...slots, readManualSlot(appInstanceId, appInstanceOccupiedBy, timezone)];

    return jsonOk({
      device_id: deviceId,
      app_instance_id: appInstanceId || null,
      device_label: readString(device.name, "Selected phone"),
      assignment_type: assignmentType,
      slot_date: slotDate,
      timezone,
      slots: slotsWithManual,
    });
  } catch {
    return jsonError("Could not load schedule slots.", 500);
  }
}
