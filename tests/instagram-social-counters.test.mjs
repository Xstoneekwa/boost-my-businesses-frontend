import assert from "node:assert/strict";
import test from "node:test";
import {
  actionCountersFromLogs,
  interactionEventCounters,
  mergeCanonicalInteractionEventsWithUnfollowFallback,
  reconcileSocialCounters,
  runTotalsCounters,
} from "../lib/instagram-dashboard/social-counters.ts";

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

const nativeUnfollow = (id, interactionRowId, username) => ({
  id,
  account_id: "account-1",
  run_id: "run-1",
  event_type: "unfollow_success",
  event_status: "success",
  interaction_type: "unfollow",
  event_at: "2026-08-22T18:00:00Z",
  payload: { interaction_row_id: interactionRowId, target_username: username },
});

const historicalUnfollow = (id, username) => ({
  id,
  account_id: "account-1",
  last_run_id: "run-1",
  username,
  unfollowed_at: "2026-08-22T18:00:00Z",
  unfollow_result: "success",
});

test("canonical native Unfollow suppresses its matching historical fallback", () => {
  const rows = mergeCanonicalInteractionEventsWithUnfollowFallback(
    [nativeUnfollow("event-1", "interaction-1", "alice")],
    [historicalUnfollow("interaction-1", "alice")],
  );
  assert.equal(interactionEventCounters(rows).unfollows, 1);
  assert.equal(rows.length, 1);
});

test("native-only and historical-only Unfollows each remain countable", () => {
  const nativeOnly = mergeCanonicalInteractionEventsWithUnfollowFallback(
    [nativeUnfollow("event-1", "interaction-1", "alice")],
    [],
  );
  const historicalOnly = mergeCanonicalInteractionEventsWithUnfollowFallback(
    [],
    [historicalUnfollow("interaction-2", "bob")],
  );
  assert.equal(interactionEventCounters(nativeOnly).unfollows, 1);
  assert.equal(interactionEventCounters(historicalOnly).unfollows, 1);
});

test("distinct native Unfollows remain distinct while matching fallbacks are removed", () => {
  const rows = mergeCanonicalInteractionEventsWithUnfollowFallback(
    [
      nativeUnfollow("event-1", "interaction-1", "alice"),
      nativeUnfollow("event-2", "interaction-2", "bob"),
    ],
    [
      historicalUnfollow("interaction-1", "alice"),
      historicalUnfollow("interaction-2", "bob"),
    ],
  );
  assert.equal(interactionEventCounters(rows).unfollows, 2);
  assert.equal(rows.length, 2);
});

for (const [account, expected] of [["mythyl_fitness", 66], ["lorielebras_autom", 104]]) {
  test(`${account} field-shaped native and fallback rows project ${expected} Unfollows`, () => {
    const nativeRows = [];
    const fallbackRows = [];
    for (let index = 0; index < expected; index += 1) {
      nativeRows.push(nativeUnfollow(`event-${index}`, `interaction-${index}`, `candidate_${index}`));
      fallbackRows.push(historicalUnfollow(`interaction-${index}`, `candidate_${index}`));
    }
    const rows = mergeCanonicalInteractionEventsWithUnfollowFallback(nativeRows, fallbackRows);
    assert.equal(interactionEventCounters(rows).unfollows, expected);
    assert.equal(rows.length, expected);
  });
}

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
