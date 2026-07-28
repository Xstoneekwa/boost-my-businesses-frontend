import type { TargetAccountStock, TargetLifecycleAssessment } from "./types.ts";

const STOCK_ELIGIBLE = new Set(["healthy", "watch", "replacement_recommended", "replacement_pending"]);
const AVAILABILITY_STOCK_EXCLUDED = new Set([
  "verified_restricted",
  "permanently_unavailable",
  "deleted_or_not_found",
  "identity_conflict",
]);

export function computeTargetAccountStock(
  assessments: readonly TargetLifecycleAssessment[],
  input: Readonly<{ tenantId: string; accountId: string; minimumEligibleTargetCount: number }>,
): TargetAccountStock {
  const scoped = assessments.filter((item) => item.scope.tenantId === input.tenantId && item.scope.accountId === input.accountId);
  const included = scoped.filter((item) =>
    STOCK_ELIGIBLE.has(item.status)
    && !AVAILABILITY_STOCK_EXCLUDED.has(item.availability?.status ?? "available"),
  ).map((item) => item.scope.targetId);
  const excluded = scoped.filter((item) => !included.includes(item.scope.targetId)).map((item) => item.scope.targetId);
  return Object.freeze({
    ...input,
    eligibleTargetCount: included.length,
    lowStock: included.length < input.minimumEligibleTargetCount,
    includedTargetIds: Object.freeze(included),
    excludedTargetIds: Object.freeze(excluded),
  });
}
