import type {
  TargetLifecycleReason,
  TargetPlanPolicyAction,
  TargetPlanPolicyDecision,
  TargetPlanPolicyInput,
} from "./types.ts";

type DecisionOverrides = Partial<Omit<TargetPlanPolicyDecision, "plan" | "action" | "reasons" | "reasonCodes" | "explanation" | "evaluatedAt">>;

export function evaluateTargetLifecyclePlanPolicy(input: TargetPlanPolicyInput): TargetPlanPolicyDecision {
  const makeDecision = (
    action: TargetPlanPolicyAction,
    reasons: readonly TargetLifecycleReason[],
    explanation: string,
    overrides: DecisionOverrides = {},
  ): TargetPlanPolicyDecision => Object.freeze({
    plan: input.plan,
    action,
    reasons,
    reasonCodes: reasons,
    explanation,
    automaticReplacementAllowed: input.plan === "premium",
    replacementRequired: ["replacement_recommended", "replacement_pending", "exhausted"].includes(input.assessment.status),
    archiveAllowed: false,
    archiveDeferred: false,
    clientNotificationRequired: false,
    clientEmailRequired: false,
    lowStockRecomputeRequired: false,
    evaluatedAt: input.evaluatedAt,
    ...overrides,
  });
  const notify = input.notificationState !== "sent";
  const availability = input.availabilityAssessment ?? input.assessment.availability;

  if (!input.onboardingComplete) return makeDecision("block_due_to_insufficient_data", ["onboarding_incomplete"], "Onboarding is incomplete; lifecycle action is blocked.");
  if (availability?.status === "identity_conflict") return makeDecision(
    "hold_for_operator",
    availability.reasons,
    "Stable identity conflicts with the observed username; automatic identity or replacement action is blocked.",
  );
  if (availability?.status === "username_changed") return makeDecision(
    "resolve_target_identity",
    availability.reasons,
    "Stable identity confirms a username change while preserving the target identity and history.",
  );
  if (availability && [
    "temporarily_unavailable",
    "lookup_failed",
    "followers_surface_restricted",
    "suspended_or_disabled",
    "stale_evidence",
    "insufficient_evidence",
    "availability_unknown",
  ].includes(availability.status)) {
    return makeDecision(
      availability.quarantineRecommended ? "quarantine_target" : "recheck_availability",
      availability.reasons,
      "Availability evidence is not terminal; quarantine and an asynchronous recheck are required.",
    );
  }
  if (availability?.replacementRequired) {
    if (input.plan !== "premium") {
      const reason: TargetLifecycleReason = input.plan === "growth"
        ? "growth_client_target_request_required"
        : "pro_client_target_request_required";
      return makeDecision("request_client_targets", [...availability.reasons, reason], "The client must add replacement targets manually.", {
        clientNotificationRequired: notify,
        clientEmailRequired: notify,
        lowStockRecomputeRequired: true,
      });
    }
    if (input.replacementState === "activated") return makeDecision(
      "archive_after_replacement",
      [...availability.reasons, "target_archived_after_replacement"],
      "Premium replacement is active; the previous unavailable target may now be archived.",
      { archiveAllowed: true, lowStockRecomputeRequired: true },
    );
    if (input.replacementState === "pending" || input.replacementState === "ready_for_review") return makeDecision(
      "mark_replacement_pending",
      [...availability.reasons, "premium_replacement_ready_for_review", "premium_archive_deferred_until_replacement"],
      "Premium replacement-first keeps the old target until replacement activation.",
      { archiveDeferred: true, lowStockRecomputeRequired: true },
    );
    return makeDecision(
      "prepare_automatic_replacement",
      [...availability.reasons, "premium_automatic_replacement_required", "premium_archive_deferred_until_replacement"],
      "Premium prepares an automatic replacement while archive remains deferred.",
      { archiveDeferred: true, lowStockRecomputeRequired: true },
    );
  }
  if (["insufficient_data", "stale_data"].includes(input.assessment.status)) {
    return makeDecision("block_due_to_insufficient_data", input.assessment.reasons, "Evidence is not reliable enough for a lifecycle action.");
  }
  if (input.assessment.status === "archived") return makeDecision("no_action", ["target_archived"], "Target is already archived.");
  if (input.assessment.status === "healthy") return makeDecision("no_action", input.assessment.reasons, "Target remains healthy.");
  if (input.assessment.status === "watch") return makeDecision("monitor", input.assessment.reasons, "Utilization requires monitoring only.");

  if (input.assessment.archiveRecommendation.terminalProof) return makeDecision(
    "archive_immediately_terminal",
    ["target_archived_terminal_exhaustion"],
    "Future-only terminal proof contract permits immediate archive.",
    {
      archiveAllowed: true,
      clientNotificationRequired: input.plan !== "premium" && notify,
      clientEmailRequired: input.plan !== "premium" && notify,
      lowStockRecomputeRequired: true,
    },
  );

  if (input.plan !== "premium") {
    const reason: TargetLifecycleReason = input.plan === "growth"
      ? "growth_client_target_request_required"
      : "pro_client_target_request_required";
    return makeDecision("request_client_targets", [reason], "Client must add replacement targets manually.", {
      clientNotificationRequired: notify,
      clientEmailRequired: notify,
      lowStockRecomputeRequired: input.assessment.status === "exhausted",
    });
  }

  if (input.replacementState === "activated") return makeDecision(
    "archive_after_replacement",
    ["target_archived_after_replacement"],
    "Premium replacement is active; the previous target may now be archived.",
    { archiveAllowed: true, lowStockRecomputeRequired: true },
  );
  if (input.replacementState === "pending" || input.replacementState === "ready_for_review") return makeDecision(
    "mark_replacement_pending",
    ["premium_replacement_ready_for_review", "premium_archive_deferred_until_replacement"],
    "Premium replacement-first keeps the old target until activation.",
    { archiveDeferred: true },
  );
  return makeDecision(
    "prepare_automatic_replacement",
    ["premium_automatic_replacement_required", "premium_archive_deferred_until_replacement"],
    "Premium may prepare an automatic replacement; archive remains deferred.",
    { archiveDeferred: true },
  );
}

export const decideTargetPlanPolicy = evaluateTargetLifecyclePlanPolicy;
