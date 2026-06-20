import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OVERVIEW_RECENT_FEED_ACTIVE_BUSINESS_DAYS,
  OVERVIEW_RECENT_FEED_MAX_GROUPS,
  buildClientOverviewRecentFeed,
  buildOverviewRecentFeedGroupDetails,
  formatOverviewRecentFeedBusinessDate,
  mapOverviewRecentFeedSourceEvent,
  resolveOverviewFeedGroupKey,
  resolveOverviewRecentActiveBusinessDays,
} from "./client-overview-recent-feed-projection.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const TZ = "Africa/Johannesburg";
const ACCOUNT_A = "83de9cc9-5c37-42d1-9edc-c924352b17b1";
const ACCOUNT_B = "11111111-1111-1111-1111-111111111111";

function event(overrides = {}) {
  return {
    id: "evt-1",
    account_id: ACCOUNT_A,
    event_type: "follow_sent",
    event_status: "success",
    interaction_type: "follow",
    event_at: "2026-06-08T20:56:00.000Z",
    username: "user_a",
    source_target_username: "cafecuba_geneve",
    run_id: "run-batch-1",
    ...overrides,
  };
}

test("resolveOverviewFeedGroupKey groups by account, business day, action and source target", () => {
  assert.equal(
    resolveOverviewFeedGroupKey({
      accountId: ACCOUNT_A,
      actionKind: "follow",
      sourceTargetUsername: "cafecuba_geneve",
      businessDayKey: "2026-06-08",
    }),
    `${ACCOUNT_A}::2026-06-08::follow::cafecuba_geneve`,
  );
});

test("same action + compte cible + même journée => une ligne condensée", () => {
  const feed = buildClientOverviewRecentFeed([
    event({ id: "1", username: "user_a", run_id: "run-1" }),
    event({ id: "2", username: "user_b", run_id: "run-2", event_at: "2026-06-08T19:00:00.000Z" }),
    event({ id: "3", username: "user_c", run_id: "run-3", event_at: "2026-06-08T18:00:00.000Z" }),
  ], { accountId: ACCOUNT_A, businessTimezone: TZ });

  assert.equal(feed.length, 1);
  assert.equal(feed[0].count, 3);
  assert.equal(feed[0].distinctTouchedCount, 3);
});

test("same action + compte cible sur deux journées => deux lignes", () => {
  const feed = buildClientOverviewRecentFeed([
    event({ id: "1", event_at: "2026-06-08T20:56:00.000Z" }),
    event({ id: "2", event_at: "2026-06-07T20:56:00.000Z", username: "user_b" }),
  ], { accountId: ACCOUNT_A, businessTimezone: TZ });

  assert.equal(feed.length, 2);
  assert.equal(feed[0].businessDayKey, "2026-06-08");
  assert.equal(feed[1].businessDayKey, "2026-06-07");
});

test("follow et like du même jour => deux lignes", () => {
  const feed = buildClientOverviewRecentFeed([
    event({ id: "1" }),
    event({
      id: "2",
      event_type: "like_sent",
      interaction_type: "post_like_success",
      username: "user_like",
    }),
  ], { accountId: ACCOUNT_A, businessTimezone: TZ });

  assert.equal(feed.length, 2);
  assert.equal(feed[0].actionKind, "follow");
  assert.equal(feed[1].actionKind, "like");
  assert.equal(feed[1].categoryLabelFr, "J'aime");
});

test("only the two most recent business days with activity are retained", () => {
  const rows = [
    event({ id: "d8", event_at: "2026-06-08T20:56:00.000Z" }),
    event({ id: "d7", event_at: "2026-06-07T20:56:00.000Z", username: "user_b" }),
    event({ id: "d6", event_at: "2026-06-06T20:56:00.000Z", username: "user_c" }),
  ];
  const events = rows
    .map((row) => mapOverviewRecentFeedSourceEvent(row, { accountId: ACCOUNT_A, businessTimezone: TZ }))
    .filter(Boolean);
  const activeDays = resolveOverviewRecentActiveBusinessDays(events, OVERVIEW_RECENT_FEED_ACTIVE_BUSINESS_DAYS);
  assert.deepEqual(activeDays, ["2026-06-08", "2026-06-07"]);

  const groups = buildOverviewRecentFeedGroupDetails(rows, { accountId: ACCOUNT_A, businessTimezone: TZ });
  assert.equal(groups.some((group) => group.businessDayKey === "2026-06-06"), false);
});

test("a day without activity is not counted among the two active days", () => {
  const rows = [
    event({ id: "d8", event_at: "2026-06-08T20:56:00.000Z" }),
    event({ id: "d5", event_at: "2026-06-05T20:56:00.000Z", username: "user_old" }),
  ];
  const activeDays = resolveOverviewRecentActiveBusinessDays(
    rows
      .map((row) => mapOverviewRecentFeedSourceEvent(row, { accountId: ACCOUNT_A, businessTimezone: TZ }))
      .filter(Boolean),
    2,
  );
  assert.deepEqual(activeDays, ["2026-06-08", "2026-06-05"]);
});

test("single active business day shows only that day", () => {
  const feed = buildClientOverviewRecentFeed([
    event({ id: "1" }),
    event({ id: "2", username: "user_b", event_at: "2026-06-08T18:00:00.000Z" }),
  ], { accountId: ACCOUNT_A, businessTimezone: TZ, activeBusinessDays: 2 });

  assert.ok(feed.every((item) => item.businessDayKey === "2026-06-08"));
});

test("overflow bubble uses distinct touched usernames, not event count", () => {
  const rows = Array.from({ length: 18 }, (_, index) => event({
    id: `evt-${index}`,
    username: `user_${index}`,
    run_id: `run-${index}`,
  }));

  const feed = buildClientOverviewRecentFeed(rows, { accountId: ACCOUNT_A, businessTimezone: TZ });
  assert.equal(feed[0].count, 18);
  assert.equal(feed[0].distinctTouchedCount, 18);
  assert.equal(feed[0].overflowCount, 15);
});

test("strict multi-account isolation in projection", () => {
  const rows = [
    event({ id: "a1", account_id: ACCOUNT_A }),
    event({ id: "b1", account_id: ACCOUNT_B, source_target_username: "cafecuba_geneve" }),
  ];

  const feedA = buildClientOverviewRecentFeed(rows, { accountId: ACCOUNT_A, businessTimezone: TZ });
  const feedB = buildClientOverviewRecentFeed(rows, { accountId: ACCOUNT_B, businessTimezone: TZ });

  assert.equal(feedA.length, 1);
  assert.equal(feedB.length, 1);
  assert.equal(feedA[0].count, 1);
  assert.equal(feedB[0].count, 1);
});

test("buildClientOverviewRecentFeed excludes failed and internal events", () => {
  const feed = buildClientOverviewRecentFeed([
    event({ event_status: "failed" }),
    event({ event_type: "follow_verified" }),
  ], { accountId: ACCOUNT_A, businessTimezone: TZ });
  assert.equal(feed.length, 0);
});

test("maximum five recent groups returned", () => {
  assert.equal(OVERVIEW_RECENT_FEED_MAX_GROUPS, 5);
  const rows = Array.from({ length: 7 }, (_, index) => event({
    id: `evt-${index}`,
    source_target_username: `target_${index}`,
    event_at: `2026-06-08T${String(20 - index).padStart(2, "0")}:00:00.000Z`,
  }));

  const feed = buildClientOverviewRecentFeed(rows, { accountId: ACCOUNT_A, businessTimezone: TZ, limit: 5 });
  assert.equal(feed.length, 5);
});

test("formatOverviewRecentFeedBusinessDate shows day without hour", () => {
  const label = formatOverviewRecentFeedBusinessDate("2026-06-08", "fr");
  assert.match(label, /8.*juin/i);
  assert.doesNotMatch(label, /:/);
});

test("client dashboard overview uses condensed recent feed without right counter", () => {
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  const feedSource = source("../../app/instagram-client/ClientOverviewRecentFeed.tsx");
  const loaderSource = source("./load-account-insights.ts");

  assert.match(feedSource, /formatOverviewRecentFeedBusinessDate/);
  assert.doesNotMatch(feedSource, /cd-orf-count/);
  assert.match(loaderSource, /accountId,/);
  assert.doesNotMatch(loaderSource, /windowDays/);
});

test("overview recent feed projection avoids technical client-facing terms", () => {
  const feed = buildClientOverviewRecentFeed([event()], { accountId: ACCOUNT_A, businessTimezone: TZ });
  assert.doesNotMatch(feed[0].summaryFr, /\bCT\b|run_id|provider|evidence/i);
  assert.match(feed[0].summaryFr, /à partir de @cafecuba_geneve/);
});
