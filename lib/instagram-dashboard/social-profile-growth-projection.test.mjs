import assert from "node:assert/strict";
import test from "node:test";

import {
  FOLLOWER_DELTA_BASELINE_TOLERANCE_HOURS,
  FOLLOWER_DELTA_WINDOW_HOURS,
  projectSocialProfileFollowerDelta3d,
} from "./social-profile-growth-projection.ts";

function row(followers, observedAt, following = 50) {
  return {
    account_id: "account-1",
    username_normalized: "account",
    followers_count: followers,
    following_count: following,
    posts_count: 1,
    observed_at: observedAt,
    lookup_status: "found",
    source_provider: "searchapi",
  };
}

const currentAt = "2026-07-25T12:00:00.000Z";
const exactBaselineAt = "2026-07-22T12:00:00.000Z";

test("positive net follower delta is projected", () => {
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(10, exactBaselineAt), row(16, currentAt)], now: currentAt });
  assert.equal(out.value, 6);
});

test("negative net follower delta is projected", () => {
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(20, exactBaselineAt), row(16, currentAt)], now: currentAt });
  assert.equal(out.value, -4);
});

test("real zero delta remains zero", () => {
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(16, exactBaselineAt), row(16, currentAt, 0)], now: currentAt });
  assert.equal(out.value, 0);
  assert.equal(out.currentFollowings, 0);
});

test("current snapshot at 36h boundary is fresh", () => {
  const now = "2026-07-27T00:00:00.000Z";
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(10, exactBaselineAt), row(16, currentAt)], now });
  assert.equal(out.status, "fresh");
  assert.equal(out.ageSeconds, 36 * 3600);
});

test("snapshot older than 36h and at most 72h is aging", () => {
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(10, exactBaselineAt), row(16, currentAt)], now: "2026-07-27T00:00:01.000Z" });
  assert.equal(out.status, "aging");
});

test("snapshot older than 72h is stale but keeps historical value", () => {
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(10, exactBaselineAt), row(16, currentAt)], now: "2026-07-28T12:00:01.000Z" });
  assert.equal(out.status, "stale");
  assert.equal(out.value, 6);
});

test("exact 72h baseline exposes exact coverage", () => {
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(10, exactBaselineAt), row(16, currentAt)], now: currentAt });
  assert.equal(out.windowHours, FOLLOWER_DELTA_WINDOW_HOURS);
  assert.equal(out.windowCoverageHours, 72);
  assert.equal(out.baselineCapturedAt, exactBaselineAt);
});

test("nearest bounded baseline is selected", () => {
  const near = "2026-07-22T18:00:00.000Z";
  const farther = "2026-07-21T18:00:00.000Z";
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(8, farther), row(11, near), row(16, currentAt)], now: currentAt });
  assert.equal(out.baselineValue, 11);
  assert.equal(out.windowCoverageHours, 66);
});

test("baseline outside bounded tolerance is insufficient", () => {
  const tooFar = new Date(Date.parse(exactBaselineAt) - (FOLLOWER_DELTA_BASELINE_TOLERANCE_HOURS * 3600_000 + 1)).toISOString();
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(8, tooFar), row(16, currentAt)], now: currentAt });
  assert.equal(out.status, "insufficient_data");
  assert.equal(out.value, null);
});

test("single current snapshot is insufficient rather than zero", () => {
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(0, currentAt, 0)], now: currentAt });
  assert.equal(out.status, "insufficient_data");
  assert.equal(out.currentValue, 0);
  assert.equal(out.value, null);
});

test("no snapshots is unavailable", () => {
  const out = projectSocialProfileFollowerDelta3d({ rows: [], now: currentAt });
  assert.equal(out.status, "unavailable");
  assert.equal(out.currentValue, null);
});

test("non-found and invalid observations never become canonical", () => {
  const out = projectSocialProfileFollowerDelta3d({
    rows: [
      { ...row(999, exactBaselineAt), lookup_status: "not_found" },
      { ...row(999, currentAt), followers_count: -1 },
    ],
    now: currentAt,
  });
  assert.equal(out.status, "unavailable");
});

test("canonical source and captured timestamp are explicit", () => {
  const out = projectSocialProfileFollowerDelta3d({ rows: [row(10, exactBaselineAt), row(16, currentAt, 77)], now: currentAt });
  assert.equal(out.source, "ig_account_social_profile_snapshots");
  assert.equal(out.sourceProvider, "searchapi");
  assert.equal(out.currentCapturedAt, currentAt);
  assert.equal(out.currentFollowings, 77);
});
