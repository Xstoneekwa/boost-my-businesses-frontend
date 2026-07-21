import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { projectStatsFollowerSnapshots } from "./stats-follower-snapshot-projection.ts";

test("stats uses the latest real snapshot for each SAST business day without backfill", () => {
  const projection = projectStatsFollowerSnapshots({
    timezone: "Africa/Johannesburg",
    now: new Date("2026-07-21T17:00:00.000Z"),
    rows: [
      { account_id: "mythyl", followers_count: 100, captured_at: "2026-07-16T23:30:00.000Z", source: "public_profile_lookup", observation_kind: "daily" },
      { account_id: "mythyl", followers_count: 103, captured_at: "2026-07-17T12:00:00.000Z", source: "public_profile_lookup", observation_kind: "daily" },
      { account_id: "mythyl", followers_count: 108, captured_at: "2026-07-20T00:30:00.000Z", source: "public_profile_lookup", observation_kind: "daily" },
    ],
  });
  assert.deepEqual(projection.points.map((point) => [point.date, point.followersCount]), [
    ["2026-07-17", 103],
    ["2026-07-20", 108],
  ]);
  assert.equal(projection.sourceStatus.status, "stale");
  assert.equal(projection.sourceStatus.latestAt, "2026-07-20T00:30:00.000Z");
  assert.equal(projection.points.some((point) => point.date === "2026-07-18"), false);
});

test("stats reports no_data when no reliable follower snapshot exists", () => {
  const projection = projectStatsFollowerSnapshots({
    rows: [{ account_id: "mythyl", followers_count: -1, captured_at: "2026-07-20T00:30:00.000Z", source: "public_profile_lookup", observation_kind: "daily" }],
  });
  assert.equal(projection.sourceStatus.status, "no_data");
  assert.deepEqual(projection.points, []);
});

test("stats route preserves unfollowed_at truth while adding follower snapshots", () => {
  const route = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/[accountId]/stats-history/route.ts", import.meta.url), "utf8");
  assert.match(route, /verifiedUnfollowRowsAsInteractionEvents/);
  assert.match(route, /\.eq\("unfollow_result", "success"\)/);
  assert.match(route, /\.gte\("unfollowed_at", since\.toISOString\(\)\)/);
  assert.match(route, /ig_account_follower_snapshots/);
  assert.match(route, /projectStatsFollowerSnapshots/);
});
