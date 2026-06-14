import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/api/instagram-dashboard/profiles/[accountId]/stats-history/route.ts", import.meta.url), "utf8");

test("stats history uses real social action logs and excludes operational logs", () => {
  assert.match(source, /ig_action_logs/);
  assert.match(source, /socialActionKindFromLog/);
  assert.match(source, /ig_interaction_events/);
  assert.doesNotMatch(source, /login_completed/);
  assert.doesNotMatch(source, /preflight_completed/);
});

test("stats history exposes 30-day rows with pending snapshot sources", () => {
  assert.match(source, /days/);
  assert.match(source, /followers_count: null/);
  assert.match(source, /followings_count: null/);
  assert.match(source, /pending_account_follower_snapshots/);
  assert.match(source, /account_following_snapshots/);
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
