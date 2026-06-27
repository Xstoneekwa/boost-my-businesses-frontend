import type { ClientEmailSendTrigger, ClientEmailTemplateCategory } from "./client-email-constants.ts";
import {
  buildIntentDeliverySnapshotFields,
  type ResolvedTransactionalDeliverySettings,
} from "./client-email-delivery-settings.ts";
import {
  isLifecycleIntentCategory,
  validateClientEmailIntentParentRefs,
} from "./client-email-intent-parent-contract.ts";
import {
  evaluateCategoryMaterializeAutomationGate,
  isMaterializationCandidateDecision,
} from "./client-email-lifecycle-outbox-gates.ts";
import type {
  ClientEmailOutboxDecision,
  ClientEmailOutboxFutureIntentSnapshot,
  ClientEmailOutboxPlanRow,
} from "./client-email-lifecycle-outbox-plan.ts";
import type { OutboxEffectiveCandidateRow } from "./client-email-lifecycle-outbox-precedence.ts";
import { readErrorMessage } from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";
import { buildTemplatePreview } from "./client-email-template-render.ts";
import { normalizeCommunicationEmail } from "./client-communication-email.ts";

export const MATERIALIZE_CLIENT_EMAIL_OUTBOX_RPC = "materialize_client_email_outbox_candidate_v1" as const;

export const CLIENT_EMAIL_IDEMPOTENCY_IDENTITY_CONFLICT = "client_email_idempotency_identity_conflict" as const;
export const CLIENT_EMAIL_ACCOUNT_CLIENT_OWNERSHIP_MISMATCH =
  "client_email_account_client_ownership_mismatch" as const;

export type MaterializeOutboxOperation =
  | "open_lifecycle_episode"
  | "create_lifecycle_initial_intent"
  | "open_needs_more_sequence"
  | "create_needs_more_initial_intent"
  | "create_needs_more_reminder_intent";

export type MaterializeIntentBusinessIdentity = {
  accountId: string;
  clientId: string;
  category: ClientEmailTemplateCategory;
  trigger: ClientEmailSendTrigger;
  reminderIndex: number;
  parentType: "sequence" | "lifecycle_episode";
  parentId: string | null;
  idempotencyKey: string;
};

export type MaterializeCandidateCommand = {
  accountId: string;
  clientId: string;
  category: ClientEmailTemplateCategory;
  operation: MaterializeOutboxOperation;
  decision: ClientEmailOutboxDecision;
  parentEpisodeKey: string;
  parentId: string | null;
  parentType: "sequence" | "lifecycle_episode";
  startedAt: string;
  sourceActionId: string | null;
  eligibleTargetCountAtStart: number | null;
  recipientEmail: string | null;
  idempotencyKey: string | null;
  configVersion: number;
  businessIdentity: MaterializeIntentBusinessIdentity | null;
  intentSnapshot: ClientEmailOutboxFutureIntentSnapshot | null;
};

export type MaterializeCandidateValidationResult =
  | { valid: true; command: MaterializeCandidateCommand }
  | { valid: false; reason: string; code: string };

export type MaterializeRpcResult = {
  ok: true;
  parent: {
    id: string;
    kind: "sequence" | "lifecycle_episode";
    created: boolean;
  };
  intent: {
    id: string;
    created: boolean;
    status: string;
    idempotencyKey: string;
  } | null;
};

export type MaterializeRpcError = {
  ok: false;
  code: string;
};

type ActiveTemplate = {
  id: string;
  category: ClientEmailTemplateCategory;
  version: number;
  subject: string;
  bodyText: string;
};

const LIFECYCLE_OPERATIONS = new Set<MaterializeOutboxOperation>([
  "open_lifecycle_episode",
  "create_lifecycle_initial_intent",
]);

const NEEDS_MORE_OPERATIONS = new Set<MaterializeOutboxOperation>([
  "open_needs_more_sequence",
  "create_needs_more_initial_intent",
  "create_needs_more_reminder_intent",
]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function resolveParentType(category: ClientEmailTemplateCategory): "sequence" | "lifecycle_episode" {
  return category === "needs_more_target_accounts" ? "sequence" : "lifecycle_episode";
}

export function resolveStrictMaterializeOperation(input: {
  category: ClientEmailTemplateCategory;
  decision: ClientEmailOutboxDecision;
  reminderIndex: number | null;
  parentId: string | null;
}): MaterializeOutboxOperation | null {
  const { category, decision, parentId } = input;
  const reminderIndex = input.reminderIndex ?? 0;

  if (isLifecycleIntentCategory(category)) {
    if (decision === "would_create_reminder_intent") return null;
    if (reminderIndex !== 0) return null;
    if (decision === "would_open_episode") return "open_lifecycle_episode";
    if (decision === "would_create_initial_intent") return "create_lifecycle_initial_intent";
    return null;
  }

  if (category === "needs_more_target_accounts") {
    if (decision === "would_open_episode") return "open_needs_more_sequence";
    if (decision === "would_create_initial_intent") {
      if (reminderIndex !== 0) return null;
      return "create_needs_more_initial_intent";
    }
    if (decision === "would_create_reminder_intent") {
      if (reminderIndex < 1 || reminderIndex > 5) return null;
      return "create_needs_more_reminder_intent";
    }
  }

  return null;
}

export function isIntentMaterializeOperation(operation: MaterializeOutboxOperation) {
  return operation === "create_lifecycle_initial_intent"
    || operation === "create_needs_more_initial_intent"
    || operation === "create_needs_more_reminder_intent";
}

export function buildMaterializeIntentBusinessIdentity(input: {
  accountId: string;
  clientId: string;
  category: ClientEmailTemplateCategory;
  trigger: ClientEmailSendTrigger;
  reminderIndex: number | null;
  parentType: "sequence" | "lifecycle_episode";
  parentId: string | null;
  idempotencyKey: string;
}): MaterializeIntentBusinessIdentity {
  return {
    accountId: input.accountId,
    clientId: input.clientId,
    category: input.category,
    trigger: input.trigger,
    reminderIndex: input.reminderIndex ?? 0,
    parentType: input.parentType,
    parentId: input.parentId,
    idempotencyKey: input.idempotencyKey,
  };
}

export function assertMaterializeIntentBusinessIdentityMatch(
  expected: MaterializeIntentBusinessIdentity,
  actual: MaterializeIntentBusinessIdentity,
): { ok: true } | { ok: false; code: typeof CLIENT_EMAIL_IDEMPOTENCY_IDENTITY_CONFLICT } {
  const fields: Array<keyof MaterializeIntentBusinessIdentity> = [
    "accountId",
    "clientId",
    "category",
    "trigger",
    "reminderIndex",
    "parentType",
    "parentId",
    "idempotencyKey",
  ];
  for (const field of fields) {
    if (expected[field] !== actual[field]) {
      return { ok: false, code: CLIENT_EMAIL_IDEMPOTENCY_IDENTITY_CONFLICT };
    }
  }
  return { ok: true };
}

export function validateMaterializeEffectiveCandidate(input: {
  candidate: OutboxEffectiveCandidateRow | ClientEmailOutboxPlanRow & { isEffectiveCandidate?: boolean };
  env: Record<string, string | undefined>;
  recipientEmail?: string | null;
  suppressed?: boolean;
}) {
  const { candidate, env } = input;

  if (input.suppressed || ("isEffectiveCandidate" in candidate && candidate.isEffectiveCandidate === false)) {
    return { valid: false as const, reason: "candidate_suppressed_by_precedence", code: "suppressed_candidate" };
  }

  if ("materializationEligible" in candidate && candidate.materializationEligible === false) {
    return {
      valid: false as const,
      reason: "materialization_gate_closed",
      code: "materialize_gate_closed",
    };
  }

  if (!isMaterializationCandidateDecision(candidate.decision)) {
    return { valid: false as const, reason: "decision_not_materializable", code: "invalid_decision" };
  }

  const materializeGate = evaluateCategoryMaterializeAutomationGate(candidate.category, env);
  if (!materializeGate.allowed) {
    return {
      valid: false as const,
      reason: materializeGate.message,
      code: materializeGate.reason,
    };
  }

  const operation = resolveStrictMaterializeOperation({
    category: candidate.category,
    decision: candidate.decision,
    reminderIndex: candidate.reminderIndex,
    parentId: candidate.parentId,
  });
  if (!operation) {
    return { valid: false as const, reason: "unsupported_materialize_operation", code: "invalid_operation" };
  }

  if (!candidate.parentKey) {
    return { valid: false as const, reason: "missing_parent_episode_key", code: "missing_parent_episode_key" };
  }

  const parentType = resolveParentType(candidate.category);
  if (candidate.parentType && candidate.parentType !== parentType) {
    return {
      valid: false as const,
      reason: "category_parent_type_mismatch",
      code: "category_parent_mismatch",
    };
  }

  if (operation === "create_needs_more_reminder_intent" && !candidate.parentId) {
    return {
      valid: false as const,
      reason: "needs_more_active_sequence_required",
      code: "needs_more_active_sequence_required",
    };
  }

  if (isIntentMaterializeOperation(operation)) {
    const recipient = normalizeCommunicationEmail(input.recipientEmail ?? "");
    if (!recipient) {
      return { valid: false as const, reason: "missing_canonical_client_email", code: "missing_recipient_email" };
    }

    const snapshot = candidate.futureIntentSnapshot;
    if (!snapshot) {
      return { valid: false as const, reason: "missing_future_intent_snapshot", code: "missing_intent_snapshot" };
    }

    if (snapshot.category !== candidate.category || snapshot.parentType !== parentType) {
      return { valid: false as const, reason: "snapshot_category_mismatch", code: "category_parent_mismatch" };
    }

    if (!snapshot.templateId || !snapshot.snapshotSubject || !snapshot.snapshotBodyText || !snapshot.snapshotBodyHtml) {
      return { valid: false as const, reason: "incomplete_template_snapshot", code: "missing_intent_snapshot_fields" };
    }

    if (isLifecycleIntentCategory(candidate.category) && (candidate.reminderIndex ?? 0) !== 0) {
      return { valid: false as const, reason: "lifecycle_initial_index_required", code: "lifecycle_initial_index_required" };
    }

    const parentValidation = validateClientEmailIntentParentRefs({
      intentKind: "client",
      category: candidate.category,
      sequenceId: parentType === "sequence" ? candidate.parentId ?? "pending-parent" : null,
      lifecycleEpisodeId: parentType === "lifecycle_episode" ? candidate.parentId ?? "pending-parent" : null,
    });
    if (!parentValidation.valid && candidate.parentId) {
      return { valid: false as const, reason: parentValidation.reason, code: "category_parent_mismatch" };
    }
  }

  return { valid: true as const };
}

export function buildMaterializeCandidateCommand(input: {
  candidate: OutboxEffectiveCandidateRow | ClientEmailOutboxPlanRow;
  recipientEmail?: string | null;
  deliverySettings: ResolvedTransactionalDeliverySettings;
  template?: ActiveTemplate;
  demoValues: Record<string, string>;
  startedAt?: string;
  sourceActionId?: string | null;
  eligibleTargetCountAtStart?: number | null;
}): MaterializeCandidateValidationResult {
  const operation = resolveStrictMaterializeOperation({
    category: input.candidate.category,
    decision: input.candidate.decision,
    reminderIndex: input.candidate.reminderIndex,
    parentId: input.candidate.parentId,
  });
  if (!operation) {
    return { valid: false, reason: "unsupported_materialize_operation", code: "invalid_operation" };
  }

  const parentType = resolveParentType(input.candidate.category);
  const parentEpisodeKey = input.candidate.parentKey ?? input.candidate.futureIntentSnapshot?.parentKey ?? "";
  if (!parentEpisodeKey) {
    return { valid: false, reason: "missing_parent_episode_key", code: "missing_parent_episode_key" };
  }

  if (
    (isLifecycleIntentCategory(input.candidate.category) && !LIFECYCLE_OPERATIONS.has(operation))
    || (input.candidate.category === "needs_more_target_accounts" && !NEEDS_MORE_OPERATIONS.has(operation))
  ) {
    return { valid: false, reason: "operation_category_mismatch", code: "invalid_operation" };
  }

  if (operation === "create_needs_more_reminder_intent" && !input.candidate.parentId) {
    return { valid: false, reason: "needs_more_active_sequence_required", code: "needs_more_active_sequence_required" };
  }

  let intentSnapshot = input.candidate.futureIntentSnapshot;
  let businessIdentity: MaterializeIntentBusinessIdentity | null = null;

  if (isIntentMaterializeOperation(operation)) {
    const recipient = normalizeCommunicationEmail(input.recipientEmail ?? "");
    if (!recipient) {
      return { valid: false, reason: "missing_canonical_client_email", code: "missing_recipient_email" };
    }

    if (input.template) {
      const preview = buildTemplatePreview(input.template.subject, input.template.bodyText, input.demoValues);
      const deliveryFields = buildIntentDeliverySnapshotFields(input.deliverySettings);
      const idempotencyKey = input.candidate.idempotencyKey ?? intentSnapshot?.idempotencyKey ?? "";
      if (!idempotencyKey) {
        return { valid: false, reason: "missing_idempotency_key", code: "missing_idempotency_key" };
      }

      intentSnapshot = {
        templateId: input.template.id,
        templateVersion: input.template.version,
        snapshotSubject: preview.subject,
        snapshotBodyText: preview.bodyText,
        snapshotBodyHtml: preview.bodyHtml,
        fromEmailSnapshot: deliveryFields.from_email_snapshot,
        supportEmailSnapshot: deliveryFields.support_email_snapshot,
        configVersion: input.deliverySettings.configVersion,
        category: input.candidate.category,
        trigger: (input.candidate.trigger ?? intentSnapshot?.trigger ?? "automatic_initial") as ClientEmailSendTrigger,
        reminderIndex: input.candidate.reminderIndex,
        parentType,
        parentKey: parentEpisodeKey,
        idempotencyKey,
      };
    } else if (!intentSnapshot) {
      return { valid: false, reason: "missing_future_intent_snapshot", code: "missing_intent_snapshot" };
    }

    const trigger = (input.candidate.trigger ?? intentSnapshot.trigger) as ClientEmailSendTrigger;
    const idempotencyKey = intentSnapshot.idempotencyKey;
    businessIdentity = buildMaterializeIntentBusinessIdentity({
      accountId: input.candidate.accountId,
      clientId: input.candidate.clientId,
      category: input.candidate.category,
      trigger,
      reminderIndex: input.candidate.reminderIndex,
      parentType,
      parentId: input.candidate.parentId,
      idempotencyKey,
    });
  }

  const command: MaterializeCandidateCommand = {
    accountId: input.candidate.accountId,
    clientId: input.candidate.clientId,
    category: input.candidate.category,
    operation,
    decision: input.candidate.decision,
    parentEpisodeKey,
    parentId: input.candidate.parentId,
    parentType,
    startedAt: input.startedAt ?? new Date().toISOString(),
    sourceActionId: input.sourceActionId ?? null,
    eligibleTargetCountAtStart: input.eligibleTargetCountAtStart ?? null,
    recipientEmail: isIntentMaterializeOperation(operation)
      ? normalizeCommunicationEmail(input.recipientEmail ?? "")
      : null,
    idempotencyKey: businessIdentity?.idempotencyKey ?? null,
    configVersion: intentSnapshot?.configVersion ?? input.deliverySettings.configVersion,
    businessIdentity,
    intentSnapshot,
  };

  return { valid: true, command };
}

export function projectMaterializeRpcPayload(command: MaterializeCandidateCommand) {
  const snapshot = command.intentSnapshot;
  return {
    p_account_id: command.accountId,
    p_client_id: command.clientId,
    p_category: command.category,
    p_operation: command.operation,
    p_parent_episode_key: command.parentEpisodeKey,
    p_started_at: command.startedAt,
    p_source_action_id: command.sourceActionId,
    p_eligible_target_count_at_start: command.eligibleTargetCountAtStart,
    p_recipient_email: command.recipientEmail,
    p_idempotency_key: command.idempotencyKey,
    p_trigger: snapshot?.trigger ?? null,
    p_reminder_index: snapshot?.reminderIndex ?? command.businessIdentity?.reminderIndex ?? null,
    p_template_id: snapshot?.templateId ?? null,
    p_template_version: snapshot?.templateVersion ?? null,
    p_snapshot_subject: snapshot?.snapshotSubject ?? null,
    p_snapshot_body_text: snapshot?.snapshotBodyText ?? null,
    p_snapshot_body_html: snapshot?.snapshotBodyHtml ?? null,
    p_from_email: snapshot?.fromEmailSnapshot ?? null,
    p_from_email_snapshot: snapshot?.fromEmailSnapshot ?? null,
    p_support_email_snapshot: snapshot?.supportEmailSnapshot ?? null,
    p_parent_id: command.parentId,
  };
}

function parseMaterializeRpcResult(data: unknown): MaterializeRpcResult | MaterializeRpcError {
  const record = (data ?? {}) as Record<string, unknown>;
  if (record.ok === false) {
    return { ok: false, code: readString(record.code, "materialize_failed") };
  }
  if (record.ok !== true) {
    return { ok: false, code: "invalid_rpc_response" };
  }

  const parent = (record.parent ?? {}) as Record<string, unknown>;
  const intentRaw = record.intent;
  const intent = intentRaw && typeof intentRaw === "object"
    ? {
        id: readString((intentRaw as Record<string, unknown>).id),
        created: (intentRaw as Record<string, unknown>).created === true,
        status: readString((intentRaw as Record<string, unknown>).status, "pending"),
        idempotencyKey: readString((intentRaw as Record<string, unknown>).idempotency_key),
      }
    : null;

  return {
    ok: true,
    parent: {
      id: readString(parent.id),
      kind: readString(parent.kind) === "sequence" ? "sequence" : "lifecycle_episode",
      created: parent.created === true,
    },
    intent,
  };
}

/** Internal-only RPC caller. Must not be wired to HTTP routes, cron, scheduler, webhook, or BotApp. */
export async function materializeClientEmailOutboxCandidateInternal(
  supabase: ClientEmailSupabase,
  command: MaterializeCandidateCommand,
): Promise<MaterializeRpcResult | MaterializeRpcError> {
  if (isIntentMaterializeOperation(command.operation) && command.businessIdentity) {
    if (command.intentSnapshot?.category !== command.category) {
      return { ok: false, code: "category_parent_mismatch" };
    }
  }

  const payload = projectMaterializeRpcPayload(command);
  const { data, error } = await supabase.rpc(MATERIALIZE_CLIENT_EMAIL_OUTBOX_RPC, payload);
  if (error) {
    const message = readErrorMessage(error);
    if (message.includes(CLIENT_EMAIL_IDEMPOTENCY_IDENTITY_CONFLICT)) {
      return { ok: false, code: CLIENT_EMAIL_IDEMPOTENCY_IDENTITY_CONFLICT };
    }
    throw new Error(message);
  }
  return parseMaterializeRpcResult(data);
}
