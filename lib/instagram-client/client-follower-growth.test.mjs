import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildFollowerChartTitle,
  buildFollowerChartView,
} from "./client-follower-chart-projection.ts";
import {
  buildClientFollowerGrowthBundle,
  filterReliableFollowerSnapshots,
  projectClientFollowerGrowthSeries,
} from "./client-follower-growth-projection.ts";
import {
  isAllowedFollowerSnapshotSource,
  validateFollowerSnapshotInput,
} from "./follower-snapshot-contract.ts";

const TZ = "Africa/Johannesburg";
const CLIENT_LINK = "2026-06-03T16:15:44.000Z";
const NOW = new Date("2026-06-20T12:00:00.000Z");

function snap(capturedAt, followers, kind = "daily") {
  return {
    account_id: "acct-a",
    followers_count: followers,
    captured_at: capturedAt,
    source: "public_profile_lookup",
    observation_kind: kind,
  };
}

test("no snapshots → empty state without stale ig_accounts fallback", () => {
  const series = projectClientFollowerGrowthSeries({
    accountId: "acct-a",
    snapshots: [],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    period: "all",
    now: NOW,
  });
  const view = buildFollowerChartView(series, "fr");
  assert.equal(series.currentFollowers, null);
  assert.equal(view.mainValue, "—");
  assert.equal(view.deltaDisplay, "—");
  assert.equal(view.showChart, false);
  assert.equal(view.subtitle, "Première lecture des abonnés en cours");
});

test("single snapshot → current followers visible, delta unknown, no curve", () => {
  const series = projectClientFollowerGrowthSeries({
    accountId: "acct-a",
    snapshots: [snap("2026-06-10T08:00:00.000Z", 28, "baseline")],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    period: "all",
    now: NOW,
  });
  const view = buildFollowerChartView(series, "fr");
  assert.equal(series.currentFollowers, 28);
  assert.equal(view.mainValue, "28");
  assert.equal(view.deltaDisplay, "—");
  assert.equal(view.showChart, false);
  assert.match(view.subtitle, /Historique des abonnés en cours de collecte/);
});

test("two snapshots → delta correct for growth, decline, and stable", () => {
  const growth = projectClientFollowerGrowthSeries({
    accountId: "acct-a",
    snapshots: [
      snap("2026-06-10T08:00:00.000Z", 20, "baseline"),
      snap("2026-06-18T08:00:00.000Z", 28),
    ],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    period: "all",
    now: NOW,
  });
  assert.equal(growth.delta, 8);
  assert.equal(growth.deltaStatus, "positive");
  assert.equal(buildFollowerChartView(growth, "fr").deltaDisplay, "+8");

  const decline = projectClientFollowerGrowthSeries({
    accountId: "acct-a",
    snapshots: [
      snap("2026-06-10T08:00:00.000Z", 30, "baseline"),
      snap("2026-06-18T08:00:00.000Z", 25),
    ],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    period: "all",
    now: NOW,
  });
  assert.equal(decline.delta, -5);
  assert.equal(decline.deltaStatus, "negative");

  const stable = projectClientFollowerGrowthSeries({
    accountId: "acct-a",
    snapshots: [
      snap("2026-06-10T08:00:00.000Z", 28, "baseline"),
      snap("2026-06-18T08:00:00.000Z", 28),
    ],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    period: "all",
    now: NOW,
  });
  assert.equal(stable.delta, 0);
  assert.equal(stable.deltaStatus, "zero");
  assert.equal(buildFollowerChartView(stable, "fr").deltaDisplay, "0");
});

test("30 days without reference snapshot at period start → delta unknown", () => {
  const series = projectClientFollowerGrowthSeries({
    accountId: "acct-a",
    snapshots: [snap("2026-06-18T08:00:00.000Z", 28, "baseline")],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    period: "30d",
    now: NOW,
  });
  assert.equal(series.delta, null);
  assert.equal(series.deltaStatus, "unknown");
});

test("all period starts at first observation after client link", () => {
  const beforeLink = snap("2026-06-01T08:00:00.000Z", 10, "baseline");
  const afterLink = snap("2026-06-10T08:00:00.000Z", 20, "baseline");
  const latest = snap("2026-06-18T08:00:00.000Z", 28);
  const series = projectClientFollowerGrowthSeries({
    accountId: "acct-a",
    snapshots: [beforeLink, afterLink, latest],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    period: "all",
    now: NOW,
  });
  assert.equal(series.historyStartDate, afterLink.captured_at);
  assert.equal(series.delta, 8);
});

test("daily without intraday snapshots → honest empty chart", () => {
  const series = projectClientFollowerGrowthSeries({
    accountId: "acct-a",
    snapshots: [
      snap("2026-06-19T08:00:00.000Z", 26),
      snap("2026-06-20T08:00:00.000Z", 28),
    ],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    period: "daily",
    now: NOW,
  });
  assert.equal(series.points.length, 0);
  assert.equal(buildFollowerChartView(series, "fr").showChart, false);
});

test("daily with multiple intraday snapshots → curve enabled", () => {
  const series = projectClientFollowerGrowthSeries({
    accountId: "acct-a",
    snapshots: [
      snap("2026-06-19T08:00:00.000Z", 26),
      snap("2026-06-20T08:00:00.000Z", 27, "intraday"),
      snap("2026-06-20T12:00:00.000Z", 28, "intraday"),
    ],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    period: "daily",
    now: NOW,
  });
  assert.equal(series.points.length, 2);
  assert.equal(buildFollowerChartView(series, "fr").showChart, true);
});

test("interactions and disallowed sources never enter follower projection", () => {
  const filtered = filterReliableFollowerSnapshots([
    snap("2026-06-10T08:00:00.000Z", 5),
    {
      account_id: "acct-a",
      followers_count: 999,
      captured_at: "2026-06-11T08:00:00.000Z",
      source: "bot_follow_sent",
      observation_kind: "daily",
    },
  ]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.followers_count, 5);

  const insightsSource = readFileSync(new URL("./load-account-insights.ts", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("../../app/instagram-client/ClientDashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(dashboardSource, /buildOverviewChartSeries/);
  assert.doesNotMatch(dashboardSource, /chartSeries/);
  assert.doesNotMatch(dashboardSource, /totalInteractions/);
  assert.match(dashboardSource, /initialFollowerGrowth/);
  assert.match(dashboardSource, /buildFollowerChartViews/);
  assert.match(insightsSource, /chartSeries/);
});

test("multi-account isolation uses account_id scoped snapshots only", () => {
  const bundleA = buildClientFollowerGrowthBundle({
    accountId: "acct-a",
    snapshots: [snap("2026-06-10T08:00:00.000Z", 28, "baseline")],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    now: NOW,
  });
  const bundleB = buildClientFollowerGrowthBundle({
    accountId: "acct-b",
    snapshots: [{
      account_id: "acct-b",
      followers_count: 99,
      captured_at: "2026-06-10T08:00:00.000Z",
      source: "public_profile_lookup",
      observation_kind: "baseline",
    }],
    clientLinkedAt: CLIENT_LINK,
    businessTimezone: TZ,
    now: NOW,
  });
  assert.equal(bundleA.all.currentFollowers, 28);
  assert.equal(bundleB.all.currentFollowers, 99);
});

test("validateFollowerSnapshotInput rejects disallowed source", () => {
  const result = validateFollowerSnapshotInput({
    account_id: "acct-a",
    followers_count: 28,
    captured_at: "2026-06-10T08:00:00.000Z",
    source: "ig_interaction_events",
    observation_kind: "daily",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "disallowed_source");
});

test("follower chart title uses Abonnés label", () => {
  assert.equal(buildFollowerChartTitle("i_m_your_traker", "fr"), "Abonnés · @i_m_your_traker");
  assert.doesNotMatch(buildFollowerChartTitle("brand", "fr"), /Activité/);
});

test("allowed sources are explicit and finite", () => {
  assert.equal(isAllowedFollowerSnapshotSource("device_profile_read"), true);
  assert.equal(isAllowedFollowerSnapshotSource("public_profile_lookup"), true);
  assert.equal(isAllowedFollowerSnapshotSource("admin_manual_verified"), true);
  assert.equal(isAllowedFollowerSnapshotSource("follow_sent"), false);
});
