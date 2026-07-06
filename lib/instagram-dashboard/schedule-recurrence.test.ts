import assert from "node:assert/strict";
import test from "node:test";

import {
  dailySlotLabel,
  deriveCurrentDailyWindow,
  extractDailySlot,
  projectDailyWindows,
  SCHEDULE_PROJECTION_HORIZON_HOURS,
  slotOccurrenceOnLocalDay,
} from "./schedule-recurrence.ts";

// Africa/Johannesburg is UTC+2 all year (no DST).
const JOBURG = "Africa/Johannesburg";

test("extractDailySlot recovers the local slot from a dated window", () => {
  // 06:00–12:00 Africa/Johannesburg == 04:00–10:00 UTC.
  const slot = extractDailySlot("2026-07-06T04:00:00.000Z", "2026-07-06T10:00:00.000Z", JOBURG);
  assert.ok(slot);
  assert.equal(slot.localStart, "06:00");
  assert.equal(slot.localEnd, "12:00");
  assert.equal(slot.endDayOffset, 0);
  assert.equal(slot.timezone, JOBURG);
  assert.equal(dailySlotLabel(slot), "06:00–12:00");
});

test("extractDailySlot supports the cross-midnight standard slot (18:00–00:00)", () => {
  // 18:00–00:00 local == 16:00–22:00 UTC, end lands on the next local day.
  const slot = extractDailySlot("2026-07-03T16:00:00.000Z", "2026-07-03T22:00:00.000Z", JOBURG);
  assert.ok(slot);
  assert.equal(slot.localStart, "18:00");
  assert.equal(slot.localEnd, "00:00");
  assert.equal(slot.endDayOffset, 1);
});

test("extractDailySlot defaults the legacy/UTC timezone to Africa/Johannesburg", () => {
  const slot = extractDailySlot("2026-07-03T22:00:00.000Z", "2026-07-04T04:00:00.000Z", null);
  assert.ok(slot);
  // mythyl_fitness real window: 22:00–04:00 UTC == 00:00–06:00 local.
  assert.equal(slot.localStart, "00:00");
  assert.equal(slot.localEnd, "06:00");
  assert.equal(slot.endDayOffset, 0);
});

test("extractDailySlot rejects windows that cannot express a daily slot", () => {
  assert.equal(extractDailySlot("invalid", "2026-07-06T10:00:00Z", JOBURG), null);
  assert.equal(extractDailySlot("2026-07-06T10:00:00Z", "2026-07-06T10:00:00Z", JOBURG), null);
  assert.equal(extractDailySlot("2026-07-06T10:00:00Z", "2026-07-06T04:00:00Z", JOBURG), null);
  // 30h window: not a daily slot.
  assert.equal(extractDailySlot("2026-07-06T00:00:00Z", "2026-07-07T06:00:00Z", JOBURG), null);
});

test("deriveCurrentDailyWindow returns the open occurrence while inside the window", () => {
  const slot = extractDailySlot("2026-07-06T04:00:00.000Z", "2026-07-06T10:00:00.000Z", JOBURG)!;
  const now = new Date("2026-07-08T05:30:00.000Z"); // 07:30 local, inside 06:00–12:00
  const window = deriveCurrentDailyWindow(slot, now);
  assert.equal(window.starts_at, "2026-07-08T04:00:00.000Z");
  assert.equal(window.ends_at, "2026-07-08T10:00:00.000Z");
});

test("deriveCurrentDailyWindow rolls an expired window to today's upcoming occurrence", () => {
  // Stored window expired days ago (July 3rd); at 05:00 local on July 6th the
  // derived occurrence is today's 06:00–12:00 slot — never a past window.
  const slot = extractDailySlot("2026-07-03T04:00:00.000Z", "2026-07-03T10:00:00.000Z", JOBURG)!;
  const now = new Date("2026-07-06T03:00:00.000Z"); // 05:00 local
  const window = deriveCurrentDailyWindow(slot, now);
  assert.equal(window.starts_at, "2026-07-06T04:00:00.000Z");
  assert.equal(window.ends_at, "2026-07-06T10:00:00.000Z");
});

test("deriveCurrentDailyWindow moves to tomorrow once today's slot has ended", () => {
  const slot = extractDailySlot("2026-07-03T04:00:00.000Z", "2026-07-03T10:00:00.000Z", JOBURG)!;
  const now = new Date("2026-07-06T15:00:00.000Z"); // 17:00 local, after 12:00 end
  const window = deriveCurrentDailyWindow(slot, now);
  assert.equal(window.starts_at, "2026-07-07T04:00:00.000Z");
  assert.equal(window.ends_at, "2026-07-07T10:00:00.000Z");
});

test("deriveCurrentDailyWindow keeps yesterday's cross-midnight occurrence while it is open", () => {
  // 18:00–00:00 local slot: at 23:00 local (21:00 UTC) yesterday's occurrence is still open.
  const slot = extractDailySlot("2026-07-03T16:00:00.000Z", "2026-07-03T22:00:00.000Z", JOBURG)!;
  const now = new Date("2026-07-06T21:00:00.000Z"); // 23:00 local July 6th
  const window = deriveCurrentDailyWindow(slot, now);
  assert.equal(window.starts_at, "2026-07-06T16:00:00.000Z");
  assert.equal(window.ends_at, "2026-07-06T22:00:00.000Z");
});

test("derivation is deterministic — concurrent callers compute the same window", () => {
  const slot = extractDailySlot("2026-07-03T04:00:00.000Z", "2026-07-03T10:00:00.000Z", JOBURG)!;
  const now = new Date("2026-07-06T03:00:00.000Z");
  assert.deepEqual(deriveCurrentDailyWindow(slot, now), deriveCurrentDailyWindow(slot, now));
  // Re-deriving from an already rolled-forward window is a no-op (idempotent).
  const rolled = deriveCurrentDailyWindow(slot, now);
  const slotFromRolled = extractDailySlot(rolled.starts_at, rolled.ends_at, JOBURG)!;
  assert.deepEqual(deriveCurrentDailyWindow(slotFromRolled, now), rolled);
});

test("projectDailyWindows covers the 48h horizon with one occurrence per day", () => {
  const slot = extractDailySlot("2026-07-03T04:00:00.000Z", "2026-07-03T10:00:00.000Z", JOBURG)!;
  const now = new Date("2026-07-06T05:00:00.000Z"); // inside July 6th occurrence
  const windows = projectDailyWindows(slot, now);
  assert.equal(SCHEDULE_PROJECTION_HORIZON_HOURS, 48);
  assert.deepEqual(windows.map((w) => w.starts_at), [
    "2026-07-06T04:00:00.000Z",
    "2026-07-07T04:00:00.000Z",
    "2026-07-08T04:00:00.000Z",
  ]);
  // Every projected window ends in the future and starts inside the horizon.
  for (const window of windows) {
    assert.ok(Date.parse(window.ends_at) > now.getTime());
    assert.ok(Date.parse(window.starts_at) < now.getTime() + 48 * 3_600_000);
  }
});

test("slotOccurrenceOnLocalDay is DST-safe through zonedLocalDateTimeToUtc", () => {
  // Europe/Paris DST forward on 2026-03-29: local 06:00 is UTC+2 after the jump.
  const slot = extractDailySlot("2026-03-27T05:00:00.000Z", "2026-03-27T11:00:00.000Z", "Europe/Paris")!;
  assert.equal(slot.localStart, "06:00");
  const after = slotOccurrenceOnLocalDay(slot, "2026-03-30");
  assert.equal(after.starts_at, "2026-03-30T04:00:00.000Z"); // 06:00 UTC+2
  const before = slotOccurrenceOnLocalDay(slot, "2026-03-27");
  assert.equal(before.starts_at, "2026-03-27T05:00:00.000Z"); // 06:00 UTC+1
});
