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
  })[0];
  assert.equal(profile.currentBlocker.actionType, "operator_review_required");
});

test("light route is five batched queries with no per-account loop queries", () => {
  const source = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/live/route.ts", import.meta.url), "utf8");
  assert.match(source, /Promise\.all\(/);
  assert.match(source, /query_count:\s*5/);
  assert.doesNotMatch(source, /getManageData|getStopCleanupState|getActiveOperatorStopSuppression/);
  assert.equal((source.match(/supabase\.from\(/g) ?? []).length, 5);
});
