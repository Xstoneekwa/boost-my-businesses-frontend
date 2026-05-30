import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRestoreLifecycleDecision,
  hasActiveDuplicateForRestore,
  isActiveTargetLifecycle,
  isArchivedTargetLifecycle,
} from "../lib/instagram-target-lifecycle.ts";

const now = new Date("2026-05-30T03:00:00.000Z");

const archivedEligible = {
  id: "target-1",
  account_id: "account-1",
  normalized_username: "target_user",
  status: "archived",
  verification_status: "found",
  quality_status: "eligible",
  archived_at: "2026-05-29T03:00:00.000Z",
  provider_checked_at: "2026-05-29T03:00:00.000Z",
  followback_ratio: 17,
};

test("restore returns archived fresh eligible CT to valid without queueing verification", () => {
  const decision = buildRestoreLifecycleDecision(archivedEligible, now);

  assert.equal(decision.targetPatch.status, "valid");
  assert.equal(decision.targetPatch.verification_status, "found");
  assert.equal(decision.targetPatch.quality_status, "eligible");
  assert.equal(decision.targetPatch.archived_at, null);
  assert.equal(decision.targetPatch.archive_reason, null);
  assert.equal(decision.shouldQueueVerification, false);
  assert.equal(decision.auditReason, "manual_restore_quality_fresh");
});

test("restore sends stale or unknown CT back to pending verification", () => {
  const decision = buildRestoreLifecycleDecision({
    ...archivedEligible,
    provider_checked_at: "2026-04-01T03:00:00.000Z",
  }, now);

  assert.equal(decision.targetPatch.status, "pending_verification");
  assert.equal(decision.targetPatch.verification_status, "pending");
  assert.equal(decision.targetPatch.quality_status, "unknown");
  assert.equal(decision.shouldQueueVerification, true);
  assert.equal(decision.auditReason, "manual_restore_reverification_required");
});

test("restore does not directly validate rejected not_found CT", () => {
  const decision = buildRestoreLifecycleDecision({
    ...archivedEligible,
    verification_status: "not_found",
    quality_status: "rejected_not_found",
    provider_checked_at: "2026-05-29T03:00:00.000Z",
  }, now);

  assert.equal(decision.targetPatch.status, "pending_verification");
  assert.equal(decision.targetPatch.verification_status, "pending");
  assert.equal(decision.shouldQueueVerification, true);
});

test("active duplicate detection ignores archived rows and matches same account username", () => {
  assert.equal(hasActiveDuplicateForRestore(archivedEligible, [
    archivedEligible,
    { id: "target-2", normalized_username: "target_user", status: "valid" },
  ]), true);

  assert.equal(hasActiveDuplicateForRestore(archivedEligible, [
    archivedEligible,
    { id: "target-2", normalized_username: "target_user", status: "archived", archived_at: "2026-05-29T03:00:00.000Z" },
  ]), false);
});

test("lifecycle helpers keep archive separate from active eligibility", () => {
  assert.equal(isArchivedTargetLifecycle(archivedEligible), true);
  assert.equal(isActiveTargetLifecycle(archivedEligible), false);
  assert.equal(isActiveTargetLifecycle({ ...archivedEligible, status: "valid", archived_at: null }), true);
});
