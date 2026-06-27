import type { ClientEmailTemplateCategory } from "./client-email-constants.ts";
import type { ClientEmailOutboxDecision, ClientEmailOutboxPlanRow } from "./client-email-lifecycle-outbox-plan.ts";

export const OUTBOX_CATEGORY_PRECEDENCE: readonly ClientEmailTemplateCategory[] = [
  "account_canceled",
  "account_paused",
  "needs_assistance",
  "needs_more_target_accounts",
] as const;

export type OutboxPrecedenceSelection = {
  rawObservations: ClientEmailOutboxPlanRow[];
  effectiveCandidates: OutboxEffectiveCandidateRow[];
  suppressedCandidates: OutboxSuppressedCandidateRow[];
};

export type OutboxEffectiveCandidateRow = ClientEmailOutboxPlanRow & {
  dispatchEligible: boolean;
  suppressedByCategory: null;
  suppressionReason: null;
  isEffectiveCandidate: true;
};

export type OutboxSuppressedCandidateRow = ClientEmailOutboxPlanRow & {
  dispatchEligible: false;
  suppressedByCategory: ClientEmailTemplateCategory;
  suppressionReason: string;
  isEffectiveCandidate: false;
};

const DISPATCH_ELIGIBLE_DECISIONS = new Set<ClientEmailOutboxDecision>([
  "would_create_initial_intent",
  "would_create_reminder_intent",
]);

const EFFECTIVE_DECISION_RANK: Record<ClientEmailOutboxDecision, number> = {
  would_create_reminder_intent: 0,
  would_create_initial_intent: 1,
  would_open_episode: 2,
  would_close_episode: 3,
  would_cancel_episode: 4,
  blocked_legacy_pre_watermark: 5,
  blocked_missing_client_email: 6,
  blocked_template_unavailable: 7,
  blocked_delivery_gate: 8,
  no_action: 9,
};

export function outboxCategoryPrecedenceRank(category: ClientEmailTemplateCategory) {
  const index = OUTBOX_CATEGORY_PRECEDENCE.indexOf(category);
  return index >= 0 ? index : OUTBOX_CATEGORY_PRECEDENCE.length;
}

export function formatSuppressionReason(
  suppressedCategory: ClientEmailTemplateCategory,
  winningCategory: ClientEmailTemplateCategory,
) {
  const winningLabel = winningCategory.replaceAll("_", " ");
  const suppressedLabel = suppressedCategory.replaceAll("_", " ");
  return `${suppressedLabel} was suppressed because ${winningLabel} takes precedence for this account in the combined outbox.`;
}

export function isDispatchEligibleDecision(decision: ClientEmailOutboxDecision) {
  return DISPATCH_ELIGIBLE_DECISIONS.has(decision);
}

export function resolveWinningCategoryForAccount(rows: ClientEmailOutboxPlanRow[]) {
  const categories = [...new Set(rows.map((row) => row.category))];
  if (categories.length === 0) return null;
  return categories.sort(
    (left, right) => outboxCategoryPrecedenceRank(left) - outboxCategoryPrecedenceRank(right),
  )[0] ?? null;
}

function effectiveRowKey(row: ClientEmailOutboxPlanRow) {
  return [
    row.category,
    row.parentKey ?? "",
    row.decision,
    row.trigger ?? "",
    String(row.reminderIndex ?? ""),
  ].join("|");
}

export function pickSingleEffectiveRowForCategory(rows: ClientEmailOutboxPlanRow[]) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((left, right) => {
    const rankCompare = EFFECTIVE_DECISION_RANK[left.decision] - EFFECTIVE_DECISION_RANK[right.decision];
    if (rankCompare !== 0) return rankCompare;
    return effectiveRowKey(left).localeCompare(effectiveRowKey(right));
  });

  const seen = new Set<string>();
  for (const row of sorted) {
    const key = effectiveRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    return row;
  }
  return sorted[0] ?? null;
}

export function selectEffectiveOutboxCandidates(
  rawObservations: ClientEmailOutboxPlanRow[],
): OutboxPrecedenceSelection {
  const byAccount = new Map<string, ClientEmailOutboxPlanRow[]>();
  for (const row of rawObservations) {
    const bucket = byAccount.get(row.accountId) ?? [];
    bucket.push(row);
    byAccount.set(row.accountId, bucket);
  }

  const effectiveCandidates: OutboxEffectiveCandidateRow[] = [];
  const suppressedCandidates: OutboxSuppressedCandidateRow[] = [];

  for (const rows of byAccount.values()) {
    const winningCategory = resolveWinningCategoryForAccount(rows);
    if (!winningCategory) continue;

    const winningRows = rows.filter((row) => row.category === winningCategory);
    const suppressedRows = rows.filter((row) => row.category !== winningCategory);

    for (const row of suppressedRows) {
      suppressedCandidates.push({
        ...row,
        idempotencyKey: null,
        futureIntentSnapshot: null,
        dispatchEligible: false,
        suppressedByCategory: winningCategory,
        suppressionReason: formatSuppressionReason(row.category, winningCategory),
        isEffectiveCandidate: false,
      });
    }

    const effectiveRow = pickSingleEffectiveRowForCategory(winningRows);
    if (!effectiveRow) continue;

    effectiveCandidates.push({
      ...effectiveRow,
      dispatchEligible: isDispatchEligibleDecision(effectiveRow.decision),
      suppressedByCategory: null,
      suppressionReason: null,
      isEffectiveCandidate: true,
    });
  }

  return {
    rawObservations,
    effectiveCandidates,
    suppressedCandidates,
  };
}

export function countSuppressedCategoriesByAccount(
  selection: OutboxPrecedenceSelection,
) {
  const counts = new Map<string, number>();
  for (const row of selection.suppressedCandidates) {
    counts.set(row.accountId, (counts.get(row.accountId) ?? 0) + 1);
  }
  return counts;
}
