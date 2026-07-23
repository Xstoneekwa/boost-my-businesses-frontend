import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentBlockingDashboardAction,
  isStaleHistoricalSchedulerBlocker,
} from "./dashboard-action-blockers.ts";

const now = new Date("2026-07-23T00:00:00.000Z");

test("expired scheduler blockers are not projected as current", () => {
  const row = {
    action_type: "scheduler_launch_blocked",
    status: "pending",
    blocking_campaign: true,
    created_at: "2026-07-22T10:00:00.000Z",
    metadata_safe: {
      scheduled_window_start: "2026-07-22T10:00:00.000Z",
      scheduled_window_end: "2026-07-22T16:00:00.000Z",
    },
  };
  assert.equal(isStaleHistoricalSchedulerBlocker(row, { now }), true);
  assert.equal(isCurrentBlockingDashboardAction(row, { now }), false);
});

test("current pending blockers remain projected while resolved blockers do not", () => {
  const current = {
    action_type: "operator_review_required",
    status: "pending",
    blocking_campaign: true,
  };
  assert.equal(isCurrentBlockingDashboardAction(current, { now }), true);
  assert.equal(isCurrentBlockingDashboardAction({ ...current, status: "resolved" }, { now }), false);
});
