import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBulkTargetLines,
  normalizeTargetUsername,
  summarizeBulkTargetLines,
  targetDecisionFromLookup,
  isValidTargetUsername,
} from "../lib/instagram-targets.ts";

const baseLookup = {
  ok: true,
  status: "found",
  input_username: "target_user",
  canonical_username: "target_user",
  instagram_user_id: "123",
  external_profile_id: "profile_123",
  avatar_url: "https://cdn.example.test/avatar.jpg",
  is_private: false,
  is_verified: false,
  followers_count: 1200,
  reason: "found",
  checked_at: "2026-05-30T00:00:00.000Z",
  metadata: {
    cache_hit: false,
    throttle_hit: false,
    rate_limited: false,
    latency_ms: 12,
  },
};

test("normalizes target username safely", () => {
  assert.equal(normalizeTargetUsername(" @Cinema_Catchup "), "cinema_catchup");
  assert.equal(isValidTargetUsername("bad username"), false);
});

test("quality V1 accepts found eligible target", () => {
  const decision = targetDecisionFromLookup(baseLookup);
  assert.equal(decision.status, "valid");
  assert.equal(decision.verification_status, "found");
  assert.equal(decision.quality_status, "eligible");
  assert.equal(decision.rejected_reason, null);
});

test("quality V1 rejects clear not_found", () => {
  const decision = targetDecisionFromLookup({
    ...baseLookup,
    ok: false,
    status: "not_found",
    canonical_username: null,
    avatar_url: null,
    followers_count: null,
    reason: "not_found",
  });
  assert.equal(decision.status, "rejected");
  assert.equal(decision.verification_status, "not_found");
  assert.equal(decision.quality_status, "rejected_not_found");
});

test("quality V1 sends rate limit to review, never rejected", () => {
  const decision = targetDecisionFromLookup({
    ...baseLookup,
    ok: false,
    status: "rate_limited",
    reason: "rate_limited",
    metadata: { rate_limited: true, throttle_hit: true },
  });
  assert.equal(decision.status, "review");
  assert.equal(decision.verification_status, "rate_limited");
  assert.equal(decision.quality_status, "review_provider_unavailable");
});

test("provider not configured leaves target pending verification", () => {
  const decision = targetDecisionFromLookup({
    ...baseLookup,
    ok: false,
    status: "provider_not_configured",
    reason: "provider_not_configured",
    canonical_username: null,
  });
  assert.equal(decision.status, "pending_verification");
  assert.equal(decision.verification_status, "pending");
  assert.equal(decision.quality_status, "unknown");
});

test("quality V1 rejects low follower, verified and private profiles", () => {
  assert.equal(targetDecisionFromLookup({ ...baseLookup, followers_count: 499 }).quality_status, "rejected_low_followers");
  assert.equal(targetDecisionFromLookup({ ...baseLookup, is_verified: true }).quality_status, "rejected_verified");
  assert.equal(targetDecisionFromLookup({ ...baseLookup, is_private: true }).quality_status, "rejected_private");
});

test("bulk classification keeps invalid and duplicate lines without provider burst", () => {
  const lines = classifyBulkTargetLines(
    ["valid_one", "bad username", "@valid_one", "existing_user", "valid_two"],
    ["existing_user"],
  );
  const summary = summarizeBulkTargetLines(lines);

  assert.deepEqual(lines.map((line) => line.status), [
    "pending_verification",
    "invalid_syntax",
    "duplicate_in_batch",
    "duplicate_existing",
    "pending_verification",
  ]);
  assert.deepEqual(summary, {
    total_submitted: 5,
    accepted_for_verification: 2,
    invalid: 1,
    duplicates: 1,
    already_existing: 1,
  });
});
