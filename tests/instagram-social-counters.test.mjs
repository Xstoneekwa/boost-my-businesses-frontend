import assert from "node:assert/strict";
import test from "node:test";
import {
  actionCountersFromLogs,
  interactionEventCounters,
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
