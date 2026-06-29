import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNeedsMoreFirstReminderDueAt,
  evaluateNeedsMoreReminderDue,
  isNeedsMoreFirstReminderDue,
} from "./client-email-needs-more-24h-due.ts";
import { buildNeedsMoreTargetingDashboardUrl } from "./client-email-needs-more-targeting-url.ts";
import {
  buildNeedsMoreTargetsEpisodeKey,
  listDueReminderIndexes,
  planNeedsMoreTargetsEpisodeReconciliation,
} from "./client-email-needs-more-targets-sequence.ts";
import {
  NeedsMoreTargetsSequenceMemoryStore,
  reconcileNeedsMoreTargetAccountEmailSequences,
} from "./client-email-needs-more-targets-reconcile.ts";
import { runNeedsMoreTargetsReminderRunner } from "./client-email-needs-more-targets-runner.ts";
import { resolveNeedsMoreActiveSince } from "./needs-more-target-accounts.ts";

const baseSnapshot = {
  accountId: "acct-1",
  clientId: "client-1",
  accountCanceled: false,
  needsMoreSignalActive: true,
  sourceActionId: "action-1",
  needsMoreActiveSince: "2026-06-01T12:00:00.000Z",
};

test("needs_more_active_since uses dashboard action created_at", () => {
  assert.equal(
    resolveNeedsMoreActiveSince({ created_at: "2026-06-01T12:00:00.000Z" }),
    "2026-06-01T12:00:00.000Z",
  );
  assert.equal(resolveNeedsMoreActiveSince(null), null);
});

test("first reminder not due at 23h59 and due at exactly 24h", () => {
  const activeSince = "2026-06-01T12:00:00.000Z";
  const dueAt = computeNeedsMoreFirstReminderDueAt(activeSince);
  assert.equal(dueAt, "2026-06-02T12:00:00.000Z");

  const almost = new Date("2026-06-02T11:59:00.000Z");
  assert.equal(isNeedsMoreFirstReminderDue({ needsMoreActiveSince: activeSince, now: almost }), false);
  assert.equal(
    evaluateNeedsMoreReminderDue({
      needsMoreActiveSince: activeSince,
      now: almost,
      eligibleTargetCount: 5,
      needsMoreSignalActive: true,
      accountCanceled: false,
      clientEmailAvailable: true,
    }).reason,
    "not_due_yet",
  );

  const exact = new Date("2026-06-02T12:00:00.000Z");
  assert.equal(isNeedsMoreFirstReminderDue({ needsMoreActiveSince: activeSince, now: exact }), true);
  assert.equal(
    evaluateNeedsMoreReminderDue({
      needsMoreActiveSince: activeSince,
      now: exact,
      eligibleTargetCount: 5,
      needsMoreSignalActive: true,
      accountCanceled: false,
      clientEmailAvailable: true,
    }).reason,
    "due_for_first_reminder",
  );
});

test("six added but only four eligible keeps signal active", () => {
  const plan = planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    eligibleTargetCount: 4,
    activeEpisode: null,
    now: new Date("2026-06-03T00:00:00.000Z"),
  });
  assert.equal(plan.actions.some((action) => action.type === "open_episode"), true);
  assert.equal(plan.actions.some((action) => action.type === "plan_send"), false);
});

test("resolution before 24h closes episode without send candidate", () => {
  const store = new NeedsMoreTargetsSequenceMemoryStore();
  const startedAt = new Date("2026-06-01T12:00:00.000Z");
  store.applyPlan(planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    eligibleTargetCount: 5,
    activeEpisode: null,
    now: startedAt,
  }), { accountId: "acct-1", clientId: "client-1", now: startedAt });

  const beforeDue = new Date("2026-06-02T06:00:00.000Z");
  const plan = planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    eligibleTargetCount: 6,
    activeEpisode: store.getActiveForAccount("acct-1"),
    now: beforeDue,
  });
  assert.equal(plan.actions.some((action) => action.type === "close_episode"), true);
  assert.equal(plan.actions.some((action) => action.type === "plan_send"), false);
});

test("reopening after resolution uses new needs_more_active_since period", () => {
  const firstSince = "2026-06-01T12:00:00.000Z";
  const secondSince = "2026-06-10T08:00:00.000Z";
  const firstKey = buildNeedsMoreTargetsEpisodeKey("acct-1", firstSince);
  const secondKey = buildNeedsMoreTargetsEpisodeKey("acct-1", secondSince);
  assert.notEqual(firstKey, secondKey);

  const firstPlan = planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    needsMoreActiveSince: firstSince,
    eligibleTargetCount: 4,
    activeEpisode: null,
    now: new Date(firstSince),
  });
  const secondPlan = planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    needsMoreActiveSince: secondSince,
    eligibleTargetCount: 3,
    activeEpisode: null,
    now: new Date(secondSince),
  });
  const firstOpen = firstPlan.actions.find((action) => action.type === "open_episode");
  const secondOpen = secondPlan.actions.find((action) => action.type === "open_episode");
  assert.equal(firstOpen?.type === "open_episode" ? firstOpen.episodeKey : null, firstKey);
  assert.equal(secondOpen?.type === "open_episode" ? secondOpen.episodeKey : null, secondKey);
});

test("duplicate runner evaluation is read-only and idempotent at plan level", async () => {
  const supabase = { from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  const snapshots = [{ ...baseSnapshot, eligibleTargetCount: 5 }];
  const first = await runNeedsMoreTargetsReminderRunner(supabase as never, { snapshots, mode: "preview" });
  const second = await runNeedsMoreTargetsReminderRunner(supabase as never, { snapshots, mode: "preview" });
  assert.equal(first.stoppedBeforeWrite, true);
  assert.equal(second.stoppedBeforeWrite, true);
  assert.equal(first.evaluations.length, second.evaluations.length);
});

test("legacy pre-watermark excluded by runner due evaluation", async () => {
  const supabase = { from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  const result = await runNeedsMoreTargetsReminderRunner(supabase as never, {
    snapshots: [{ ...baseSnapshot, needsMoreActiveSince: "2026-05-01T00:00:00.000Z", eligibleTargetCount: 5 }],
    env: {
      CLIENT_EMAIL_SENDING_ENABLED: "true",
      CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
      CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
      CLIENT_EMAIL_PROVIDER: "postmark",
      POSTMARK_SERVER_TOKEN: "token",
    },
    now: new Date("2026-12-01T00:00:00.000Z"),
  });
  assert.equal(result.evaluations[0]?.dueEvaluation.reason, "blocked_legacy_pre_watermark");
});

test("missing canonical email blocks due evaluation", () => {
  assert.equal(
    evaluateNeedsMoreReminderDue({
      needsMoreActiveSince: baseSnapshot.needsMoreActiveSince,
      now: new Date("2026-06-03T00:00:00.000Z"),
      eligibleTargetCount: 5,
      needsMoreSignalActive: true,
      accountCanceled: false,
      clientEmailAvailable: false,
    }).reason,
    "missing_canonical_email",
  );
});

test("CTA deep link points to tenant targeting route with account id", () => {
  const url = buildNeedsMoreTargetingDashboardUrl("acct-tenant-1", "https://app.example.com");
  assert.equal(url, "https://app.example.com/instagram-client?view=targeting&account=acct-tenant-1");
});

test("only first product reminder index becomes due after 24h", () => {
  const startedAt = new Date("2026-06-01T12:00:00.000Z");
  const beforeDue = new Date("2026-06-02T11:00:00.000Z");
  const afterDue = new Date("2026-06-02T13:00:00.000Z");
  assert.deepEqual(listDueReminderIndexes({ startedAt, now: beforeDue, lastCompletedReminderIndex: null }), []);
  assert.deepEqual(listDueReminderIndexes({ startedAt, now: afterDue, lastCompletedReminderIndex: null }), [0]);
});

test("eligible=5 opens episode without immediate planned send", async () => {
  const closedEnv = {
    CLIENT_EMAIL_SENDING_ENABLED: "false",
    CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
    CLIENT_EMAIL_PROVIDER: "postmark",
    POSTMARK_SERVER_TOKEN: "token",
  };
  const supabase = {
    from: () => ({
      select: () => ({
        limit: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };
  const result = await reconcileNeedsMoreTargetAccountEmailSequences(supabase as never, {
    snapshots: [{ ...baseSnapshot, eligibleTargetCount: 5 }],
    env: closedEnv,
  });
  assert.equal(result.plannedSends, 0);
  assert.equal(result.episodesOpened, 1);
  assert.equal(result.plans[0]?.actions.some((action) => action.type === "plan_send"), false);
});
