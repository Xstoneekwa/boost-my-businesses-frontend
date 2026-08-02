import { normalizeLegacyScheduleTimezone } from "./business-timezone.ts";
import { extractDailySlot } from "./schedule-recurrence.ts";

export type CanonicalScheduleTimeslot = {
  timeslot_start: string;
  timeslot_end: string;
};

export type ScheduleAssignmentIntent = {
  schedule_mode?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  device_timezone?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * account_assignments is the only Scheduler source of truth. The legacy
 * ig_account_settings timeslot fields are a read-compatible projection and
 * must never create an independent scheduling intent.
 */
export function canonicalScheduleTimeslotFromAssignment(
  assignment: ScheduleAssignmentIntent | null | undefined,
): CanonicalScheduleTimeslot | null {
  if (!assignment || text(assignment.schedule_mode) !== "scheduled") return null;
  const slot = extractDailySlot(
    text(assignment.starts_at),
    text(assignment.ends_at),
    normalizeLegacyScheduleTimezone(text(assignment.device_timezone)),
  );
  if (!slot) return null;
  return {
    timeslot_start: slot.localStart,
    timeslot_end: slot.localEnd,
  };
}

export function projectCanonicalScheduleTimeslot<T extends Record<string, unknown>>(
  settings: T,
  canonical: CanonicalScheduleTimeslot | null,
): T {
  if (!canonical) return settings;
  return {
    ...settings,
    timeslot_start: canonical.timeslot_start,
    timeslot_end: canonical.timeslot_end,
  };
}
