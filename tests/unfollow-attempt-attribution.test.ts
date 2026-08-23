import assert from "node:assert/strict";
import test from "node:test";

import { projectUnfollowAttemptAttribution } from "../lib/instagram-dashboard/unfollow-attempt-attribution.ts";

function events(runId: string, count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    run_id: runId,
    event_type: "unfollow_verified",
    event_status: "success",
    payload: { action_id: `${prefix}-${index}` },
  }));
}

test("Rex replay preserves 19/101/0 across immutable run attribution", () => {
  const result = projectUnfollowAttemptAttribution({
    events: [...events("run-s1", 19, "s1"), ...events("run-s2", 101, "s2")],
    requests: [
      { id: "request-s1", run_id: "run-s1" },
      { id: "request-s2", run_id: "run-s2", metadata_safe: { attempt_id: 2, prior_run_id: "run-s1" } },
    ],
    runs: [{ id: "run-s1" }, { id: "run-s2", performance_summary: { current_attempt_id: 2 } }],
  });
  assert.deepEqual(result.attempts, { S1: 19, S2: 101, S3: 0 });
  assert.equal(result.dailyTotal, 120);
  assert.equal(result.unattributed, 0);
});

test("single-attempt 80 fixture remains entirely S1", () => {
  const result = projectUnfollowAttemptAttribution({
    events: events("run-s1", 80, "nab"),
    requests: [{ id: "request-s1", run_id: "run-s1", metadata_safe: { attempt_id: 1 } }],
    runs: [{ id: "run-s1" }],
  });
  assert.deepEqual(result.attempts, { S1: 80, S2: 0, S3: 0 });
  assert.equal(result.dailyTotal, 80);
});

test("three attempts retain exact authoritative attribution", () => {
  const result = projectUnfollowAttemptAttribution({
    events: [...events("a", 2, "a"), ...events("b", 3, "b"), ...events("c", 4, "c")],
    requests: [
      { run_id: "a", metadata_safe: { attempt_id: 1 } },
      { run_id: "b", metadata_safe: { attempt_id: 2 } },
      { run_id: "c", metadata_safe: { attempt_id: 3 } },
    ],
    runs: [],
  });
  assert.deepEqual(result.attempts, { S1: 2, S2: 3, S3: 4 });
  assert.equal(result.dailyTotal, 9);
});

test("native receipt wins over synthetic fallback without double counting", () => {
  const native = {
    id: "action-1",
    run_id: "run-s1",
    event_type: "unfollow_verified",
    event_status: "success",
    payload: { action_id: "action-1", interaction_row_id: "row-1" },
  };
  const synthetic = {
    id: "unfollow:row-1",
    run_id: "run-s1",
    event_type: "unfollow_verified",
    event_status: "success",
    payload: {
      action_id: "fallback-action",
      interaction_row_id: "row-1",
      evidence_source: "ig_interacted_users.unfollowed_at",
    },
  };
  const result = projectUnfollowAttemptAttribution({
    // Historical fallback can arrive before the native row. Authority must
    // not depend on input ordering or on action ids matching.
    events: [synthetic, native],
    requests: [{ run_id: "run-s1", metadata_safe: { attempt_id: 1 } }],
    runs: [],
  });
  assert.equal(result.nativeCanonicalCount, 1);
  assert.equal(result.syntheticFallbackCount, 0);
  assert.equal(result.dailyTotal, 1);
});

test("unproved historical attribution is unknown, never fabricated", () => {
  const result = projectUnfollowAttemptAttribution({
    events: events("legacy-run", 1, "legacy"),
    requests: [{ run_id: "legacy-run" }],
    runs: [{ id: "legacy-run" }],
  });
  assert.deepEqual(result.attempts, { S1: 0, S2: 0, S3: 0 });
  assert.equal(result.unattributed, 1);
  assert.equal(result.dailyTotal, 1);
});
