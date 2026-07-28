import assert from "node:assert/strict";
import test from "node:test";
import { assessTargetLifecycle, computeTargetAccountStock, decideTargetPlanPolicy } from "./index.ts";
import type { TargetLifecycleAssessmentInput, TargetPlan } from "./types.ts";

const now = "2026-07-28T12:00:00.000Z";
const base: TargetLifecycleAssessmentInput = {
  tenantId: "tenant_one",
  accountId: "account_one",
  targetId: "target_one",
  normalizedUsername: "@Target_One",
  uniqueProfilesEvaluated: 2_400,
  breakdown: { followed: 800, skipped: 600, ineligible: 500, unavailable: 300, duplicate: 200 },
  estimatedExploitableAudience: 3_000,
  observedFollowerCount: 4_000,
  denominatorVersion: "audience-v1",
  denominatorSource: "synthetic-test",
  denominatorObservedAt: "2026-07-27T12:00:00.000Z",
  denominatorReliability: 1,
  historicalCoverage: 1,
  uniqueEvaluationCoverage: 1,
  sourceAttributionReliability: 1,
  workerVersionCoverage: 1,
  followbackRatio: 18,
  calculatedAt: now,
};

test("canonical numerator is unique evaluated profiles and breakdown is diagnostic only", () => {
  const result = assessTargetLifecycle(base);
  assert.equal(result.metrics.utilizationRatio, 0.8);
  assert.equal(result.status, "replacement_recommended");
  assert.equal(result.scope.normalizedUsername, "target_one");
  assert.equal(Object.values(result.metrics.breakdown).reduce((sum, value) => sum + (value ?? 0), 0), 2_400);
  assert.deepEqual(result.reasons, ["target_replacement_recommended"]);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
});

test("80, 85, 90 and 95 percent thresholds remain distinct and deterministic", () => {
  const statuses = [0.8, 0.85, 0.9, 0.95].map((ratio) => assessTargetLifecycle({
    ...base,
    uniqueProfilesEvaluated: ratio * 4_000,
    estimatedExploitableAudience: 4_000,
  }).status);
  assert.deepEqual(statuses, ["replacement_recommended", "replacement_pending", "exhausted", "exhausted"]);
});

test("stale, missing, low-confidence and impossible evidence fail closed", () => {
  assert.equal(assessTargetLifecycle({ ...base, denominatorObservedAt: "2026-06-01T00:00:00.000Z" }).status, "stale_data");
  assert.equal(assessTargetLifecycle({ ...base, uniqueProfilesEvaluated: null }).status, "insufficient_data");
  assert.equal(assessTargetLifecycle({
    ...base,
    historicalCoverage: 0,
    uniqueEvaluationCoverage: 0,
    denominatorReliability: 0,
    sourceAttributionReliability: 0,
    workerVersionCoverage: 0,
  }).status, "insufficient_data");
  assert.equal(assessTargetLifecycle({ ...base, estimatedExploitableAudience: 2_000, uniqueProfilesEvaluated: 2_200 }).status, "insufficient_data");
});

test("low FBR and audience utilization are orthogonal", () => {
  const result = assessTargetLifecycle({ ...base, uniqueProfilesEvaluated: 1_000, followbackRatio: 4 });
  assert.equal(result.status, "healthy");
  assert.equal(result.metrics.fbrBand, "low");
});

test("the same assessment yields client action for Growth/Pro and automatic preparation for Premium", () => {
  const assessment = assessTargetLifecycle(base);
  const decide = (plan: TargetPlan) => decideTargetPlanPolicy({
    plan,
    assessment,
    eligibleTargetCount: 5,
    minimumEligibleTargetCount: 6,
    onboardingComplete: true,
    replacementState: "none",
    evaluatedAt: now,
  });
  assert.equal(decide("growth").action, "request_client_targets");
  assert.equal(decide("pro").action, "request_client_targets");
  assert.equal(decide("premium").action, "prepare_automatic_replacement");
  assert.equal(decide("growth").automaticReplacementAllowed, false);
  assert.equal(decide("premium").archiveDeferred, true);
  assert.equal(decide("growth").clientNotificationRequired, true);
  assert.equal(decide("pro").clientEmailRequired, true);
  assert.deepEqual(decide("growth").reasonCodes, ["growth_client_target_request_required"]);
});

test("Premium replacement-first policy only allows archive after activation", () => {
  const assessment = assessTargetLifecycle({ ...base, uniqueProfilesEvaluated: 2_700 });
  const decide = (replacementState: "none" | "pending" | "ready_for_review" | "activated") => decideTargetPlanPolicy({
    plan: "premium",
    assessment,
    eligibleTargetCount: 5,
    minimumEligibleTargetCount: 6,
    onboardingComplete: true,
    replacementState,
    evaluatedAt: now,
  });
  assert.equal(decide("none").action, "prepare_automatic_replacement");
  assert.equal(decide("pending").action, "mark_replacement_pending");
  assert.equal(decide("ready_for_review").archiveAllowed, false);
  assert.equal(decide("activated").action, "archive_after_replacement");
  assert.equal(decide("activated").archiveAllowed, true);
});

test("terminal proof unlocks an explicit future archive contract without side effects", () => {
  const assessment = assessTargetLifecycle({ ...base, uniqueProfilesEvaluated: 2_900, terminalProof: true });
  const decision = decideTargetPlanPolicy({
    plan: "growth",
    assessment,
    eligibleTargetCount: 6,
    minimumEligibleTargetCount: 6,
    onboardingComplete: true,
    replacementState: "none",
    evaluatedAt: now,
  });
  assert.equal(decision.action, "archive_immediately_terminal");
  assert.equal(decision.archiveAllowed, true);
  assert.equal(decision.lowStockRecomputeRequired, true);
});

test("stock excludes exhausted and archived targets, preserves account and tenant isolation", () => {
  const statuses = ["healthy", "watch", "replacement_recommended", "replacement_pending", "archived", "exhausted"] as const;
  const assessments = statuses.map((status, index) => {
    if (status === "archived") return assessTargetLifecycle({ ...base, targetId: `target_${index}`, archived: true });
    if (status === "exhausted") return assessTargetLifecycle({ ...base, targetId: `target_${index}`, uniqueProfilesEvaluated: 2_700 });
    const values = { healthy: 500, watch: 2_250, replacement_recommended: 2_400, replacement_pending: 2_550 } as const;
    return assessTargetLifecycle({ ...base, targetId: `target_${index}`, uniqueProfilesEvaluated: values[status] });
  });
  const otherAccount = assessTargetLifecycle({ ...base, accountId: "agency_account_two", targetId: "other_target" });
  const stock = computeTargetAccountStock([...assessments, otherAccount], {
    tenantId: "tenant_one", accountId: "account_one", minimumEligibleTargetCount: 5,
  });
  assert.equal(stock.eligibleTargetCount, 4);
  assert.equal(stock.lowStock, true);
  assert.equal(stock.includedTargetIds.includes("other_target"), false);
});

test("mixed agency accounts can receive different actions without cross-account leakage", () => {
  const first = assessTargetLifecycle(base);
  const second = assessTargetLifecycle({ ...base, accountId: "account_two", targetId: "target_two", uniqueProfilesEvaluated: 500 });
  const firstDecision = decideTargetPlanPolicy({ plan: "premium", assessment: first, eligibleTargetCount: 5, minimumEligibleTargetCount: 6, onboardingComplete: true, replacementState: "none", evaluatedAt: now });
  const secondDecision = decideTargetPlanPolicy({ plan: "growth", assessment: second, eligibleTargetCount: 15, minimumEligibleTargetCount: 6, onboardingComplete: true, replacementState: "none", evaluatedAt: now });
  assert.equal(firstDecision.action, "prepare_automatic_replacement");
  assert.equal(secondDecision.action, "no_action");
  assert.notEqual(first.scope.accountId, second.scope.accountId);
});

test("required cross-pack scenario matrix remains explicit", () => {
  const assessmentAt = (plan: TargetPlan, ratio: number, confidence: "strong" | "weak" = "strong") => ({
    plan,
    assessment: assessTargetLifecycle({
      ...base,
      accountId: `account_${plan}`,
      targetId: `target_${plan}_${ratio}_${confidence}`,
      uniqueProfilesEvaluated: 3_000 * ratio,
      historicalCoverage: confidence === "strong" ? 1 : 0,
      uniqueEvaluationCoverage: confidence === "strong" ? 1 : 0,
      denominatorReliability: confidence === "strong" ? 1 : 0.3,
      sourceAttributionReliability: confidence === "strong" ? 1 : 0.3,
      workerVersionCoverage: confidence === "strong" ? 1 : 0.3,
    }),
  });
  const scenarios = [
    assessmentAt("growth", 0.8),
    assessmentAt("growth", 0.9),
    assessmentAt("growth", 0.9, "weak"),
    assessmentAt("pro", 0.85),
    assessmentAt("pro", 0.9),
    assessmentAt("premium", 0.8),
    assessmentAt("premium", 0.85),
    assessmentAt("premium", 0.9),
  ];
  const actions = scenarios.map(({ plan, assessment }) => evaluate(plan, assessment, "none").action);
  assert.deepEqual(actions, [
    "request_client_targets",
    "request_client_targets",
    "block_due_to_insufficient_data",
    "request_client_targets",
    "request_client_targets",
    "prepare_automatic_replacement",
    "prepare_automatic_replacement",
    "prepare_automatic_replacement",
  ]);
  assert.equal(evaluate("premium", scenarios[7].assessment, "ready_for_review").action, "mark_replacement_pending");
  for (const plan of ["growth", "pro", "premium"] as const) {
    const goodFbrExhausted = assessTargetLifecycle({ ...base, uniqueProfilesEvaluated: 2_700, followbackRatio: 20 });
    assert.equal(goodFbrExhausted.status, "exhausted");
    const badFbrHealthy = assessTargetLifecycle({ ...base, uniqueProfilesEvaluated: 900, followbackRatio: 3 });
    assert.equal(badFbrHealthy.status, "healthy");
    assert.equal(evaluate(plan, badFbrHealthy, "none").action, "no_action");
  }
});

function evaluate(plan: TargetPlan, assessment: ReturnType<typeof assessTargetLifecycle>, replacementState: "none" | "ready_for_review") {
  return decideTargetPlanPolicy({
    plan,
    assessment,
    eligibleTargetCount: 5,
    minimumEligibleTargetCount: 6,
    onboardingComplete: true,
    replacementState,
    evaluatedAt: now,
  });
}
