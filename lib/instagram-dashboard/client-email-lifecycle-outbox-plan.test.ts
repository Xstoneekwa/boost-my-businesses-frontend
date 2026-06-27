import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";
import {
  mapLifecyclePreviewToOutboxDecisions,
  mapNeedsMorePlanToOutboxRows,
} from "./client-email-lifecycle-outbox-plan.ts";
import { loadClientEmailLifecycleReadiness } from "./client-email-lifecycle-readiness.ts";
import {
  listDueReminderIndexes,
  planNeedsMoreTargetsEpisodeReconciliation,
} from "./client-email-needs-more-targets-sequence.ts";

const closedEnv = {
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "false",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
  CLIENT_EMAIL_PROVIDER: "postmark",
  POSTMARK_SERVER_TOKEN: "token",
};

const openLifecycleEnv = {
  ...closedEnv,
  CLIENT_EMAIL_SENDING_ENABLED: "true",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
};

const openNeedsMoreEnv = {
  ...closedEnv,
  CLIENT_EMAIL_SENDING_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
};

const watermark = new Date("2026-07-01T00:00:00.000Z");
const deliverySettings = buildLegacyTransactionalDeliverySettings();
const template = {
  id: "tpl-1",
  category: "account_paused" as const,
  version: 3,
  subject: "Paused {{client_name}}",
  bodyText: "Support: {{support_email}}",
};

const baseLifecycleInput = {
  category: "account_paused" as const,
  accountId: "acct-1",
  clientId: "client-1",
  instagramUsername: "user1",
  clientLabel: "Client One",
  clientEmailMasked: "c***@example.com",
  adminLifecycleStatus: "paused",
  automationEnabledAt: watermark,
  transitionEvidence: {
    message: "account_paused",
    occurredAt: "2026-07-02T09:00:00.000Z",
    source: "ig_action_logs.account_admin_status_changed" as const,
  },
  activeEpisode: null,
  clientEmailAvailable: true,
  deliverySettings,
  template: { ...template, category: "account_paused" as const },
  env: openLifecycleEnv,
  now: new Date("2026-07-03T00:00:00.000Z"),
  existingIdempotencyKeys: new Set<string>(),
};

const baseNeedsMoreInput = {
  accountId: "acct-1",
  clientId: "client-1",
  instagramUsername: "user1",
  clientLabel: "Client One",
  clientEmailMasked: "c***@example.com",
  adminLifecycleStatus: "active",
  eligibleTargetCount: 5,
  needsMoreSignalActive: true,
  sourceActionId: "action-1",
  sourceActionCreatedAt: "2026-07-02T00:00:00.000Z",
  sourceActionUpdatedAt: "2026-07-02T00:00:00.000Z",
  activeEpisode: null,
  clientEmailAvailable: true,
  deliverySettings,
  template: {
    id: "tpl-nmt",
    category: "needs_more_target_accounts" as const,
    version: 2,
    subject: "Targets",
    bodyText: "Support {{support_email}}",
  },
  env: openNeedsMoreEnv,
  needsMoreWatermark: watermark,
  now: new Date("2026-07-03T00:00:00.000Z"),
  existingIdempotencyKeys: new Set<string>(),
};

test("historical lifecycle before watermark maps to blocked_legacy_pre_watermark", () => {
  const rows = mapLifecyclePreviewToOutboxDecisions({
    ...baseLifecycleInput,
    automationEnabledAt: watermark,
    transitionEvidence: {
      message: "account_paused",
      occurredAt: "2026-06-01T00:00:00.000Z",
      source: "ig_action_logs.account_admin_status_changed",
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.decision, "blocked_legacy_pre_watermark");
});

test("valid post-watermark pause plans open episode and initial intent with gates open", () => {
  const rows = mapLifecyclePreviewToOutboxDecisions(baseLifecycleInput);
  assert.equal(rows.some((row) => row.decision === "would_open_episode"), true);
  const intentRow = rows.find((row) => row.decision === "would_create_initial_intent");
  assert.ok(intentRow);
  assert.equal(intentRow?.parentType, "lifecycle_episode");
  assert.equal(intentRow?.trigger, "automatic_initial");
  assert.match(intentRow?.idempotencyKey ?? "", /^lifecycle:account_paused:/);
});

test("cancellation post-watermark uses lifecycle episode parent", () => {
  const rows = mapLifecyclePreviewToOutboxDecisions({
    ...baseLifecycleInput,
    category: "account_canceled",
    adminLifecycleStatus: "cancelled",
    template: { ...template, category: "account_canceled" },
    transitionEvidence: {
      message: "account_cancelled",
      occurredAt: "2026-07-02T09:00:00.000Z",
      source: "ig_action_logs.account_admin_status_changed",
    },
  });
  const intentRow = rows.find((row) => row.decision === "would_create_initial_intent");
  assert.ok(intentRow);
  assert.equal(intentRow?.parentType, "lifecycle_episode");
});

test("needs assistance post-watermark parents lifecycle episode", () => {
  const rows = mapLifecyclePreviewToOutboxDecisions({
    ...baseLifecycleInput,
    category: "needs_assistance",
    adminLifecycleStatus: "needs_assistance",
    template: { ...template, category: "needs_assistance" },
    transitionEvidence: {
      message: "account_marked_needs_assistance",
      occurredAt: "2026-07-02T09:00:00.000Z",
      source: "ig_action_logs.account_admin_status_changed",
    },
  });
  const intentRow = rows.find((row) => row.decision === "would_create_initial_intent");
  assert.ok(intentRow);
  assert.equal(intentRow?.parentType, "lifecycle_episode");
});

test("closed delivery gates block intent creation without writes", () => {
  const rows = mapLifecyclePreviewToOutboxDecisions({
    ...baseLifecycleInput,
    env: closedEnv,
  });
  assert.equal(rows.some((row) => row.decision === "would_open_episode"), true);
  assert.equal(rows.some((row) => row.decision === "blocked_delivery_gate"), true);
  assert.equal(rows.some((row) => row.decision === "would_create_initial_intent"), false);
});

test("missing client email blocks intent but keeps business state", () => {
  const rows = mapLifecyclePreviewToOutboxDecisions({
    ...baseLifecycleInput,
    clientEmailAvailable: false,
    clientEmailMasked: null,
  });
  const blocked = rows.find((row) => row.decision === "blocked_missing_client_email");
  assert.ok(blocked);
  assert.equal(blocked?.businessState, "paused");
});

test("inactive template blocks intent with stable reason", () => {
  const rows = mapLifecyclePreviewToOutboxDecisions({
    ...baseLifecycleInput,
    template: null,
  });
  const blocked = rows.find((row) => row.decision === "blocked_template_unavailable");
  assert.ok(blocked);
  assert.match(blocked?.reason ?? "", /No active template/i);
});

test("existing idempotency key yields no_action on re-run", () => {
  const first = mapLifecyclePreviewToOutboxDecisions(baseLifecycleInput);
  const key = first.find((row) => row.idempotencyKey)?.idempotencyKey;
  assert.ok(key);
  const second = mapLifecyclePreviewToOutboxDecisions({
    ...baseLifecycleInput,
    existingIdempotencyKeys: new Set([key!]),
  });
  assert.equal(second.some((row) => row.decision === "no_action"), true);
  assert.equal(second.some((row) => row.decision === "would_create_initial_intent"), false);
});

test("pause on canceled account would cancel episode instead of sending", () => {
  const rows = mapLifecyclePreviewToOutboxDecisions({
    ...baseLifecycleInput,
    adminLifecycleStatus: "cancelled",
    activeEpisode: {
      id: "episode-1",
      status: "active",
      startedAt: "2026-07-02T09:00:00.000Z",
      episodeKey: "account_paused:acct-1:2026-07-02T09:00:00.000Z",
    },
  });
  assert.equal(rows.some((row) => row.decision === "would_cancel_episode"), true);
  assert.equal(rows.some((row) => row.decision === "would_create_initial_intent"), false);
});

test("needs-more pre-watermark signal is blocked_legacy_pre_watermark", () => {
  const rows = mapNeedsMorePlanToOutboxRows({
    ...baseNeedsMoreInput,
    sourceActionCreatedAt: "2026-06-01T00:00:00.000Z",
    sourceActionUpdatedAt: "2026-06-01T00:00:00.000Z",
  });
  assert.equal(rows[0]?.decision, "blocked_legacy_pre_watermark");
});

test("needs-more post-watermark with CT=5 plans initial then reminders up to max 6", () => {
  const startedAt = new Date("2026-07-01T00:00:00.000Z");
  const farFuture = new Date("2026-12-01T00:00:00.000Z");
  const episode = {
    id: "episode-1",
    accountId: "acct-1",
    clientId: "client-1",
    sourceActionId: "action-1",
    status: "active" as const,
    eligibleTargetCountAtStart: 5,
    thresholdAtStart: 5,
    startedAt: startedAt.toISOString(),
    resolvedAt: null,
    canceledAt: null,
    closeReason: null,
    nextReminderIndex: 0,
    lastCompletedReminderIndex: null,
    episodeKey: "needs_more_targets:acct-1:2026-07-01T00:00:00.000Z",
  };
  const dueIndexes = listDueReminderIndexes({
    startedAt,
    now: farFuture,
    lastCompletedReminderIndex: null,
  });
  assert.equal(dueIndexes.length, 6);
  const plan = planNeedsMoreTargetsEpisodeReconciliation({
    accountId: "acct-1",
    clientId: "client-1",
    accountCanceled: false,
    eligibleTargetCount: 5,
    needsMoreSignalActive: true,
    sourceActionId: "action-1",
    activeEpisode: episode,
    now: farFuture,
  });
  const sendActions = plan.actions.filter((action) => action.type === "plan_send");
  assert.equal(sendActions.length, 6);
});

test("needs-more stops when CT above threshold", () => {
  const rows = mapNeedsMorePlanToOutboxRows({
    ...baseNeedsMoreInput,
    eligibleTargetCount: 6,
    activeEpisode: {
      id: "episode-1",
      accountId: "acct-1",
      clientId: "client-1",
      sourceActionId: "action-1",
      status: "active",
      eligibleTargetCountAtStart: 5,
      thresholdAtStart: 5,
      startedAt: "2026-07-01T00:00:00.000Z",
      resolvedAt: null,
      canceledAt: null,
      closeReason: null,
      nextReminderIndex: 0,
      lastCompletedReminderIndex: null,
      episodeKey: "needs_more_targets:acct-1:2026-07-01T00:00:00.000Z",
    },
  });
  assert.equal(rows.some((row) => row.decision === "would_close_episode"), true);
  assert.equal(rows.some((row) => row.decision === "would_create_reminder_intent"), false);
});

test("needs-more canceled account closes sequence", () => {
  const rows = mapNeedsMorePlanToOutboxRows({
    ...baseNeedsMoreInput,
    adminLifecycleStatus: "cancelled",
    activeEpisode: {
      id: "episode-1",
      accountId: "acct-1",
      clientId: "client-1",
      sourceActionId: "action-1",
      status: "active",
      eligibleTargetCountAtStart: 5,
      thresholdAtStart: 5,
      startedAt: "2026-07-01T00:00:00.000Z",
      resolvedAt: null,
      canceledAt: null,
      closeReason: null,
      nextReminderIndex: 0,
      lastCompletedReminderIndex: null,
      episodeKey: "needs_more_targets:acct-1:2026-07-01T00:00:00.000Z",
    },
  });
  assert.equal(rows.some((row) => row.decision === "would_cancel_episode"), true);
});

test("future intent snapshot uses growth sender and never support@ alias", () => {
  const rows = mapLifecyclePreviewToOutboxDecisions(baseLifecycleInput);
  const intentRow = rows.find((row) => row.futureIntentSnapshot);
  assert.ok(intentRow?.futureIntentSnapshot);
  assert.equal(intentRow.futureIntentSnapshot.fromEmailSnapshot, "growth@boostmybusinesses.com");
  assert.equal(intentRow.futureIntentSnapshot.supportEmailSnapshot, "growth@boostmybusinesses.com");
  assert.doesNotMatch(intentRow.futureIntentSnapshot.supportEmailSnapshot, /support@boostmybusinesses.com/);
  assert.doesNotMatch(intentRow.futureIntentSnapshot.snapshotBodyText, /support@boostmybusinesses.com/);
});

test("needs-more idempotency key stable across identical replan", () => {
  const first = mapNeedsMorePlanToOutboxRows(baseNeedsMoreInput);
  const second = mapNeedsMorePlanToOutboxRows(baseNeedsMoreInput);
  const firstKey = first.find((row) => row.idempotencyKey)?.idempotencyKey;
  const secondKey = second.find((row) => row.idempotencyKey)?.idempotencyKey;
  assert.equal(firstKey, secondKey);
});

test("readiness stays blocked with gates closed and no scheduler", async () => {
  function buildTableChain(table: string) {
    if (table === "client_email_send_intents") {
      return {
        select: () => ({
          limit: async () => ({
            data: null,
            error: { message: "column client_email_send_intents.lifecycle_episode_id does not exist", code: "42703" },
          }),
        }),
      };
    }
    if (table === "transactional_email_delivery_settings") {
      return {
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [{ settings_key: "default" }], error: null }),
            maybeSingle: async () => ({
              data: {
                settings_key: "default",
                active_from_email: "growth@boostmybusinesses.com",
                support_email: "growth@boostmybusinesses.com",
                config_version: 1,
                updated_at: "2026-07-01T00:00:00.000Z",
              },
              error: null,
            }),
          }),
        }),
      };
    }
    const result = { data: [] as unknown[], error: null as null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => result,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return chain;
  }

  const supabase = {
    from(table: string) {
      if (table === "client_email_templates") {
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return {
                eq: async () => ({ count: 8, error: null }),
              };
            }
            return buildTableChain(table);
          },
        };
      }
      return buildTableChain(table);
    },
  };

  const readiness = await loadClientEmailLifecycleReadiness(supabase as never, closedEnv);
  assert.equal(readiness.schedulerConnected, false);
  assert.equal(readiness.globalSendingEnabled, false);
  assert.equal(readiness.testSendingEnabled, false);
  assert.equal(readiness.lifecycleAutomationEnabled, false);
  assert.equal(readiness.needsMoreAutomationEnabled, false);
  assert.equal(readiness.lifecycleWatermarkConfigured, false);
  assert.equal(readiness.needsMoreWatermarkConfigured, false);
  assert.equal(readiness.providerDispatchAllowed, false);
  assert.match(readiness.blockingReasons.join(" "), /Intent parent linkage migration/);
  assert.equal(readiness.finalReadinessStatus, "blocked");
});
