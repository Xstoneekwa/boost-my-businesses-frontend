import assert from "node:assert/strict";
import test from "node:test";
import { scoreCommercialProspect } from "./discovery-scoring.ts";
import type { CommercialAiAnalysis } from "./discovery-contract.ts";

function analysis(score: number, overrides: Partial<CommercialAiAnalysis> = {}): CommercialAiAnalysis {
  return { businessName: "Fixture Aesthetics", subsegment: "Aesthetic Clinic", locationConfidence: 0.95, verticalConfidence: 0.96, confidence: 0.9,
    dimensions: { instagramImportance: score, contentQuality: score, activity: score, commercialStrength: score, customerValue: score, targetingFit: score, growthPotential: score, decisionMakerAccess: score, budgetFit: score },
    evidence: ["Observed public booking link"], reasoning: "Observed public business profile.", recommendedChannel: "instagram", recommendedAngle: "A",
    signals: { isLocal: true, isBeautyAesthetics: true, isCommerciallyActive: true, appearsClosed: false }, ...overrides };
}

test("weighted boundaries produce P1, P2 and P3 deterministically", () => {
  assert.equal(scoreCommercialProspect({ analysis: analysis(8), isPrivate: false, profileFound: true, businessStatus: "open" }).scorePriority, "P1");
  assert.equal(scoreCommercialProspect({ analysis: analysis(6.5), isPrivate: false, profileFound: true, businessStatus: "open" }).scorePriority, "P2");
  assert.equal(scoreCommercialProspect({ analysis: analysis(6.4), isPrivate: false, profileFound: true, businessStatus: "open" }).scorePriority, "P3");
});

test("only high-quality P1 and upper P2 enter Needs Approval", () => {
  assert.equal(scoreCommercialProspect({ analysis: analysis(8), isPrivate: false, profileFound: true, businessStatus: "open" }).needsManualReview, true);
  assert.equal(scoreCommercialProspect({ analysis: analysis(7.2), isPrivate: false, profileFound: true, businessStatus: "open" }).needsManualReview, true);
  assert.equal(scoreCommercialProspect({ analysis: analysis(6.8), isPrivate: false, profileFound: true, businessStatus: "open" }).needsManualReview, false);
});

test("private, closed, wrong-market, wrong-vertical and inactive profiles fail closed", () => {
  for (const input of [
    { analysis: analysis(10), isPrivate: true, profileFound: true, businessStatus: "open" as const },
    { analysis: analysis(10), isPrivate: false, profileFound: true, businessStatus: "closed" as const },
    { analysis: analysis(10, { signals: { isLocal: false, isBeautyAesthetics: true, isCommerciallyActive: true, appearsClosed: false } }), isPrivate: false, profileFound: true, businessStatus: "open" as const },
    { analysis: analysis(10, { signals: { isLocal: true, isBeautyAesthetics: false, isCommerciallyActive: true, appearsClosed: false } }), isPrivate: false, profileFound: true, businessStatus: "open" as const },
    { analysis: analysis(10, { signals: { isLocal: true, isBeautyAesthetics: true, isCommerciallyActive: false, appearsClosed: false } }), isPrivate: false, profileFound: true, businessStatus: "open" as const },
  ]) {
    const result = scoreCommercialProspect(input);
    assert.equal(result.itemStatus, "hard_rejected"); assert.equal(result.score, 0); assert.equal(result.needsManualReview, false);
  }
});

test("low AI confidence is penalized and cannot reach Liam queue", () => {
  const result = scoreCommercialProspect({ analysis: analysis(8, { confidence: 0.4 }), isPrivate: false, profileFound: true, businessStatus: "open" });
  assert.equal(result.score, 6.5); assert.equal(result.needsManualReview, false);
});
