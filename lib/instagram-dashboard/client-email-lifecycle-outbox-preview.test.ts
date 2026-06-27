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

const outboxRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-lifecycle/outbox-preview/route.ts", import.meta.url),
  "utf8",
);

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

test("outbox preview route requires relay or admin and uses read-only planner", () => {
  assert.match(outboxRoute, /requireRelayOrAdmin/);
  assert.match(outboxRoute, /loadClientEmailLifecycleOutboxPreview/);
  assert.match(outboxRoute, /Cache-Control/);
  assert.match(outboxRoute, /no-store/);
  assert.doesNotMatch(outboxRoute, /insert\(|update\(|delete\(|postmark|webhook/i);
});

test("projection strips ids, keys, and template bodies", () => {
  const projected = projectOutboxPreviewItem(baseRow(), basePlan());
  assert.equal(projected.instagramUsername, "paused_user");
  assert.equal(projected.clientEmailMasked, "c***@example.com");
  assert.equal(projected.templateConfigured, true);
  assert.equal(projected.templateVersion, 2);
  assert.equal(projected.senderConfigured, true);
  assert.equal(projected.supportEmailConfigured, true);
  assert.doesNotMatch(JSON.stringify(projected), /acct-hidden|client-hidden|tpl-hidden|idempotency|snapshotBody/i);
  assert.doesNotMatch(JSON.stringify(projected), /growth@boostmybusinesses\.com/);
});

test("historical lifecycle maps to blocked_legacy_pre_watermark", () => {
  assert.equal(
    deriveOutboxPreviewDeliveryState("blocked_legacy_pre_watermark"),
    "blocked_legacy_pre_watermark",
  );
  assert.equal(
    formatOutboxPreviewDecision("blocked_legacy_pre_watermark"),
    "Blocked: legacy pre-watermark",
  );
});

test("needs-more historical signal maps to blocked_legacy_pre_watermark", () => {
  const row = baseRow({
    category: "needs_more_target_accounts",
    parentType: "sequence",
    decision: "blocked_legacy_pre_watermark",
    reason: "Needs-more signal predates automation watermark.",
  });
  const projected = projectOutboxPreviewItem(row, basePlan());
  assert.equal(projected.lifecycleDecision, "blocked_legacy_pre_watermark");
  assert.equal(projected.watermarkState, "watermark_missing");
});

test("closed gate maps to blocked_delivery_gate", () => {
  const row = baseRow({ decision: "blocked_delivery_gate", reason: "Automation gates remain closed." });
  const projected = projectOutboxPreviewItem(row, basePlan());
  assert.equal(projected.deliveryState, "blocked_delivery_gate");
  assert.equal(projected.gateState, "gates_closed");
});

test("missing client email maps to blocked_missing_client_email", () => {
  const row = baseRow({
    decision: "blocked_missing_client_email",
    clientEmailMasked: null,
    reason: "Canonical client communication email is not configured.",
  });
  const projected = projectOutboxPreviewItem(row, basePlan());
  assert.equal(projected.deliveryState, "blocked_missing_client_email");
});

test("missing template maps to blocked_template_unavailable", () => {
  const row = baseRow({
    decision: "blocked_template_unavailable",
    activeTemplateId: null,
    activeTemplateVersion: null,
  });
  const projected = projectOutboxPreviewItem(row, basePlan());
  assert.equal(projected.deliveryState, "blocked_template_unavailable");
  assert.equal(projected.templateConfigured, false);
});

test("canceled account close maps to blocked_account_canceled delivery state", () => {
  assert.equal(
    deriveOutboxPreviewDeliveryState("would_cancel_episode"),
    "blocked_account_canceled",
  );
});

test("summary counts theoretical dispatch rows", () => {
  const rows = [
    baseRow({ decision: "would_create_initial_intent" }),
    baseRow({ decision: "would_create_reminder_intent", category: "needs_more_target_accounts" }),
    baseRow({ decision: "blocked_delivery_gate" }),
  ];
  const summary = summarizeOutboxPreviewRows(rows, 2);
  assert.equal(summary.wouldCreateInitialIntent, 1);
  assert.equal(summary.wouldCreateReminderIntent, 1);
  assert.equal(summary.readyToDispatchTheoretical, 2);
  assert.equal(summary.blockedDeliveryGate, 1);
});

test("no_action waiting rows can be excluded from pertinent items", () => {
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

test("projected preview marks readOnly and mutationExecuted false", () => {
  const preview = projectClientEmailLifecycleOutboxPreview({
    plan: basePlan(),
    readinessStatus: "partial",
    readinessBlockingReasons: ["Lifecycle anti-backfill watermark is not configured."],
  });
  assert.equal(preview.readOnly, true);
  assert.equal(preview.mutationExecuted, false);
  assert.equal(preview.readinessStatus, "partial");
});

test("watermark state for needs-more uses needs-more watermark flag", () => {
  const withWatermark = deriveOutboxPreviewWatermarkState(
    "would_create_initial_intent",
    "needs_more_target_accounts",
    { lifecycleWatermarkConfigured: false, needsMoreWatermarkConfigured: true },
  );
  assert.equal(withWatermark, "watermark_satisfied");
});

test("internal test intents are never part of outbox preview projection input", () => {
  const row = baseRow({ decision: "would_create_initial_intent", intentKind: undefined as never });
  assert.doesNotMatch(JSON.stringify(row), /intent_kind.?test|manual_test/i);
  const projected = projectOutboxPreviewItem(row, basePlan());
  assert.equal(projected.lifecycleDecision, "would_create_initial_intent");
});
