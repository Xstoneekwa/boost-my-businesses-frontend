import { createSupabaseClient } from "@/lib/supabase";
import { normalizeBusinessTimezone, normalizeLegacyScheduleTimezone } from "@/lib/instagram-dashboard/business-timezone";
import { jsonError, jsonOk, readString, requireInstagramAdmin, type SupabaseRecord } from "../../_utils";

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

function readSlot(row: SupabaseRecord, assignments: SupabaseRecord[]) {
  const startsAt = readString(row.starts_at, "");
  const endsAt = readString(row.ends_at, "");
  const occupant = assignments.find((assignment) => overlaps(
    startsAt,
    endsAt,
    readString(assignment.starts_at, ""),
    readString(assignment.ends_at, ""),
  ));
  return {
    slot_index: Number(row.slot_index ?? 0),
    slot_kind: readString(row.slot_kind, ""),
    slot_kind_label: readString(row.slot_kind, ""),
    local_label: readString(row.local_label, ""),
    starts_at: startsAt,
    ends_at: endsAt,
    available: !occupant,
    reason: occupant ? "occupied" : "available",
    occupied_by: readString((occupant?.ig_accounts as SupabaseRecord | undefined)?.username, "") || null,
  };
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const url = new URL(request.url);
    const deviceId = url.searchParams.get("device_id")?.trim() ?? "";
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
    const slotDate = readDateForTimezone(timezone);
    const { data: slotRows, error: slotError } = await supabase.rpc("generate_assignment_slot_catalog", {
      p_assignment_type: assignmentType,
      p_slot_date: slotDate,
      p_timezone: timezone,
    });
    if (slotError) return jsonError("schedule_slots_unavailable", 409);

    const { data: assignments } = await supabase
      .from("account_assignments")
      .select("id,account_id,starts_at,ends_at,status,ig_accounts(username)")
      .eq("device_id", deviceId)
      .in("status", ["pending", "reserved", "active"]);

    const assignmentRows = ((assignments ?? []) as SupabaseRecord[]);
    const slots = Array.isArray(slotRows)
      ? (slotRows as SupabaseRecord[]).map((slot) => readSlot(slot, assignmentRows))
      : [];

    return jsonOk({
      device_id: deviceId,
      device_label: readString(device.name, "Selected phone"),
      assignment_type: assignmentType,
      slot_date: slotDate,
      timezone,
      slots,
    });
  } catch {
    return jsonError("Could not load schedule slots.", 500);
  }
}
