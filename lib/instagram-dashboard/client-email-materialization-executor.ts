import type { ClientEmailTemplateCategory } from "./client-email-constants.ts";
import type { ResolvedTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";
import {
  evaluateClientEmailMaterializationExecutionGate,
  type ClientEmailMaterializationExecutionGateReason,
} from "./client-email-materialization-execution-gate.ts";
import type { ClientEmailOutboxDecision } from "./client-email-lifecycle-outbox-plan.ts";
import type { OutboxEffectiveCandidateRow } from "./client-email-lifecycle-outbox-precedence.ts";
import {
  buildMaterializeCandidateCommand,
  isIntentMaterializeOperation,
  materializeClientEmailOutboxCandidateInternal,
  resolveStrictMaterializeOperation,
  validateMaterializeEffectiveCandidate,
  type MaterializeCandidateCommand,
  type MaterializeRpcError,
  type MaterializeRpcResult,
} from "./client-email-outbox-materializer.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

type ActiveTemplate = {
  id: string;
  category: ClientEmailTemplateCategory;
  version: number;
  subject: string;
  bodyText: string;
};

export type MaterializationExecutorRevalidationFailure = {
  status: "revalidation_failed";
  code: string;
  reason: string;
};

export type MaterializationExecutorDisabled = {
  status: "execution_disabled";
  gateReason: ClientEmailMaterializationExecutionGateReason;
};

export type MaterializationExecutorMaterialized = {
  status: "materialized";
  operation: MaterializeCandidateCommand["operation"];
  rpcInvoked: true;
  result: MaterializeRpcResult;
};

export type MaterializationExecutorMaterializeFailed = {
  status: "materialize_failed";
  operation: MaterializeCandidateCommand["operation"];
  rpcInvoked: true;
  code: string;
};

export type MaterializationExecutorDecision =
  | MaterializationExecutorDisabled
  | MaterializationExecutorRevalidationFailure
  | MaterializationExecutorMaterialized
  | MaterializationExecutorMaterializeFailed;

type MaterializeInternalFn = typeof materializeClientEmailOutboxCandidateInternal;

export type SingleClientEmailMaterializationExecutorInput = {
  supabase: ClientEmailSupabase;
  candidate: OutboxEffectiveCandidateRow;
  recipientEmail: string | null;
  deliverySettings: ResolvedTransactionalDeliverySettings;
  demoValues?: Record<string, string>;
  template?: ActiveTemplate;
  env?: Record<string, string | undefined>;
  startedAt?: string;
  sourceActionId?: string | null;
  eligibleTargetCountAtStart?: number | null;
  materializeInternal?: MaterializeInternalFn;
};

function isExecutableMaterializationDecision(
  decision: ClientEmailOutboxDecision,
): decision is "would_create_initial_intent" | "would_create_reminder_intent" {
  return decision === "would_create_initial_intent" || decision === "would_create_reminder_intent";
}

export function revalidateSingleMaterializationCandidate(input: {
  candidate: OutboxEffectiveCandidateRow;
  recipientEmail: string | null;
  deliverySettings: ResolvedTransactionalDeliverySettings;
  demoValues?: Record<string, string>;
  template?: ActiveTemplate;
  env?: Record<string, string | undefined>;
  startedAt?: string;
  sourceActionId?: string | null;
  eligibleTargetCountAtStart?: number | null;
}):
  | { valid: true; command: MaterializeCandidateCommand }
  | MaterializationExecutorRevalidationFailure {
  const env = input.env ?? process.env;
  const { candidate } = input;

  if (candidate.isEffectiveCandidate !== true) {
    return {
      status: "revalidation_failed",
      code: "suppressed_candidate",
      reason: "candidate_suppressed_by_precedence",
    };
  }

  if (!isExecutableMaterializationDecision(candidate.decision)) {
    return {
      status: "revalidation_failed",
      code: "invalid_decision",
      reason: candidate.decision === "would_open_episode"
        ? "execute_initial_must_not_use_open_operation"
        : "decision_not_materializable",
    };
  }

  const candidateValidation = validateMaterializeEffectiveCandidate({
    candidate,
    env,
    recipientEmail: input.recipientEmail,
  });
  if (!candidateValidation.valid) {
    return {
      status: "revalidation_failed",
      code: candidateValidation.code,
      reason: candidateValidation.reason,
    };
  }

  const operation = resolveStrictMaterializeOperation({
    category: candidate.category,
    decision: candidate.decision,
    reminderIndex: candidate.reminderIndex,
    parentId: candidate.parentId,
  });
  if (!operation || !isIntentMaterializeOperation(operation)) {
    return {
      status: "revalidation_failed",
      code: "invalid_operation",
      reason: "execute_requires_create_intent_operation",
    };
  }

  const commandResult = buildMaterializeCandidateCommand({
    candidate,
    recipientEmail: input.recipientEmail,
    deliverySettings: input.deliverySettings,
    template: input.template,
    demoValues: input.demoValues ?? {},
    startedAt: input.startedAt,
    sourceActionId: input.sourceActionId,
    eligibleTargetCountAtStart: input.eligibleTargetCountAtStart,
  });
  if (!commandResult.valid) {
    return {
      status: "revalidation_failed",
      code: commandResult.code,
      reason: commandResult.reason,
    };
  }

  if (!isIntentMaterializeOperation(commandResult.command.operation)) {
    return {
      status: "revalidation_failed",
      code: "invalid_operation",
      reason: "execute_requires_create_intent_operation",
    };
  }

  return { valid: true, command: commandResult.command };
}

/**
 * Internal-only single-candidate materialize executor.
 * Must not be imported by HTTP routes, cron, queue, inbound handlers, or BotApp until a future controlled activation task.
 */
export async function executeSingleClientEmailMaterializationInternal(
  input: SingleClientEmailMaterializationExecutorInput,
): Promise<MaterializationExecutorDecision> {
  const env = input.env ?? process.env;
  const executionGate = evaluateClientEmailMaterializationExecutionGate(env);
  if (!executionGate.enabled) {
    return {
      status: "execution_disabled",
      gateReason: executionGate.reason,
    };
  }

  const revalidation = revalidateSingleMaterializationCandidate(input);
  if ("status" in revalidation) {
    return revalidation;
  }

  const materialize = input.materializeInternal ?? materializeClientEmailOutboxCandidateInternal;
  const result = await materialize(input.supabase, revalidation.command);
  if (result.ok === false) {
    return {
      status: "materialize_failed",
      operation: revalidation.command.operation,
      rpcInvoked: true,
      code: (result as MaterializeRpcError).code,
    };
  }

  return {
    status: "materialized",
    operation: revalidation.command.operation,
    rpcInvoked: true,
    result,
  };
}
