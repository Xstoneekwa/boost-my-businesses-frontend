import { ctStableFingerprint } from "./snapshot.ts";

export type PremiumReplacementShadowCandidate = Readonly<{
  username: string;
  score: number;
  blacklisted?: boolean;
  duplicate?: boolean;
  ownershipConflict?: boolean;
}>;

export function simulatePremiumReplacementShadow(input: Readonly<{
  tenantId: string;
  accountId: string;
  targetId: string;
  plan: "growth" | "pro" | "premium";
  entitlementActive: boolean;
  accountPaused: boolean;
  cancelRequested: boolean;
  downgradePending: boolean;
  campaignBlocked: boolean;
  recommendation: string;
  reason?: string;
  confidence?: "unknown" | "low" | "medium" | "high";
  candidates: readonly PremiumReplacementShadowCandidate[];
  generatedAt: string;
}>) {
  const blockers = [
    !input.entitlementActive && "entitlement_inactive",
    input.accountPaused && "account_paused",
    input.cancelRequested && "cancel_requested",
    input.downgradePending && "downgrade_pending",
    input.campaignBlocked && "campaign_blocked",
    input.plan !== "premium" && "premium_entitlement_required",
  ].filter((value): value is string => Boolean(value));
  const excluded = input.candidates.filter((item) => item.blacklisted || item.duplicate || item.ownershipConflict || item.score < 0.7);
  const eligible = input.candidates.filter((item) => !excluded.includes(item)).sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
  const preparationRecommended = !blockers.length
    && ["replacement_recommended", "replacement_preparation_recommended"].includes(input.recommendation);
  const hypotheticalPolicyPath = Object.freeze([
    "verify_replacement_stock",
    "verify_premium_entitlement",
    "prepare_shadow_intent",
    "simulate_batch",
    "simulate_review",
    "simulate_j_plus_5",
    "simulate_activation",
    "defer_source_archive_until_replacement",
  ]);
  return Object.freeze({
    mode: "premium_replacement_shadow" as const,
    mutationExecuted: false as const,
    providerCalled: false as const,
    activationAllowed: false as const,
    proposalCreated: false as const,
    batchCreated: false as const,
    notificationSent: false as const,
    emailSent: false as const,
    sourceTarget: Object.freeze({ tenantId: input.tenantId, accountId: input.accountId, targetId: input.targetId }),
    reason: input.reason ?? input.recommendation,
    confidence: input.confidence ?? "unknown",
    replacementNeeded: ["replacement_recommended", "replacement_preparation_recommended"].includes(input.recommendation),
    idempotencyKey: ctStableFingerprint({ tenantId: input.tenantId, accountId: input.accountId, targetId: input.targetId, recommendation: input.recommendation, candidates: input.candidates }),
    blockers: Object.freeze(blockers),
    preparationRecommended,
    hypotheticalCandidateCount: eligible.length,
    hypotheticalPolicyPath,
    archiveDeferred: true as const,
    terminalOutcomePreview: blockers.length
      ? "blocked_no_action"
      : preparationRecommended && eligible.length
        ? "replacement_candidate_review_would_be_recommended"
        : preparationRecommended
          ? "replacement_stock_would_be_required"
          : "monitor_no_action",
    eligibleCandidates: Object.freeze(eligible.map((item) => Object.freeze({ username: item.username.trim().replace(/^@+/, "").toLowerCase(), score: item.score }))),
    excludedCandidates: Object.freeze(excluded.map((item) => Object.freeze({
      username: item.username.trim().replace(/^@+/, "").toLowerCase(),
      reasons: Object.freeze([
        item.blacklisted && "blacklisted",
        item.duplicate && "duplicate",
        item.ownershipConflict && "ownership_conflict",
        item.score < 0.7 && "score_below_threshold",
      ].filter((value): value is string => Boolean(value))),
    }))),
    generatedAt: input.generatedAt,
  });
}
