import assert from "node:assert/strict";
import test from "node:test";

import { projectProfilesLive } from "./profiles-live-projection.ts";

const empty = {
  requests: [],
  runs: [],
  actionLogs: [],
  interactionEvents: [],
  unfollowRows: [],
  dashboardActions: [],
  followerSnapshots: [],
};

test("live projection moves an account from idle to active and back", () => {
  const active = projectProfilesLive({
    ...empty,
    accountIds: ["account-1"],
    now: "2026-07-23T00:00:03.000Z",
    requests: [{ id: "request-1", account_id: "account-1", run_id: "run-1", status: "running", created_at: "2026-07-23T00:00:00.000Z" }],
    runs: [{ id: "run-1", account_id: "account-1", status: "running", started_at: "2026-07-23T00:00:00.000Z" }],
    interactionEvents: [{ id: "event-1", account_id: "account-1", run_id: "run-1", username: "target", event_type: "follow_verified", event_status: "success", event_at: "2026-07-23T00:00:02.000Z" }],
  })[0];
  assert.equal(active.runtimeIndicator.state, "active");
  assert.equal(active.currentRunCounters.follows, 1);
  assert.equal(active.countersToday.follows, 1);

  const idle = projectProfilesLive({
    ...empty,
    accountIds: ["account-1"],
    now: "2026-07-23T00:00:05.000Z",
    runs: [{ id: "run-1", account_id: "account-1", status: "completed", total_follow: 1, finished_at: "2026-07-23T00:00:04.000Z" }],
  })[0];
  assert.equal(idle.runtimeIndicator.state, "idle");
  assert.equal(idle.countersToday.follows, 1);
});

test("verified likes and unfollows are projected without double counting", () => {
  const profile = projectProfilesLive({
    ...empty,
    accountIds: ["account-1"],
    now: "2026-07-23T00:00:05.000Z",
    requests: [{ id: "request-1", account_id: "account-1", run_id: "run-1", status: "running" }],
    runs: [{ id: "run-1", account_id: "account-1", status: "running" }],
    actionLogs: [{ id: "log-1", account_id: "account-1", run_id: "run-1", target_username: "same", action_type: "unfollow_completed", status: "success" }],
    interactionEvents: [{ id: "like-1", account_id: "account-1", run_id: "run-1", username: "liked", event_type: "post_like_success", event_status: "success", event_at: "2026-07-23T00:00:02.000Z", payload: { liked_count: 2 } }],
    unfollowRows: [
      { id: "unfollow-1", account_id: "account-1", run_id: "run-1", username: "same", unfollow_result: "success", unfollowed_at: "2026-07-23T00:00:01.000Z" },
      { id: "unfollow-2", account_id: "account-1", run_id: "run-1", username: "new", unfollow_result: "success", unfollowed_at: "2026-07-23T00:00:03.000Z" },
    ],
  })[0];
  assert.equal(profile.currentRunCounters.likes, 2);
  assert.equal(profile.currentRunCounters.unfollows, 2);
  assert.deepEqual(profile.liveSupportedKinds, ["follow", "unfollow", "like", "dm"]);
});

test("stopping and current blocker statuses remain explicit", () => {
  const profile = projectProfilesLive({
    ...empty,
    accountIds: ["account-1"],
    now: "2026-07-23T00:00:05.000Z",
    requests: [{ id: "request-1", account_id: "account-1", run_id: "run-1", status: "running", cancel_requested_at: "2026-07-23T00:00:04.000Z" }],
    runs: [{ id: "run-1", account_id: "account-1", status: "running" }],
    dashboardActions: [{ id: "action-1", account_id: "account-1", action_type: "operator_review_required", status: "pending", blocking_campaign: true, created_at: "2026-07-23T00:00:03.000Z" }],
  })[0];
  assert.equal(profile.activeRunRequestStatus, "stopping");
  assert.equal(profile.runControlPhase, "stopping");
  assert.equal(profile.currentBlocker.actionType, "operator_review_required");
});

test("72h follower delta preserves real zero and leaves insufficient history null", () => {
  const complete = projectProfilesLive({
    ...empty,
    accountIds: ["account-1"],
    now: "2026-07-23T00:00:00.000Z",
    followerSnapshots: [
      { account_id: "account-1", followers_count: 53, captured_at: "2026-07-19T23:00:00.000Z", source: "public_profile_lookup", observation_kind: "daily" },
      { account_id: "account-1", followers_count: 53, captured_at: "2026-07-22T23:00:00.000Z", source: "public_profile_lookup", observation_kind: "daily" },
    ],
  })[0];
  assert.equal(complete.followerDelta3d.value, 0);
  assert.equal(complete.followerDelta3d.currentFollowers, 53);

  const unknown = projectProfilesLive({
    ...empty,
    accountIds: ["account-1"],
    now: "2026-07-23T00:00:00.000Z",
    followerSnapshots: [{ account_id: "account-1", followers_count: 0, captured_at: "2026-07-22T23:00:00.000Z", source: "device_profile_read", observation_kind: "baseline" }],
  })[0];
  assert.equal(unknown.followerDelta3d.value, null);
  assert.equal(unknown.followerDelta3d.currentFollowers, 0);
});

test("membership is controlled only by the account id list", () => {
  assert.deepEqual(projectProfilesLive({ ...empty, accountIds: [], now: "2026-07-23T00:00:00.000Z" }), []);
});

test("projection output never includes raw payload, metadata, credentials or vault references", () => {
  const profile = projectProfilesLive({
    ...empty,
    accountIds: ["account-1"],
    now: "2026-07-23T00:00:00.000Z",
    dashboardActions: [{ account_id: "account-1", action_type: "operator_review_required", status: "pending", blocking_campaign: true, metadata: { credential: "forbidden" } }],
  })[0];
  const serialized = JSON.stringify(profile);
  assert.doesNotMatch(serialized, /forbidden|credential|vault|service_role/i);
});
