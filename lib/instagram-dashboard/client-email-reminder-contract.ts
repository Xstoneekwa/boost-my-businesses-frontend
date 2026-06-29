import {
  CLIENT_EMAIL_MAX_REMINDER_INDEX,
  CLIENT_EMAIL_MAX_SENDS_PER_NEED,
  CLIENT_EMAIL_PRODUCT_ACTIVE_NEEDS_MORE_REMINDER_INDEXES,
  CLIENT_EMAIL_REMINDER_OFFSETS_HOURS,
} from "./client-email-constants.ts";
import { NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD } from "./needs-more-target-accounts.ts";

export function isValidClientEmailReminderIndex(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  return value >= 0 && value <= CLIENT_EMAIL_MAX_REMINDER_INDEX;
}

export function reminderOffsetHoursForIndex(reminderIndex: number): number | null {
  const row = CLIENT_EMAIL_REMINDER_OFFSETS_HOURS.find((entry) => entry.reminderIndex === reminderIndex);
  return row?.offsetHours ?? null;
}

export function scheduledForAfterInitial(now: Date, reminderIndex: number): Date | null {
  const offsetHours = reminderOffsetHoursForIndex(reminderIndex);
  if (offsetHours == null) return null;
  return new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
}

export type NeedsMoreTargetsEmailStopReason =
  | "eligible_targets_above_threshold"
  | "account_canceled"
  | "needs_more_signal_resolved"
  | null;

export function evaluateNeedsMoreTargetsEmailStop(input: {
  eligibleTargetCount: number;
  accountCanceled: boolean;
  needsMoreSignalActive: boolean;
}): NeedsMoreTargetsEmailStopReason {
  if (input.accountCanceled) return "account_canceled";
  if (!input.needsMoreSignalActive) return "needs_more_signal_resolved";
  if (input.eligibleTargetCount > NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD) {
    return "eligible_targets_above_threshold";
  }
  return null;
}

export function canScheduleNeedsMoreTargetsReminder(input: {
  reminderIndex: number;
  eligibleTargetCount: number;
  accountCanceled: boolean;
  needsMoreSignalActive: boolean;
}): boolean {
  if (!isValidClientEmailReminderIndex(input.reminderIndex)) return false;
  if (input.reminderIndex > CLIENT_EMAIL_MAX_REMINDER_INDEX) return false;
  return evaluateNeedsMoreTargetsEmailStop(input) === null;
}

export function maxNeedsMoreTargetsEmailSends(): number {
  return CLIENT_EMAIL_MAX_SENDS_PER_NEED;
}

export function maxProductActiveNeedsMoreEmailSends(): number {
  return CLIENT_EMAIL_PRODUCT_ACTIVE_NEEDS_MORE_REMINDER_INDEXES.length;
}

export function isProductActiveNeedsMoreReminderIndex(reminderIndex: number): boolean {
  return CLIENT_EMAIL_PRODUCT_ACTIVE_NEEDS_MORE_REMINDER_INDEXES.includes(
    reminderIndex as (typeof CLIENT_EMAIL_PRODUCT_ACTIVE_NEEDS_MORE_REMINDER_INDEXES)[number],
  );
}

export const NEEDS_MORE_TARGETS_REMINDER_SCHEDULE = CLIENT_EMAIL_REMINDER_OFFSETS_HOURS;
