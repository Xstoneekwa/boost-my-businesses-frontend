import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTargetsOverview,
  mapTargetRow,
  targetFbrLabel,
  targetMatchesListFilter,
  targetPerformanceFromFbr,
  targetPerformanceLabel,
} from "../app/instagram-dashboard/targets-data.ts";

const baseRow = {
  id: "target-1",
  account_id: "account-1",
  target_username: "target_user",
  normalized_username: "target_user",
  status: "valid",
  verification_status: "found",
  verification_reason: "found",
  quality_status: "eligible",
  source: "manual_single",
  created_at: "2026-05-30T08:00:00.000Z",
  updated_at: "2026-05-30T08:00:00.000Z",
  followers_count: 1803,
};

test("maps eligibility and pending performance separately", () => {
  const item = mapTargetRow(baseRow);

  assert.equal(item.qualityLabel, "Eligible");
  assert.equal(item.performanceLabel, "Pending");
  assert.equal(item.fbrPercent, null);
  assert.equal(targetFbrLabel(item.fbrPercent), "—");
});

test("rejected low follower target stays out of active filter", () => {
  const low = mapTargetRow({
    ...baseRow,
    id: "target-low",
    status: "rejected",
    quality_status: "rejected_low_followers",
    followers_count: 230,
  });

  assert.equal(low.qualityLabel, "Low");
  assert.equal(low.performanceLabel, "—");
  assert.equal(targetMatchesListFilter(low, "active"), false);
  assert.equal(targetMatchesListFilter(low, "rejected"), true);
});

test("archived rows are visible only in archived or all filters", () => {
  const archived = mapTargetRow({
    ...baseRow,
    id: "target-archived",
    status: "archived",
    archived_at: "2026-05-30T09:00:00.000Z",
  });

  assert.equal(targetMatchesListFilter(archived, "active"), false);
  assert.equal(targetMatchesListFilter(archived, "rejected"), false);
  assert.equal(targetMatchesListFilter(archived, "archived"), true);
  assert.equal(targetMatchesListFilter(archived, "all"), true);
});

test("performance is based on runtime FBR only, never followers count", () => {
  const eligibleWithoutFbr = mapTargetRow({
    ...baseRow,
    followers_count: 12400,
    followback_ratio: null,
  });
  const eligibleWithFbr = mapTargetRow({
    ...baseRow,
    id: "target-fbr",
    followback_ratio: 14.8,
  });

  assert.equal(eligibleWithoutFbr.performanceLabel, "Pending");
  assert.equal(targetFbrLabel(eligibleWithoutFbr.fbrPercent), "—");
  assert.equal(eligibleWithFbr.performanceLabel, "Good");
  assert.equal(targetFbrLabel(eligibleWithFbr.fbrPercent), "14.8%");
});

test("performance thresholds stay separate from eligibility", () => {
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", 8)), "Poor");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", 8.2)), "Avg");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", 14.8)), "Good");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("rejected_low_followers", 14.8)), "—");
});

test("overview counts rejected and performance separately", () => {
  const overview = buildTargetsOverview([
    baseRow,
    {
      ...baseRow,
      id: "target-rejected",
      status: "rejected",
      quality_status: "rejected_low_followers",
      followers_count: 230,
    },
    {
      ...baseRow,
      id: "target-poor-performance",
      followback_ratio: 7.9,
    },
  ]);

  assert.equal(overview.summary.validEligible, 2);
  assert.equal(overview.summary.rejected, 1);
  assert.equal(overview.summary.poorPerformanceCount, 1);
});
