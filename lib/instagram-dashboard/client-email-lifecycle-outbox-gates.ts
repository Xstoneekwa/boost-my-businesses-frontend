import type { ClientEmailTemplateCategory } from "./client-email-constants.ts";
import {
  evaluateMaterializeLifecycleAutomationGate,
  evaluateMaterializeNeedsMoreAutomationGate,
} from "./client-email-lifecycle-automation-gates.ts";
import {
  evaluateClientEmailSendingGate,
  readClientEmailProviderEnv,
} from "./client-email-provider-config.ts";
import type {
  ClientEmailLifecycleOutboxPlan,
  ClientEmailOutboxDecision,
  ClientEmailOutboxPlanRow,
} from "./client-email-lifecycle-outbox-plan.ts";
import type { OutboxEffectiveCandidateRow } from "./client-email-lifecycle-outbox-precedence.ts";

export type OutboxLayerGateState = "open" | "closed" | "not_applicable";
export type OutboxLayerReadinessStatus = "blocked" | "partial" | "ready";

export type OutboxLayerReadiness = {
  eligible: boolean;
  gateState: OutboxLayerGateState;
  blockingReasons: string[];
};

const MATERIALIZATION_CANDIDATE_DECISIONS = new Set<ClientEmailOutboxDecision>([
  "would_open_episode",
  "would_create_initial_intent",
  "would_create_reminder_intent",
]);

const DISPATCH_CANDIDATE_DECISIONS = new Set<ClientEmailOutboxDecision>([
  "would_create_initial_intent",
  "would_create_reminder_intent",
]);

export function isMaterializationCandidateDecision(decision: ClientEmailOutboxDecision) {
  return MATERIALIZATION_CANDIDATE_DECISIONS.has(decision);
}

export function isDispatchCandidateDecision(decision: ClientEmailOutboxDecision) {
  return DISPATCH_CANDIDATE_DECISIONS.has(decision);
}

export function evaluateCategoryMaterializeAutomationGate(
  category: ClientEmailTemplateCategory,
  env: Record<string, string | undefined>,
) {
  if (category === "needs_more_target_accounts") {
    return evaluateMaterializeNeedsMoreAutomationGate(env);
  }
  return evaluateMaterializeLifecycleAutomationGate(env);
}

export function evaluateCategoryDispatchAutomationGate(
  category: ClientEmailTemplateCategory,
  env: Record<string, string | undefined>,
) {
  const materializeGate = evaluateCategoryMaterializeAutomationGate(category, env);
  if (!materializeGate.allowed) {
    return materializeGate;
  }

  const sendingGate = evaluateClientEmailSendingGate(env);
  if (!sendingGate.allowed) {
    return {
      allowed: false as const,
      reason: "client_sending_disabled" as const,
      message: sendingGate.message,
    };
  }

  const provider = readClientEmailProviderEnv(env);
  if (provider.provider !== "postmark") {
    return {
      allowed: false as const,
      reason: "provider_not_configured" as const,
      message: "CLIENT_EMAIL_PROVIDER must be set to postmark before lifecycle dispatch.",
    };
  }
  if (!provider.postmarkServerTokenConfigured) {
    return {
      allowed: false as const,
      reason: "postmark_token_missing" as const,
      message: "POSTMARK_SERVER_TOKEN is not configured.",
    };
  }

  return { allowed: true as const };
}

export function projectRowMaterializationReadiness(
  row: ClientEmailOutboxPlanRow,
  env: Record<string, string | undefined>,
): OutboxLayerReadiness {
  if (!isMaterializationCandidateDecision(row.decision)) {
    return {
      eligible: false,
      gateState: "not_applicable",
      blockingReasons: [],
    };
  }

  const categoryGate = evaluateCategoryMaterializeAutomationGate(row.category, env);
  if (!categoryGate.allowed) {
    return {
      eligible: false,
      gateState: "closed",
      blockingReasons: [categoryGate.message],
    };
  }

  return {
    eligible: true,
    gateState: "open",
    blockingReasons: [],
  };
}

export function projectRowDispatchReadiness(input: {
  row: ClientEmailOutboxPlanRow;
  materialization: OutboxLayerReadiness;
  plan: Pick<
    ClientEmailLifecycleOutboxPlan,
    "globalSendingEnabled" | "providerDispatchAllowed"
  >;
  env: Record<string, string | undefined>;
  senderConfigured: boolean;
  supportEmailConfigured: boolean;
}): OutboxLayerReadiness {
  if (!isDispatchCandidateDecision(input.row.decision)) {
    return {
      eligible: false,
      gateState: "not_applicable",
      blockingReasons: [],
    };
  }

  const reasons: string[] = [];
  if (!input.materialization.eligible) {
    reasons.push(...input.materialization.blockingReasons);
  }

  const categoryGate = evaluateCategoryDispatchAutomationGate(input.row.category, input.env);
  if (!categoryGate.allowed) {
    reasons.push(categoryGate.message);
  }

  if (!input.senderConfigured) {
    reasons.push("Active sender email is not configured.");
  }
  if (!input.supportEmailConfigured) {
    reasons.push("Support email is not configured.");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    eligible: uniqueReasons.length === 0,
    gateState: uniqueReasons.length === 0 ? "open" : "closed",
    blockingReasons: uniqueReasons,
  };
}

export function enrichEffectiveCandidateWithGateProjections(
  row: ClientEmailOutboxPlanRow,
  plan: ClientEmailLifecycleOutboxPlan,
  env: Record<string, string | undefined>,
): OutboxEffectiveCandidateRow {
  const materialization = projectRowMaterializationReadiness(row, env);
  const dispatch = projectRowDispatchReadiness({
    row,
    materialization,
    plan,
    env,
    senderConfigured: Boolean(row.fromEmailSnapshot),
    supportEmailConfigured: Boolean(row.supportEmailSnapshot),
  });

  return {
    ...row,
    materializationEligible: materialization.eligible,
    materializationGateState: materialization.gateState,
    materializationBlockingReasons: materialization.blockingReasons,
    dispatchEligible: dispatch.eligible,
    dispatchGateState: dispatch.gateState,
    dispatchBlockingReasons: dispatch.blockingReasons,
    suppressedByCategory: null,
    suppressionReason: null,
    isEffectiveCandidate: true,
  };
}

export function deriveOutboxLayerReadinessStatus(input: {
  schemaReady: boolean;
  templatesReady: boolean;
  blockingReasons: string[];
}): OutboxLayerReadinessStatus {
  if (!input.schemaReady || !input.templatesReady) return "blocked";
  if (input.blockingReasons.length === 0) return "ready";
  return "partial";
}
