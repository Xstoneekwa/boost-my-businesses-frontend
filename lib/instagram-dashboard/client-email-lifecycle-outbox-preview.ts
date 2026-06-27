import {
  CLIENT_EMAIL_CATEGORY_LABELS,
  CLIENT_EMAIL_SEND_TRIGGER_LABELS,
  type ClientEmailTemplateCategory,
} from "./client-email-constants.ts";
import type { ClientEmailLifecycleReadinessStatus } from "./client-email-lifecycle-readiness.ts";
import { loadClientEmailLifecycleReadiness } from "./client-email-lifecycle-readiness.ts";
import {
  buildClientEmailLifecycleOutboxPlan,
  type ClientEmailLifecycleOutboxPlan,
  type ClientEmailOutboxDecision,
  type ClientEmailOutboxPlanRow,
} from "./client-email-lifecycle-outbox-plan.ts";
import {
  countSuppressedCategoriesByAccount,
  selectEffectiveOutboxCandidates,
  type OutboxEffectiveCandidateRow,
} from "./client-email-lifecycle-outbox-precedence.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

export type ClientEmailOutboxPreviewDeliveryState =
  | "theoretical_dispatch_ready"
  | "episode_only"
  | "blocked_legacy_pre_watermark"
  | "blocked_missing_client_email"
  | "blocked_template_unavailable"
  | "blocked_delivery_gate"
  | "blocked_account_canceled"
  | "suppressed_by_precedence"
  | "no_action";

export type ClientEmailOutboxPreviewGateState =
  | "gates_closed"
  | "gates_open"
  | "not_applicable";

export type ClientEmailOutboxPreviewWatermarkState =
  | "watermark_missing"
  | "watermark_satisfied"
  | "not_applicable";

export type ClientEmailOutboxPreviewItem = {
  instagramUsername: string | null;
  clientLabel: string | null;
  clientEmailMasked: string | null;
  category: ClientEmailTemplateCategory;
  categoryLabel: string;
  parentType: "sequence" | "lifecycle_episode" | null;
  parentLabel: string;
  trigger: string | null;
  triggerLabel: string | null;
  reminderIndex: number | null;
  lifecycleDecision: ClientEmailOutboxDecision;
  lifecycleDecisionLabel: string;
  deliveryState: ClientEmailOutboxPreviewDeliveryState;
  deliveryStateLabel: string;
  gateState: ClientEmailOutboxPreviewGateState;
  gateStateLabel: string;
  watermarkState: ClientEmailOutboxPreviewWatermarkState;
  watermarkStateLabel: string;
  templateConfigured: boolean;
  templateVersion: number | null;
  senderConfigured: boolean;
  supportEmailConfigured: boolean;
  dispatchEligible: boolean;
  suppressedSiblingCount: number;
  precedenceNote: string | null;
  reason: string;
};

export type ClientEmailOutboxPreviewSummary = {
  accountsAnalyzed: number;
  rawObservations: number;
  effectiveCandidates: number;
  suppressedByLifecyclePriority: number;
  plannedItems: number;
  wouldOpenEpisode: number;
  wouldCreateInitialIntent: number;
  wouldCreateReminderIntent: number;
  wouldCloseEpisode: number;
  wouldCancelEpisode: number;
  blockedLegacyPreWatermark: number;
  blockedMissingClientEmail: number;
  blockedTemplateUnavailable: number;
  blockedDeliveryGate: number;
  noAction: number;
  readyToDispatchTheoretical: number;
};

export type ClientEmailLifecycleOutboxPreview = {
  previewedAt: string;
  readOnly: true;
  mutationExecuted: false;
  accountsAnalyzed: number;
  readinessStatus: ClientEmailLifecycleReadinessStatus;
  readinessBlockingReasons: string[];
  summary: ClientEmailOutboxPreviewSummary;
  items: ClientEmailOutboxPreviewItem[];
};

const OUTBOX_DECISION_LABELS: Record<ClientEmailOutboxDecision, string> = {
  would_open_episode: "Would open episode",
  would_create_initial_intent: "Would create initial intent",
  would_create_reminder_intent: "Would create reminder intent",
  would_close_episode: "Would close episode",
  would_cancel_episode: "Would cancel episode",
  blocked_legacy_pre_watermark: "Blocked: legacy pre-watermark",
  blocked_missing_client_email: "Blocked: missing client email",
  blocked_template_unavailable: "Blocked: template unavailable",
  blocked_delivery_gate: "Blocked: delivery gate closed",
  no_action: "No action",
};

const DELIVERY_STATE_LABELS: Record<ClientEmailOutboxPreviewDeliveryState, string> = {
  theoretical_dispatch_ready: "Theoretically ready to dispatch",
  episode_only: "Episode lifecycle only",
  blocked_legacy_pre_watermark: "Blocked by missing watermark",
  blocked_missing_client_email: "Blocked: missing client email",
  blocked_template_unavailable: "Blocked: template unavailable",
  blocked_delivery_gate: "Blocked: delivery gate closed",
  blocked_account_canceled: "Blocked: account canceled",
  suppressed_by_precedence: "Suppressed by lifecycle priority",
  no_action: "No action",
};

export function formatOutboxPreviewDecision(decision: ClientEmailOutboxDecision) {
  return OUTBOX_DECISION_LABELS[decision];
}

export function formatOutboxPreviewDeliveryState(state: ClientEmailOutboxPreviewDeliveryState) {
  return DELIVERY_STATE_LABELS[state];
}

export function deriveOutboxPreviewDeliveryState(
  decision: ClientEmailOutboxDecision,
  dispatchEligible: boolean,
): ClientEmailOutboxPreviewDeliveryState {
  if (!dispatchEligible && (decision === "would_create_initial_intent" || decision === "would_create_reminder_intent")) {
    return "suppressed_by_precedence";
  }
  switch (decision) {
    case "would_create_initial_intent":
    case "would_create_reminder_intent":
      return "theoretical_dispatch_ready";
    case "would_open_episode":
    case "would_close_episode":
      return "episode_only";
    case "blocked_legacy_pre_watermark":
      return "blocked_legacy_pre_watermark";
    case "blocked_missing_client_email":
      return "blocked_missing_client_email";
    case "blocked_template_unavailable":
      return "blocked_template_unavailable";
    case "blocked_delivery_gate":
      return "blocked_delivery_gate";
    case "would_cancel_episode":
      return "blocked_account_canceled";
    default:
      return "no_action";
  }
}

export function deriveOutboxPreviewGateState(
  decision: ClientEmailOutboxDecision,
  dispatchEligible: boolean,
  plan: Pick<
    ClientEmailLifecycleOutboxPlan,
    "globalSendingEnabled" | "lifecycleAutomationEnabled" | "needsMoreAutomationEnabled" | "providerDispatchAllowed"
  >,
) {
  if (decision === "blocked_delivery_gate") return "gates_closed" as const;
  if (!dispatchEligible) return "not_applicable" as const;
  if (
    decision === "would_create_initial_intent"
    || decision === "would_create_reminder_intent"
  ) {
    return plan.providerDispatchAllowed ? "gates_open" as const : "gates_closed" as const;
  }
  if (
    !plan.globalSendingEnabled
    && !plan.lifecycleAutomationEnabled
    && !plan.needsMoreAutomationEnabled
  ) {
    return "gates_closed" as const;
  }
  return "not_applicable" as const;
}

export function deriveOutboxPreviewWatermarkState(
  decision: ClientEmailOutboxDecision,
  category: ClientEmailTemplateCategory,
  dispatchEligible: boolean,
  plan: Pick<ClientEmailLifecycleOutboxPlan, "lifecycleWatermarkConfigured" | "needsMoreWatermarkConfigured">,
): ClientEmailOutboxPreviewWatermarkState {
  if (decision === "blocked_legacy_pre_watermark") return "watermark_missing";
  if (!dispatchEligible) return "not_applicable";
  if (decision === "no_action" || decision === "would_open_episode") return "not_applicable";
  if (category === "needs_more_target_accounts") {
    return plan.needsMoreWatermarkConfigured ? "watermark_satisfied" : "watermark_missing";
  }
  if (plan.lifecycleWatermarkConfigured) return "watermark_satisfied";
  return "watermark_missing";
}

export function formatOutboxPreviewGateState(state: ClientEmailOutboxPreviewGateState) {
  switch (state) {
    case "gates_closed":
      return "Gates closed";
    case "gates_open":
      return "Gates open";
    default:
      return "Not applicable";
  }
}

export function formatOutboxPreviewWatermarkState(state: ClientEmailOutboxPreviewWatermarkState) {
  switch (state) {
    case "watermark_missing":
      return "Watermark not configured";
    case "watermark_satisfied":
      return "Post-watermark eligible";
    default:
      return "Not applicable";
  }
}

export function formatOutboxPreviewParentLabel(parentType: ClientEmailOutboxPreviewItem["parentType"]) {
  if (parentType === "sequence") return "Sequence";
  if (parentType === "lifecycle_episode") return "Lifecycle episode";
  return "—";
}

export function shouldIncludeOutboxPreviewRow(row: ClientEmailOutboxPlanRow) {
  if (row.decision !== "no_action") return true;
  if (row.reason === "active_episode_waiting_for_next_due_reminder") return false;
  if (row.category === "needs_more_target_accounts") return true;
  return /blocked|legacy|canceled|threshold|resolved|signal|watermark|gate|email|template|idempotency|eligible|account/i.test(row.reason);
}

export function summarizeOutboxPreviewRows(input: {
  rawObservations: ClientEmailOutboxPlanRow[];
  effectiveCandidates: OutboxEffectiveCandidateRow[];
  suppressedCount: number;
  accountsAnalyzed: number;
}): ClientEmailOutboxPreviewSummary {
  const count = (decision: ClientEmailOutboxDecision, rows: ClientEmailOutboxPlanRow[]) =>
    rows.filter((row) => row.decision === decision).length;

  const effective = input.effectiveCandidates;

  return {
    accountsAnalyzed: input.accountsAnalyzed,
    rawObservations: input.rawObservations.length,
    effectiveCandidates: effective.length,
    suppressedByLifecyclePriority: input.suppressedCount,
    plannedItems: effective.length,
    wouldOpenEpisode: count("would_open_episode", effective),
    wouldCreateInitialIntent: count("would_create_initial_intent", effective),
    wouldCreateReminderIntent: count("would_create_reminder_intent", effective),
    wouldCloseEpisode: count("would_close_episode", effective),
    wouldCancelEpisode: count("would_cancel_episode", effective),
    blockedLegacyPreWatermark: count("blocked_legacy_pre_watermark", effective),
    blockedMissingClientEmail: count("blocked_missing_client_email", effective),
    blockedTemplateUnavailable: count("blocked_template_unavailable", effective),
    blockedDeliveryGate: count("blocked_delivery_gate", effective),
    noAction: count("no_action", effective),
    readyToDispatchTheoretical: effective.filter((row) => row.dispatchEligible).length,
  };
}

export function projectOutboxPreviewItem(
  row: OutboxEffectiveCandidateRow,
  plan: ClientEmailLifecycleOutboxPlan,
  input: { suppressedSiblingCount: number },
): ClientEmailOutboxPreviewItem {
  const deliveryState = deriveOutboxPreviewDeliveryState(row.decision, row.dispatchEligible);
  const gateState = deriveOutboxPreviewGateState(row.decision, row.dispatchEligible, plan);
  const watermarkState = deriveOutboxPreviewWatermarkState(
    row.decision,
    row.category,
    row.dispatchEligible,
    plan,
  );

  return {
    instagramUsername: row.instagramUsername,
    clientLabel: row.clientLabel,
    clientEmailMasked: row.clientEmailMasked,
    category: row.category,
    categoryLabel: CLIENT_EMAIL_CATEGORY_LABELS[row.category],
    parentType: row.parentType,
    parentLabel: formatOutboxPreviewParentLabel(row.parentType),
    trigger: row.trigger,
    triggerLabel: row.trigger ? CLIENT_EMAIL_SEND_TRIGGER_LABELS[row.trigger] : null,
    reminderIndex: row.reminderIndex,
    lifecycleDecision: row.decision,
    lifecycleDecisionLabel: formatOutboxPreviewDecision(row.decision),
    deliveryState,
    deliveryStateLabel: formatOutboxPreviewDeliveryState(deliveryState),
    gateState,
    gateStateLabel: formatOutboxPreviewGateState(gateState),
    watermarkState,
    watermarkStateLabel: formatOutboxPreviewWatermarkState(watermarkState),
    templateConfigured: Boolean(row.activeTemplateId && row.activeTemplateVersion),
    templateVersion: row.activeTemplateVersion,
    senderConfigured: Boolean(row.fromEmailSnapshot),
    supportEmailConfigured: Boolean(row.supportEmailSnapshot),
    dispatchEligible: row.dispatchEligible,
    suppressedSiblingCount: input.suppressedSiblingCount,
    precedenceNote: input.suppressedSiblingCount > 0
      ? "Other lifecycle communication suppressed by account status"
      : null,
    reason: row.reason,
  };
}

export function projectClientEmailLifecycleOutboxPreview(input: {
  plan: ClientEmailLifecycleOutboxPlan;
  readinessStatus: ClientEmailLifecycleReadinessStatus;
  readinessBlockingReasons: string[];
}): ClientEmailLifecycleOutboxPreview {
  const rawObservations = input.plan.rows.filter(shouldIncludeOutboxPreviewRow);
  const selection = selectEffectiveOutboxCandidates(rawObservations);
  const suppressedByAccount = countSuppressedCategoriesByAccount(selection);

  const items = selection.effectiveCandidates.map((row) => projectOutboxPreviewItem(row, input.plan, {
    suppressedSiblingCount: suppressedByAccount.get(row.accountId) ?? 0,
  }));

  return {
    previewedAt: input.plan.plannedAt,
    readOnly: true,
    mutationExecuted: false,
    accountsAnalyzed: input.plan.accountsAnalyzed,
    readinessStatus: input.readinessStatus,
    readinessBlockingReasons: input.readinessBlockingReasons,
    summary: summarizeOutboxPreviewRows({
      rawObservations,
      effectiveCandidates: selection.effectiveCandidates,
      suppressedCount: selection.suppressedCandidates.length,
      accountsAnalyzed: input.plan.accountsAnalyzed,
    }),
    items,
  };
}

export async function loadClientEmailLifecycleOutboxPreview(
  supabase: ClientEmailSupabase,
  input: { now?: Date; env?: Record<string, string | undefined> } = {},
): Promise<ClientEmailLifecycleOutboxPreview> {
  const env = input.env ?? process.env;
  const [plan, readiness] = await Promise.all([
    buildClientEmailLifecycleOutboxPlan(supabase, { now: input.now, env }),
    loadClientEmailLifecycleReadiness(supabase, env),
  ]);

  return projectClientEmailLifecycleOutboxPreview({
    plan,
    readinessStatus: readiness.finalReadinessStatus,
    readinessBlockingReasons: readiness.blockingReasons,
  });
}
