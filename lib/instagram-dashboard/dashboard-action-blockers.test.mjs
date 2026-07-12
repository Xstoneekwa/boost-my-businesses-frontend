import assert from "node:assert/strict";
import test from "node:test";

import dashboardActionBlockers from "./dashboard-action-blockers.ts";

const {
  isCurrentBlockingDashboardAction,
  isStaleHistoricalSchedulerBlocker,
} = dashboardActionBlockers;

const now = new Date("2026-07-12T20:00:00Z");

function schedulerAction(overrides = {}) {
  return {
    action_type: "scheduler_launch_blocked",
    status: "pending",
    blocking_campaign: true,
    created_at: "2026-07-10T10:15:15.05639+00:00",
    metadata: {
      scheduled_window_start: "2026-07-10T10:00:00+00:00",
      scheduled_window_end: "2026-07-10T16:00:00+00:00",
    },
    ...overrides,
  };
}

test("past scheduler action followed by later completed run is not current blocking", () => {
  const row = schedulerAction();

  assert.equal(isStaleHistoricalSchedulerBlocker(row, {
    now,
    latestSuccessfulSessionAt: "2026-07-11T16:30:39.181761+00:00",
  }), true);
  assert.equal(isCurrentBlockingDashboardAction(row, {
    now,
    latestSuccessfulSessionAt: "2026-07-11T16:30:39.181761+00:00",
  }), false);
});

test("current scheduler action remains current blocking", () => {
  const row = schedulerAction({
    created_at: "2026-07-12T19:00:00Z",
    metadata: {
      scheduled_window_start: "2026-07-12T18:00:00Z",
      scheduled_window_end: "2026-07-12T22:00:00Z",
    },
  });

  assert.equal(isCurrentBlockingDashboardAction(row, { now }), true);
});

test("resolved stale action is never used as primary blocker", () => {
  const row = schedulerAction({ status: "resolved" });

  assert.equal(isCurrentBlockingDashboardAction(row, {
    now,
    latestSuccessfulSessionAt: "2026-07-11T16:30:39.181761+00:00",
  }), false);
});

test("active current action wins when an older stale action is also present", () => {
  const stale = schedulerAction();
  const current = schedulerAction({
    created_at: "2026-07-12T19:00:00Z",
    metadata: {
      scheduled_window_start: "2026-07-12T18:00:00Z",
      scheduled_window_end: "2026-07-12T22:00:00Z",
    },
  });

  const blockers = [stale, current].filter((row) => isCurrentBlockingDashboardAction(row, {
    now,
    latestSuccessfulSessionAt: "2026-07-11T16:30:39.181761+00:00",
  }));

  assert.deepEqual(blockers, [current]);
});

test("runtime success makes old pending scheduler action non current", () => {
  const row = schedulerAction({
    metadata: {
      scheduled_window_start: "2026-07-10T22:00:00+00:00",
      scheduled_window_end: "2026-07-11T04:00:00+00:00",
    },
  });

  assert.equal(isCurrentBlockingDashboardAction(row, {
    now,
    latestSuccessfulSessionAt: "2026-07-12T16:13:22.496031+00:00",
  }), false);
});
