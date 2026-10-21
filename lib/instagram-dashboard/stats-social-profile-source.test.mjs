import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const statsRoute = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/[accountId]/stats-history/route.ts", import.meta.url), "utf8");
const liveRoute = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/live/route.ts", import.meta.url), "utf8");
const fullRoute = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");
const reader = readFileSync(new URL("./canonical-social-snapshot-read.ts", import.meta.url), "utf8");

test("Profiles live and Stats use one canonical snapshot table", () => {
  assert.match(liveRoute, /enrichAccountsWithRuntime/);
  assert.match(reader, /CANONICAL_SOCIAL_SNAPSHOT_TABLE = "ig_account_social_profile_snapshots"/);
  for (const source of [fullRoute]) {
    assert.match(source, /readCanonicalSocialSnapshots\(supabase/);
    assert.match(source, /canonicalSocialSnapshotProjection\(socialSnapshotsResult.data/);
    assert.doesNotMatch(source, /from\("ig_account_follower_snapshots"\)/);
  }
  assert.match(statsRoute, /supabase\.rpc\("read_stats_social_observations_v1", \{ p_account_id: normalizedAccountId, p_since: since, p_until: now\.toISOString\(\) \}\)/);
  assert.match(statsRoute, /storedRows\.some\(row => row\.account_id !== normalizedAccountId\)/);
  assert.match(statsRoute, /latestStatsObservations\(storedRows, normalizedAccountId, now\)/);
  assert.match(statsRoute, /canonicalSocialSnapshotProjection\(storedRows\.filter\(row => Date\.parse\(row\.observed_at\) >= Date\.parse\(since\)\), normalizedAccountId, now\)/);
  assert.doesNotMatch(statsRoute, /from\("ig_account_follower_snapshots"\)/);
  assert.doesNotMatch(fullRoute, /pending_account_follower_snapshots|no_snapshot_table/);
});
test("Stats exposes followers, followings, posts, captured timestamps and freshness", () => {
  assert.match(statsRoute, /followers_snapshot_at/);
  assert.match(statsRoute, /followings_snapshot_at/);
  assert.match(statsRoute, /posts_snapshot_at/);
  assert.match(statsRoute, /followers_freshness_status/);
  assert.match(statsRoute, /source_status: socialSnapshots\.sourceStatus/);
});
