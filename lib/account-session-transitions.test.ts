import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_SESSION_TRANSITION_STATES,
  clientTransitionCopy,
  projectAccountSessionTransitionRow,
  selectCurrentAccountSessionTransition,
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

test("projects only an initiated transition bound to the current active run", () => {
  const current = selectCurrentAccountSessionTransition([
    { id: "old", run_id: "old-run", transition_state: "initiated", updated_at: "2026-08-24T12:00:00Z" },
    { id: "done", run_id: "current-run", transition_state: "completed", updated_at: "2026-08-25T12:00:00Z" },
    { id: "current", run_id: "current-run", transition_state: "initiated", updated_at: "2026-08-25T11:00:00Z" },
  ], "current-run");
  assert.equal(current?.id, "current");
});

test("completed and historical transitions remain projectable history but are hidden from current badge", () => {
  const growthHistory = {
    id: "c77df9c7-416b-4466-8d06-447431eedc29",
    run_id: "historical-run",
    transition_state: "completed",
    exact_stable_reason: "follow_to_unfollow_time_handoff",
    updated_at: "2026-08-24T12:00:00Z",
  };
  assert.equal(projectAccountSessionTransitionRow(growthHistory).exactStableReason, "follow_to_unfollow_time_handoff");
  assert.equal(selectCurrentAccountSessionTransition([growthHistory], ""), null);
  assert.equal(selectCurrentAccountSessionTransition([growthHistory], "new-run"), null);
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
