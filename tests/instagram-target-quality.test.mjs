import assert from "node:assert/strict";
import test from "node:test";
import {
  CT_QUALITY_MIN_FOLLOWERS,
  evaluateTargetQuality,
} from "../lib/instagram-target-quality.ts";

const baseProfile = {
  verification_status: "found",
  provider_status: "found",
  normalized_username: "target_user",
  canonical_username: "target_user",
  avatar_url: "https://cdn.example.test/avatar.jpg",
  followers_count: 1200,
  is_verified: false,
  is_private: false,
  provider_checked_at: "2026-05-30T03:00:00.000Z",
  metadata_safe: {
    cache_hit: false,
    rate_limited: false,
  },
};

test("not_found maps to rejected_not_found", () => {
  const decision = evaluateTargetQuality({
    ...baseProfile,
    verification_status: "not_found",
    followers_count: null,
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.quality_status, "rejected_not_found");
  assert.equal(decision.rejected_reason, "username_not_found");
});

test("followers_count below minimum maps to rejected_low_followers", () => {
  const decision = evaluateTargetQuality({ ...baseProfile, followers_count: CT_QUALITY_MIN_FOLLOWERS - 1 });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.quality_status, "rejected_low_followers");
  assert.equal(decision.rejected_reason, "followers_count_below_minimum");
});

test("followers_count equal minimum is eligible when other checks pass", () => {
  const decision = evaluateTargetQuality({ ...baseProfile, followers_count: CT_QUALITY_MIN_FOLLOWERS });

  assert.equal(decision.status, "valid");
  assert.equal(decision.quality_status, "eligible");
});

test("verified true maps to rejected_verified", () => {
  const decision = evaluateTargetQuality({ ...baseProfile, is_verified: true });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.quality_status, "rejected_verified");
});

test("private true maps to rejected_private", () => {
  const decision = evaluateTargetQuality({ ...baseProfile, is_private: true });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.quality_status, "rejected_private");
});

test("verified and low followers uses low followers priority", () => {
  const decision = evaluateTargetQuality({
    ...baseProfile,
    followers_count: CT_QUALITY_MIN_FOLLOWERS - 1,
    is_verified: true,
  });

  assert.equal(decision.quality_status, "rejected_low_followers");
  assert.equal(decision.verification_reason, "followers_count_below_minimum");
});

test("rate_limited maps to review and never rejected_not_found", () => {
  const decision = evaluateTargetQuality({
    ...baseProfile,
    verification_status: "rate_limited",
    provider_error_reason: "rate_limited",
  });

  assert.equal(decision.status, "review");
  assert.equal(decision.quality_status, "review_provider_unavailable");
  assert.notEqual(decision.quality_status, "rejected_not_found");
});

test("provider_error maps to review_provider_unavailable", () => {
  const decision = evaluateTargetQuality({
    ...baseProfile,
    verification_status: "provider_error",
    provider_error_reason: "provider_http_error",
  });

  assert.equal(decision.status, "review");
  assert.equal(decision.quality_status, "review_provider_unavailable");
  assert.equal(decision.verification_reason, "provider_http_error");
});

test("canonical mismatch maps to review_username_changed", () => {
  const decision = evaluateTargetQuality({
    ...baseProfile,
    normalized_username: "submitted_user",
    canonical_username: "canonical_user",
  });

  assert.equal(decision.status, "review");
  assert.equal(decision.quality_status, "review_username_changed");
  assert.equal(decision.rejected_reason, null);
});

test("avatar missing is warning only and remains eligible when other checks pass", () => {
  const decision = evaluateTargetQuality({
    ...baseProfile,
    avatar_url: null,
  });

  assert.equal(decision.status, "valid");
  assert.equal(decision.quality_status, "eligible");
  assert.equal(decision.warning, "avatar_missing");
});

test("unknown followers do not trigger low follower rejection", () => {
  const decision = evaluateTargetQuality({
    ...baseProfile,
    followers_count: null,
  });

  assert.equal(decision.status, "valid");
  assert.equal(decision.quality_status, "eligible");
});

test("FBR fields are ignored by CT Quality V1", () => {
  const withFbr = evaluateTargetQuality({
    ...baseProfile,
    followback_ratio: 1,
    followers_gained: 0,
    follows_sent: 100,
  });
  const withoutFbr = evaluateTargetQuality(baseProfile);

  assert.equal(withFbr.status, withoutFbr.status);
  assert.equal(withFbr.quality_status, withoutFbr.quality_status);
});
