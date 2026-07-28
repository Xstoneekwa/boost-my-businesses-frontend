import assert from "node:assert/strict";
import test from "node:test";

import { businessDayRangeStartIso, businessDayWindow, formatBusinessTimestamp } from "./business-timezone.ts";
import { profileCounterBusinessDayStartIso } from "./profile-counter-business-day.ts";

test("profiles keep the previous SAST business day before 22:00 UTC", () => {
  assert.equal(
    profileCounterBusinessDayStartIso(new Date("2026-07-27T21:59:59.999Z")),
    "2026-07-26T22:00:00.000Z",
  );
});

test("canonical window is half-open from SAST midnight to the next SAST midnight", () => {
  assert.deepEqual(businessDayWindow(new Date("2026-07-27T21:59:59.999Z")), {
    businessDate: "2026-07-27",
    timezone: "Africa/Johannesburg",
    startIso: "2026-07-26T22:00:00.000Z",
    endIso: "2026-07-27T22:00:00.000Z",
  });
  assert.deepEqual(businessDayWindow(new Date("2026-07-27T22:00:00.000Z")), {
    businessDate: "2026-07-28",
    timezone: "Africa/Johannesburg",
    startIso: "2026-07-27T22:00:00.000Z",
    endIso: "2026-07-28T22:00:00.000Z",
  });
});

test("multi-day ranges start on the first requested SAST business date", () => {
  assert.equal(
    businessDayRangeStartIso(new Date("2026-07-27T22:00:00.000Z"), 3),
    "2026-07-25T22:00:00.000Z",
  );
});

test("displayed operational timestamps use Johannesburg time without a timezone suffix", () => {
  assert.equal(
    formatBusinessTimestamp("2026-07-27T19:46:16.000Z"),
    "27 Jul 2026 · 21:46",
  );
});

test("profiles roll daily counters at SAST midnight", () => {
  assert.equal(
    profileCounterBusinessDayStartIso(new Date("2026-07-27T22:00:00.000Z")),
    "2026-07-27T22:00:00.000Z",
  );
});
