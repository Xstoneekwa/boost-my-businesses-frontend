import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveOutboxPreviewDeliveryState,
  deriveOutboxPreviewGateState,
  deriveOutboxPreviewWatermarkState,
  formatOutboxPreviewDecision,
  loadClientEmailLifecycleOutboxPreview,
  projectClientEmailLifecycleOutboxPreview,
  projectOutboxPreviewItem,
  shouldIncludeOutboxPreviewRow,
  summarizeOutboxPreviewRows,
} from "./client-email-lifecycle-outbox-preview.ts";
import type { ClientEmailLifecycleOutboxPlan, ClientEmailOutboxPlanRow } from "./client-email-lifecycle-outbox-plan.ts";
import type { OutboxEffectiveCandidateRow } from "./client-email-lifecycle-outbox-precedence.ts";

const outboxRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-lifecycle/outbox-preview/route.ts", import.meta.url),
  "utf8",
);

const materializeReadyEnv = {
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CLIENT_EMAIL_PROVIDER: "postmark",
  POSTMARK_SERVER_TOKEN: "token",
};

const closedEnv = {
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "false",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
  CLIENT_EMAIL_PROVIDER: "postmark",
  POSTMARK_SERVER_TOKEN: "token",
};

const basePlan = (): ClientEmailLifecycleOutboxPlan => ({
  plannedAt: "2026-07-03T00:00:00.000Z",
  readOnly: true,
  mutationExecuted: false,
  schemaIntentLinksReady: true,
  lifecycleSchemaReady: true,
  needsMoreSchemaReady: true,
  globalSendingEnabled: false,
  lifecycleAutomationEnabled: false,
  needsMoreAutomationEnabled: false,
  lifecycleWatermarkConfigured: false,
  needsMoreWatermarkConfigured: false,
  providerDispatchAllowed: false,
  accountsAnalyzed: 1,
  rows: [],
});

const baseRow = (overrides: Partial<ClientEmailOutboxPlanRow> = {}): ClientEmailOutboxPlanRow => ({
  accountId: "acct-hidden",
  clientId: "client-hidden",
  instagramUsername: "paused_user",
  clientLabel: "Client One",
  clientEmailMasked: "c***@example.com",
  category: "account_paused",
  parentType: "lifecycle_episode",
  parentKey: "account_paused:acct-hidden:2026-07-02T00:00:00.000Z",
  parentId: null,
  trigger: "automatic_initial",
  reminderIndex: 0,
  businessState: "paused",
  decision: "blocked_legacy_pre_watermark",
  reason: "Historical lifecycle state detected before activation evidence.",
  idempotencyKey: "lifecycle:account_paused:acct-hidden:episode:abc:index:0",
  activeTemplateId: "tpl-hidden",
  activeTemplateVersion: 2,
  fromEmailSnapshot: "growth@boostmybusinesses.com",
  supportEmailSnapshot: "growth@boostmybusinesses.com",
  configVersion: 1,
  futureIntentSnapshot: null,
  ...overrides,
});

function effectiveRow(overrides: Partial<OutboxEffectiveCandidateRow> = {}): OutboxEffectiveCandidateRow {
  return {
    ...baseRow(overrides),
    materializationEligible: overrides.materializationEligible ?? false,
    materializationGateState: overrides.materializationGateState ?? "not_applicable",
    materializationBlockingReasons: overrides.materializationBlockingReasons ?? [],
    dispatchEligible: overrides.dispatchEligible ?? false,
    dispatchGateState: overrides.dispatchGateState ?? "not_applicable",
    dispatchBlockingReasons: overrides.dispatchBlockingReasons ?? [],
    suppressedByCategory: null,
    suppressionReason: null,
    isEffectiveCandidate: true,
  };
}

function previewInput(overrides: Partial<Parameters<typeof projectClientEmailLifecycleOutboxPreview>[0]> = {}) {
  return {
    plan: basePlan(),
    readinessStatus: "partial" as const,
    readinessBlockingReasons: [],
    materializationReadinessStatus: "partial" as const,
    dispatchReadinessStatus: "blocked" as const,
    materializationBlockingReasons: [],
    dispatchBlockingReasons: ["Client email sending is disabled by CLIENT_EMAIL_SENDING_ENABLED."],
    env: materializeReadyEnv,
    ...overrides,
  };
}

test("outbox preview route requires relay or admin and uses read-only planner", () => {
  assert.match(outboxRoute, /requireRelayOrAdmin/);
  assert.match(outboxRoute, /loadClientEmailLifecycleOutboxPreview/);
  assert.match(outboxRoute, /Cache-Control/);
  assert.match(outboxRoute, /no-store/);
  assert.doesNotMatch(outboxRoute, /insert\(|update\(|delete\(|postmark|webhook/i);
});

test("projection strips ids, keys, and template bodies", () => {
  const projected = projectOutboxPreviewItem(effectiveRow(), basePlan(), { suppressedSiblingCount: 0 });
  assert.equal(projected.instagramUsername, "paused_user");
  assert.equal(projected.clientEmailMasked, "c***@example.com");
  assert.doesNotMatch(JSON.stringify(projected), /acct-hidden|client-hidden|tpl-hidden|idempotency|snapshotBody/i);
  assert.doesNotMatch(JSON.stringify(projected), /growth@boostmybusinesses\.com/);
});

test("historical lifecycle maps to blocked_legacy_pre_watermark", () => {
  assert.equal(
    deriveOutboxPreviewDeliveryState("blocked_legacy_pre_watermark", false),
    "blocked_legacy_pre_watermark",
  );
  assert.equal(
    formatOutboxPreviewDecision("blocked_legacy_pre_watermark"),
    "Blocked: legacy pre-watermark",
  );
});

test("precedence collapses canceled account to one effective row and suppresses needs-more", () => {
  const preview = projectClientEmailLifecycleOutboxPreview(previewInput({
    plan: {
      ...basePlan(),
      accountsAnalyzed: 1,
      lifecycleWatermarkConfigured: true,
      needsMoreWatermarkConfigured: true,
      lifecycleAutomationEnabled: true,
      needsMoreAutomationEnabled: true,
      rows: [
        baseRow({ accountId: "a1", category: "account_canceled", decision: "blocked_legacy_pre_watermark" }),
        baseRow({ accountId: "a1", category: "needs_more_target_accounts", decision: "no_action", reason: "signal active" }),
      ],
    },
  }));
  assert.equal(preview.summary.rawObservations, 2);
  assert.equal(preview.summary.effectiveCandidates, 1);
  assert.equal(preview.summary.suppressedByLifecyclePriority, 1);
  assert.equal(preview.items.length, 1);
  assert.equal(preview.items[0]?.category, "account_canceled");
  assert.equal(preview.items[0]?.precedenceNote, "Other lifecycle communication suppressed by account status");
});

test("legacy blocked_delivery_gate decision still projects dispatch gate closed", () => {
  const projected = projectOutboxPreviewItem(
    effectiveRow({
      decision: "blocked_delivery_gate",
      reason: "Automation gates remain closed.",
      dispatchGateState: "closed",
      dispatchBlockingReasons: ["Automation gates remain closed."],
    }),
    basePlan(),
    { suppressedSiblingCount: 0 },
  );
  assert.equal(projected.deliveryState, "blocked_delivery_gate");
  assert.equal(projected.gateState, "gates_closed");
});

test("summary counts raw vs effective and suppressed", () => {
  const preview = projectClientEmailLifecycleOutboxPreview(previewInput({
    plan: {
      ...basePlan(),
      accountsAnalyzed: 2,
      rows: [
        baseRow({ accountId: "a1", category: "account_canceled", decision: "blocked_legacy_pre_watermark" }),
        baseRow({ accountId: "a1", category: "needs_more_target_accounts", decision: "no_action", reason: "eligible=5" }),
        baseRow({ accountId: "a2", category: "account_canceled", decision: "blocked_legacy_pre_watermark", instagramUsername: "user2" }),
        baseRow({ accountId: "a2", category: "needs_more_target_accounts", decision: "no_action", reason: "eligible=4" }),
      ],
    },
  }));
  assert.equal(preview.summary.rawObservations, 4);
  assert.equal(preview.summary.effectiveCandidates, 2);
  assert.equal(preview.summary.suppressedByLifecyclePriority, 2);
  assert.equal(preview.items.length, 2);
});

test("readyToDispatchTheoretical counts only dispatchEligible effective rows", () => {
  const summary = summarizeOutboxPreviewRows({
    rawObservations: [baseRow(), baseRow({ accountId: "a2" })],
    effectiveCandidates: [
      effectiveRow({ decision: "would_create_initial_intent", materializationEligible: true, dispatchEligible: true }),
      effectiveRow({ accountId: "a2", decision: "blocked_legacy_pre_watermark", dispatchEligible: false }),
    ],
    suppressedCount: 0,
    accountsAnalyzed: 2,
  });
  assert.equal(summary.readyToDispatchTheoretical, 1);
  assert.equal(summary.wouldMaterializeTheoretical, 1);
});

test("no_action waiting rows can be excluded from raw observations", () => {
  const waiting = baseRow({
    decision: "no_action",
    reason: "active_episode_waiting_for_next_due_reminder",
  });
  assert.equal(shouldIncludeOutboxPreviewRow(waiting), false);
});

test("loadClientEmailLifecycleOutboxPreview performs read-only selects without writes", async () => {
  const writes: string[] = [];
  let fetchCalled = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled += 1;
    return new Response("{}", { status: 200 });
  };

  const supabase = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: () => { writes.push(`${table}:insert`); return chain; },
        update: () => { writes.push(`${table}:update`); return chain; },
        delete: () => { writes.push(`${table}:delete`); return chain; },
      };
      return chain;
    },
  };

  try {
    await loadClientEmailLifecycleOutboxPreview(supabase as never, { env: closedEnv });
  } catch {
    // mock may not satisfy every select shape; writes/fetch still must stay zero
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(writes, []);
  assert.equal(fetchCalled, 0);
});

test("watermark state for needs-more uses needs-more watermark flag when materialization eligible", () => {
  const withWatermark = deriveOutboxPreviewWatermarkState(
    "would_create_initial_intent",
    "needs_more_target_accounts",
    true,
    { lifecycleWatermarkConfigured: false, needsMoreWatermarkConfigured: true },
  );
  assert.equal(withWatermark, "watermark_satisfied");
});

test("gate state is not applicable for legacy pre-watermark rows", () => {
  assert.equal(
    deriveOutboxPreviewGateState({
      decision: "blocked_legacy_pre_watermark",
      dispatchEligible: false,
      dispatchGateState: "not_applicable",
    }),
    "not_applicable",
  );
});
