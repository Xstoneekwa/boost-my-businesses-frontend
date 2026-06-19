import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveTargetFbrMetrics, targetFbrBotAppLabel } from "./target-fbr-metrics.ts";

const projectionSource = readFileSync(new URL("./profile-details-target-projection.ts", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("./profile-details-data.ts", import.meta.url), "utf8");

function projectFbrFields(row) {
  const metrics = resolveTargetFbrMetrics({
    follows_sent_count: Number(row.follows_sent_count ?? 0),
    followbacks_count: Number(row.followbacks_count ?? 0),
    followback_ratio: row.followback_ratio ?? null,
    followbacks_metrics_reliable_at: row.followbacks_metrics_reliable_at ?? null,
  });
  const fbrMetricsReliable = metrics.metricsReliable;
  return {
    fbrMetricsReliable,
    fbrPercent: metrics.fbrPercent,
    followback_ratio: fbrMetricsReliable ? metrics.fbrPercent : null,
    followback_ratio_db: row.followback_ratio ?? null,
    fbrLabel: targetFbrBotAppLabel(metrics.fbrPercent, metrics.followsSent, fbrMetricsReliable),
  };
}

test("profile details projection source exposes reliable FBR relay fields", () => {
  assert.match(projectionSource, /fbrMetricsReliable/);
  assert.match(projectionSource, /followbacks_metrics_reliable_at/);
  assert.match(projectionSource, /fbrPercent/);
  assert.match(projectionSource, /followbacksCount/);
  assert.match(projectionSource, /followsSentCount/);
  assert.match(projectionSource, /fbrLabel/);
  assert.match(projectionSource, /followback_ratio_db/);
  assert.match(projectionSource, /followback_ratio: fbrMetricsReliable \? metrics\.fbrPercent : null/);
  assert.match(projectionSource, /projectSharedTargetRow/);
  assert.match(dataSource, /profile-details-target-projection/);
});

test("profile details exposes reliable FBR when followbacks_metrics_reliable_at is set", () => {
  const row = projectFbrFields({
    follows_sent_count: 14,
    followbacks_count: 3,
    followback_ratio: 21.4286,
    followbacks_metrics_reliable_at: "2026-06-19T21:31:27.812294+00:00",
  });

  assert.equal(row.fbrMetricsReliable, true);
  assert.equal(row.fbrPercent, 21.4286);
  assert.equal(row.followback_ratio, 21.4286);
  assert.equal(row.fbrLabel, "21.4%");
});

test("profile details hides exploitable zero FBR when metrics are not reliable", () => {
  const row = projectFbrFields({
    follows_sent_count: 18,
    followbacks_count: 0,
    followback_ratio: 0,
  });

  assert.equal(row.fbrMetricsReliable, false);
  assert.equal(row.fbrPercent, null);
  assert.equal(row.followback_ratio, null);
  assert.equal(row.followback_ratio_db, 0);
  assert.equal(row.fbrLabel, "Not measured");
});

test("profile details route uses shared profile target projection", async () => {
  const routeSource = readFileSync(
    new URL("../../app/api/instagram-dashboard/profiles/[accountId]/details/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /getProfileDetailsData/);
});

test("prod-like reliable vs unmeasured targets project differently", () => {
  const reliable = projectFbrFields({
    follows_sent_count: 14,
    followbacks_count: 3,
    followback_ratio: 21.4286,
    followbacks_metrics_reliable_at: "2026-06-19T21:31:27.812294+00:00",
  });
  const unmeasured = projectFbrFields({
    follows_sent_count: 18,
    followbacks_count: 0,
    followback_ratio: 0,
  });

  assert.equal(reliable.fbrMetricsReliable, true);
  assert.notEqual(reliable.fbrPercent, null);
  assert.equal(unmeasured.fbrMetricsReliable, false);
  assert.equal(unmeasured.fbrPercent, null);
  assert.equal(unmeasured.followback_ratio, null);
});
