import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260723110000_follow_warmup_active_sast_days_v1.sql", import.meta.url),
  "utf8",
);
const settingsRoute = readFileSync(
  new URL("../app/api/instagram-dashboard/settings/route.ts", import.meta.url),
  "utf8",
);

function sastDate(isoTimestamp) {
  const shifted = new Date(new Date(isoTimestamp).getTime() + 2 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function warmupDayForRun({ now, verifiedFollowTimestamps }) {
  const currentBusinessDate = sastDate(now);
  const priorActiveDates = new Set(
    verifiedFollowTimestamps
      .map(sastDate)
      .filter((date) => date < currentBusinessDate),
  );
  return Math.min(4, priorActiveDates.size + 1);
}

function effectiveSessionCap({ packageCap, accountCap, warmupCap, opsCap = null, remaining = null }) {
  return Math.min(
    ...[packageCap, accountCap, warmupCap, opsCap, remaining]
      .filter((value) => value !== null),
  );
}

test("migration derives warmup from verified Follow activity in SAST, not package age", () => {
  assert.match(migration, /event_at at time zone 'Africa\/Johannesburg'/);
  assert.match(migration, /event_type = 'follow_verified'/);
  assert.match(migration, /interaction_type = 'follow'/);
  assert.match(migration, /interaction_status = 'success'/);
  assert.match(migration, /run_id is not null/);
  assert.match(migration, /least\(4, r\.prior_active_days \+ 1\)/);
  assert.doesNotMatch(migration, /current_date\s*-\s*r\.package_started_at::date/i);
  assert.match(migration, /package_started_at is metadata only/);
  assert.doesNotMatch(migration, /username\s*=|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test("migration separates package defaults from package maxima", () => {
  assert.match(migration, /add column if not exists max_follow_day_cap integer/);
  assert.match(migration, /add column if not exists max_follow_session_cap integer/);
  assert.match(migration, /default_follow_day_cap <= max_follow_day_cap/);
  assert.match(migration, /default_follow_session_cap <= max_follow_session_cap/);
  assert.match(migration, /as package_defaults/);
  assert.match(migration, /'follow_day', w\.max_follow_day_cap/);
  assert.match(migration, /'follow_session', w\.max_follow_session_cap/);
  assert.match(migration, /'day_4_plus_follow_cap', w\.max_follow_day_cap/);
  assert.match(migration, /else w\.max_follow_day_cap/);
});

test("account created three days ago with no verified Follow starts at Day 1", () => {
  assert.equal(warmupDayForRun({ now: "2026-07-23T10:00:00Z", verifiedFollowTimestamps: [] }), 1);
});

test("one historical active day yields Day 2 even for an older account", () => {
  assert.equal(warmupDayForRun({
    now: "2026-07-23T10:00:00Z",
    verifiedFollowTimestamps: ["2026-07-10T08:00:00Z"],
  }), 2);
});

test("three non-consecutive historical active days yield Day 4+", () => {
  assert.equal(warmupDayForRun({
    now: "2026-07-23T10:00:00Z",
    verifiedFollowTimestamps: [
      "2026-07-10T08:00:00Z",
      "2026-07-12T08:00:00Z",
      "2026-07-20T08:00:00Z",
    ],
  }), 4);
});

test("multiple runs on the same SAST day consume one warmup day", () => {
  assert.equal(warmupDayForRun({
    now: "2026-07-23T10:00:00Z",
    verifiedFollowTimestamps: [
      "2026-07-22T05:00:00Z",
      "2026-07-22T18:00:00Z",
    ],
  }), 2);
});

test("two accounts on the same package progress independently", () => {
  assert.equal(warmupDayForRun({
    now: "2026-07-23T10:00:00Z",
    verifiedFollowTimestamps: ["2026-07-22T05:00:00Z"],
  }), 2);
  assert.equal(warmupDayForRun({
    now: "2026-07-23T10:00:00Z",
    verifiedFollowTimestamps: [],
  }), 1);
});

test("a failed run without follow_verified does not consume a warmup day", () => {
  assert.equal(warmupDayForRun({ now: "2026-07-23T10:00:00Z", verifiedFollowTimestamps: [] }), 1);
});

test("a run with one verified Follow then a crash consumes the date once", () => {
  assert.equal(warmupDayForRun({
    now: "2026-07-24T10:00:00Z",
    verifiedFollowTimestamps: ["2026-07-23T10:03:00Z"],
  }), 2);
});

test("SAST midnight is the business-day boundary", () => {
  assert.equal(sastDate("2026-07-22T21:59:59Z"), "2026-07-22");
  assert.equal(sastDate("2026-07-22T22:00:00Z"), "2026-07-23");
});

test("Day 4+ still respects account, package, ops and remaining caps", () => {
  assert.equal(effectiveSessionCap({ packageCap: 80, accountCap: 50, warmupCap: 80 }), 50);
  assert.equal(effectiveSessionCap({ packageCap: 80, accountCap: 120, warmupCap: 80 }), 80);
  assert.equal(effectiveSessionCap({ packageCap: 80, accountCap: 50, warmupCap: 40 }), 40);
  assert.equal(effectiveSessionCap({ packageCap: 80, accountCap: 50, warmupCap: 80, opsCap: 35 }), 35);
  assert.equal(effectiveSessionCap({ packageCap: 80, accountCap: 50, warmupCap: 80, remaining: 12 }), 12);
});

test("settings route validates configured caps against the linked package before writing", () => {
  assert.match(settingsRoute, /packageFollowPolicyForAccount\(supabase, accountId\)/);
  assert.match(settingsRoute, /validateConfiguredFollowCaps\(\{/);
  assert.match(settingsRoute, /if \(!followCapValidation\.ok\) return jsonError/);
  assert.match(settingsRoute, /configuredDayCap: settings\.max_actions_per_day/);
  assert.match(settingsRoute, /configuredSessionCap: settings\.follow_limit/);
});

test("settings route counts current quota from verified Follow events at SAST midnight", () => {
  assert.match(settingsRoute, /businessDayKeyFromIso\(now\.toISOString\(\)\)/);
  assert.match(settingsRoute, /zonedLocalDateTimeToUtc\(businessDay, "00:00"\)/);
  assert.match(settingsRoute, /\.from\("ig_interaction_events"\)/);
  assert.match(settingsRoute, /\.eq\("event_type", "follow_verified"\)/);
  assert.match(settingsRoute, /\.not\("run_id", "is", null\)/);
});

test("saving account caps does not persist the temporary warmup projection", () => {
  assert.match(settingsRoute, /if \(includesWarmupWrite\(body\)\)/);
  assert.match(settingsRoute, /settings\.max_actions_per_day = followCapValidation\.configuredDayCap/);
  assert.match(settingsRoute, /settings\.follow_limit = followCapValidation\.configuredSessionCap/);
});
