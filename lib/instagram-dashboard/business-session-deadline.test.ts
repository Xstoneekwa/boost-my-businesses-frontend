import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUSINESS_SESSION_TRANSITION_BUFFER_SECONDS,
  resolveCanonicalBusinessActionDeadline,
} from "./business-session-deadline.ts";

describe("canonical business session deadline", () => {
  it("uses the schedule end minus the canonical transition buffer", () => {
    assert.equal(resolveCanonicalBusinessActionDeadline({
      scheduleWindowEndsAt: "2026-08-18T16:00:00.000Z",
    }), "2026-08-18T15:50:00.000Z");
    assert.equal(BUSINESS_SESSION_TRANSITION_BUFFER_SECONDS, 600);
  });

  it("uses an earlier device-exclusive reservation boundary", () => {
    assert.equal(resolveCanonicalBusinessActionDeadline({
      scheduleWindowEndsAt: "2026-08-18T16:00:00.000Z",
      nextDeviceReservationAt: "2026-08-18T15:30:00.000Z",
    }), "2026-08-18T15:20:00.000Z");
  });

  it("uses an earlier explicit safety boundary", () => {
    assert.equal(resolveCanonicalBusinessActionDeadline({
      scheduleWindowEndsAt: "2026-08-18T16:00:00.000Z",
      explicitSafetyBoundaryAt: "2026-08-18T14:00:00.000Z",
    }), "2026-08-18T13:50:00.000Z");
  });
});
