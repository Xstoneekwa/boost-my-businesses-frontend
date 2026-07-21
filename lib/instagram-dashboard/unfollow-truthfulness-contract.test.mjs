import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { projectUnfollowTruthfulness } from "./unfollow-truthfulness-contract.ts";

test("unfollow contract keeps daily cap separate from last-run eligible stock", () => {
  const projection = projectUnfollowTruthfulness(11, 120, [{
    created_at: "2026-07-20T17:00:00.000Z",
    finished_at: "2026-07-20T17:03:33.000Z",
    performance_summary: {
      unfollow_effective_limit: 120,
      last_run_eligible_at_start: 51,
      last_run_attempted: 11,
      last_run_verified: 11,
      last_run_remaining_eligible: 40,
      last_run_coverage_status: "partial",
      last_run_stop_reason: "ui_coverage_budget_exhausted",
    },
  }]);
  assert.deepEqual(projection, {
    unfollowDoneToday: 11,
    unfollowDailyCap: 120,
    unfollowEffectiveLimit: 120,
    lastRunEligibleAtStart: 51,
    lastRunAttempted: 11,
    lastRunVerified: 11,
    lastRunRemainingEligible: 40,
    lastRunCoverageStatus: "partial",
    lastRunStopReason: "ui_coverage_budget_exhausted",
    metricsAsOf: "2026-07-20T17:03:33.000Z",
    source: "ig_runs.performance_summary",
  });
});

test("older runs expose unavailable detail instead of inventing 51 or 40", () => {
  const projection = projectUnfollowTruthfulness(11, 120, [{
    finished_at: "2026-07-20T17:03:33.000Z",
    performance_summary: { unfollow_actions_verified: 11 },
  }]);
  assert.equal(projection.lastRunVerified, 11);
  assert.equal(projection.lastRunEligibleAtStart, null);
  assert.equal(projection.lastRunRemainingEligible, null);
  assert.equal(projection.lastRunCoverageStatus, null);
});

test("profiles route preserves verified unfollowed_at reconciliation", () => {
  const source = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");
  assert.match(source, /verifiedUnfollowRowsAsInteractionEvents/);
  assert.match(source, /\.eq\("unfollow_result", "success"\)/);
  assert.match(source, /\.gte\("unfollowed_at", since\)/);
});
