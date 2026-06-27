import {
  CLIENT_EMAIL_CATEGORY_LABELS,
  CLIENT_EMAIL_SEND_TRIGGER_LABELS,
  type ClientEmailSendTrigger,
  type ClientEmailTemplateCategory,
} from "./client-email-constants.ts";
import {
  loadClientEmailLifecycleReadiness,
  type ClientEmailLifecycleReadinessStatus,
} from "./client-email-lifecycle-readiness.ts";
import {
  buildClientEmailLifecycleOutboxPlan,
  type ClientEmailOutboxDecision,
  type ClientEmailLifecycleOutboxPlan,
} from "./client-email-lifecycle-outbox-plan.ts";
import type { OutboxLayerReadinessStatus } from "./client-email-lifecycle-outbox-gates.ts";
import { enrichEffectiveCandidateWithGateProjections } from "./client-email-lifecycle-outbox-gates.ts";
import {
  shouldIncludeOutboxPreviewRow,
} from "./client-email-lifecycle-outbox-preview.ts";
import {
  selectEffectiveOutboxCandidates,
  type OutboxEffectiveCandidateRow,
  type OutboxSuppressedCandidateRow,
} from "./client-email-lifecycle-outbox-precedence.ts";
import {
  resolveStrictMaterializeOperation,
  type MaterializeOutboxOperation,
  validateMaterializeEffectiveCandidate,
} from "./client-email-outbox-materializer.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

export type MaterializationRunPlanItemStatus = "would_materialize" | "skipped";

export type MaterializationRunPlanItem = {
  status: MaterializationRunPlanItemStatus;
  eligible: boolean;
  operation: MaterializeOutboxOperation | null;
  parentType: "sequence" | "lifecycle_episode" | null;
  parentLabel: string;
  category: ClientEmailTemplateCategory;
  categoryLabel: string;
  trigger: ClientEmailSendTrigger | null;
  triggerLabel: string | null;
  reminderIndex: number | null;
  lifecycleDecision: ClientEmailOutboxDecision;
  materializationReadinessStatus: OutboxLayerReadinessStatus;
  materializationGateState: OutboxEffectiveCandidateRow["materializationGateState"];
  skipReason: string | null;
  skipCode: string | null;
  precedenceNote: string | null;
  instagramUsername: string | null;
  clientLabel: string | null;
  clientEmailMasked: string | null;
  reason: string;
};

export type MaterializationRunPlanSummary = {
  inputEffectiveCandidates: number;
  wouldMaterialize: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  skippedByCategory: Partial<Record<ClientEmailTemplateCategory, number>>;
};

export type MaterializationRunPlan = {
  items: MaterializationRunPlanItem[];
  summary: MaterializationRunPlanSummary;
};

export type MaterializationShadowOperationSummary = {
  open_lifecycle_episode: number;
  create_lifecycle_initial_intent: number;
  open_needs_more_sequence: number;
  create_needs_more_initial_intent: number;
  create_needs_more_reminder_intent: number;
};

export type ClientEmailMaterializationShadowRun = {
  plannedAt: string;
  executionMode: "shadow";
  readOnly: true;
  mutationExecuted: false;
  rpcInvoked: false;
  accountsAnalyzed: number;
  rawObservations: number;
  effectiveCandidates: number;
  suppressedByPrecedence: number;
  wouldMaterialize: number;
  skipped: number;
  readinessStatus: ClientEmailLifecycleReadinessStatus;
  materializationReadinessStatus: OutboxLayerReadinessStatus;
  dispatchReadinessStatus: OutboxLayerReadinessStatus;
  materializationBlockingReasons: string[];
  dispatchBlockingReasons: string[];
  summary: MaterializationRunPlanSummary;
  skippedByCategory: Partial<Record<ClientEmailTemplateCategory, number>>;
  operationSummary: MaterializationShadowOperationSummary;
  items: MaterializationRunPlanItem[];
};

function formatParentLabel(parentType: MaterializationRunPlanItem["parentType"]) {
  if (parentType === "sequence") return "Needs-more sequence";
  if (parentType === "lifecycle_episode") return "Lifecycle episode";
  return "—";
}

function inferShadowRecipientEmail(candidate: OutboxEffectiveCandidateRow): string | null {
  if (candidate.decision === "blocked_missing_client_email") return null;
  if (candidate.decision === "would_open_episode") return null;
  if (
    candidate.decision === "would_create_initial_intent"
    || candidate.decision === "would_create_reminder_intent"
  ) {
    return "client@example.com";
  }
  return null;
}

function recordSkip(
  skippedByReason: Record<string, number>,
  skippedByCategory: Partial<Record<ClientEmailTemplateCategory, number>>,
  code: string,
  category: ClientEmailTemplateCategory,
) {
  skippedByReason[code] = (skippedByReason[code] ?? 0) + 1;
  skippedByCategory[category] = (skippedByCategory[category] ?? 0) + 1;
}

function projectSafeMaterializationRunItem(
  candidate: OutboxEffectiveCandidateRow,
  materializationReadinessStatus: OutboxLayerReadinessStatus,
): Omit<
  MaterializationRunPlanItem,
  "status" | "eligible" | "operation" | "skipReason" | "skipCode"
> {
  const parentType = candidate.parentType === "sequence" || candidate.parentType === "lifecycle_episode"
    ? candidate.parentType
    : null;

  return {
    parentType,
    parentLabel: formatParentLabel(parentType),
    category: candidate.category,
    categoryLabel: CLIENT_EMAIL_CATEGORY_LABELS[candidate.category],
    trigger: candidate.trigger,
    triggerLabel: candidate.trigger ? CLIENT_EMAIL_SEND_TRIGGER_LABELS[candidate.trigger] : null,
    reminderIndex: candidate.reminderIndex,
    lifecycleDecision: candidate.decision,
    materializationReadinessStatus,
    materializationGateState: candidate.materializationGateState,
    precedenceNote: null,
    instagramUsername: candidate.instagramUsername,
    clientLabel: candidate.clientLabel,
    clientEmailMasked: candidate.clientEmailMasked,
    reason: candidate.reason,
  };
}

/** Pure shadow plan from effective candidates only — no I/O, no RPC, no mutations. */
export function buildClientEmailMaterializationRunPlan(input: {
  effectiveCandidates: OutboxEffectiveCandidateRow[];
  env: Record<string, string | undefined>;
  materializationReadinessStatus: OutboxLayerReadinessStatus;
}): MaterializationRunPlan {
  const items: MaterializationRunPlanItem[] = [];
  const skippedByReason: Record<string, number> = {};
  const skippedByCategory: Partial<Record<ClientEmailTemplateCategory, number>> = {};
  let wouldMaterialize = 0;

  for (const candidate of input.effectiveCandidates) {
    if (candidate.isEffectiveCandidate !== true) {
      continue;
    }

    const base = projectSafeMaterializationRunItem(candidate, input.materializationReadinessStatus);

    if (!candidate.materializationEligible) {
      const skipCode = candidate.materializationBlockingReasons.some((reason) => /watermark/i.test(reason))
        ? "watermark_not_configured"
        : "materialize_gate_closed";
      recordSkip(skippedByReason, skippedByCategory, skipCode, candidate.category);
      items.push({
        ...base,
        status: "skipped",
        eligible: false,
        operation: null,
        skipReason: candidate.materializationBlockingReasons[0] ?? "Materialization gate closed.",
        skipCode,
      });
      continue;
    }

    const validation = validateMaterializeEffectiveCandidate({
      candidate,
      env: input.env,
      recipientEmail: inferShadowRecipientEmail(candidate),
    });
    if (!validation.valid) {
      recordSkip(skippedByReason, skippedByCategory, validation.code, candidate.category);
      items.push({
        ...base,
        status: "skipped",
        eligible: false,
        operation: null,
        skipReason: validation.reason,
        skipCode: validation.code,
      });
      continue;
    }

    const operation = resolveStrictMaterializeOperation({
      category: candidate.category,
      decision: candidate.decision,
      reminderIndex: candidate.reminderIndex,
      parentId: candidate.parentId,
    });
    if (!operation) {
      recordSkip(skippedByReason, skippedByCategory, "invalid_operation", candidate.category);
      items.push({
        ...base,
        status: "skipped",
        eligible: false,
        operation: null,
        skipReason: "unsupported_materialize_operation",
        skipCode: "invalid_operation",
      });
      continue;
    }

    wouldMaterialize += 1;
    items.push({
      ...base,
      status: "would_materialize",
      eligible: true,
      operation,
      skipReason: null,
      skipCode: null,
    });
  }

  const skipped = items.length - wouldMaterialize;

  return {
    items,
    summary: {
      inputEffectiveCandidates: input.effectiveCandidates.filter((row) => row.isEffectiveCandidate).length,
      wouldMaterialize,
      skipped,
      skippedByReason,
      skippedByCategory,
    },
  };
}

function buildShadowContext(plan: ClientEmailLifecycleOutboxPlan, env: Record<string, string | undefined>) {
  const rawObservations = plan.rows.filter(shouldIncludeOutboxPreviewRow);
  const selection = selectEffectiveOutboxCandidates(rawObservations);
  const effectiveCandidates = selection.effectiveCandidates.map((row) =>
    enrichEffectiveCandidateWithGateProjections(row, plan, env),
  );

  return {
    rawObservations,
    selection,
    effectiveCandidates,
  };
}

function summarizeShadowOperations(items: MaterializationRunPlanItem[]): MaterializationShadowOperationSummary {
  const summary: MaterializationShadowOperationSummary = {
    open_lifecycle_episode: 0,
    create_lifecycle_initial_intent: 0,
    open_needs_more_sequence: 0,
    create_needs_more_initial_intent: 0,
    create_needs_more_reminder_intent: 0,
  };

  for (const item of items) {
    if (item.status !== "would_materialize" || !item.operation) continue;
    summary[item.operation] += 1;
  }

  return summary;
}

/** Read-only shadow orchestrator — never invokes RPC or mutates Supabase. */
export async function planClientEmailMaterializationShadowRun(
  supabase: ClientEmailSupabase,
  input: { now?: Date; env?: Record<string, string | undefined> } = {},
): Promise<ClientEmailMaterializationShadowRun> {
  const env = input.env ?? process.env;
  const [plan, readiness] = await Promise.all([
    buildClientEmailLifecycleOutboxPlan(supabase, { now: input.now, env }),
    loadClientEmailLifecycleReadiness(supabase, env),
  ]);

  const { rawObservations, selection, effectiveCandidates } = buildShadowContext(plan, env);
  const runPlan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates,
    env,
    materializationReadinessStatus: readiness.materializationReadinessStatus,
  });

  return {
    plannedAt: plan.plannedAt,
    executionMode: "shadow",
    readOnly: true,
    mutationExecuted: false,
    rpcInvoked: false,
    accountsAnalyzed: plan.accountsAnalyzed,
    rawObservations: rawObservations.length,
    effectiveCandidates: effectiveCandidates.length,
    suppressedByPrecedence: selection.suppressedCandidates.length,
    wouldMaterialize: runPlan.summary.wouldMaterialize,
    skipped: runPlan.summary.skipped,
    readinessStatus: readiness.finalReadinessStatus,
    materializationReadinessStatus: readiness.materializationReadinessStatus,
    dispatchReadinessStatus: readiness.dispatchReadinessStatus,
    materializationBlockingReasons: readiness.materializationBlockingReasons,
    dispatchBlockingReasons: readiness.dispatchBlockingReasons,
    summary: runPlan.summary,
    skippedByCategory: runPlan.summary.skippedByCategory,
    operationSummary: summarizeShadowOperations(runPlan.items),
    items: runPlan.items,
  };
}

export type { OutboxSuppressedCandidateRow };
