import {
  CLIENT_EMAIL_NEEDS_MORE_FIRST_REMINDER_OFFSET_HOURS,
  CLIENT_EMAIL_PRODUCT_ACTIVE_NEEDS_MORE_REMINDER_INDEXES,
} from "./client-email-constants.ts";
import {
  evaluateNeedsMoreTargetsEmailStop,
  reminderOffsetHoursForIndex,
} from "./client-email-reminder-contract.ts";
import { NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD } from "./needs-more-target-accounts.ts";

export type NeedsMoreReminderDueReason =
  | "not_due_yet"
  | "due_for_first_reminder"
  | "resolved"
  | "missing_canonical_email"
  | "blocked_legacy_pre_watermark"
  | "suppressed_by_precedence"
  | "missing_needs_more_active_since"
  | "account_canceled"
  | "eligible_targets_above_threshold"
  | "needs_more_signal_inactive";

export type NeedsMoreReminderDueEvaluation = {
  due: boolean;
  reason: NeedsMoreReminderDueReason;
  dueAtIso: string | null;
  needsMoreActiveSince: string | null;
  reminderIndex: number | null;
};

export function computeNeedsMoreFirstReminderDueAt(needsMoreActiveSince: string): string | null {
  const startedAt = new Date(needsMoreActiveSince);
  if (Number.isNaN(startedAt.getTime())) return null;
  const offsetHours = reminderOffsetHoursForIndex(0);
  if (offsetHours == null) return null;
  return new Date(startedAt.getTime() + offsetHours * 60 * 60 * 1000).toISOString();
}

export function isNeedsMoreFirstReminderDue(input: {
  needsMoreActiveSince: string | null;
  now: Date;
}): boolean {
  if (!input.needsMoreActiveSince) return false;
  const dueAtIso = computeNeedsMoreFirstReminderDueAt(input.needsMoreActiveSince);
  if (!dueAtIso) return false;
  return new Date(dueAtIso).getTime() <= input.now.getTime();
}

export function evaluateNeedsMoreReminderDue(input: {
  needsMoreActiveSince: string | null;
  now: Date;
  eligibleTargetCount: number;
  needsMoreSignalActive: boolean;
  accountCanceled: boolean;
  clientEmailAvailable: boolean;
  legacyPreWatermark?: boolean;
  suppressedByPrecedence?: boolean;
}): NeedsMoreReminderDueEvaluation {
  const base = {
    needsMoreActiveSince: input.needsMoreActiveSince,
    reminderIndex: CLIENT_EMAIL_PRODUCT_ACTIVE_NEEDS_MORE_REMINDER_INDEXES[0] ?? 0,
  };

  if (input.accountCanceled) {
    return { ...base, due: false, reason: "account_canceled", dueAtIso: null, reminderIndex: null };
  }

  const stopReason = evaluateNeedsMoreTargetsEmailStop({
    eligibleTargetCount: input.eligibleTargetCount,
    accountCanceled: input.accountCanceled,
    needsMoreSignalActive: input.needsMoreSignalActive,
  });

  if (stopReason === "eligible_targets_above_threshold" || stopReason === "needs_more_signal_resolved") {
    return { ...base, due: false, reason: "resolved", dueAtIso: null, reminderIndex: null };
  }

  if (!input.needsMoreSignalActive) {
    return { ...base, due: false, reason: "needs_more_signal_inactive", dueAtIso: null, reminderIndex: null };
  }

  if (input.legacyPreWatermark) {
    return { ...base, due: false, reason: "blocked_legacy_pre_watermark", dueAtIso: null, reminderIndex: null };
  }

  if (input.suppressedByPrecedence) {
    return { ...base, due: false, reason: "suppressed_by_precedence", dueAtIso: null, reminderIndex: null };
  }

  if (!input.clientEmailAvailable) {
    return { ...base, due: false, reason: "missing_canonical_email", dueAtIso: null, reminderIndex: null };
  }

  if (!input.needsMoreActiveSince) {
    return { ...base, due: false, reason: "missing_needs_more_active_since", dueAtIso: null, reminderIndex: null };
  }

  const dueAtIso = computeNeedsMoreFirstReminderDueAt(input.needsMoreActiveSince);
  if (!dueAtIso) {
    return { ...base, due: false, reason: "missing_needs_more_active_since", dueAtIso: null, reminderIndex: null };
  }

  const due = new Date(dueAtIso).getTime() <= input.now.getTime();
  if (!due) {
    return {
      ...base,
      due: false,
      reason: "not_due_yet",
      dueAtIso,
      reminderIndex: null,
    };
  }

  if (input.eligibleTargetCount > NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD) {
    return { ...base, due: false, reason: "resolved", dueAtIso, reminderIndex: null };
  }

  return {
    ...base,
    due: true,
    reason: "due_for_first_reminder",
    dueAtIso,
    reminderIndex: CLIENT_EMAIL_PRODUCT_ACTIVE_NEEDS_MORE_REMINDER_INDEXES[0] ?? 0,
  };
}

export function needsMoreFirstReminderOffsetHours(): number {
  return CLIENT_EMAIL_NEEDS_MORE_FIRST_REMINDER_OFFSET_HOURS;
}
