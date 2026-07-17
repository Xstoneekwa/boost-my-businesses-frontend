import assert from "node:assert/strict";
import test from "node:test";
import {
  actionCountersFromLogs,
  interactionEventCounters,
  interactionEventCountersByDay,
  reconcileSocialCounters,
  runTotalsCounters,
  verifiedUnfollowRowsAsInteractionEvents,
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

test("actionCountersFromLogs excludes settings audits and deduplicates canonical actions", () => {
  const counters = actionCountersFromLogs([
    { account_id: "account-a", run_id: "run-a", action_type: "unfollow_domain_settings_saved", status: "success" },
    { account_id: "account-a", run_id: "run-a", action_type: "follow_warmup_settings_saved", status: "success" },
    { account_id: "account-a", run_id: "run-a", target_username: "same_target", action_type: "unfollow_completed", status: "success" },
    { account_id: "account-a", run_id: "run-a", target_username: "same_target", action_type: "unfollow_completed", status: "success" },
  ]);

  assert.equal(counters.follows, 0);
  assert.equal(counters.unfollows, 1);
  assert.equal(counters.interactionsTotal, 1);
});

test("canonical action identities remain isolated across accounts", () => {
  const counters = actionCountersFromLogs([
    { account_id: "account-a", run_id: "run-a", target_username: "same_target", action_type: "follow_completed", status: "success" },
    { account_id: "account-b", run_id: "run-a", target_username: "same_target", action_type: "follow_completed", status: "success" },
  ]);

  assert.equal(counters.follows, 2);
  assert.equal(counters.interactionsTotal, 2);
});

function verifiedUnfollow(index, overrides = {}) {
  return {
    id: `unfollow-${index}`,
    account_id: "account-a",
    run_id: "run-a",
    last_run_id: "run-a",
    username: `target-${index}`,
    unfollowed_at: `2026-07-16T23:54:${String(index).padStart(2, "0")}.000Z`,
    unfollow_result: "success",
    interaction_status: "success",
    ...overrides,
  };
}

test("six verified canonical unfollows remain six live and after reconciliation", () => {
  const events = verifiedUnfollowRowsAsInteractionEvents(
    Array.from({ length: 6 }, (_, index) => verifiedUnfollow(index + 1)),
  );
  assert.equal(interactionEventCounters(events).unfollows, 6);
});

test("two same-day runs with eleven and six unfollows aggregate to seventeen", () => {
  const firstRun = Array.from({ length: 11 }, (_, index) => verifiedUnfollow(index + 1, {
    run_id: "run-first",
    last_run_id: "run-first",
    username: `first-${index + 1}`,
    unfollowed_at: `2026-07-16T16:22:${String(index).padStart(2, "0")}.000Z`,
  }));
  const secondRun = Array.from({ length: 6 }, (_, index) => verifiedUnfollow(index + 1, {
    run_id: "run-second",
    last_run_id: "run-second",
    username: `second-${index + 1}`,
  }));
  const byDay = interactionEventCountersByDay(
    verifiedUnfollowRowsAsInteractionEvents([...firstRun, ...secondRun]),
  );
  assert.equal(byDay.get("2026-07-16")?.unfollows, 17);
});

test("verified unfollows deduplicate the same account run and target", () => {
  const row = verifiedUnfollow(1);
  const events = verifiedUnfollowRowsAsInteractionEvents([row, { ...row, id: "duplicate" }]);
  assert.equal(events.length, 1);
  assert.equal(interactionEventCounters(events).unfollows, 1);
});

test("unverified, uncorrelated and missing unfollow rows do not become actions", () => {
  const events = verifiedUnfollowRowsAsInteractionEvents([
    verifiedUnfollow(1, { unfollow_result: "failed" }),
    verifiedUnfollow(2, { run_id: null, last_run_id: null }),
    verifiedUnfollow(3, { unfollowed_at: null }),
    verifiedUnfollow(4, { username: null }),
  ]);
  assert.equal(events.length, 0);
});
