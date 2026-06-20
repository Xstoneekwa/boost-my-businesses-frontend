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
import { targetAdminAutoArchiveLabel } from "../lib/instagram-dashboard/target-auto-archive-low-fbr-policy.ts";

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
    followback_ratio: 15,
    follows_sent_count: 120,
    followbacks_count: 18,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
    fbrMetricsReliable: true,
  });

  assert.equal(eligibleWithoutFbr.performanceLabel, "Pending");
  assert.equal(targetFbrLabel(eligibleWithoutFbr.fbrPercent), "—");
  assert.equal(eligibleWithFbr.performanceLabel, "Good");
  assert.equal(targetFbrLabel(eligibleWithFbr.fbrPercent), "15%");
});

test("performance thresholds stay separate from eligibility", () => {
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", null, 0)), "Pending");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", 8, 50)), "Insufficient data");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", 8, 100)), "Bad");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", 8.2, 100)), "Avg");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", 14.8, 100)), "Avg");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", 15, 100)), "Good");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("rejected_low_followers", 15, 100)), "—");
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
      id: "target-bad-performance",
      followback_ratio: 7.9,
      follows_sent_count: 100,
      followbacks_count: 7,
      followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
      fbrMetricsReliable: true,
    },
  ]);

  assert.equal(overview.summary.validEligible, 2);
  assert.equal(overview.summary.rejected, 1);
  assert.equal(overview.summary.poorPerformanceCount, 1);
});

test("maps P1c metrics and computes FBR from counters when ratio is absent", () => {
  const item = mapTargetRow({
    ...baseRow,
    followback_ratio: null,
    follows_sent_count: 10,
    followbacks_count: 1,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
    last_selected_at: "2026-06-02T00:00:00.000Z",
    last_used_at: "2026-06-02T00:05:00.000Z",
    last_successful_candidate_at: "2026-06-02T00:06:00.000Z",
    last_exhausted_at: "2026-06-02T00:07:00.000Z",
    exhaustion_reason: "no_candidates_after_sparse_scrolls",
    cooldown_until: "2026-06-03T00:00:00.000Z",
    metrics_updated_at: "2026-06-02T00:08:00.000Z",
    fbrMetricsReliable: true,
  });

  assert.equal(item.followsSent, 10);
  assert.equal(item.followbacks, 1);
  assert.equal(item.fbrPercent, 10);
  assert.equal(item.performanceLabel, "Insufficient data");
  assert.equal(targetFbrLabel(item.fbrPercent, item.followsSent, item.fbrMetricsReliable), "10%");
  assert.equal(item.lastUsedAt, "2026-06-02T00:05:00.000Z");
  assert.equal(item.lastSelectedAt, "2026-06-02T00:00:00.000Z");
  assert.equal(item.lastSuccessfulCandidateAt, "2026-06-02T00:06:00.000Z");
  assert.equal(item.lastExhaustedAt, "2026-06-02T00:07:00.000Z");
  assert.equal(item.exhaustionReason, "no_candidates_after_sparse_scrolls");
  assert.equal(item.cooldownUntil, "2026-06-03T00:00:00.000Z");
  assert.equal(item.metricsUpdatedAt, "2026-06-02T00:08:00.000Z");
});

test("does not label low FBR as poor before minimum sample size", () => {
  const item = mapTargetRow({
    ...baseRow,
    id: "target-low-sample",
    followback_ratio: 4,
    follows_sent_count: 99,
    followbacks_count: 4,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
    fbrMetricsReliable: true,
  });

  assert.equal(item.performanceLabel, "Insufficient data");
  assert.notEqual(item.performanceLabel, "Bad");
});

test("maps admin auto-archive metadata and internal archived label", () => {
  const item = mapTargetRow({
    ...baseRow,
    id: "target-auto-archived",
    status: "archived",
    archived_at: "2026-06-20T03:00:00.000Z",
    archive_reason: "auto_low_followback_ratio",
    auto_archived_at: "2026-06-20T03:00:00.000Z",
    readd_blocked_permanently: true,
    readd_block_reason: "auto_low_followback_ratio",
  });

  assert.equal(item.archiveReason, "auto_low_followback_ratio");
  assert.equal(item.autoArchivedAt, "2026-06-20T03:00:00.000Z");
  assert.equal(item.readdBlockedPermanently, true);
  assert.equal(item.readdBlockReason, "auto_low_followback_ratio");
  assert.equal(item.adminAutoArchiveLabel, "Mis de côté automatiquement — FBR faible");
  assert.equal(targetAdminAutoArchiveLabel({ archiveReason: null, autoArchivedAt: "2026-06-20T03:00:00.000Z" }), "Archive automatique — rendement insuffisant");
});
