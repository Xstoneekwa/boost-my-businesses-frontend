import assert from "node:assert/strict";
import test from "node:test";

import { profileCounterBusinessDayStartIso } from "./profile-counter-business-day.ts";

test("profiles keep the previous SAST business day before 22:00 UTC", () => {
  assert.equal(
    profileCounterBusinessDayStartIso(new Date("2026-07-27T21:59:59.999Z")),
    "2026-07-26T22:00:00.000Z",
  );
});

test("profiles roll daily counters at SAST midnight", () => {
  assert.equal(
    profileCounterBusinessDayStartIso(new Date("2026-07-27T22:00:00.000Z")),
    "2026-07-27T22:00:00.000Z",
  );
});
