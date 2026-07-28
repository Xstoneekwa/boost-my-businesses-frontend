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

  if (!input.onboardingComplete) return makeDecision("block_due_to_insufficient_data", ["onboarding_incomplete"], "Onboarding is incomplete; lifecycle action is blocked.");
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
