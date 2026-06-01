import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";

export type ScheduleSlotReason =
  | "available"
  | "occupied"
  | "phone_rest"
  | "outreach_rest_reserved"
  | "no_clone_available"
  | "no_app_instance_available"
  | "current"
  | null;

export type ScheduleSlotProjection = {
  slot_index: number;
  slot_kind: string;
  slot_kind_label: string;
  local_label: string;
  starts_at: string;
  ends_at: string;
  available: boolean;
  reason: ScheduleSlotReason;
  occupied_by: string | null;
};

export type ScheduleAssignmentProjection = {
  assignment_id: string;
  device_id: string;
  clone_id: string | null;
  app_instance_id?: string | null;
  assignment_type: string;
  slot_kind: string;
  status: string;
  starts_at: string;
  ends_at: string;
  assignment_source: string;
  device_label?: string | null;
  clone_label?: string | null;
  local_label?: string | null;
};

export type ScheduleRestWindowProjection = {
  id: string;
  weekday: number | null;
  local_start_time: string;
  local_end_time: string;
  timezone: string;
  status: string;
  reason: string | null;
};

export type ScheduleGateProjection = {
  ok: boolean;
  reason: string;
  assignment_id?: string | null;
  window_active?: boolean;
  phone_rest_active?: boolean;
  next_eligible_starts_at?: string | null;
  run_start_gate: "ready" | "blocked";
  dispatcher_gate: "ready" | "env_fallback" | "blocked";
  auto_restart_gate: "ready" | "blocked";
};

export type ScheduleProjection = {
  account_id: string;
  assignment_type: string | null;
  slot_kind: string | null;
  device_id: string | null;
  device_label: string | null;
  device_timezone: string | null;
  slot_date: string | null;
  current_assignment: ScheduleAssignmentProjection | null;
  available_slots: ScheduleSlotProjection[];
  rest_windows: ScheduleRestWindowProjection[];
  app_instance_availability?: {
    total: number;
    available: number;
    occupied: number;
    disabled: number;
    unknown: number;
    primary_app: number;
    clones: number;
  } | null;
  gates: ScheduleGateProjection;
  save_ready: boolean;
  runtime_status: "active" | "blocked" | "pending";
  changed_fields?: string[];
};

export type SchedulePatchPayload = {
  account_id?: unknown;
  device_id?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  slot_index?: unknown;
};

export const SCHEDULE_BLOCK_REASONS = [
  "assignment_missing",
  "assignment_window_closed",
  "assignment_slot_conflict",
  "phone_rest_active",
  "outreach_rest_reserved",
  "no_app_instance_available",
  "device_unavailable",
  "assignment_profile_mismatch",
] as const;

export type ScheduleBlockReason = (typeof SCHEDULE_BLOCK_REASONS)[number];

export function readScheduleSlot(row: SupabaseRecord): ScheduleSlotProjection {
  return {
    slot_index: Number(row.slot_index ?? 0),
    slot_kind: readString(row.slot_kind, ""),
    slot_kind_label: readString(row.slot_kind_label, readString(row.slot_kind, "")),
    local_label: readString(row.local_label, ""),
    starts_at: readString(row.starts_at, ""),
    ends_at: readString(row.ends_at, ""),
    available: row.available === true,
    reason: (readString(row.reason, "") || null) as ScheduleSlotReason,
    occupied_by: readString(row.occupied_by, "") || null,
  };
}

export function scheduleBlockMessage(reason: string) {
  switch (reason) {
    case "assignment_missing":
      return "Manual run is blocked because no phone slot assignment exists for this account.";
    case "assignment_window_closed":
      return "Manual run is blocked because the account is outside its assigned schedule window.";
    case "assignment_slot_conflict":
      return "Schedule save failed because the selected slot is already occupied on this phone.";
    case "phone_rest_active":
      return "Manual run is blocked because the phone is in a rest window.";
    case "outreach_rest_reserved":
      return "Manual run is blocked because this Outreach slot is reserved for phone rest.";
    case "no_app_instance_available":
      return "Manual run is blocked because no Instagram app instance is available on this phone.";
    case "device_unavailable":
      return "Manual run is blocked because the assigned phone/device is unavailable.";
    case "assignment_profile_mismatch":
      return "Manual run is blocked because the assignment profile does not match this run type.";
    default:
      return "Manual run is blocked by schedule gates.";
  }
}

export function mapScheduleGateReasonToRunStart(reason: string): ScheduleBlockReason | null {
  const normalized = readString(reason, "").toLowerCase();
  if ((SCHEDULE_BLOCK_REASONS as readonly string[]).includes(normalized)) {
    return normalized as ScheduleBlockReason;
  }
  return null;
}

export function formatScheduleLocalLabel(startsAt: string, endsAt: string, timezone: string | null) {
  if (!startsAt || !endsAt) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone || "UTC",
    });
    return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`;
  } catch {
    return null;
  }
}

export function sameScheduleSelection(
  current: Pick<ScheduleAssignmentProjection, "device_id" | "starts_at" | "ends_at"> | null,
  next: Pick<ScheduleAssignmentProjection, "device_id" | "starts_at" | "ends_at"> | null,
) {
  if (!current || !next) return false;
  return (
    current.device_id === next.device_id &&
    current.starts_at === next.starts_at &&
    current.ends_at === next.ends_at
  );
}

export function assignmentWindowContainsNow(startsAt: string, endsAt: string, now = new Date()) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const ts = now.getTime();
  return start <= ts && ts < end;
}

export function phoneRestActiveNow(
  restWindows: ScheduleRestWindowProjection[],
  now = new Date(),
  timezone = "UTC",
) {
  for (const window of restWindows) {
    if (window.status !== "active") continue;
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: window.timezone || timezone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
      const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
      const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
      const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
      if (window.weekday !== null && window.weekday !== weekdayIndex) continue;
      const current = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00`;
      if (current >= window.local_start_time && current < window.local_end_time) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
