import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSocialProfileSnapshot,
  normalizeAbsoluteCount,
  normalizeSocialProfileUsername,
  planSocialProfileScheduledTrigger,
  projectSocialProfileSnapshots,
  resolveSocialProfileTimezone,
  selectSnapshotForSession,
  socialProfileSnapshotIdempotencyKey,
} from "./social-profile-snapshot-contract.ts";

for (const [label, input, expected] of [
  ["zero number", 0, 0], ["positive number", 42, 42], ["numeric string", "53", 53],
  ["null", null, null], ["undefined", undefined, null], ["empty", "", null],
  ["negative", -1, null], ["decimal", 1.2, null], ["negative string", "-2", null],
  ["word", "many", null], ["nan", Number.NaN, null], ["unsafe", Number.MAX_SAFE_INTEGER + 1, null],
]) test(`absolute count: ${label}`, () => assert.equal(normalizeAbsoluteCount(input), expected));

for (const [label, input, expected] of [
  ["at prefix", "@Example", "example"], ["spaces", "  Example  ", "example"],
  ["multiple at", "@@Name", "name"], ["already normalized", "name_one", "name_one"],
]) test(`username: ${label}`, () => assert.equal(normalizeSocialProfileUsername(input), expected));

for (const [label, input, expectedTimezone, expectedSource] of [
  ["device wins", { deviceTimezone: "Europe/Paris", scheduleTimezone: "America/New_York" }, "Europe/Paris", "device_assignment"],
  ["schedule fallback", { deviceTimezone: "UTC", scheduleTimezone: "America/New_York" }, "America/New_York", "schedule"],
  ["empty device", { deviceTimezone: "", scheduleTimezone: "Europe/London" }, "Europe/London", "schedule"],
  ["platform fallback", {}, "Africa/Johannesburg", "platform_default"],
  ["utc schedule ignored", { scheduleTimezone: "UTC" }, "Africa/Johannesburg", "platform_default"],
  ["trim device", { deviceTimezone: " Europe/Paris " }, "Europe/Paris", "device_assignment"],
]) test(`timezone: ${label}`, () => assert.deepEqual(resolveSocialProfileTimezone(input), { timezone: expectedTimezone, source: expectedSource }));

const baseInput = {
  accountId: "00000000-0000-0000-0000-000000000001",
  username: "@Example",
  observation: { followers_count: 0, following_count: 12, posts_count: 4, observed_at: "2026-07-22T00:30:00.000Z", lookup_status: "found" },
  provider: "searchapi",
  trigger: "daily_fallback",
};

for (const [label, mutate, predicate] of [
  ["accepts zero", {}, (row) => row.followers_count === 0],
  ["normalizes username", {}, (row) => row.username_normalized === "example"],
  ["stores following", {}, (row) => row.following_count === 12],
  ["stores posts", {}, (row) => row.posts_count === 4],
  ["stores local date", {}, (row) => row.snapshot_local_date === "2026-07-22"],
  ["full row fresh", {}, (row) => row.freshness_status === "fresh"],
  ["partial row", { observation: { ...baseInput.observation, posts_count: null } }, (row) => row.freshness_status === "partial"],
  ["http provider", { provider: "http" }, (row) => row.source_provider === "http"],
  ["unknown provider safe", { provider: "other" }, (row) => row.source_provider === "searchapi"],
  ["invalid date rejected", { observation: { ...baseInput.observation, observed_at: "bad" } }, (row) => row === null],
  ["invalid username rejected", { username: "not valid!" }, (row) => row === null],
  ["failed lookup rejected", { observation: { ...baseInput.observation, lookup_status: "provider_error" } }, (row) => row === null],
  ["all metrics missing rejected", { observation: { ...baseInput.observation, followers_count: null, following_count: null, posts_count: null } }, (row) => row === null],
]) test(`build row: ${label}`, () => {
  const row = buildSocialProfileSnapshot({ ...baseInput, ...mutate });
  assert.equal(predicate(row), true);
});

for (const [label, left, right, equal] of [
  ["same daily day", {}, { observedAt: "2026-07-22T12:00:00.000Z" }, true],
  ["different daily day", {}, { observedAt: "2026-07-23T12:00:00.000Z" }, false],
  ["event stable", { sourceEventId: "evt-1" }, { sourceEventId: "evt-1", observedAt: "2026-07-23T12:00:00.000Z" }, true],
  ["event differs", { sourceEventId: "evt-1" }, { sourceEventId: "evt-2" }, false],
  ["account differs", {}, { accountId: "00000000-0000-0000-0000-000000000002" }, false],
  ["trigger differs", {}, { trigger: "session_end" }, false],
]) test(`idempotency: ${label}`, () => {
  const seed = { accountId: baseInput.accountId, trigger: "daily_fallback", observedAt: baseInput.observation.observed_at, timezone: "Africa/Johannesburg" };
  assert.equal(socialProfileSnapshotIdempotencyKey({ ...seed, ...left }) === socialProfileSnapshotIdempotencyKey({ ...seed, ...right }), equal);
});

const snapshot = buildSocialProfileSnapshot(baseInput);
const exactSnapshot = { ...snapshot, source_run_id: "run-1" };
for (const [label, input, expected] of [
  ["explicit run", { snapshots: [exactSnapshot], runId: "run-1", sessionAt: "2026-07-22T01:00:00.000Z", timezone: "Africa/Johannesburg" }, "explicit"],
  ["same day", { snapshots: [snapshot], sessionAt: "2026-07-22T02:00:00.000Z", timezone: "Africa/Johannesburg" }, "same_local_date"],
  ["outside bound", { snapshots: [snapshot], sessionAt: "2026-07-22T23:59:00.000Z", timezone: "Africa/Johannesburg", maxHours: 1 }, "none"],
  ["different day", { snapshots: [snapshot], sessionAt: "2026-07-24T00:30:00.000Z", timezone: "Africa/Johannesburg" }, "none"],
  ["invalid session", { snapshots: [snapshot], sessionAt: "bad", timezone: "Africa/Johannesburg" }, "none"],
  ["failed lookup excluded", { snapshots: [{ ...snapshot, lookup_status: "provider_error" }], sessionAt: "2026-07-22T02:00:00.000Z", timezone: "Africa/Johannesburg" }, "none"],
]) test(`session match: ${label}`, () => assert.equal(selectSnapshotForSession(input).match, expected));

test("projection exposes all three available statuses", () => {
  const result = projectSocialProfileSnapshots({ rows: [snapshot], now: new Date("2026-07-22T01:00:00.000Z") });
  assert.equal(result.sourceStatus.followers.status, "available");
  assert.equal(result.sourceStatus.followings.status, "available");
  assert.equal(result.sourceStatus.posts.status, "available");
});
test("projection marks latest stale", () => assert.equal(projectSocialProfileSnapshots({ rows: [snapshot], now: new Date("2026-07-25T00:30:00.000Z") }).sourceStatus.followers.status, "stale"));
test("projection preserves zero", () => assert.equal(projectSocialProfileSnapshots({ rows: [snapshot] }).points[0].row.followers_count, 0));
test("projection reports missing following only", () => assert.equal(projectSocialProfileSnapshots({ rows: [{ ...snapshot, following_count: null }] }).sourceStatus.followings.status, "no_data"));
test("projection reports no data for empty history", () => assert.equal(projectSocialProfileSnapshots({ rows: [] }).sourceStatus.followers.status, "no_data"));

test("scheduler prefers a completed same-local-day run", () => assert.equal(planSocialProfileScheduledTrigger({ now: new Date("2026-07-22T12:00:00Z"), timezone: "Africa/Johannesburg", latestRunFinishedAt: "2026-07-22T11:00:00Z" })?.trigger, "session_end"));
test("scheduler does not enqueue an early fallback", () => assert.equal(planSocialProfileScheduledTrigger({ now: new Date("2026-07-22T12:00:00Z"), timezone: "Africa/Johannesburg" }), null));
test("scheduler enqueues fallback after local 23:00", () => assert.equal(planSocialProfileScheduledTrigger({ now: new Date("2026-07-22T21:30:00Z"), timezone: "Africa/Johannesburg" })?.trigger, "daily_fallback"));
test("scheduler does not attach a previous-local-day run", () => assert.equal(planSocialProfileScheduledTrigger({ now: new Date("2026-07-22T12:00:00Z"), timezone: "Africa/Johannesburg", latestRunFinishedAt: "2026-07-21T11:00:00Z" }), null));
test("scheduler computes local date in account timezone", () => assert.equal(planSocialProfileScheduledTrigger({ now: new Date("2026-07-22T22:30:00Z"), timezone: "Europe/Paris", latestRunFinishedAt: "2026-07-22T22:00:00Z" })?.localDate, "2026-07-23"));

test("Admin Stats reads the same persisted snapshot projection and queues refresh through the backend", () => {
  const dashboard = readFileSync(new URL("../../app/instagram-dashboard/InstagramDashboardButtons.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /profiles\/\$\{encodeURIComponent\(accountId\)\}\/stats-history\?days=30/);
  assert.match(dashboard, /profiles\/\$\{encodeURIComponent\(accountId\)\}\/social-profile-refresh/);
  assert.match(dashboard, /day\.followers_count \?\? "—"/);
});
