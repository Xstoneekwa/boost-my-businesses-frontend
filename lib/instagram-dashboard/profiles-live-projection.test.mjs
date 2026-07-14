import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { projectProfilesLive } from "./profiles-live-projection.ts";

test("live projection moves idle to active and back without losing canonical counters", () => {
  const base = {
    accountIds: ["account-1"],
    now: "2026-07-13T16:30:00.000Z",
    actionLogs: [{ account_id: "account-1", run_id: "run-1", action_type: "follow_completed", target_username: "one", status: "success", created_at: "2026-07-13T16:00:00.000Z" }],
    interactionEvents: [],
    dashboardActions: [],
    followerSnapshots: [],
  };
  const active = projectProfilesLive({
    ...base,
    requests: [{ id: "request-1", account_id: "account-1", run_id: "run-1", status: "running", created_at: "2026-07-13T16:10:00.000Z" }],
    runs: [{ id: "run-1", account_id: "account-1", status: "running", created_at: "2026-07-13T16:10:00.000Z" }],
  })[0];
  assert.equal(active.runtimeIndicator.state, "active");
  assert.equal(active.countersToday.follows, 1);

  const idle = projectProfilesLive({
    ...base,
    requests: [],
    runs: [{ id: "run-1", account_id: "account-1", status: "completed", total_follow: 1, created_at: "2026-07-13T16:10:00.000Z", finished_at: "2026-07-13T16:20:00.000Z" }],
  })[0];
  assert.equal(idle.runtimeIndicator.state, "idle");
  assert.equal(idle.countersToday.follows, 1);
});

test("manual Play and scheduler requests use the same active projection", () => {
  const project = (source_surface) => projectProfilesLive({
    accountIds: ["account-1"],
    now: "2026-07-14T11:08:00.000Z",
    requests: [{ id: "request-1", account_id: "account-1", run_id: "run-1", status: "running", source_surface }],
    runs: [{ id: "run-1", account_id: "account-1", status: "running" }],
    actionLogs: [], interactionEvents: [], dashboardActions: [], followerSnapshots: [],
  })[0];

  const manual = project("botapp_manual_play");
  const scheduler = project("instagram_schedule_session_cron");
  assert.deepEqual(manual.runtimeIndicator, scheduler.runtimeIndicator);
  assert.equal(manual.activeRunRequestStatus, "running");
  assert.equal(scheduler.activeRunRequestStatus, "running");
});

test("cancel request remains active as stopping until the worker is terminal", () => {
  const stopping = projectProfilesLive({
    accountIds: ["account-1"],
    now: "2026-07-14T11:09:00.000Z",
    requests: [{ id: "request-1", account_id: "account-1", run_id: "run-1", status: "running", cancel_requested_at: "2026-07-14T11:08:59.000Z" }],
    runs: [{ id: "run-1", account_id: "account-1", status: "running" }],
    actionLogs: [], interactionEvents: [], dashboardActions: [], followerSnapshots: [],
  })[0];
  assert.equal(stopping.runtimeIndicator.state, "active");
  assert.equal(stopping.runtimeIndicator.reason, "stopping");
  assert.equal(stopping.activeRunRequestStatus, "stopping");
  assert.equal(stopping.activeRunStatus, "stopping");
  assert.equal(stopping.runControlPhase, "stopping");

  const terminal = projectProfilesLive({
    accountIds: ["account-1"],
    now: "2026-07-14T11:09:04.000Z",
    requests: [],
    runs: [{ id: "run-1", account_id: "account-1", status: "stopped", finished_at: "2026-07-14T11:09:03.000Z" }],
    actionLogs: [], interactionEvents: [], dashboardActions: [], followerSnapshots: [],
  })[0];
  assert.equal(terminal.runtimeIndicator.state, "idle");
  assert.equal(terminal.activeRunRequestStatus, null);
  assert.equal(terminal.activeRunStatus, null);
  assert.equal(terminal.runControlPhase, null);
});

test("resolved and non-blocking actions are omitted while a current blocker remains", () => {
  const common = { account_id: "account-1", action_type: "operator_review_required", created_at: "2026-07-13T16:00:00.000Z" };
  const profile = projectProfilesLive({
    accountIds: ["account-1"],
    now: "2026-07-13T16:30:00.000Z",
    requests: [], runs: [], actionLogs: [], interactionEvents: [],
    dashboardActions: [
      { ...common, id: "resolved", status: "resolved", blocking_campaign: true },
      { ...common, id: "nonblocking", status: "pending", blocking_campaign: false },
      { ...common, id: "current", status: "pending", blocking_campaign: true },
    ],
    followerSnapshots: [],
  })[0];
  assert.equal(profile.currentBlocker.actionType, "operator_review_required");
});

test("rolling 72h follower delta uses the latest snapshot and the latest snapshot at or before the threshold", () => {
  const profile = projectProfilesLive({
    accountIds: ["account-1"],
    now: "2026-07-13T16:30:00.000Z",
    requests: [], runs: [], actionLogs: [], interactionEvents: [], dashboardActions: [],
    followerSnapshots: [
      { account_id: "account-1", followers_count: 10, captured_at: "2026-07-09T11:00:00.000Z", source: "public_profile_lookup", observation_kind: "daily" },
      { account_id: "account-1", followers_count: 11, captured_at: "2026-07-10T12:00:00.000Z", source: "public_profile_lookup", observation_kind: "daily" },
      { account_id: "account-1", followers_count: 14, captured_at: "2026-07-13T12:00:00.000Z", source: "public_profile_lookup", observation_kind: "daily" },
    ],
  })[0];
  assert.deepEqual(profile.followerDelta3d, {
    value: 3,
    currentFollowers: 14,
    previousFollowers: 11,
    from: "2026-07-10T12:00:00.000Z",
    to: "2026-07-13T12:00:00.000Z",
    source: "ig_account_follower_snapshots",
    freshness: "complete",
  });
});

test("rolling 72h follower delta remains unknown when history is insufficient", () => {
  const profile = projectProfilesLive({
    accountIds: ["account-1"],
    now: "2026-07-13T16:30:00.000Z",
    requests: [], runs: [], actionLogs: [], interactionEvents: [], dashboardActions: [],
    followerSnapshots: [
      { account_id: "account-1", followers_count: 14, captured_at: "2026-07-13T12:00:00.000Z", source: "device_profile_read", observation_kind: "baseline" },
    ],
  })[0];
  assert.equal(profile.followerDelta3d.value, null);
  assert.equal(profile.followerDelta3d.freshness, "insufficient_history");
});

test("light route is six batched queries with no per-account loop queries", () => {
  const source = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/live/route.ts", import.meta.url), "utf8");
  assert.match(source, /Promise\.all\(/);
  assert.match(source, /query_count:\s*6/);
  assert.doesNotMatch(source, /getManageData|getStopCleanupState|getActiveOperatorStopSuppression/);
  assert.equal((source.match(/supabase\.from\(/g) ?? []).length, 6);
});
