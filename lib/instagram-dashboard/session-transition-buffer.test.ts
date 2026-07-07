import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySessionTransitionPhase,
  deriveSessionTransitionTimestamps,
  isBusinessActionsAllowed,
  isWithinPreflightWindow,
  SESSION_TRANSITION_BUFFER_MINUTES,
} from "./session-transition-buffer.ts";

test("deriveSessionTransitionTimestamps applies T-10 on both ends", () => {
  const timestamps = deriveSessionTransitionTimestamps(
    "2026-07-07T10:00:00.000Z",
    "2026-07-07T16:00:00.000Z",
  );
  assert.ok(timestamps);
  assert.equal(timestamps.business_action_deadline, "2026-07-07T15:50:00.000Z");
  assert.equal(timestamps.preflight_start, "2026-07-07T09:50:00.000Z");
});

test("cross-midnight window keeps absolute deadline ordering", () => {
  const timestamps = deriveSessionTransitionTimestamps(
    "2026-07-07T16:00:00.000Z",
    "2026-07-08T00:00:00.000Z",
  );
  assert.ok(timestamps);
  assert.equal(timestamps.business_action_deadline, "2026-07-07T23:50:00.000Z");
  assert.equal(timestamps.preflight_start, "2026-07-07T15:50:00.000Z");
});

test("Africa/Johannesburg slot maps through absolute timestamps", () => {
  // 12:00–18:00 SAST = 10:00–16:00 UTC in winter (UTC+2)
  const timestamps = deriveSessionTransitionTimestamps(
    "2026-07-07T10:00:00.000Z",
    "2026-07-07T16:00:00.000Z",
  );
  assert.ok(timestamps);
  const preflightDueAt = new Date("2026-07-07T09:55:00.000Z");
  assert.equal(isWithinPreflightWindow(preflightDueAt, timestamps), true);
  assert.equal(isBusinessActionsAllowed(new Date("2026-07-07T15:49:00.000Z"), timestamps), true);
  assert.equal(isBusinessActionsAllowed(new Date("2026-07-07T15:50:00.000Z"), timestamps), false);
  assert.equal(
    classifySessionTransitionPhase(new Date("2026-07-07T15:55:00.000Z"), timestamps),
    "transition_buffer_active",
  );
});

test("rejects windows shorter than buffer", () => {
  assert.equal(
    deriveSessionTransitionTimestamps(
      "2026-07-07T10:00:00.000Z",
      "2026-07-07T10:05:00.000Z",
      SESSION_TRANSITION_BUFFER_MINUTES,
    ),
    null,
  );
});
