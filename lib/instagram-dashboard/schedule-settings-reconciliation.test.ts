import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalScheduleTimeslotFromAssignment,
  projectCanonicalScheduleTimeslot,
} from "./schedule-settings-reconciliation.ts";

test("Assignment is the source of truth and projects a Johannesburg 00:00-06:00 slot", () => {
  const canonical = canonicalScheduleTimeslotFromAssignment({
    schedule_mode: "scheduled",
    starts_at: "2026-08-02T22:00:00.000Z",
    ends_at: "2026-08-03T04:00:00.000Z",
    device_timezone: "Africa/Johannesburg",
  });
  assert.deepEqual(canonical, { timeslot_start: "00:00", timeslot_end: "06:00" });
});

test("Assignment change overwrites stale Settings projection", () => {
  assert.deepEqual(
    projectCanonicalScheduleTimeslot(
      { timeslot_start: "09:00", timeslot_end: "18:00", follow_enabled: true },
      { timeslot_start: "00:00", timeslot_end: "06:00" },
    ),
    { timeslot_start: "00:00", timeslot_end: "06:00", follow_enabled: true },
  );
});

test("Settings cannot become an independent schedule source", () => {
  const requestedSettings = { timeslot_start: "09:00", timeslot_end: "18:00" };
  const projected = projectCanonicalScheduleTimeslot(requestedSettings, {
    timeslot_start: "00:00",
    timeslot_end: "06:00",
  });
  assert.deepEqual(projected, { timeslot_start: "00:00", timeslot_end: "06:00" });
});

test("manual-only assignments do not invent a scheduled projection", () => {
  assert.equal(canonicalScheduleTimeslotFromAssignment({
    schedule_mode: "manual_only",
    starts_at: null,
    ends_at: null,
    device_timezone: "Africa/Johannesburg",
  }), null);
});

test("invalid dated windows fail closed", () => {
  assert.equal(canonicalScheduleTimeslotFromAssignment({
    schedule_mode: "scheduled",
    starts_at: "invalid",
    ends_at: "invalid",
    device_timezone: "Africa/Johannesburg",
  }), null);
});
