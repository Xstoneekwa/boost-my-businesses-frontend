import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSocialProfileSnapshot,
  normalizeAbsoluteCount,
  projectSocialProfileSnapshots,
  resolveSocialProfileTimezone,
  socialProfileSnapshotIdempotencyKey,
} from "./social-profile-snapshot-contract.ts";

const base = {
  accountId: "00000000-0000-4000-8000-000000000001",
  username: "@example",
  observation: {
    followers_count: 0,
    following_count: 12,
    posts_count: 0,
    observed_at: "2026-07-25T02:15:00.000Z",
    lookup_status: "found",
  },
  provider: "searchapi",
  trigger: "daily_fallback",
};

test("absolute counts preserve real zero and reject invalid values", () => {
  assert.equal(normalizeAbsoluteCount(0), 0);
  assert.equal(normalizeAbsoluteCount("53"), 53);
  for (const value of [null, "", -1, 1.5, Number.NaN, "many"]) {
    assert.equal(normalizeAbsoluteCount(value), null);
  }
});
test("snapshot stores followers, followings, posts and the daily bucket", () => {
  const row = buildSocialProfileSnapshot(base);
  assert.equal(row.followers_count, 0);
  assert.equal(row.following_count, 12);
  assert.equal(row.posts_count, 0);
  assert.equal(row.snapshot_local_date, "2026-07-25");
  assert.equal(row.source_provider, "searchapi");
});

test("failed observations and wholly empty metrics are not persisted", () => {
  assert.equal(buildSocialProfileSnapshot({
    ...base,
    observation: { ...base.observation, lookup_status: "provider_error" },
  }), null);
  assert.equal(buildSocialProfileSnapshot({
    ...base,
    observation: { ...base.observation, followers_count: null, following_count: null, posts_count: null },
  }), null);
});

test("daily idempotency is stable inside one account-local bucket", () => {
  const input = {
    accountId: base.accountId,
    trigger: "daily_fallback",
    observedAt: "2026-07-25T02:15:00.000Z",
    timezone: "Africa/Johannesburg",
  };
  assert.equal(
    socialProfileSnapshotIdempotencyKey(input),
    socialProfileSnapshotIdempotencyKey({ ...input, observedAt: "2026-07-25T20:00:00.000Z" }),
  );
  assert.notEqual(
    socialProfileSnapshotIdempotencyKey(input),
    socialProfileSnapshotIdempotencyKey({ ...input, observedAt: "2026-07-26T02:15:00.000Z" }),
  );
});

test("device timezone wins and platform fallback stays explicit", () => {
  assert.deepEqual(
    resolveSocialProfileTimezone({ deviceTimezone: "Europe/Paris", scheduleTimezone: "America/New_York" }),
    { timezone: "Europe/Paris", source: "device_assignment" },
  );
  assert.deepEqual(
    resolveSocialProfileTimezone({}),
    { timezone: "Africa/Johannesburg", source: "platform_default" },
  );
});

test("canonical projection exposes current values and stale status", () => {
  const snapshot = buildSocialProfileSnapshot(base);
  const projected = projectSocialProfileSnapshots({
    rows: [snapshot],
    now: new Date("2026-07-29T02:15:00.000Z"),
  });
  assert.equal(projected.sourceStatus.followers.status, "stale");
  assert.equal(projected.sourceStatus.followings.status, "stale");
  assert.equal(projected.points[0].row.followers_count, 0);
});
