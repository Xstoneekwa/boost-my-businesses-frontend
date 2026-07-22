export type FollowLimitReconciliationClassification =
  | "already_consistent"
  | "explicit_override_confirmed"
  | "package_seeded_legacy"
  | "legacy_test_value"
  | "override_above_package"
  | "ambiguous_manual_review";

export type FollowLimitReconciliationInput = {
  account: string;
  packageCode: string | null;
  packageDayCap: number | null;
  packageSessionCap: number | null;
  legacyDayCap: number | null;
  legacySessionCap: number | null;
  legacyRunCap: number | null;
  exactAdminAuditMatch: boolean;
  onboardingDefaultsMatch: boolean;
  confirmedTestValue: boolean;
};

export type FollowLimitReconciliationRow = FollowLimitReconciliationInput & {
  classification: FollowLimitReconciliationClassification;
  proposedAction: string;
};

export function classifyFollowLimitReconciliation(
  input: FollowLimitReconciliationInput,
): FollowLimitReconciliationRow {
  const overrideAbovePackage = input.exactAdminAuditMatch
    && ((input.legacyDayCap !== null && input.packageDayCap !== null && input.legacyDayCap > input.packageDayCap)
      || (input.legacySessionCap !== null
        && input.packageSessionCap !== null
        && input.legacySessionCap > input.packageSessionCap));

  let classification: FollowLimitReconciliationClassification;
  let proposedAction: string;
  if (overrideAbovePackage) {
    classification = "override_above_package";
    proposedAction = "Future confirmed backfill; retain stored intent and bound by package.";
  } else if (input.exactAdminAuditMatch) {
    classification = "explicit_override_confirmed";
    proposedAction = "Eligible for a future controlled override backfill.";
  } else if (input.confirmedTestValue) {
    classification = "legacy_test_value";
    proposedAction = "No automatic backfill; retain legacy read-only evidence.";
  } else if (input.onboardingDefaultsMatch) {
    classification = "package_seeded_legacy";
    proposedAction = "No override; use package defaults after rollout.";
  } else if (input.packageDayCap !== null
    && input.packageSessionCap !== null
    && input.legacyDayCap !== null
    && input.legacySessionCap !== null
    && input.legacyDayCap === input.packageDayCap
    && input.legacySessionCap === input.packageSessionCap) {
    classification = "already_consistent";
    proposedAction = "No override; use package defaults after rollout.";
  } else {
    classification = "ambiguous_manual_review";
    proposedAction = "No automatic backfill; require manual evidence review.";
  }

  return { ...input, classification, proposedAction };
}
