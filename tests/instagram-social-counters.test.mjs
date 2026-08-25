import assert from "node:assert/strict";
import test from "node:test";
import {
  actionCountersFromLogs,
  interactionEventCounters,
  mergeCanonicalInteractionEventsWithUnfollowFallback,
  reconcileSocialCounters,
  runTotalsCounters,
} from "../lib/instagram-dashboard/social-counters.ts";

function nativeUnfollow(id, interactionRowId, runId = "native-run", username = "candidate") {
  return {
    id,
    account_id: "account-1",
    run_id: runId,
    username,
    event_type: "unfollow_verified",
    event_status: "success",
    payload: { interaction_row_id: interactionRowId, target_username: username },
  };
}

function syntheticUnfollow(id, runId = "synthetic-run", username = "candidate") {
  return {
    id,
    account_id: "account-1",
    last_run_id: runId,
    username,
    unfollowed_at: "2026-08-25T12:00:00.000Z",
    unfollow_result: "success",
  };
}

test("reconcileSocialCounters keeps post-follow likes from ig_runs and interaction events", () => {
  const logs = actionCountersFromLogs([
    { action_type: "follow_completed", status: "info" },
    { action_type: "follow_completed", status: "info" },
  ]);
  const runs = runTotalsCounters([
    { total_follow: 2, total_like: 1, total_dm: 0, total_story: 0 },
  ]);
  const events = interactionEventCounters([
    {
      event_type: "post_like_success",
      event_status: "success",
      interaction_type: "like",
      payload: { liked_count: 1 },
    },
  ]);
  const counters = reconcileSocialCounters(logs, runs, events);
  assert.equal(counters.follows, 2);
  assert.equal(counters.likes, 1);
  assert.equal(counters.interactionsTotal, 3);
});

test("interactionEventCounters counts liked_count payload for live post-follow likes", () => {
  const counters = interactionEventCounters([
    {
      event_type: "post_like_success",
      event_status: "success",
      interaction_type: "like",
      payload: { liked_count: 2 },
    },
  ]);
  assert.equal(counters.likes, 2);
  assert.equal(counters.interactionsTotal, 2);
});

test("failed follow_completed payload never creates a 51st verified Follow", () => {
  const counters = actionCountersFromLogs([
    { action_type: "follow_completed", status: "info", payload: { ok: true }, target_username: "verified" },
    {
      action_type: "follow_completed",
      status: "info",
      payload: { ok: false, failure_code: 74 },
      target_username: "review_popup_candidate",
    },
  ]);
  assert.equal(counters.follows, 1);
  assert.equal(counters.interactionsTotal, 1);
});

test("ordinary successful info action without payload remains countable", () => {
  const counters = actionCountersFromLogs([
    { action_type: "follow_completed", status: "info", target_username: "verified" },
  ]);
  assert.equal(counters.follows, 1);
});

test("legacy and persisted-v1 Follow receipts dedupe the same physical action", () => {
  const counters = interactionEventCounters([
    { account_id: "a", run_id: "r", username: "candidate", event_type: "follow_verified", event_status: "success" },
    { account_id: "a", run_id: "r", username: "candidate", event_type: "follow_verified_persisted_v1", event_status: "success" },
    { account_id: "a", run_id: "r", username: "candidate-2", event_type: "follow_verified_persisted_v1", event_status: "success" },
  ]);
  assert.equal(counters.follows, 2);
  assert.equal(counters.interactionsTotal, 2);
});

test("native and synthetic Unfollow evidence converge by immutable interaction row id across run attribution", () => {
  for (const syntheticRunId of ["native-run", "different-run"]) {
    const rows = mergeCanonicalInteractionEventsWithUnfollowFallback(
      [nativeUnfollow("event-1", "interaction-1")],
      [syntheticUnfollow("interaction-1", syntheticRunId)],
    );
    assert.equal(rows.length, 1);
    assert.equal(interactionEventCounters(rows).unfollows, 1);
  }
});

test("native-only and synthetic-only Unfollow evidence each count once", () => {
  assert.equal(interactionEventCounters(
    mergeCanonicalInteractionEventsWithUnfollowFallback([nativeUnfollow("event-1", "interaction-1")], []),
  ).unfollows, 1);
  assert.equal(interactionEventCounters(
    mergeCanonicalInteractionEventsWithUnfollowFallback([], [syntheticUnfollow("interaction-1")]),
  ).unfollows, 1);
});

test("two truly distinct native Unfollow actions for the same username remain distinct", () => {
  const rows = mergeCanonicalInteractionEventsWithUnfollowFallback([
    nativeUnfollow("event-1", "interaction-1"),
    nativeUnfollow("event-2", "interaction-2"),
  ], []);
  assert.equal(interactionEventCounters(rows).unfollows, 2);
});

for (const fixture of [
  { label: "J", canonical: 29, duplicateFallback: 19 },
  { label: "BMY", canonical: 42, duplicateFallback: 42 },
  { label: "NAB", canonical: 80, duplicateFallback: 66 },
  { label: "Growth", canonical: 80, duplicateFallback: 66 },
]) {
  test(`${fixture.label} field replay converges to canonical native Unfollow total`, () => {
    const native = Array.from({ length: fixture.canonical }, (_, index) => (
      nativeUnfollow(`event-${index}`, `interaction-${index}`, `native-run-${index % 3}`, `candidate-${index}`)
    ));
    const fallback = Array.from({ length: fixture.duplicateFallback }, (_, index) => (
      syntheticUnfollow(`interaction-${index}`, `synthetic-run-${index % 2}`, `candidate-${index}`)
    ));
    const rows = mergeCanonicalInteractionEventsWithUnfollowFallback(native, fallback);
    assert.equal(interactionEventCounters(rows).unfollows, fixture.canonical);
  });
}
