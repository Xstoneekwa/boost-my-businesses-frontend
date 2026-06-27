import {
  CLIENT_EMAIL_CATEGORY_LABELS,
  CLIENT_EMAIL_TEMPLATE_CATEGORIES,
  type ClientEmailTemplateCategory,
} from "./client-email-constants.ts";
import { resolveClientCommunicationEmail } from "./client-communication-email.ts";
import { resolveTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";
import {
  evaluateClientEmailMaterializationExecutionGate,
} from "./client-email-materialization-execution-gate.ts";
import {
  executeSingleClientEmailMaterializationInternal,
  type MaterializationExecutorDecision,
} from "./client-email-materialization-executor.ts";
import { enrichEffectiveCandidateWithGateProjections } from "./client-email-lifecycle-outbox-gates.ts";
import {
  buildClientEmailLifecycleOutboxPlan,
} from "./client-email-lifecycle-outbox-plan.ts";
import { shouldIncludeOutboxPreviewRow } from "./client-email-lifecycle-outbox-preview.ts";
import {
  selectEffectiveOutboxCandidates,
  type OutboxEffectiveCandidateRow,
  type OutboxSuppressedCandidateRow,
} from "./client-email-lifecycle-outbox-precedence.ts";
import { isIntentMaterializeOperation } from "./client-email-outbox-materializer.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

export const MATERIALIZE_SINGLE_CONFIRMATION = "MATERIALIZE_SINGLE_PENDING_INTENT" as const;

export const MATERIALIZE_SINGLE_FORBIDDEN_BODY_FIELDS = [
  "clientId",
  "client_id",
  "accountId",
  "account_id",
  "parentId",
  "parent_id",
  "sequenceId",
  "sequence_id",
  "lifecycleEpisodeId",
  "lifecycle_episode_id",
  "idempotencyKey",
  "idempotency_key",
  "recipient",
  "recipientEmail",
  "recipient_email",
  "email",
  "contact_email",
  "notification_email",
  "primary_contact_email",
  "template",
  "templateId",
  "template_id",
  "templateVersion",
  "template_version",
  "fromEmail",
  "from_email",
  "supportEmail",
  "support_email",
  "fromEmailSnapshot",
  "from_email_snapshot",
  "supportEmailSnapshot",
  "support_email_snapshot",
  "operation",
  "sql",
  "status",
  "reminderIndex",
  "reminder_index",
  "provider",
  "providerMessageId",
  "provider_message_id",
  "body",
  "bodyText",
  "body_text",
  "subject",
  "snapshot",
  "snapshots",
] as const;

export type MaterializeSingleRequest = {
  instagramUsername: string;
  category: ClientEmailTemplateCategory;
  confirmation: typeof MATERIALIZE_SINGLE_CONFIRMATION;
};

export type MaterializeSingleErrorReason =
  | "materialize_execution_disabled"
  | "invalid_materialize_single_request"
  | "materialize_single_confirmation_required"
  | "materialize_single_candidate_not_found"
  | "materialize_single_candidate_not_effective"
  | "materialize_single_candidate_not_eligible"
  | "materialize_single_multiple_matches"
  | "materialize_single_revalidation_failed"
  | "materialize_single_materialize_failed";

export type MaterializeSingleSafeResponse = {
  ok: boolean;
  reason?: MaterializeSingleErrorReason | string;
  executionMode?: "disabled" | "single";
  readOnly: boolean;
  mutationExecuted: boolean;
  rpcInvoked: boolean;
  data?: Record<string, unknown>;
  revalidationCode?: string;
};

export function buildMaterializeSingleGateClosedResponse(): MaterializeSingleSafeResponse {
  return {
    ok: false,
    reason: "materialize_execution_disabled",
    executionMode: "disabled",
    readOnly: true,
    mutationExecuted: false,
    rpcInvoked: false,
  };
}

function normalizeInstagramUsername(value: string) {
  return value.trim().toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseMaterializeSingleRequestBody(body: unknown):
  | { ok: true; request: MaterializeSingleRequest }
  | { ok: false; reason: MaterializeSingleErrorReason } {
  if (!isPlainObject(body)) {
    return { ok: false, reason: "invalid_materialize_single_request" };
  }

  for (const field of MATERIALIZE_SINGLE_FORBIDDEN_BODY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      return { ok: false, reason: "invalid_materialize_single_request" };
    }
  }

  const allowedKeys = new Set(["instagramUsername", "category", "confirmation"]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, reason: "invalid_materialize_single_request" };
    }
  }

  const instagramUsername = typeof body.instagramUsername === "string" ? body.instagramUsername.trim() : "";
  const categoryRaw = typeof body.category === "string" ? body.category.trim() : "";
  const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";

  if (!instagramUsername || !categoryRaw) {
    return { ok: false, reason: "invalid_materialize_single_request" };
  }

  if (!confirmation) {
    return { ok: false, reason: "materialize_single_confirmation_required" };
  }

  if (confirmation !== MATERIALIZE_SINGLE_CONFIRMATION) {
    return { ok: false, reason: "materialize_single_confirmation_required" };
  }

  if (!CLIENT_EMAIL_TEMPLATE_CATEGORIES.includes(categoryRaw as ClientEmailTemplateCategory)) {
    return { ok: false, reason: "invalid_materialize_single_request" };
  }

  return {
    ok: true,
    request: {
      instagramUsername,
      category: categoryRaw as ClientEmailTemplateCategory,
      confirmation: MATERIALIZE_SINGLE_CONFIRMATION,
    },
  };
}

export function findMaterializeSingleEffectiveCandidate(input: {
  effectiveCandidates: OutboxEffectiveCandidateRow[];
  suppressedCandidates: OutboxSuppressedCandidateRow[];
  instagramUsername: string;
  category: ClientEmailTemplateCategory;
}):
  | { ok: true; candidate: OutboxEffectiveCandidateRow }
  | { ok: false; reason: MaterializeSingleErrorReason } {
  const normalizedUsername = normalizeInstagramUsername(input.instagramUsername);

  const matches = input.effectiveCandidates.filter((candidate) =>
    candidate.isEffectiveCandidate === true
    && candidate.category === input.category
    && normalizeInstagramUsername(candidate.instagramUsername ?? "") === normalizedUsername,
  );

  if (matches.length > 1) {
    return { ok: false, reason: "materialize_single_multiple_matches" };
  }

  if (matches.length === 1) {
    const candidate = matches[0];
    if (candidate.decision === "blocked_legacy_pre_watermark") {
      return { ok: false, reason: "materialize_single_candidate_not_eligible" };
    }
    if (candidate.decision === "would_open_episode") {
      return { ok: false, reason: "materialize_single_revalidation_failed" };
    }
    if (candidate.materializationEligible !== true) {
      return { ok: false, reason: "materialize_single_candidate_not_eligible" };
    }
    if (
      candidate.decision !== "would_create_initial_intent"
      && candidate.decision !== "would_create_reminder_intent"
    ) {
      return { ok: false, reason: "materialize_single_candidate_not_eligible" };
    }
    return { ok: true, candidate };
  }

  const suppressedMatches = input.suppressedCandidates.filter((candidate) =>
    candidate.category === input.category
    && normalizeInstagramUsername(candidate.instagramUsername ?? "") === normalizedUsername,
  );
  if (suppressedMatches.length > 0) {
    return { ok: false, reason: "materialize_single_candidate_not_effective" };
  }

  return { ok: false, reason: "materialize_single_candidate_not_found" };
}

function formatParentLabel(parentType: OutboxEffectiveCandidateRow["parentType"]) {
  if (parentType === "sequence") return "Needs-more sequence";
  if (parentType === "lifecycle_episode") return "Lifecycle episode";
  return "—";
}

export function projectMaterializeSingleSuccessResponse(input: {
  request: MaterializeSingleRequest;
  candidate: OutboxEffectiveCandidateRow;
  decision: Extract<MaterializationExecutorDecision, { status: "materialized" }>;
}): MaterializeSingleSafeResponse {
  return {
    ok: true,
    executionMode: "single",
    readOnly: false,
    mutationExecuted: true,
    rpcInvoked: true,
    data: {
      instagramUsername: input.request.instagramUsername,
      category: input.request.category,
      categoryLabel: CLIENT_EMAIL_CATEGORY_LABELS[input.request.category],
      operation: input.decision.operation,
      intentStatus: input.decision.result.intent?.status ?? "pending",
      parentCreated: input.decision.result.parent.created,
      intentCreated: input.decision.result.intent?.created ?? false,
      parentType: input.candidate.parentType,
      parentLabel: formatParentLabel(input.candidate.parentType),
      clientLabel: input.candidate.clientLabel,
      clientEmailMasked: input.candidate.clientEmailMasked,
      trigger: input.candidate.trigger,
      reminderIndex: input.candidate.reminderIndex,
      lifecycleDecision: input.candidate.decision,
    },
  };
}

export function projectMaterializeSingleErrorResponse(input: {
  reason: MaterializeSingleErrorReason;
  revalidationCode?: string;
}): MaterializeSingleSafeResponse {
  return {
    ok: false,
    reason: input.reason,
    executionMode: "single",
    readOnly: true,
    mutationExecuted: false,
    rpcInvoked: false,
    ...(input.revalidationCode ? { revalidationCode: input.revalidationCode } : {}),
  };
}

export function materializeSingleErrorStatus(reason: MaterializeSingleErrorReason): number {
  if (reason === "materialize_execution_disabled") return 409;
  if (reason === "invalid_materialize_single_request") return 400;
  if (reason === "materialize_single_confirmation_required") return 400;
  if (reason === "materialize_single_candidate_not_found") return 404;
  if (reason === "materialize_single_revalidation_failed") return 422;
  if (reason === "materialize_single_materialize_failed") return 422;
  return 409;
}

async function loadRecipientEmailForClient(
  supabase: ClientEmailSupabase,
  clientId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("metadata,name")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error("Could not resolve canonical client communication email.");
  const resolved = resolveClientCommunicationEmail({
    client: (data as Record<string, unknown> | null) ?? null,
    workspaceAuthEmail: null,
  });
  return resolved.ok ? resolved.email : null;
}

export type ExecuteMaterializeSingleRequestInput = {
  supabase: ClientEmailSupabase;
  body: unknown;
  env?: Record<string, string | undefined>;
  now?: Date;
  executeInternal?: typeof executeSingleClientEmailMaterializationInternal;
  loadPlan?: typeof buildClientEmailLifecycleOutboxPlan;
  loadDeliverySettings?: typeof resolveTransactionalDeliverySettings;
  loadRecipientEmail?: (supabase: ClientEmailSupabase, clientId: string) => Promise<string | null>;
};

export async function executeMaterializeSingleRequest(
  input: ExecuteMaterializeSingleRequestInput,
): Promise<{ status: number; body: MaterializeSingleSafeResponse }> {
  const env = input.env ?? process.env;
  const executionGate = evaluateClientEmailMaterializationExecutionGate(env);
  if (!executionGate.enabled) {
    return {
      status: 409,
      body: buildMaterializeSingleGateClosedResponse(),
    };
  }

  const parsed = parseMaterializeSingleRequestBody(input.body);
  if (!parsed.ok) {
    return {
      status: materializeSingleErrorStatus(parsed.reason),
      body: projectMaterializeSingleErrorResponse({ reason: parsed.reason }),
    };
  }

  const loadPlan = input.loadPlan ?? buildClientEmailLifecycleOutboxPlan;
  const loadDeliverySettings = input.loadDeliverySettings ?? resolveTransactionalDeliverySettings;
  const loadRecipientEmail = input.loadRecipientEmail ?? loadRecipientEmailForClient;

  const [plan, deliverySettings] = await Promise.all([
    loadPlan(input.supabase, { now: input.now, env }),
    loadDeliverySettings(input.supabase),
  ]);

  const rawObservations = plan.rows.filter(shouldIncludeOutboxPreviewRow);
  const selection = selectEffectiveOutboxCandidates(rawObservations);
  const effectiveCandidates = selection.effectiveCandidates.map((row) =>
    enrichEffectiveCandidateWithGateProjections(row, plan, env),
  );

  const candidateLookup = findMaterializeSingleEffectiveCandidate({
    effectiveCandidates,
    suppressedCandidates: selection.suppressedCandidates,
    instagramUsername: parsed.request.instagramUsername,
    category: parsed.request.category,
  });
  if (!candidateLookup.ok) {
    return {
      status: materializeSingleErrorStatus(candidateLookup.reason),
      body: projectMaterializeSingleErrorResponse({ reason: candidateLookup.reason }),
    };
  }

  const candidate = candidateLookup.candidate;
  const recipientEmail = await loadRecipientEmail(input.supabase, candidate.clientId);
  const template = candidate.activeTemplateId
    ? {
      id: candidate.activeTemplateId,
      category: candidate.category,
      version: candidate.activeTemplateVersion ?? 0,
      subject: candidate.futureIntentSnapshot?.snapshotSubject ?? "",
      bodyText: candidate.futureIntentSnapshot?.snapshotBodyText ?? "",
    }
    : undefined;

  const executeInternal = input.executeInternal ?? executeSingleClientEmailMaterializationInternal;
  const decision = await executeInternal({
    supabase: input.supabase,
    candidate,
    recipientEmail,
    deliverySettings,
    template,
    env,
  });

  if (decision.status === "execution_disabled") {
    return {
      status: 409,
      body: buildMaterializeSingleGateClosedResponse(),
    };
  }

  if (decision.status === "revalidation_failed") {
    return {
      status: 422,
      body: projectMaterializeSingleErrorResponse({
        reason: "materialize_single_revalidation_failed",
        revalidationCode: decision.code,
      }),
    };
  }

  if (decision.status === "materialize_failed") {
    return {
      status: 422,
      body: projectMaterializeSingleErrorResponse({
        reason: "materialize_single_materialize_failed",
        revalidationCode: decision.code,
      }),
    };
  }

  if (!isIntentMaterializeOperation(decision.operation)) {
    return {
      status: 422,
      body: projectMaterializeSingleErrorResponse({
        reason: "materialize_single_revalidation_failed",
        revalidationCode: "invalid_operation",
      }),
    };
  }

  return {
    status: 200,
    body: projectMaterializeSingleSuccessResponse({
      request: parsed.request,
      candidate,
      decision,
    }),
  };
}
