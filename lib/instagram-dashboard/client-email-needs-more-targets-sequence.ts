import {
  CLIENT_EMAIL_MAX_REMINDER_INDEX,
  type ClientEmailNeedsMoreTargetsSequenceCloseReason,
  type ClientEmailNeedsMoreTargetsSequenceStatus,
} from "./client-email-constants.ts";
import {
  evaluateNeedsMoreTargetsEmailStop,
  isValidClientEmailReminderIndex,
  reminderOffsetHoursForIndex,
  scheduledForAfterInitial,
  type NeedsMoreTargetsEmailStopReason,
} from "./client-email-reminder-contract.ts";
import { NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD } from "./needs-more-target-accounts.ts";

export const CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE =
  "client_email_needs_more_targets_sequences" as const;

export type NeedsMoreTargetsSequenceRecord = {
  id: string;
  accountId: string;
  clientId: string;
  sourceActionId: string | null;
  status: ClientEmailNeedsMoreTargetsSequenceStatus;
  eligibleTargetCountAtStart: number;
  thresholdAtStart: number;
  startedAt: string;
  resolvedAt: string | null;
  canceledAt: string | null;
  closeReason: ClientEmailNeedsMoreTargetsSequenceCloseReason | null;
  nextReminderIndex: number;
  lastCompletedReminderIndex: number | null;
  episodeKey: string;
};

export type PlannedNeedsMoreTargetsSend = {
  reminderIndex: number;
  trigger: "automatic_initial" | "automatic_reminder";
  scheduledFor: string;
  idempotencyKey: string;
};

export type NeedsMoreTargetsEpisodePlanAction =
  | { type: "open_episode"; episodeKey: string; eligibleTargetCount: number; sourceActionId: string | null }
  | { type: "close_episode"; closeReason: ClientEmailNeedsMoreTargetsSequenceCloseReason }
  | { type: "plan_send"; send: PlannedNeedsMoreTargetsSend }
  | { type: "noop"; reason: string };

export type NeedsMoreTargetsEpisodePlan = {
  accountId: string;
  clientId: string;
  actions: NeedsMoreTargetsEpisodePlanAction[];
};

export function buildNeedsMoreTargetsEpisodeKey(accountId: string, startedAtIso: string) {
  return `needs_more_targets:${accountId}:${startedAtIso}`;
}

export function buildNeedsMoreTargetsIntentIdempotencyKey(input: {
  accountId: string;
  episodeId: string;
  reminderIndex: number;
}) {
  return `needs_more_targets:${input.accountId}:episode:${input.episodeId}:index:${input.reminderIndex}`;
}

export function shouldStartNeedsMoreTargetsEmailSequence(input: {
  eligibleTargetCount: number;
  needsMoreSignalActive: boolean;
  accountCanceled: boolean;
  hasActiveEpisode: boolean;
}) {
  if (input.hasActiveEpisode) return false;
  if (input.accountCanceled) return false;
  if (!input.needsMoreSignalActive) return false;
  if (input.eligibleTargetCount > NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD) return false;
  return true;
}

export function scheduledForAfterEpisodeStart(startedAt: Date, reminderIndex: number) {
  return scheduledForAfterInitial(startedAt, reminderIndex);
}

export function listDueReminderIndexes(input: {
  startedAt: Date;
  now: Date;
  lastCompletedReminderIndex: number | null;
}) {
  const lastDone = input.lastCompletedReminderIndex ?? -1;
  const due: number[] = [];
  for (let index = 0; index <= CLIENT_EMAIL_MAX_REMINDER_INDEX; index += 1) {
    if (index <= lastDone) continue;
    const scheduledFor = scheduledForAfterEpisodeStart(input.startedAt, index);
    if (!scheduledFor) break;
    if (scheduledFor.getTime() > input.now.getTime()) break;
    due.push(index);
  }
  return due;
}

export function resolveNeedsMoreTargetsSendTrigger(reminderIndex: number) {
  return reminderIndex === 0 ? "automatic_initial" as const : "automatic_reminder" as const;
}

export function mapStopReasonToCloseReason(
  reason: NeedsMoreTargetsEmailStopReason,
): ClientEmailNeedsMoreTargetsSequenceCloseReason | null {
  if (!reason) return null;
  return reason;
}

export function planNeedsMoreTargetsEpisodeReconciliation(input: {
  accountId: string;
  clientId: string;
  accountCanceled: boolean;
  eligibleTargetCount: number;
  needsMoreSignalActive: boolean;
  sourceActionId: string | null;
  activeEpisode: NeedsMoreTargetsSequenceRecord | null;
  now?: Date;
}): NeedsMoreTargetsEpisodePlan {
  const now = input.now ?? new Date();
  const actions: NeedsMoreTargetsEpisodePlanAction[] = [];
  const stopReason = evaluateNeedsMoreTargetsEmailStop({
    eligibleTargetCount: input.eligibleTargetCount,
    accountCanceled: input.accountCanceled,
    needsMoreSignalActive: input.needsMoreSignalActive,
  });

  if (input.activeEpisode?.status === "active") {
    const closeReason = mapStopReasonToCloseReason(stopReason);
    if (closeReason) {
      actions.push({ type: "close_episode", closeReason });
      return { accountId: input.accountId, clientId: input.clientId, actions };
    }

    const startedAt = new Date(input.activeEpisode.startedAt);
    const dueIndexes = listDueReminderIndexes({
      startedAt,
      now,
      lastCompletedReminderIndex: input.activeEpisode.lastCompletedReminderIndex,
    });

    for (const reminderIndex of dueIndexes) {
      if (!isValidClientEmailReminderIndex(reminderIndex)) continue;
      const scheduledFor = scheduledForAfterEpisodeStart(startedAt, reminderIndex);
      if (!scheduledFor) continue;
      actions.push({
        type: "plan_send",
        send: {
          reminderIndex,
          trigger: resolveNeedsMoreTargetsSendTrigger(reminderIndex),
          scheduledFor: scheduledFor.toISOString(),
          idempotencyKey: buildNeedsMoreTargetsIntentIdempotencyKey({
            accountId: input.accountId,
            episodeId: input.activeEpisode.id,
            reminderIndex,
          }),
        },
      });
    }

    if (actions.length === 0) {
      actions.push({ type: "noop", reason: "active_episode_waiting_for_next_due_reminder" });
    }
    return { accountId: input.accountId, clientId: input.clientId, actions };
  }

  if (stopReason) {
    actions.push({ type: "noop", reason: stopReason });
    return { accountId: input.accountId, clientId: input.clientId, actions };
  }

  if (!shouldStartNeedsMoreTargetsEmailSequence({
    eligibleTargetCount: input.eligibleTargetCount,
    needsMoreSignalActive: input.needsMoreSignalActive,
    accountCanceled: input.accountCanceled,
    hasActiveEpisode: false,
  })) {
    actions.push({ type: "noop", reason: "start_conditions_not_met" });
    return { accountId: input.accountId, clientId: input.clientId, actions };
  }

  const startedAtIso = now.toISOString();
  const episodeKey = buildNeedsMoreTargetsEpisodeKey(input.accountId, startedAtIso);
  actions.push({
    type: "open_episode",
    episodeKey,
    eligibleTargetCount: input.eligibleTargetCount,
    sourceActionId: input.sourceActionId,
  });
  actions.push({
    type: "plan_send",
    send: {
      reminderIndex: 0,
      trigger: "automatic_initial",
      scheduledFor: startedAtIso,
      idempotencyKey: buildNeedsMoreTargetsIntentIdempotencyKey({
        accountId: input.accountId,
        episodeId: episodeKey,
        reminderIndex: 0,
      }),
    },
  });
  return { accountId: input.accountId, clientId: input.clientId, actions };
}

export function reminderOffsetHoursScheduleMatchesSpec() {
  return [0, 1, 2, 3, 4, 5].every((index) => {
    const expected = [0, 48, 5 * 24, 9 * 24, 14 * 24, 21 * 24][index];
    return reminderOffsetHoursForIndex(index) === expected;
  });
}
