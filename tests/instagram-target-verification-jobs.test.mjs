import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTargetVerificationJobDecision,
  buildTargetVerificationJobPayloads,
} from "../lib/instagram-target-verification-jobs.ts";
import { targetDecisionFromLookup } from "../lib/instagram-targets.ts";

const checkedAt = "2026-05-30T01:00:00.000Z";
const now = new Date("2026-05-30T01:05:00.000Z");

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
  checked_at: checkedAt,
  metadata: {
    cache_hit: false,
    throttle_hit: false,
    rate_limited: false,
    latency_ms: 12,
  },
};

function jobDecision(lookup, attemptCount = 1, maxAttempts = 3) {
  return buildTargetVerificationJobDecision({
    decision: targetDecisionFromLookup(lookup),
    attemptCount,
    maxAttempts,
    now,
  });
}

test("builds one verification job for each accepted bulk target", () => {
  const payloads = buildTargetVerificationJobPayloads([
    {
      id: "target-1",
      account_id: "account-1",
      batch_id: "batch-1",
      normalized_username: "valid_one",
    },
    {
      id: "target-2",
      account_id: "account-1",
      batch_id: "batch-1",
      normalized_username: "valid_two",
    },
  ]);

  assert.deepEqual(payloads.map((row) => row.normalized_username), ["valid_one", "valid_two"]);
  assert.equal(payloads.every((row) => row.status === "pending"), true);
});

test("does not build jobs for invalid or duplicate rows without target ids", () => {
  const payloads = buildTargetVerificationJobPayloads([
    { account_id: "account-1", normalized_username: "invalid_row" },
    { id: "", account_id: "account-1", normalized_username: "duplicate_row" },
  ]);

  assert.deepEqual(payloads, []);
});

test("deduplicates job payloads by target id", () => {
  const payloads = buildTargetVerificationJobPayloads([
    { id: "target-1", account_id: "account-1", normalized_username: "valid_one" },
    { id: "target-1", account_id: "account-1", normalized_username: "valid_one" },
  ]);

  assert.equal(payloads.length, 1);
});

test("maps found eligible target to succeeded valid", () => {
  const result = jobDecision(baseLookup);
  assert.equal(result.jobStatus, "succeeded");
  assert.equal(result.targetPatch.status, "valid");
  assert.equal(result.targetPatch.quality_status, "eligible");
  assert.equal(result.auditResult, "accepted");
});

test("maps low followers to rejected_low_followers", () => {
  const result = jobDecision({ ...baseLookup, followers_count: 499 });
  assert.equal(result.jobStatus, "succeeded");
  assert.equal(result.targetPatch.status, "rejected");
  assert.equal(result.targetPatch.quality_status, "rejected_low_followers");
  assert.equal(result.auditResult, "rejected");
});

test("maps verified target to rejected_verified", () => {
  const result = jobDecision({ ...baseLookup, is_verified: true });
  assert.equal(result.targetPatch.status, "rejected");
  assert.equal(result.targetPatch.quality_status, "rejected_verified");
});

test("maps private target to rejected_private", () => {
  const result = jobDecision({ ...baseLookup, is_private: true });
  assert.equal(result.targetPatch.status, "rejected");
  assert.equal(result.targetPatch.quality_status, "rejected_private");
});

test("maps clear not_found to rejected_not_found without retry", () => {
  const result = jobDecision({
    ...baseLookup,
    ok: false,
    status: "not_found",
    reason: "not_found",
    followers_count: null,
  });
  assert.equal(result.jobStatus, "succeeded");
  assert.equal(result.targetPatch.status, "rejected");
  assert.equal(result.targetPatch.quality_status, "rejected_not_found");
  assert.equal(result.nextAttemptAt, null);
});

test("schedules retry for rate_limited provider result", () => {
  const result = jobDecision({
    ...baseLookup,
    ok: false,
    status: "rate_limited",
    reason: "rate_limited",
    metadata: { rate_limited: true },
  });
  assert.equal(result.jobStatus, "retry_scheduled");
  assert.equal(result.targetPatch.status, "pending_verification");
  assert.equal(result.targetPatch.quality_status, "unknown");
  assert.equal(result.lastErrorCode, "rate_limited");
  assert.equal(typeof result.nextAttemptAt, "string");
});

test("schedules retry for provider_error", () => {
  const result = jobDecision({
    ...baseLookup,
    ok: false,
    status: "provider_error",
    reason: "provider_http_error",
  });
  assert.equal(result.jobStatus, "retry_scheduled");
  assert.equal(result.targetPatch.status, "pending_verification");
  assert.equal(result.lastErrorCode, "provider_http_error");
});

test("max attempts converts retryable provider issue to review_provider_unavailable", () => {
  const result = jobDecision({
    ...baseLookup,
    ok: false,
    status: "provider_error",
    reason: "provider_http_error",
  }, 3, 3);

  assert.equal(result.jobStatus, "succeeded");
  assert.equal(result.targetPatch.status, "review");
  assert.equal(result.targetPatch.quality_status, "review_provider_unavailable");
  assert.equal(result.auditResult, "review");
});
