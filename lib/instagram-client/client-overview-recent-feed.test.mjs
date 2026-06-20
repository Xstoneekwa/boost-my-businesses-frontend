import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OVERVIEW_RECENT_FEED_MAX_GROUPS,
  OVERVIEW_RECENT_FEED_WINDOW_DAYS,
  buildClientOverviewRecentFeed,
  eventInOverviewRecentBusinessWindow,
  formatOverviewRecentFeedTimestamp,
  mapOverviewRecentFeedSourceEvent,
  resolveOverviewFeedGroupKey,
  resolveOverviewFeedSessionKey,
} from "./client-overview-recent-feed-projection.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const TZ = "Africa/Johannesburg";
const NOW = new Date("2026-06-15T12:00:00.000Z");
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
    source_target_username: "originoil_cosmetics",
    run_id: "run-batch-1",
    ...overrides,
  };
}

test("mapOverviewRecentFeedSourceEvent keeps source target and touched username", () => {
  const mapped = mapOverviewRecentFeedSourceEvent(event(), { accountId: ACCOUNT_A, businessTimezone: TZ });
  assert.ok(mapped);
  assert.equal(mapped.sourceTargetUsername, "originoil_cosmetics");
  assert.equal(mapped.touchedUsername, "user_a");
  assert.equal(mapped.sessionKey, "run:run-batch-1");
});

test("resolveOverviewFeedGroupKey prefers session bucket over business day", () => {
  assert.equal(
    resolveOverviewFeedGroupKey({
      actionKind: "follow",
      sourceTargetUsername: "cafecuba_geneve",
      sessionKey: "run:abc",
      businessDayKey: "2026-06-08",
    }),
    "follow::cafecuba_geneve::run:abc",
  );
  assert.equal(
    resolveOverviewFeedGroupKey({
      actionKind: "like",
      sourceTargetUsername: "cafecuba_geneve",
      sessionKey: null,
      businessDayKey: "2026-06-08",
    }),
    "like::cafecuba_geneve::day:2026-06-08",
  );
});

test("same action + compte cible on two business days => two feed lines", () => {
  const feed = buildClientOverviewRecentFeed([
    event({ id: "1", run_id: null, request_id: null, session_id: null, event_at: "2026-06-08T20:56:00.000Z" }),
    event({ id: "2", run_id: null, request_id: null, session_id: null, event_at: "2026-06-07T20:56:00.000Z", username: "user_b" }),
  ], {
    accountId: ACCOUNT_A,
    businessTimezone: TZ,
    now: NOW,
  });

  assert.equal(feed.length, 2);
  assert.equal(feed[0].count, 1);
  assert.equal(feed[1].count, 1);
  assert.match(feed[0].summaryFr, /1 abonnement envoyé à partir de @originoil_cosmetics/);
});

test("same session/batch => one condensed line", () => {
  const feed = buildClientOverviewRecentFeed([
    event({ id: "1", username: "user_a" }),
    event({ id: "2", username: "user_b", event_at: "2026-06-08T20:54:00.000Z" }),
    event({ id: "3", username: "user_c", event_at: "2026-06-08T20:52:00.000Z" }),
  ], {
    accountId: ACCOUNT_A,
    businessTimezone: TZ,
    now: NOW,
  });

  assert.equal(feed.length, 1);
  assert.equal(feed[0].count, 3);
  assert.equal(feed[0].distinctTouchedCount, 3);
  assert.equal(feed[0].touchedUsernames.length, 3);
  assert.equal(feed[0].overflowCount, 0);
});

test("overflow bubble uses distinct touched usernames, not event count", () => {
  const rows = Array.from({ length: 18 }, (_, index) => event({
    id: `evt-${index}`,
    username: `user_${index}`,
    run_id: "run-batch-1",
  }));

  const feed = buildClientOverviewRecentFeed(rows, {
    accountId: ACCOUNT_A,
    businessTimezone: TZ,
    now: NOW,
  });

  assert.equal(feed.length, 1);
  assert.equal(feed[0].count, 18);
  assert.equal(feed[0].distinctTouchedCount, 18);
  assert.equal(feed[0].touchedUsernames.length, 3);
  assert.equal(feed[0].overflowCount, 15);
});

test("repeated events on same touched username keep +N on distinct count", () => {
  const rows = Array.from({ length: 18 }, (_, index) => event({
    id: `evt-${index}`,
    username: index < 10 ? `user_${index}` : `user_${index - 10}`,
    run_id: "run-batch-1",
  }));

  const feed = buildClientOverviewRecentFeed(rows, {
    accountId: ACCOUNT_A,
    businessTimezone: TZ,
    now: NOW,
  });

  assert.equal(feed[0].count, 18);
  assert.equal(feed[0].distinctTouchedCount, 10);
  assert.equal(feed[0].overflowCount, 7);
});

test("buildClientOverviewRecentFeed excludes failed and internal events", () => {
  const feed = buildClientOverviewRecentFeed([
    event({ event_status: "failed" }),
    event({ event_type: "follow_verified" }),
    event({ event_type: "profile_visit" }),
  ], { accountId: ACCOUNT_A, businessTimezone: TZ, now: NOW });
  assert.equal(feed.length, 0);
});

test("14-day business window excludes older groups", () => {
  assert.equal(OVERVIEW_RECENT_FEED_WINDOW_DAYS, 14);
  assert.equal(
    eventInOverviewRecentBusinessWindow("2026-06-02T10:00:00.000Z", TZ, 14, NOW),
    true,
  );
  assert.equal(
    eventInOverviewRecentBusinessWindow("2026-06-01T10:00:00.000Z", TZ, 14, NOW),
    false,
  );

  const feed = buildClientOverviewRecentFeed([
    event({ id: "recent", event_at: "2026-06-08T20:56:00.000Z" }),
    event({ id: "old", event_at: "2026-05-20T20:56:00.000Z", run_id: "run-old" }),
  ], { accountId: ACCOUNT_A, businessTimezone: TZ, now: NOW });

  assert.equal(feed.length, 1);
  assert.equal(feed[0].count, 1);
});

test("maximum five recent groups returned", () => {
  assert.equal(OVERVIEW_RECENT_FEED_MAX_GROUPS, 5);
  const rows = Array.from({ length: 7 }, (_, index) => event({
    id: `evt-${index}`,
    run_id: `run-${index}`,
    event_at: `2026-06-${String(8 - index).padStart(2, "0")}T20:56:00.000Z`,
    source_target_username: `target_${index}`,
  }));

  const feed = buildClientOverviewRecentFeed(rows, {
    accountId: ACCOUNT_A,
    businessTimezone: TZ,
    now: NOW,
    limit: 5,
  });
  assert.equal(feed.length, 5);
});

test("strict multi-account isolation in projection", () => {
  const rows = [
    event({ id: "a1", account_id: ACCOUNT_A }),
    event({ id: "b1", account_id: ACCOUNT_B, source_target_username: "originoil_cosmetics" }),
  ];

  const feedA = buildClientOverviewRecentFeed(rows, { accountId: ACCOUNT_A, businessTimezone: TZ, now: NOW });
  const feedB = buildClientOverviewRecentFeed(rows, { accountId: ACCOUNT_B, businessTimezone: TZ, now: NOW });

  assert.equal(feedA.length, 1);
  assert.equal(feedB.length, 1);
  assert.equal(feedA[0].count, 1);
  assert.equal(feedB[0].count, 1);
});

test("like category pill is J'aime in french", () => {
  const feed = buildClientOverviewRecentFeed([
    event({
      event_type: "like_sent",
      interaction_type: "post_like_success",
      username: "user_like",
    }),
  ], { accountId: ACCOUNT_A, businessTimezone: TZ, now: NOW });

  assert.equal(feed[0].categoryLabelFr, "J'aime");
});

test("formatOverviewRecentFeedTimestamp uses readable absolute date", () => {
  assert.match(
    formatOverviewRecentFeedTimestamp("2026-06-08T20:56:00.000Z", "fr"),
    /8.*22:56|08.*22:56/,
  );
});

test("client dashboard overview uses condensed recent feed without right counter", () => {
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  const feedSource = source("../../app/instagram-client/ClientOverviewRecentFeed.tsx");
  const loaderSource = source("./load-account-insights.ts");

  assert.match(dashboardSource, /ClientOverviewRecentFeed/);
  assert.match(dashboardSource, /overviewRecentFeed/);
  assert.doesNotMatch(feedSource, /cd-orf-count/);
  assert.match(loaderSource, /run_id,request_id,session_id/);
  assert.match(loaderSource, /accountId,/);
  assert.match(loaderSource, /windowDays: 14/);
  assert.doesNotMatch(dashboardSource, /const FD:/);
});

test("overview recent feed projection avoids technical client-facing terms", () => {
  const feed = buildClientOverviewRecentFeed([event()], { accountId: ACCOUNT_A, businessTimezone: TZ, now: NOW });
  assert.doesNotMatch(feed[0].summaryFr, /\bCT\b|run_id|provider|evidence/i);
  assert.match(feed[0].summaryFr, /à partir de @originoil_cosmetics/);
});

test("resolveOverviewFeedSessionKey priority run then request then session", () => {
  assert.equal(resolveOverviewFeedSessionKey({ run_id: "r1", request_id: "q1", session_id: "s1" }), "run:r1");
  assert.equal(resolveOverviewFeedSessionKey({ request_id: "q1", session_id: "s1" }), "req:q1");
  assert.equal(resolveOverviewFeedSessionKey({ session_id: "s1" }), "sess:s1");
  assert.equal(resolveOverviewFeedSessionKey({}), null);
});
