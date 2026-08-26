import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectProfileExecutionPhase } from "../lib/instagram-dashboard/profile-execution-phase.ts";

const route = readFileSync(new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");

test("Profiles consumes bounded Worker request and capsule fields", () => {
  for (const field of [
    "root_business_session_id",
    "execution_attempt_no",
    "retry_index",
    "irreversible_work_state",
    "device_activity_started_at",
    "device_connected_at",
    "instagram_launch_requested_at",
    "instagram_foreground_verified_at",
  ]) assert.match(route, new RegExp(field));
  assert.match(route, /limit\(ids\.length \* 3\)/);
});

test("network-flap recovery phases never manufacture ACTIVE", () => {
  for (const resume_state of ["pre_device_stopped", "recovery_enqueued"]) {
    const projected = projectProfileExecutionPhase({
      request: { status: "running", root_business_session_id: "root-1", execution_attempt_no: 1, retry_index: 0 },
      run: { status: "running" },
      capsule: { resume_state, irreversible_work_state: "PRE_DEVICE" },
    });
    assert.equal(projected.executionPhase, "RECOVERING");
    assert.equal(projected.instagramForegroundVerified, false);
  }
});

test("S4 cannot be represented by the projection contract", () => {
  assert.equal(projectProfileExecutionPhase({ request: { status: "queued", execution_attempt_no: 3, retry_index: 2 } }).maxExecutionAttempts, 3);
});
