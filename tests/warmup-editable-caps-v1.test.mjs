import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260723132430_warmup_editable_caps_v1.sql", import.meta.url),
  "utf8",
);
const settingsRoute = readFileSync(
  new URL("../app/api/instagram-dashboard/settings/route.ts", import.meta.url),
  "utf8",
);
const profilesRoute = readFileSync(
  new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url),
  "utf8",
);

test("migration reuses the four canonical account_warmup_settings fields", () => {
  assert.doesNotMatch(migration, /add column/i);
  for (const field of [
    "day_1_follow_cap",
    "day_2_follow_cap",
    "day_3_follow_cap",
    "day_4_plus_follow_cap",
  ]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(migration, /check \(day_1_follow_cap > 0\)/);
  assert.match(migration, /day_1_follow_cap <= day_2_follow_cap/);
  assert.match(migration, /day_3_follow_cap <= day_4_plus_follow_cap/);
});

test("migration keeps active SAST day selection unchanged", () => {
  assert.match(migration, /event_at at time zone 'Africa\/Johannesburg'/);
  assert.match(migration, /event_type = 'follow_verified'/);
  assert.match(migration, /interaction_type = 'follow'/);
  assert.match(migration, /interaction_status = 'success'/);
  assert.match(migration, /run_id is not null/);
  assert.match(migration, /least\(4, r\.prior_active_days \+ 1\)/);
  assert.doesNotMatch(migration, /current_date\s*-\s*.*package_started_at/i);
});

test("view projects configured Day 4+ and applies warmup to day and session", () => {
  assert.match(migration, /coalesce\(aws\.day_4_plus_follow_cap, cp\.max_follow_day_cap\)/);
  assert.match(migration, /'day_4_plus_follow_cap', w\.day_4_plus_follow_cap/);
  assert.match(migration, /else w\.day_4_plus_follow_cap/);
  assert.match(migration, /'follow_session', least\([\s\S]*w\.warmup_follow_cap/);
});

test("partial warmup writes preserve every field omitted from the request", () => {
  assert.match(settingsRoute, /mergeConfiguredWarmupCapFields\(\{ patch: body, existing, defaults \}\)/);
  assert.match(settingsRoute, /validateConfiguredWarmupCaps/);
  assert.doesNotMatch(settingsRoute, /const day4 = packageCap/);
});

test("Profiles effective session uses account, package, warmup and remaining quota", () => {
  assert.match(profilesRoute, /\["manual_follow_session_cap", "follow_limit"\]/);
  assert.match(profilesRoute, /resolveEffectiveFollowCapsToday\(\{/);
  assert.match(profilesRoute, /configuredAccountSessionCap: manualFollowSessionCap/);
  assert.match(profilesRoute, /warmupCap: warmupFollowCap/);
  assert.match(profilesRoute, /followsCompletedToday: counters\.follows/);
  assert.match(profilesRoute, /followSession: effectiveFollowSessionCap/);
});
