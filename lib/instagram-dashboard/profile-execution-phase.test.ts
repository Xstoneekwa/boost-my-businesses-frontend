import assert from "node:assert/strict";
import test from "node:test";
import { projectProfileExecutionPhase } from "./profile-execution-phase.ts";

const request = (overrides: Record<string, unknown> = {}) => ({
  id: "request-s1",
  status: "running",
  run_id: "run-s1",
  root_business_session_id: "root-1",
  execution_attempt_no: 1,
  retry_index: 0,
  ...overrides,
});

test("running alone remains PRE_DEVICE and never ACTIVE", () => {
  const projection = projectProfileExecutionPhase({ request: request(), run: { id: "run-s1", status: "running" } });
  assert.equal(projection.executionPhase, "PRE_DEVICE");
  assert.equal(projection.instagramForegroundVerified, false);
  assert.equal(projection.executionDisplayState, "preparing");
});

test("startup timestamps advance without ACTIVE until foreground proof", () => {
  assert.equal(projectProfileExecutionPhase({
    request: request(),
    capsule: { irreversible_work_state: "PRE_DEVICE" },
  }).executionPhase, "PRE_DEVICE");
  assert.equal(projectProfileExecutionPhase({
    request: request(),
    capsule: { irreversible_work_state: "STARTED_OR_AMBIGUOUS", device_activity_started_at: "2026-08-26T00:00:01Z" },
  }).executionPhase, "STARTING_DEVICE");
  assert.equal(projectProfileExecutionPhase({
    request: request(),
    capsule: { irreversible_work_state: "STARTED_OR_AMBIGUOUS", device_connected_at: "2026-08-26T00:00:02Z" },
  }).executionPhase, "STARTING_INSTAGRAM");
  assert.equal(projectProfileExecutionPhase({
    request: request(),
    capsule: { instagram_foreground_verified_at: "2026-08-26T00:00:03Z" },
  }).executionPhase, "ACTIVE");
});

test("zero-work recovery stays one bounded root lifecycle", () => {
  const recovering = projectProfileExecutionPhase({
    request: request(),
    capsule: { irreversible_work_state: "PRE_DEVICE", resume_state: "recovery_enqueued", zero_work_certified_at: "2026-08-26T00:00:00Z" },
  });
  assert.equal(recovering.executionPhase, "RECOVERING");
  assert.equal(recovering.zeroWorkCertifiedAt, "2026-08-26T00:00:00Z");
  const s2 = projectProfileExecutionPhase({
    request: request({ id: "request-s2", run_id: null, status: "queued", source_surface: "control_plane_zero_work_recovery_v1", execution_attempt_no: 2, retry_index: 1 }),
  });
  assert.equal(s2.executionPhase, "RECOVERING");
  assert.equal(s2.rootBusinessSessionId, "root-1");
  assert.equal(s2.executionAttemptNo, 2);
  assert.equal(s2.retryIndex, 1);
  assert.equal(s2.maxExecutionAttempts, 3);
});

test("terminal and missing executions do not retain stale foreground evidence", () => {
  const projection = projectProfileExecutionPhase({
    capsule: { instagram_foreground_verified_at: "2026-08-26T00:00:03Z" },
  });
  assert.equal(projection.executionPhase, "TERMINAL");
  assert.equal(projection.instagramForegroundVerified, false);
  assert.equal(projection.activeForegroundEvidence, null);
});
