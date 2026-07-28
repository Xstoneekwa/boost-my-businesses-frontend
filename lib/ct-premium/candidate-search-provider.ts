import type { AccountId, CtClock, CtProposalCandidate, CtTargetingCriteriaSnapshot, TenantId } from "./types.ts";

export interface CtCandidateSearchRequest {
  tenantId: TenantId;
  accountId: AccountId;
  snapshot: CtTargetingCriteriaSnapshot;
  maxCandidates: number;
  signal?: AbortSignal;
}

export interface CtCandidateSearchResult {
  provider: string;
  providerVersion: string;
  searchedAt: string;
  candidates: readonly CtProposalCandidate[];
  warnings: readonly string[];
  traceId: string;
  durationMs: number;
}

export interface CtCandidateSearchProvider {
  searchCandidates(request: CtCandidateSearchRequest): Promise<CtCandidateSearchResult>;
}

export class FixtureCandidateSearchProvider implements CtCandidateSearchProvider {
  private readonly fixtures: readonly CtProposalCandidate[];
  private readonly clock: CtClock;
  private readonly name: string;
  private readonly version: string;
  constructor(
    fixtures: readonly CtProposalCandidate[], clock: CtClock, name = "fixture", version = "v1",
  ) { this.fixtures = fixtures; this.clock = clock; this.name = name; this.version = version; }
  async searchCandidates(request: CtCandidateSearchRequest): Promise<CtCandidateSearchResult> {
    if (request.snapshot.tenantId !== request.tenantId || request.snapshot.accountId !== request.accountId) throw new Error("provider_scope_mismatch");
    return Object.freeze({ provider: this.name, providerVersion: this.version, searchedAt: this.clock.now().toISOString(), candidates: Object.freeze(this.fixtures.slice(0, request.maxCandidates).map((candidate) => Object.freeze({ ...candidate }))), warnings: Object.freeze([]), traceId: `fixture:${request.snapshot.fingerprint}`, durationMs: 0 });
  }
}

export class EmptyCandidateSearchProvider extends FixtureCandidateSearchProvider {
  constructor(clock: CtClock) { super([], clock, "empty", "v1"); }
}

export class DeterministicCandidateSearchProvider implements CtCandidateSearchProvider {
  constructor(privateClock: CtClock) { this.clock = privateClock; }
  private readonly clock: CtClock;
  async searchCandidates(request: CtCandidateSearchRequest): Promise<CtCandidateSearchResult> {
    if (request.snapshot.tenantId !== request.tenantId || request.snapshot.accountId !== request.accountId) throw new Error("provider_scope_mismatch");
    const prefix = request.snapshot.fingerprint.replace(/[^a-z0-9]/gi, "_").slice(-12);
    const candidates = Array.from({ length: request.maxCandidates }, (_, index) => Object.freeze({ username: `shadow_${prefix}_${index + 1}`, biography: "Deterministic shadow fixture", followersCount: 1_000 + index * 100, audienceMatch: 0.8, languageMatch: 0.8, geographyMatch: 0.8, categoryMatch: 0.8, followerRangeMatch: 0.8, engagementQuality: 0.8, profileActivity: 0.8, sourceTargetPerformance: 0.8, historicalFollowbackSignal: 0.8, profileEligibilityConfidence: 0.9 }));
    return Object.freeze({ provider: "deterministic", providerVersion: "v1", searchedAt: this.clock.now().toISOString(), candidates: Object.freeze(candidates), warnings: Object.freeze([]), traceId: `deterministic:${request.snapshot.fingerprint}`, durationMs: 0 });
  }
}

export class FailingCandidateSearchProvider implements CtCandidateSearchProvider {
  private readonly message: string;
  constructor(message = "candidate_provider_failed") { this.message = message; }
  async searchCandidates(): Promise<CtCandidateSearchResult> { throw new Error(this.message); }
}
