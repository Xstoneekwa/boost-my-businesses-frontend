import type { TargetAvailabilityAssessment } from "../target-lifecycle/types.ts";

export function projectTargetAvailabilityForOperator(input: Readonly<{
  assessment: TargetAvailabilityAssessment;
  utilization: Readonly<{ state: string; utilizationRatio: number | null }>;
  performance: Readonly<{ state: string }>;
  lifecycle: Readonly<{ recommendation: string; explanation: string }>;
  policyShadow: Readonly<{ action: string }>;
  replacementShadow: Readonly<{ preparationRecommended: boolean; blockers: readonly string[] }>;
  latestEvidence?: Readonly<{
    deviceId?: string | null;
    workerVersion?: string | null;
    instagramVersion?: string | null;
    verifiedBadge?: boolean | null;
    followersSurface?: string;
    stablePlatformUserId?: string | null;
  }> | null;
}>) {
  const assessment = input.assessment;
  return Object.freeze({
    tenantId: assessment.scope.tenantId,
    accountId: assessment.scope.accountId,
    targetId: assessment.scope.targetId,
    username: assessment.scope.normalizedUsername,
    status: assessment.status,
    confidence: assessment.confidence,
    evidenceCount: assessment.evidenceCount,
    distinctRunCount: assessment.distinctRunCount,
    latestObservedAt: assessment.latestObservedAt,
    terminalProof: assessment.terminalProof,
    recheckRecommended: assessment.recheckRequired,
    quarantineShadow: assessment.quarantineRecommended,
    reasons: assessment.reasons,
    utilization: Object.freeze({ state: input.utilization.state, ratio: input.utilization.utilizationRatio }),
    performance: input.performance.state,
    lifecycle: input.lifecycle.recommendation,
    explanation: input.lifecycle.explanation,
    device: input.latestEvidence?.deviceId ?? null,
    workerRelease: input.latestEvidence?.workerVersion ?? null,
    instagramVersion: input.latestEvidence?.instagramVersion ?? null,
    verifiedBadge: input.latestEvidence?.verifiedBadge ?? null,
    followersSurface: input.latestEvidence?.followersSurface ?? "unknown",
    stableIdentity: input.latestEvidence?.stablePlatformUserId ?? assessment.scope.stablePlatformUserId,
    identityConflict: assessment.status === "identity_conflict",
    policyShadow: input.policyShadow.action,
    replacementShadow: Object.freeze({ preparationRecommended: input.replacementShadow.preparationRecommended, blockers: input.replacementShadow.blockers }),
    readOnly: true as const,
    actions: Object.freeze([]),
  });
}
