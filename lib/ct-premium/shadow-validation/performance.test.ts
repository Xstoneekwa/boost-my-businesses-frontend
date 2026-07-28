import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateCandidates } from "../normalization.ts";
import { scoreProposalCandidate } from "../scoring.ts";
import { ctStableFingerprint } from "../snapshot.ts";

test("logical candidate processing remains deterministic through 5000 synthetic profiles", (context) => {
  for (const volume of [10, 100, 1_000, 5_000]) {
    const candidates = Array.from({ length: volume }, (_, index) => ({ username: `perf_${index}`, biography: "Synthetic performance fixture", followersCount: 1_000 + index, audienceMatch: .8, languageMatch: .8, geographyMatch: .8, categoryMatch: .8, followerRangeMatch: .8, engagementQuality: .8, profileActivity: .8, sourceTargetPerformance: .8, historicalFollowbackSignal: .8, profileEligibilityConfidence: .8 }));
    const started = performance.now();
    const first = deduplicateCandidates(candidates, { activeTargetUsernames: [], activeProposalUsernames: [], blacklistUsernames: [] }).accepted.map((entry) => ({ username: entry.normalizedUsername, score: scoreProposalCandidate(entry.candidate).total }));
    const durationMs = Number((performance.now() - started).toFixed(2));
    const second = deduplicateCandidates(candidates, { activeTargetUsernames: [], activeProposalUsernames: [], blacklistUsernames: [] }).accepted.map((entry) => ({ username: entry.normalizedUsername, score: scoreProposalCandidate(entry.candidate).total }));
    assert.equal(first.length, volume);
    assert.equal(ctStableFingerprint(first), ctStableFingerprint(second));
    context.diagnostic(`${volume} candidates: ${durationMs}ms on this local machine`);
  }
});
