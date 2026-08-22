import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_SESSION_TRANSITION_STATES,
  clientTransitionCopy,
  projectAccountSessionTransitionRow,
} from "./account-session-transitions.ts";

test("projects typed fields without inferring runtime semantics", () => {
  const row = projectAccountSessionTransitionRow({
    id: "transition-1",
    account_id: "account-1",
    run_id: "run-1",
    transition_key: "session:attempt:7:follow_to_unfollow_handoff",
    transition_state: "partial",
    follows_completed: 41,
    follows_remaining: 9,
    safe_boundary: true,
    unfollow_eligible: true,
    unfollow_started: true,
    unfollow_state: "partial_resumable",
    backlog_remaining: 12,
    exact_stable_reason: "follow_to_unfollow_time_handoff",
    updated_at: "2026-08-22T00:00:00Z",
  });
  assert.equal(row.state, "partial");
  assert.equal(row.followsCompleted, 41);
  assert.equal(row.backlogRemaining, 12);
  assert.equal(row.actionableReason, null);
});

test("supports the complete typed lifecycle", () => {
  assert.deepEqual(ACCOUNT_SESSION_TRANSITION_STATES, ["initiated", "no_work", "blocked", "partial", "completed"]);
});

test("client copy contains no internal reason-code jargon", () => {
  for (const state of ACCOUNT_SESSION_TRANSITION_STATES) {
    for (const lang of ["fr", "en"] as const) {
      const copy = clientTransitionCopy(state, lang);
      assert.doesNotMatch(copy, /exit97|partial_resumable|safe_boundary|follow_to_unfollow_time_handoff/i);
    }
  }
});
