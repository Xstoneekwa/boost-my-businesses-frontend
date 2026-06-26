import assert from "node:assert/strict";
import test from "node:test";
import {
  isTargetRowCanonicallyEligible,
  summarizeTargetEligibilityRows,
} from "./account-target-eligibility.ts";

test("canonical eligibility matches readiness predicate", () => {
  const rows = [
    { status: "valid", quality_status: "eligible", verification_status: "found" },
    { status: "valid", quality_status: "eligible", verification_status: "not_found" },
    { status: "archived", quality_status: "eligible", verification_status: "found", archived_at: "2026-01-01T00:00:00Z" },
    { status: "pending_verification", quality_status: "unknown", verification_status: "pending" },
    { status: "valid", quality_status: "rejected_low_quality", verification_status: "found" },
  ];
  const summary = summarizeTargetEligibilityRows(rows);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.archived, 1);
  assert.equal(isTargetRowCanonicallyEligible(rows[0]), true);
  assert.equal(isTargetRowCanonicallyEligible(rows[1]), false);
});
