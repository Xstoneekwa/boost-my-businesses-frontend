import assert from "node:assert/strict";
import test from "node:test";
import { simulatePremiumReplacementShadow } from "./replacement-shadow.ts";

const base = {
  tenantId: "tenant-one", accountId: "account-one", targetId: "target-one", plan: "premium" as const,
  entitlementActive: true, accountPaused: false, cancelRequested: false, downgradePending: false, campaignBlocked: false,
  recommendation: "replacement_recommended", generatedAt: "2026-07-29T12:00:00.000Z",
};

test("Premium replacement shadow simulates full preparation without provider or business writes", () => {
  const report = simulatePremiumReplacementShadow({
    ...base,
    candidates: [
      { username: "candidate.one", score: 0.9 },
      { username: "blocked.one", score: 0.95, blacklisted: true },
    ],
  });
  assert.equal(report.preparationRecommended, true);
  assert.equal(report.eligibleCandidates.length, 1);
  assert.equal(report.providerCalled, false);
  assert.equal(report.mutationExecuted, false);
  assert.equal(report.proposalCreated, false);
  assert.equal(report.batchCreated, false);
  assert.equal(report.activationAllowed, false);
  assert.equal(report.notificationSent, false);
  assert.equal(report.emailSent, false);
  assert.equal(report.sourceTarget.targetId, "target-one");
  assert.equal(report.replacementNeeded, true);
  assert.equal(report.hypotheticalCandidateCount, 1);
  assert.equal(report.hypotheticalPolicyPath.length, 8);
  assert.equal(report.archiveDeferred, true);
  assert.equal(report.terminalOutcomePreview, "replacement_candidate_review_would_be_recommended");
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("pause cancel downgrade and non-Premium block replacement preparation", () => {
  for (const patch of [
    { accountPaused: true }, { cancelRequested: true }, { downgradePending: true }, { plan: "growth" as const },
  ]) {
    const report = simulatePremiumReplacementShadow({ ...base, ...patch, candidates: [] });
    assert.equal(report.preparationRecommended, false);
    assert.ok(report.blockers.length > 0);
  }
});
