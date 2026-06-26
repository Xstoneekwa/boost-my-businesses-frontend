import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTargetQuality } from "./instagram-target-quality.ts";
import { buildTargetVerificationJobDecision } from "./instagram-target-verification-jobs.ts";
import { targetDecisionFromLookup } from "./instagram-targets.ts";
import {
  TARGET_HYGIENE_ARCHIVE_REASON_ACCOUNT_NOT_FOUND,
  TARGET_HYGIENE_ARCHIVE_REASON_VERIFIED_INELIGIBLE,
  resolveTargetVerificationHygiene,
} from "./target-verification-hygiene.ts";

const now = new Date("2026-06-15T12:00:00.000Z");

const existingEligible = {
  id: "target-1",
  account_id: "acct-1",
  normalized_username: "old_handle",
  target_username: "old_handle",
  canonical_username: "old_handle",
  input_username: "old_handle",
  status: "valid",
  quality_status: "eligible",
  verification_status: "found",
  metadata_safe: {
    instagram_user_id: "ig-100",
    external_profile_id: "ext-100",
  },
};

function lookupDecision(patch: Record<string, unknown>) {
  return targetDecisionFromLookup({
    ok: true,
    status: "found",
    input_username: "old_handle",
    canonical_username: "old_handle",
    instagram_user_id: "ig-100",
    external_profile_id: "ext-100",
    avatar_url: "https://cdn.example.test/avatar.jpg",
    is_private: false,
    is_verified: false,
    followers_count: 1200,
    reason: "found",
    checked_at: now.toISOString(),
    metadata: { cache_hit: false },
    ...patch,
  });
}

function terminalJob(decision: ReturnType<typeof evaluateTargetQuality>) {
  return buildTargetVerificationJobDecision({
    decision,
    attemptCount: 3,
    maxAttempts: 3,
    now,
  });
}

test("confirmed rename keeps CT, updates username, and preserves eligibility", () => {
  const decision = lookupDecision({
    input_username: "old_handle",
    canonical_username: "new_handle",
    instagram_user_id: "ig-100",
  });
  const jobDecision = terminalJob(decision);
  const hygiene = resolveTargetVerificationHygiene({
    existingTarget: existingEligible,
    jobDecision,
    decision,
    now,
    activeUsernames: ["other_user"],
  });

  assert.equal(hygiene.hygieneAction, "rename_confirmed");
  assert.equal(hygiene.targetPatch.normalized_username, "new_handle");
  assert.equal(hygiene.targetPatch.status, "valid");
  assert.equal(hygiene.targetPatch.quality_status, "eligible");
  assert.equal(hygiene.targetPatch.metadata_safe.previous_username, "old_handle");
  assert.equal(hygiene.shouldReevaluateNeedsMoreTargets, true);
});

test("unconfirmed rename leaves CT unchanged", () => {
  const decision = lookupDecision({
    input_username: "old_handle",
    canonical_username: "new_handle",
    instagram_user_id: "ig-999",
    external_profile_id: "ext-999",
  });
  const jobDecision = terminalJob(decision);
  const hygiene = resolveTargetVerificationHygiene({
    existingTarget: existingEligible,
    jobDecision,
    decision,
    now,
    activeUsernames: [],
  });

  assert.equal(hygiene.hygieneAction, "none");
  assert.equal(hygiene.shouldApplyTargetPatch, false);
  assert.equal(hygiene.shouldReevaluateNeedsMoreTargets, false);
});

test("explicit not_found archives with stable reason", () => {
  const decision = evaluateTargetQuality({
    verification_status: "not_found",
    normalized_username: "missing_user",
    canonical_username: "missing_user",
    provider_checked_at: now.toISOString(),
  });
  const jobDecision = terminalJob(decision);
  const hygiene = resolveTargetVerificationHygiene({
    existingTarget: { ...existingEligible, normalized_username: "missing_user" },
    jobDecision,
    decision,
    now,
  });

  assert.equal(hygiene.hygieneAction, "archive_not_found");
  assert.equal(hygiene.targetPatch.status, "archived");
  assert.equal(hygiene.targetPatch.archive_reason, TARGET_HYGIENE_ARCHIVE_REASON_ACCOUNT_NOT_FOUND);
  assert.equal(hygiene.shouldReevaluateNeedsMoreTargets, true);
});

test("provider timeout does not mutate CT or trigger needs-more-targets", () => {
  const decision = evaluateTargetQuality({
    verification_status: "provider_error",
    provider_error_reason: "provider_timeout",
    normalized_username: "old_handle",
    canonical_username: "old_handle",
    provider_checked_at: now.toISOString(),
  });
  const jobDecision = buildTargetVerificationJobDecision({
    decision,
    attemptCount: 1,
    maxAttempts: 3,
    now,
  });
  const hygiene = resolveTargetVerificationHygiene({
    existingTarget: existingEligible,
    jobDecision,
    decision,
    now,
  });

  assert.equal(hygiene.shouldApplyTargetPatch, false);
  assert.equal(hygiene.shouldReevaluateNeedsMoreTargets, false);
});

test("verified profile archives with verified_became_ineligible", () => {
  const decision = lookupDecision({ is_verified: true });
  const jobDecision = terminalJob(decision);
  const hygiene = resolveTargetVerificationHygiene({
    existingTarget: existingEligible,
    jobDecision,
    decision,
    now,
  });

  assert.equal(hygiene.hygieneAction, "archive_verified");
  assert.equal(hygiene.targetPatch.archive_reason, TARGET_HYGIENE_ARCHIVE_REASON_VERIFIED_INELIGIBLE);
  assert.equal(hygiene.targetPatch.status, "archived");
  assert.equal(hygiene.shouldReevaluateNeedsMoreTargets, true);
});

test("rename blocked when canonical username already active on account", () => {
  const decision = lookupDecision({
    canonical_username: "existing_user",
    instagram_user_id: "ig-100",
  });
  const jobDecision = terminalJob(decision);
  const hygiene = resolveTargetVerificationHygiene({
    existingTarget: existingEligible,
    jobDecision,
    decision,
    now,
    activeUsernames: ["existing_user"],
  });

  assert.equal(hygiene.hygieneAction, "none");
  assert.equal(hygiene.shouldApplyTargetPatch, false);
});
