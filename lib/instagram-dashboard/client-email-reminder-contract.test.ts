import assert from "node:assert/strict";
import test from "node:test";
import {
  canScheduleNeedsMoreTargetsReminder,
  evaluateNeedsMoreTargetsEmailStop,
  isValidClientEmailReminderIndex,
  maxNeedsMoreTargetsEmailSends,
  NEEDS_MORE_TARGETS_REMINDER_SCHEDULE,
  reminderOffsetHoursForIndex,
} from "./client-email-reminder-contract.ts";

test("reminder_index valid from 0 to 5 only", () => {
  assert.equal(isValidClientEmailReminderIndex(0), true);
  assert.equal(isValidClientEmailReminderIndex(5), true);
  assert.equal(isValidClientEmailReminderIndex(6), false);
  assert.equal(isValidClientEmailReminderIndex(-1), false);
});

test("six sends maximum are planned with locked offsets", () => {
  assert.equal(maxNeedsMoreTargetsEmailSends(), 6);
  assert.equal(NEEDS_MORE_TARGETS_REMINDER_SCHEDULE.length, 6);
  assert.equal(reminderOffsetHoursForIndex(0), 0);
  assert.equal(reminderOffsetHoursForIndex(1), 48);
  assert.equal(reminderOffsetHoursForIndex(5), 21 * 24);
});

test("stop when eligible targets exceed threshold", () => {
  assert.equal(
    evaluateNeedsMoreTargetsEmailStop({
      eligibleTargetCount: 6,
      accountCanceled: false,
      needsMoreSignalActive: true,
    }),
    "eligible_targets_above_threshold",
  );
});

test("stop when account canceled or signal resolved", () => {
  assert.equal(
    evaluateNeedsMoreTargetsEmailStop({
      eligibleTargetCount: 2,
      accountCanceled: true,
      needsMoreSignalActive: true,
    }),
    "account_canceled",
  );
  assert.equal(
    evaluateNeedsMoreTargetsEmailStop({
      eligibleTargetCount: 2,
      accountCanceled: false,
      needsMoreSignalActive: false,
    }),
    "needs_more_signal_resolved",
  );
});

test("no active send logic schedules reminders when stop rules hit", () => {
  assert.equal(
    canScheduleNeedsMoreTargetsReminder({
      reminderIndex: 2,
      eligibleTargetCount: 6,
      accountCanceled: false,
      needsMoreSignalActive: true,
    }),
    false,
  );
  assert.equal(
    canScheduleNeedsMoreTargetsReminder({
      reminderIndex: 2,
      eligibleTargetCount: 4,
      accountCanceled: false,
      needsMoreSignalActive: true,
    }),
    true,
  );
});
