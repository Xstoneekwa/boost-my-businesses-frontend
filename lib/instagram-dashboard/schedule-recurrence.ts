/**
 * CP2 — Daily recurrence derived from the existing Schedule.
 *
 * Product decision: a `schedule_mode=scheduled` account repeats its Schedule
 * slot every day; `manual_only` is a hard exclusion (never derived, never
 * selected automatically).
 *
 * There is NO second source of truth: the durable intent is the local slot
 * (e.g. 06:00–12:00 Africa/Johannesburg) already encoded by the dated
 * `starts_at`/`ends_at` of the single open `account_assignments` row, in the
 * device timezone. This module only DERIVES:
 * - the local slot from the stored dated window (`extractDailySlot`);
 * - the current-or-next dated occurrence (`deriveCurrentDailyWindow`) used by
 *   the schedule-session cron to roll the expired window forward in place
 *   (single row per account — duplicates are structurally impossible);
 * - the 48h projection (`projectDailyWindows`) used by observability.
 *
 * Timezone/DST handled through zonedLocalDateTimeToUtc (Africa/Johannesburg
 * by default); cross-midnight slots (18:00–00:00 local) are supported.
 */

import {
  DEFAULT_BUSINESS_TIMEZONE,
  businessDayKeyFromIso,
  normalizeBusinessTimezone,
  zonedDateParts,
  zonedLocalDateTimeToUtc,
} from "./business-timezone.ts";

export const SCHEDULE_PROJECTION_HORIZON_HOURS = 48;

export type DailySlot = {
  /** Local wall-clock start, "HH:MM" in `timezone`. */
  localStart: string;
  /** Local wall-clock end, "HH:MM" in `timezone`. */
  localEnd: string;
  /** 1 when the slot crosses local midnight (end is on the next local day). */
  endDayOffset: number;
  timezone: string;
};

export type DerivedWindow = {
  starts_at: string;
  ends_at: string;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function localTimeOfIso(iso: string, timezone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = zonedDateParts(date, timezone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function addLocalDays(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0));
  return utc.toISOString().slice(0, 10);
}

function localDayDifference(startDayKey: string, endDayKey: string) {
  const toUtc = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(endDayKey) - toUtc(startDayKey)) / 86_400_000);
}

/**
 * Extracts the durable local slot from the stored dated window. Returns null
 * when the stored window cannot express a daily slot (invalid dates, zero or
 * negative length, longer than 24h) — callers must then leave the row
 * untouched and surface an explicit reason instead of inventing a window.
 */
export function extractDailySlot(
  startsAt: string,
  endsAt: string,
  timezone?: string | null,
): DailySlot | null {
  const tz = normalizeBusinessTimezone(timezone || DEFAULT_BUSINESS_TIMEZONE);
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const lengthMs = endMs - startMs;
  if (lengthMs <= 0 || lengthMs > 24 * 3_600_000) return null;

  const localStart = localTimeOfIso(startsAt, tz);
  const localEnd = localTimeOfIso(endsAt, tz);
  const startDayKey = businessDayKeyFromIso(startsAt, tz);
  const endDayKey = businessDayKeyFromIso(endsAt, tz);
  if (!localStart || !localEnd || !startDayKey || !endDayKey) return null;

  const endDayOffset = localDayDifference(startDayKey, endDayKey);
  if (endDayOffset < 0 || endDayOffset > 1) return null;

  return { localStart, localEnd, endDayOffset, timezone: tz };
}

/** Dated occurrence of `slot` on the given local day (YYYY-MM-DD in slot tz). */
export function slotOccurrenceOnLocalDay(slot: DailySlot, localDay: string): DerivedWindow {
  const starts = zonedLocalDateTimeToUtc(localDay, slot.localStart, slot.timezone);
  const ends = zonedLocalDateTimeToUtc(addLocalDays(localDay, slot.endDayOffset), slot.localEnd, slot.timezone);
  return { starts_at: starts.toISOString(), ends_at: ends.toISOString() };
}

/**
 * The current-or-next daily occurrence at `now`: the earliest occurrence
 * whose end is still in the future. If the slot window is currently open the
 * occurrence covering `now` is returned; otherwise today's upcoming (or
 * tomorrow's) occurrence is returned. Deterministic — two concurrent callers
 * always derive the same window (idempotent roll-forward).
 */
export function deriveCurrentDailyWindow(slot: DailySlot, now: Date): DerivedWindow {
  const todayParts = zonedDateParts(now, slot.timezone);
  const todayKey = `${String(todayParts.year).padStart(4, "0")}-${pad2(todayParts.month)}-${pad2(todayParts.day)}`;
  for (const dayOffset of [-1, 0, 1]) {
    const occurrence = slotOccurrenceOnLocalDay(slot, addLocalDays(todayKey, dayOffset));
    if (Date.parse(occurrence.ends_at) > now.getTime()) return occurrence;
  }
  // Unreachable for any slot ≤ 24h, kept as a deterministic fallback.
  return slotOccurrenceOnLocalDay(slot, addLocalDays(todayKey, 1));
}

/**
 * All occurrences overlapping [now, now + horizonHours). Includes the
 * currently open occurrence when the slot is active right now.
 */
export function projectDailyWindows(
  slot: DailySlot,
  now: Date,
  horizonHours = SCHEDULE_PROJECTION_HORIZON_HOURS,
): DerivedWindow[] {
  const horizonMs = now.getTime() + horizonHours * 3_600_000;
  const windows: DerivedWindow[] = [];
  let cursor = deriveCurrentDailyWindow(slot, now);
  while (Date.parse(cursor.starts_at) < horizonMs) {
    windows.push(cursor);
    const nextDay = addLocalDays(businessDayKeyFromIso(cursor.starts_at, slot.timezone), 1);
    cursor = slotOccurrenceOnLocalDay(slot, nextDay);
    if (windows.length >= 10) break; // hard anti-loop bound; 48h can never hold 10 daily slots
  }
  return windows;
}

/** Short local label, e.g. "06:00–12:00" — redaction-safe (no account data). */
export function dailySlotLabel(slot: DailySlot) {
  return `${slot.localStart}–${slot.localEnd}`;
}
