import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTargetFbrMetrics,
  targetFbrAdminLabel,
  targetFbrBotAppLabel,
  targetFbrClientLabel,
} from "./target-fbr-metrics.ts";
import { classifyLowFbrPerformance } from "./target-auto-archive-low-fbr-policy.ts";
import {
  mapTargetRow,
  targetFbrLabel,
  targetPerformanceFromFbr,
  targetPerformanceLabel,
} from "../../app/instagram-dashboard/targets-data.ts";

function projectedTargetRow(input) {
  const metrics = resolveTargetFbrMetrics({
    follows_sent_count: Number(input.follows_sent_count ?? 0),
    followbacks_count: Number(input.followbacks_count ?? 0),
    followback_ratio: input.followback_ratio ?? null,
    followbacks_metrics_reliable_at: input.followbacks_metrics_reliable_at ?? null,
  });
  return mapTargetRow({
    id: String(input.id ?? "t1"),
    account_id: String(input.account_id ?? "a1"),
    target_username: String(input.target_username ?? "ct_user"),
    normalized_username: String(input.normalized_username ?? "ct_user"),
    status: String(input.status ?? "valid"),
    quality_status: String(input.quality_status ?? "eligible"),
    source: String(input.source ?? "manual_single"),
    created_at: String(input.created_at ?? "2026-06-01T00:00:00.000Z"),
    updated_at: String(input.updated_at ?? "2026-06-01T00:00:00.000Z"),
    follows_sent_count: metrics.followsSent,
    followbacks_count: metrics.followbacksCount,
    followback_ratio: metrics.fbrPercent,
    followbacks_metrics_reliable_at: input.followbacks_metrics_reliable_at ?? null,
    fbrMetricsReliable: metrics.metricsReliable,
    fbrPercent: metrics.fbrPercent,
  });
}

test("followbacks_metrics_reliable_at null => no faux 0% in projection", () => {
  const resolved = resolveTargetFbrMetrics({
    follows_sent_count: 120,
    followbacks_count: 0,
    followback_ratio: 0,
  });
  assert.equal(resolved.metricsReliable, false);
  assert.equal(resolved.fbrPercent, null);
  assert.equal(targetFbrAdminLabel(resolved.fbrPercent, resolved.followsSent, resolved.metricsReliable), "Non mesuré");
  assert.equal(targetFbrClientLabel(resolved.fbrPercent, resolved.followsSent, resolved.metricsReliable, "fr"), "Données en cours");
  assert.equal(targetFbrBotAppLabel(resolved.fbrPercent, resolved.followsSent, resolved.metricsReliable), "Not measured");
});

test("0 followback réel + metrics reliable => FBR 0% affichable", () => {
  const resolved = resolveTargetFbrMetrics({
    follows_sent_count: 120,
    followbacks_count: 0,
    followback_ratio: 0,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(resolved.metricsReliable, true);
  assert.equal(resolved.fbrPercent, 0);
  assert.equal(targetFbrAdminLabel(resolved.fbrPercent, resolved.followsSent, resolved.metricsReliable), "0%");
  assert.equal(targetFbrClientLabel(resolved.fbrPercent, resolved.followsSent, resolved.metricsReliable, "en"), "0%");
});

test("FBR affichable avant 100 follows si followbacks_metrics_reliable_at existe", () => {
  const resolved = resolveTargetFbrMetrics({
    follows_sent_count: 20,
    followbacks_count: 3,
    followback_ratio: 15,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(resolved.fbrPercent, 15);
  assert.equal(targetFbrAdminLabel(resolved.fbrPercent, resolved.followsSent, resolved.metricsReliable), "15%");
  assert.equal(targetPerformanceLabel(targetPerformanceFromFbr("eligible", resolved.fbrPercent, resolved.followsSent)), "Insufficient data");
});

test("auto-archive ne se déclenche pas avant 100 follows même si FBR fiable", () => {
  const candidate = classifyLowFbrPerformance({
    follows_sent_count: 20,
    followbacks_count: 1,
    followback_ratio: 5,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(candidate.metricsReliable, true);
  assert.equal(candidate.followbackRatio, 5);
  assert.equal(candidate.wouldArchive, false);
  assert.equal(candidate.blockReason, "insufficient_follow_volume");
});

test("projection nulls unreliable stored 0% ratio", () => {
  const metrics = resolveTargetFbrMetrics({
    follows_sent_count: 14,
    followbacks_count: 0,
    followback_ratio: 0,
  });
  assert.equal(metrics.fbrPercent, null);
  assert.equal(metrics.metricsReliable, false);
});

test("projection exposes reliable FBR before 100 follows", () => {
  const metrics = resolveTargetFbrMetrics({
    follows_sent_count: 20,
    followbacks_count: 3,
    followback_ratio: 15,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(metrics.fbrPercent, 15);
  assert.equal(metrics.metricsReliable, true);
});

test("mapTargetRow + targetFbrLabel distinguish non mesuré vs 0%", () => {
  const notMeasured = projectedTargetRow({
    id: "t3",
    follows_sent_count: 14,
    followbacks_count: 0,
    followback_ratio: 0,
  });
  const trueZero = projectedTargetRow({
    id: "t4",
    target_username: "ct_user2",
    normalized_username: "ct_user2",
    follows_sent_count: 120,
    followbacks_count: 0,
    followback_ratio: 0,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });

  assert.equal(targetFbrLabel(notMeasured.fbrPercent, notMeasured.followsSent, notMeasured.fbrMetricsReliable), "Non mesuré");
  assert.equal(targetFbrLabel(trueZero.fbrPercent, trueZero.followsSent, trueZero.fbrMetricsReliable), "0%");
});
