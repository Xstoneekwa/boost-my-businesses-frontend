import assert from "node:assert/strict";
import test from "node:test";

import { resolveAddProfileAssignmentPolicy } from "./add-profile-assignment-policy.ts";

test("assignment policy assigns immediately when admin selected device app and slot", () => {
  const policy = resolveAddProfileAssignmentPolicy({
    runtimeMode: "full_cycle",
    deviceId: "device-1",
    appInstanceId: "app-1",
    startsAt: "2026-06-09T08:00:00.000Z",
    endsAt: "2026-06-09T14:00:00.000Z",
  });

  assert.equal(policy.status, "immediate_assignment");
  assert.equal(policy.shouldAssignNow, true);
  assert.equal(policy.readinessStatus, "ready");
});

test("assignment policy can wait for scheduled assignment when enabled", () => {
  const policy = resolveAddProfileAssignmentPolicy({
    runtimeMode: "full_cycle",
    allowScheduledWait: true,
  });

  assert.equal(policy.status, "waiting_scheduled_assignment");
  assert.equal(policy.shouldAssignNow, false);
  assert.equal(policy.readinessStatus, "waiting_scheduled_assignment");
});

test("assignment policy keeps current Add Profile route strict without scheduled wait", () => {
  const policy = resolveAddProfileAssignmentPolicy({
    runtimeMode: "safe_setup",
  });

  assert.equal(policy.status, "manual_target_required");
  assert.equal(policy.shouldAssignNow, false);
  assert.equal(policy.readinessStatus, "needs_phone_assignment");
});
