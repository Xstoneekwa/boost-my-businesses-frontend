import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateCandidates, normalizeInstagramUsername } from "./normalization.ts";
import { CT_SCORING_V1, scoreProposalCandidate } from "./scoring.ts";
import { ctStableFingerprint } from "./snapshot.ts";

test("normalization removes @, trims and lowercases", () => {
  assert.deepEqual(normalizeInstagramUsername("  @My.Target_1 "), { ok: true, normalized: "my.target_1", deduplicationKey: "my.target_1" });
});

test("normalization rejects empty and manifestly invalid usernames", () => {
  assert.equal(normalizeInstagramUsername(" @ ").ok, false);
  assert.equal(normalizeInstagramUsername("bad-name!").ok, false);
  assert.equal(normalizeInstagramUsername("a".repeat(31)).ok, false);
});

test("deduplication reports every stable reason without crossing account boundaries", () => {
  const result = deduplicateCandidates([
    { username: "@Alpha", biography: "fixture" },
    { username: "alpha", biography: "fixture" },
    { username: "active", biography: "fixture" },
    { username: "elsewhere", biography: "fixture" },
    { username: "blocked", biography: "fixture" },
  ], {
    activeTargetUsernames: ["active"],
    activeProposalUsernames: ["elsewhere"],
    blacklistUsernames: ["blocked"],
  });
  assert.deepEqual(result.accepted.map((entry) => entry.normalizedUsername), ["alpha"]);
  assert.deepEqual(result.excluded.map((entry) => entry.reasons[0]), ["duplicate_in_batch", "duplicate_active_target", "duplicate_active_proposal", "blacklisted"]);
});

test("scoring is deterministic and covers reject, review, recommended, penalty and exclusion", () => {
  const recommended = scoreProposalCandidate({ username: "strong", biography: "fixture", followersCount: 3000, audienceMatch: 1, languageMatch: 1, geographyMatch: 1, categoryMatch: 1, followerRangeMatch: 1, engagementQuality: 1, profileActivity: 1, sourceTargetPerformance: 1, historicalFollowbackSignal: 1, profileEligibilityConfidence: 1 });
  assert.deepEqual(recommended, scoreProposalCandidate({ username: "strong", biography: "fixture", followersCount: 3000, audienceMatch: 1, languageMatch: 1, geographyMatch: 1, categoryMatch: 1, followerRangeMatch: 1, engagementQuality: 1, profileActivity: 1, sourceTargetPerformance: 1, historicalFollowbackSignal: 1, profileEligibilityConfidence: 1 }));
  assert.equal(recommended.band, "recommended");
  assert.equal(scoreProposalCandidate({ username: "medium", biography: "fixture", followersCount: 1000, audienceMatch: .6, languageMatch: .6, geographyMatch: .6, categoryMatch: .6, followerRangeMatch: .6, engagementQuality: .6, profileActivity: .6, sourceTargetPerformance: .6, historicalFollowbackSignal: .6, profileEligibilityConfidence: .6 }).band, "review");
  const rejected = scoreProposalCandidate({ username: "weak", isEligible: false });
  assert.equal(rejected.band, "reject");
  assert.ok(rejected.penalties.includes("missing_profile_data"));
  assert.ok(rejected.exclusionFlags.includes("profile_not_eligible"));
  assert.equal(Object.values(CT_SCORING_V1.weights).reduce((sum, weight) => sum + weight, 0), 100);
});

test("stable fingerprint ignores object key order", () => {
  assert.equal(ctStableFingerprint({ b: 2, a: [1, 2] }), ctStableFingerprint({ a: [1, 2], b: 2 }));
});
