import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateNeedsMoreTargetsEmailAutomationGate,
  readClientEmailNeedsMoreTargetsAutomationEnabled,
} from "./client-email-needs-more-targets-automation-config.ts";
import {
  listDueReminderIndexes,
  planNeedsMoreTargetsEpisodeReconciliation,
  reminderOffsetHoursScheduleMatchesSpec,
  shouldStartNeedsMoreTargetsEmailSequence,
} from "./client-email-needs-more-targets-sequence.ts";
import {
  NeedsMoreTargetsSequenceMemoryStore,
  reconcileNeedsMoreTargetAccountEmailSequences,
} from "./client-email-needs-more-targets-reconcile.ts";

const closedEnv = {
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
  CLIENT_EMAIL_PROVIDER: "postmark",
  POSTMARK_SERVER_TOKEN: "token",
};

const openEnv = {
  CLIENT_EMAIL_SENDING_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_PROVIDER: "postmark",
  POSTMARK_SERVER_TOKEN: "token",
};

const baseSnapshot = {
  accountId: "acct-1",
  clientId: "client-1",
  accountCanceled: false,
  needsMoreSignalActive: true,
  sourceActionId: "action-1",
};

function createMockSupabase(input: { sequenceSchemaReady?: boolean } = {}) {
  const sequenceSchemaReady = input.sequenceSchemaReady !== false;
  const missing = {
    message: "Could not find the table 'public.client_email_needs_more_targets_sequences' in the schema cache",
    code: "PGRST205",
  };
  return {
    from(table: string) {
      return {
        select: () => ({
          limit: () => ({
            maybeSingle: async () => {
              if (table === "client_email_needs_more_targets_sequences" && !sequenceSchemaReady) {
                return { data: null, error: missing };
              }
              return { data: null, error: null };
            },
          }),
        }),
      };
    },
  };
}

test("automation gate defaults closed and requires client sending when category gate open", () => {
  assert.equal(readClientEmailNeedsMoreTargetsAutomationEnabled({}), false);
  const onlyCategory = evaluateNeedsMoreTargetsEmailAutomationGate({
    CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
    CLIENT_EMAIL_SENDING_ENABLED: "false",
    CLIENT_EMAIL_PROVIDER: "postmark",
    POSTMARK_SERVER_TOKEN: "token",
  });
  assert.equal(onlyCategory.allowed, false);
  if (onlyCategory.allowed) return;
  assert.equal(onlyCategory.reason, "client_sending_disabled");
});

test("eligible=5 with active signal plans initial episode without email side effects", async () => {
  let fetchCalled = 0;
  const result = await reconcileNeedsMoreTargetAccountEmailSequences(createMockSupabase() as never, {
    snapshots: [{ ...baseSnapshot, eligibleTargetCount: 5 }],
    env: closedEnv,
    fetcher: async () => {
      fetchCalled += 1;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.plannedSends, 1);
  assert.equal(result.episodesOpened, 1);
  assert.equal(result.postmarkFetchCount, 0);
  assert.equal(result.intentsCreated, 0);
  assert.equal(fetchCalled, 0);
  assert.equal(result.plans[0]?.actions.some((action) => action.type === "plan_send"), true);
});

test("eligible=6 does not open an episode", async () => {
  const result = await reconcileNeedsMoreTargetAccountEmailSequences(createMockSupabase() as never, {
    snapshots: [{ ...baseSnapshot, eligibleTargetCount: 6 }],
    env: closedEnv,
  });
  assert.equal(result.episodesOpened, 0);
  assert.equal(result.plannedSends, 0);
  assert.match(result.plans[0]?.actions[0]?.type === "noop" ? result.plans[0].actions[0].reason : "", /eligible_targets_above_threshold/);
});

test("duplicate reconciliation does not open two episodes", async () => {
  const store = new NeedsMoreTargetsSequenceMemoryStore();
  const supabase = createMockSupabase();
  const snapshots = [{ ...baseSnapshot, eligibleTargetCount: 5 }];
  const first = await reconcileNeedsMoreTargetAccountEmailSequences(supabase as never, {
    snapshots,
    env: closedEnv,
    memoryStore: store,
  });
  const second = await reconcileNeedsMoreTargetAccountEmailSequences(supabase as never, {
    snapshots,
    env: closedEnv,
    memoryStore: store,
  });
  assert.equal(first.episodesOpened, 1);
  assert.equal(second.episodesOpened, 0);
  assert.equal(store.listActive().length, 1);
});

test("six reminder offsets match locked schedule from episode start", () => {
  assert.equal(reminderOffsetHoursScheduleMatchesSpec(), true);
  const startedAt = new Date("2026-06-01T12:00:00.000Z");
  const now = new Date(startedAt.getTime() + (21 * 24 + 1) * 60 * 60 * 1000);
  assert.deepEqual(listDueReminderIndexes({ startedAt, now, lastCompletedReminderIndex: null }), [0, 1, 2, 3, 4, 5]);
});

test("maximum six planned sends per episode", () => {
  const startedAt = new Date("2026-06-01T12:00:00.000Z");
  const now = new Date(startedAt.getTime() + (30 * 24) * 60 * 60 * 1000);
  const due = listDueReminderIndexes({ startedAt, now, lastCompletedReminderIndex: null });
  assert.equal(due.length, 6);
});

test("eligible rises above threshold before reminder closes episode", () => {
  const store = new NeedsMoreTargetsSequenceMemoryStore();
  const startedAt = new Date("2026-06-01T12:00:00.000Z");
  store.applyPlan(planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    eligibleTargetCount: 5,
    activeEpisode: null,
    now: startedAt,
  }), { accountId: "acct-1", clientId: "client-1", now: startedAt });

  const plan = planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    eligibleTargetCount: 6,
    activeEpisode: store.getActiveForAccount("acct-1"),
    now: new Date(startedAt.getTime() + 49 * 60 * 60 * 1000),
  });
  assert.equal(plan.actions.some((action) => action.type === "close_episode"), true);
  assert.equal(plan.actions.some((action) => action.type === "plan_send"), false);
});

test("resolved signal closes episode with no further sends", () => {
  const activeEpisode = {
    id: "episode-1",
    accountId: "acct-1",
    clientId: "client-1",
    sourceActionId: "action-1",
    status: "active" as const,
    eligibleTargetCountAtStart: 4,
    thresholdAtStart: 5,
    startedAt: "2026-06-01T12:00:00.000Z",
    resolvedAt: null,
    canceledAt: null,
    closeReason: null,
    nextReminderIndex: 1,
    lastCompletedReminderIndex: 0,
    episodeKey: "needs_more_targets:acct-1:2026-06-01T12:00:00.000Z",
  };
  const plan = planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    needsMoreSignalActive: false,
    eligibleTargetCount: 4,
    activeEpisode,
    now: new Date("2026-06-03T12:00:00.000Z"),
  });
  assert.deepEqual(plan.actions, [{ type: "close_episode", closeReason: "needs_more_signal_resolved" }]);
});

test("canceled account closes episode", () => {
  const plan = planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    accountCanceled: true,
    eligibleTargetCount: 3,
    activeEpisode: {
      id: "episode-1",
      accountId: "acct-1",
      clientId: "client-1",
      sourceActionId: "action-1",
      status: "active",
      eligibleTargetCountAtStart: 3,
      thresholdAtStart: 5,
      startedAt: "2026-06-01T12:00:00.000Z",
      resolvedAt: null,
      canceledAt: null,
      closeReason: null,
      nextReminderIndex: 1,
      lastCompletedReminderIndex: 0,
      episodeKey: "episode-key",
    },
    now: new Date("2026-06-03T12:00:00.000Z"),
  });
  assert.equal(plan.actions[0]?.type, "close_episode");
  if (plan.actions[0]?.type !== "close_episode") return;
  assert.equal(plan.actions[0].closeReason, "account_canceled");
});

test("new episode allowed after prior episode resolved and signal returns", () => {
  const store = new NeedsMoreTargetsSequenceMemoryStore();
  const startedAt = new Date("2026-06-01T12:00:00.000Z");
  store.applyPlan(planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    eligibleTargetCount: 4,
    activeEpisode: null,
    now: startedAt,
  }), { accountId: "acct-1", clientId: "client-1", now: startedAt });
  store.applyPlan(planNeedsMoreTargetsEpisodeReconciliation({
    ...baseSnapshot,
    eligibleTargetCount: 6,
    activeEpisode: store.getActiveForAccount("acct-1"),
    now: new Date("2026-06-02T12:00:00.000Z"),
  }), { accountId: "acct-1", clientId: "client-1", now: new Date("2026-06-02T12:00:00.000Z") });

  assert.equal(store.getActiveForAccount("acct-1"), null);
  assert.equal(shouldStartNeedsMoreTargetsEmailSequence({
    eligibleTargetCount: 4,
    needsMoreSignalActive: true,
    accountCanceled: false,
    hasActiveEpisode: false,
  }), true);
});

test("global gate false keeps zero Postmark fetch even when automation env partially set", async () => {
  let fetchCalled = 0;
  const result = await reconcileNeedsMoreTargetAccountEmailSequences(createMockSupabase() as never, {
    snapshots: [{ ...baseSnapshot, eligibleTargetCount: 5 }],
    env: closedEnv,
    fetcher: async () => {
      fetchCalled += 1;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.automationGateOpen, false);
  assert.equal(fetchCalled, 0);
});

test("category gate false with global sending true still blocks automation", async () => {
  const result = await reconcileNeedsMoreTargetAccountEmailSequences(createMockSupabase() as never, {
    snapshots: [{ ...baseSnapshot, eligibleTargetCount: 5 }],
    env: {
      ...openEnv,
      CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
    },
  });
  assert.equal(result.automationGateOpen, false);
  assert.equal(result.persistAllowed, false);
  assert.equal(result.intentsCreated, 0);
});

test("planned sends use lifecycle triggers distinct from manual_test", async () => {
  const result = await reconcileNeedsMoreTargetAccountEmailSequences(createMockSupabase() as never, {
    snapshots: [{ ...baseSnapshot, eligibleTargetCount: 5 }],
    env: closedEnv,
  });
  const send = result.plans[0]?.actions.find((action) => action.type === "plan_send");
  assert.equal(send?.type, "plan_send");
  if (send?.type !== "plan_send") return;
  assert.equal(send.send.trigger, "automatic_initial");
  assert.equal(send.send.reminderIndex, 0);
});
