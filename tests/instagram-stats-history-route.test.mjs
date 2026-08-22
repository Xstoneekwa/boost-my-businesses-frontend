import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/api/instagram-dashboard/profiles/[accountId]/stats-history/route.ts", import.meta.url), "utf8");
const statsRouteSource = readFileSync(new URL("../app/api/instagram-dashboard/stats/route.ts", import.meta.url), "utf8");

test("stats history uses real social action logs and excludes operational logs", () => {
  assert.match(source, /ig_action_logs/);
  assert.match(source, /socialActionKindFromLog/);
  assert.match(source, /ig_interaction_events/);
  assert.doesNotMatch(source, /login_completed/);
  assert.doesNotMatch(source, /preflight_completed/);
  assert.match(source, /action_type,status,created_at,payload/);
  assert.match(source, /isCountableSocialActionLog/);
});

test("stats history exposes canonical social profile snapshots with explicit freshness", () => {
  assert.match(source, /days/);
  assert.match(source, /followers_count: null/);
  assert.match(source, /followings_count: null/);
  assert.match(source, /ig_account_social_profile_snapshots/);
  assert.match(source, /followers_freshness_status/);
  assert.match(source, /followings_freshness_status/);
  assert.match(source, /source_status/);
  assert.doesNotMatch(source, /pending_account_follower_snapshots/);
  assert.doesNotMatch(source, /account_following_snapshots/);
});

test("stats history keeps total interactions aligned with profile row definition", () => {
  assert.match(source, /STATS_TOTAL_INTERACTIONS_DEFINITION/);
  assert.match(source, /total_interactions/);
  assert.match(source, /account_package_summary\+ig_account_settings/);
});

test("stats history reconciles post-follow likes from ig_runs totals", () => {
  assert.match(source, /total_like/);
  assert.match(source, /reconcileDayWithSources/);
  assert.match(source, /ig_runs\.total_\* reconciliation for post-follow likes/);
  assert.match(source, /ig_interaction_events/);
  assert.match(source, /post_like_success/);
});

test("stats history restores canonical persisted Unfollows including continuation runs", () => {
  assert.match(source, /ig_interacted_users/);
  assert.match(source, /unfollow_result", "success"/);
  assert.match(source, /mergeCanonicalInteractionEventsWithUnfollowFallback/);
  assert.match(source, /select\("id,account_id,run_id,event_type,event_status,interaction_type,event_at,payload"\)/);
  assert.match(source, /last_run_id/);
  assert.match(source, /ig_interacted_users\.unfollowed_at where unfollow_result=success/);
});

test("stats history filters and groups by the SAST business date and labels SAST", () => {
  assert.match(source, /businessDayRangeStartIso/);
  assert.match(source, /interactionEventCountersByDay\([\s\S]*socialSnapshots\.timezone/);
  assert.match(source, /formatBusinessTimestamp/);
  assert.doesNotMatch(source, /setUTCHours\(0/);
  assert.doesNotMatch(source, /toISOString\(\)\.slice\(11, 19\)/);
});

test("stats summary uses the canonical payload-aware log counter", () => {
  assert.match(statsRouteSource, /actionCountersFromLogs\(logs\)/);
  assert.doesNotMatch(statsRouteSource, /function countAction\(/);
});
