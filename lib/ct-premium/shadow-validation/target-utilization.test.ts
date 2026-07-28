import assert from "node:assert/strict";
import test from "node:test";
import type { AccountId, TargetId, TenantId } from "../types.ts";
import {
  CT_TARGET_UTILIZATION_SHADOW_THRESHOLDS,
  assessCtTargetUtilization,
  type CtTargetUtilizationInput,
} from "./target-utilization.ts";

const calculatedAt = "2026-07-28T12:00:00.000Z";
const base: CtTargetUtilizationInput = {
  tenantId: "tenant_synthetic_utilization" as TenantId,
  accountId: "account_synthetic_utilization" as AccountId,
  targetId: "target_synthetic_utilization" as TargetId,
  normalizedUsername: "synthetic_target",
  followerCountObserved: 3_000,
  followerCountObservedAt: "2026-07-27T12:00:00.000Z",
  uniqueProfilesProcessed: 2_700,
  uniqueProfilesFollowed: 1_000,
  uniqueProfilesSkipped: 900,
  uniqueProfilesIneligible: 500,
  uniqueProfilesUnavailable: 300,
  historicalCoverage: 1,
  followbackRatio: 20,
  calculatedAt,
};

test("2700/3000 is exhausted while good FBR remains an independent signal", () => {
  const assessment = assessCtTargetUtilization(base);
  assert.equal(assessment.utilizationRatio, 0.9);
  assert.equal(assessment.status, "exhausted");
  assert.equal(assessment.archiveRecommended, true);
  assert.equal(assessment.archiveReason, "target_audience_exhausted");
  assert.equal(assessment.fbrBand, "good");
});

test("1700/2000 recommends replacement at default threshold and exhausts at 85 percent", () => {
  const input = {
    ...base,
    followerCountObserved: 2_000,
    uniqueProfilesProcessed: 1_700,
    uniqueProfilesFollowed: 600,
    uniqueProfilesSkipped: 500,
    uniqueProfilesIneligible: 400,
    uniqueProfilesUnavailable: 200,
  };
  assert.equal(assessCtTargetUtilization(input).status, "replacement_recommended");
  assert.equal(assessCtTargetUtilization({
    ...input,
    thresholds: { ...CT_TARGET_UTILIZATION_SHADOW_THRESHOLDS, exhaustedRatio: 0.85 },
  }).status, "exhausted");
});

test("absolute minimum protects small targets while low utilization stays healthy", () => {
  assert.equal(assessCtTargetUtilization({ ...base, followerCountObserved: 500, uniqueProfilesProcessed: 400 }).status, "watch");
  assert.equal(assessCtTargetUtilization({ ...base, followerCountObserved: 10_000, uniqueProfilesProcessed: 900 }).status, "healthy");
});

test("estimated exploitable audience is preferred over raw followers when supplied", () => {
  const assessment = assessCtTargetUtilization({
    ...base,
    estimatedExploitableAudience: 2_400,
    uniqueProfilesProcessed: 2_000,
    uniqueProfilesFollowed: 700,
    uniqueProfilesSkipped: 600,
    uniqueProfilesIneligible: 500,
    uniqueProfilesUnavailable: 200,
  });
  assert.equal(assessment.denominatorKind, "estimated_exploitable_audience");
  assert.equal(assessment.utilizationRatio, 0.8333);
  assert.equal(assessment.status, "replacement_recommended");
});

test("bad FBR at 40 percent utilization does not become audience exhaustion", () => {
  const assessment = assessCtTargetUtilization({ ...base, followerCountObserved: 3_000, uniqueProfilesProcessed: 1_200, followbackRatio: 4 });
  assert.equal(assessment.status, "healthy");
  assert.equal(assessment.fbrBand, "low");
  assert.equal(assessment.archiveReason, null);
});

test("stale, partial and over-100-percent evidence fail closed", () => {
  assert.equal(assessCtTargetUtilization({ ...base, followerCountObservedAt: "2026-06-01T00:00:00.000Z" }).status, "stale_data");
  assert.equal(assessCtTargetUtilization({ ...base, uniqueProfilesProcessed: null }).status, "insufficient_data");
  const over = assessCtTargetUtilization({ ...base, followerCountObserved: 2_000, uniqueProfilesProcessed: 2_200 });
  assert.equal(over.rawUtilizationRatio, 1.1);
  assert.equal(over.utilizationRatio, 1);
  assert.equal(over.archiveRecommended, false);
  assert.ok(over.confidence < CT_TARGET_UTILIZATION_SHADOW_THRESHOLDS.minimumConfidence);
});

test("threshold sensitivity covers 80, 85, 90 and 95 percent", () => {
  const results = [0.8, 0.85, 0.9, 0.95].map((exhaustedRatio) => assessCtTargetUtilization({
    ...base,
    thresholds: { ...CT_TARGET_UTILIZATION_SHADOW_THRESHOLDS, exhaustedRatio },
  }).status);
  assert.deepEqual(results, ["exhausted", "exhausted", "exhausted", "replacement_recommended"]);
});

test("assessment is deterministic, serializable and isolated by account", () => {
  const first = assessCtTargetUtilization(base);
  assert.deepEqual(first, assessCtTargetUtilization(base));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(first)));
  const other = assessCtTargetUtilization({ ...base, accountId: "account_synthetic_other" as AccountId });
  assert.notEqual(first.accountId, other.accountId);
  assert.equal(first.targetId, other.targetId);
});
