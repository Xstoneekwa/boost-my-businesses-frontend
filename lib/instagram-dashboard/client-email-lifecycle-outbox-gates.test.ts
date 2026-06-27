import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichEffectiveCandidateWithGateProjections,
  evaluateCategoryDispatchAutomationGate,
  projectRowDispatchReadiness,
  projectRowMaterializationReadiness,
} from "./client-email-lifecycle-outbox-gates.ts";
import {
  evaluateMaterializeLifecycleAutomationGate,
} from "./client-email-lifecycle-automation-gates.ts";
import type { ClientEmailOutboxPlanRow } from "./client-email-lifecycle-outbox-plan.ts";
import { projectClientEmailLifecycleOutboxPreview } from "./client-email-lifecycle-outbox-preview.ts";

const materializeReadyEnv = {
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CLIENT_EMAIL_PROVIDER: "postmark",
  POSTMARK_SERVER_TOKEN: "token",
};

const dispatchReadyEnv = {
  ...materializeReadyEnv,
  CLIENT_EMAIL_SENDING_ENABLED: "true",
};

function buildPlanRow(overrides: Partial<ClientEmailOutboxPlanRow> = {}): ClientEmailOutboxPlanRow {
  return {
    accountId: "acct-1",
    clientId: "client-1",
    instagramUsername: "user1",
    clientLabel: "Client",
    clientEmailMasked: "c***@example.com",
    category: "account_paused",
    parentType: "lifecycle_episode",
    parentKey: "account_paused:acct-1:2026-07-02T00:00:00.000Z",
    parentId: null,
    trigger: "automatic_initial",
    reminderIndex: 0,
    businessState: "paused",
    decision: "would_create_initial_intent",
    reason: "Initial account paused client intent would be created with lifecycle episode parent.",
    idempotencyKey: "lifecycle:account_paused:acct-1:episode:abc:index:0",
    activeTemplateId: "tpl-1",
    activeTemplateVersion: 2,
    fromEmailSnapshot: "growth@boostmybusinesses.com",
    supportEmailSnapshot: "growth@boostmybusinesses.com",
    configVersion: 1,
    futureIntentSnapshot: null,
    ...overrides,
  };
}

const basePlan = () => ({
  plannedAt: "2026-07-03T00:00:00.000Z",
  readOnly: true as const,
  mutationExecuted: false as const,
  schemaIntentLinksReady: true,
  lifecycleSchemaReady: true,
  needsMoreSchemaReady: true,
  globalSendingEnabled: false,
  lifecycleAutomationEnabled: true,
  needsMoreAutomationEnabled: true,
  lifecycleWatermarkConfigured: true,
  needsMoreWatermarkConfigured: true,
  providerDispatchAllowed: false,
  accountsAnalyzed: 1,
  rows: [],
});

test("materialize lifecycle gate ignores CLIENT_EMAIL_SENDING_ENABLED", () => {
  const gate = evaluateMaterializeLifecycleAutomationGate(materializeReadyEnv);
  assert.equal(gate.allowed, true);
});

test("valid candidate with automation and watermark but sending false", () => {
  const row = buildPlanRow();
  const materialization = projectRowMaterializationReadiness(row, materializeReadyEnv);
  assert.equal(materialization.eligible, true);
  assert.equal(materialization.gateState, "open");

  const dispatch = projectRowDispatchReadiness({
    row,
    materialization,
    plan: { ...basePlan(), globalSendingEnabled: false, providerDispatchAllowed: false },
    env: materializeReadyEnv,
    senderConfigured: true,
    supportEmailConfigured: true,
  });
  assert.equal(dispatch.eligible, false);
  assert.match(dispatch.blockingReasons.join(" "), /disabled by CLIENT_EMAIL_SENDING_ENABLED/i);
});

test("automation false blocks materialization even when sending true", () => {
  const row = buildPlanRow();
  const env = {
    ...dispatchReadyEnv,
    CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "false",
  };
  const materialization = projectRowMaterializationReadiness(row, env);
  assert.equal(materialization.eligible, false);
  const dispatch = projectRowDispatchReadiness({
    row,
    materialization,
    plan: basePlan(),
    env,
    senderConfigured: true,
    supportEmailConfigured: true,
  });
  assert.equal(dispatch.eligible, false);
});

test("dispatch requires sending enabled after materialization is open", () => {
  const row = buildPlanRow();
  const materialization = projectRowMaterializationReadiness(row, dispatchReadyEnv);
  const dispatch = projectRowDispatchReadiness({
    row,
    materialization,
    plan: { ...basePlan(), globalSendingEnabled: true, providerDispatchAllowed: true },
    env: dispatchReadyEnv,
    senderConfigured: true,
    supportEmailConfigured: true,
  });
  assert.equal(materialization.eligible, true);
  assert.equal(dispatch.eligible, true);
  assert.equal(evaluateCategoryDispatchAutomationGate(row.category, dispatchReadyEnv).allowed, true);
});

test("preview keeps business decision when sending false", () => {
  const row = buildPlanRow();
  const preview = projectClientEmailLifecycleOutboxPreview({
    plan: { ...basePlan(), rows: [row] },
    readinessStatus: "partial",
    readinessBlockingReasons: [],
    materializationReadinessStatus: "partial",
    dispatchReadinessStatus: "blocked",
    materializationBlockingReasons: [],
    dispatchBlockingReasons: ["Client email sending is disabled by CLIENT_EMAIL_SENDING_ENABLED."],
    env: materializeReadyEnv,
  });
  assert.equal(preview.items[0]?.lifecycleDecision, "would_create_initial_intent");
  assert.equal(preview.items[0]?.materializationEligible, true);
  assert.equal(preview.items[0]?.dispatchEligible, false);
  assert.equal(preview.summary.wouldMaterializeTheoretical, 1);
  assert.equal(preview.summary.readyToDispatchTheoretical, 0);
});

test("blocked legacy pre-watermark is not relabeled as delivery gate", () => {
  const row = buildPlanRow({
    decision: "blocked_legacy_pre_watermark",
    reason: "Historical lifecycle state detected before activation evidence.",
    trigger: null,
    reminderIndex: null,
    idempotencyKey: null,
  });
  const enriched = enrichEffectiveCandidateWithGateProjections(row, basePlan(), materializeReadyEnv);
  assert.equal(enriched.decision, "blocked_legacy_pre_watermark");
  assert.equal(enriched.materializationEligible, false);
  assert.equal(enriched.dispatchEligible, false);
});
