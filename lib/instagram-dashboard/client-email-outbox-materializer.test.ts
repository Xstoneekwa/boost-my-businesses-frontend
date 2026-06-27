import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildClientEmailDemoValues } from "./client-email-delivery-settings.ts";
import {
  assertMaterializeIntentBusinessIdentityMatch,
  buildMaterializeCandidateCommand,
  buildMaterializeIntentBusinessIdentity,
  CLIENT_EMAIL_ACCOUNT_CLIENT_OWNERSHIP_MISMATCH,
  CLIENT_EMAIL_IDEMPOTENCY_IDENTITY_CONFLICT,
  isIntentMaterializeOperation,
  MATERIALIZE_CLIENT_EMAIL_OUTBOX_RPC,
  projectMaterializeRpcPayload,
  resolveStrictMaterializeOperation,
  validateMaterializeEffectiveCandidate,
} from "./client-email-outbox-materializer.ts";
import type { ClientEmailOutboxPlanRow } from "./client-email-lifecycle-outbox-plan.ts";
import type { OutboxEffectiveCandidateRow } from "./client-email-lifecycle-outbox-precedence.ts";
import { enrichEffectiveCandidateWithGateProjections } from "./client-email-lifecycle-outbox-gates.ts";

const materializeReadyEnv = {
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
};

const deliverySettings = {
  activeFromEmail: "growth@boostmybusinesses.com",
  supportEmail: "growth@boostmybusinesses.com",
  configVersion: 2,
  source: "database" as const,
  schemaReady: true,
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function buildEffectiveRow(
  overrides: Partial<ClientEmailOutboxPlanRow> = {},
): OutboxEffectiveCandidateRow {
  const row: ClientEmailOutboxPlanRow = {
    accountId: "acct-1",
    clientId: "client-1",
    instagramUsername: "user1",
    clientLabel: "Client",
    clientEmailMasked: "c***@example.com",
    category: "account_paused",
    parentType: "lifecycle_episode",
    parentKey: "account_paused:acct-1:2026-07-02T00:00:00.000Z",
    parentId: "ep-1",
    trigger: "automatic_initial",
    reminderIndex: 0,
    businessState: "paused",
    decision: "would_create_initial_intent",
    reason: "Initial intent",
    idempotencyKey: "lifecycle:account_paused:acct-1:episode:ep-1:index:0",
    activeTemplateId: "tpl-1",
    activeTemplateVersion: 2,
    fromEmailSnapshot: "growth@boostmybusinesses.com",
    supportEmailSnapshot: "growth@boostmybusinesses.com",
    configVersion: 2,
    futureIntentSnapshot: {
      templateId: "tpl-1",
      templateVersion: 2,
      snapshotSubject: "Subject",
      snapshotBodyText: "Body",
      snapshotBodyHtml: "<p>Body</p>",
      fromEmailSnapshot: "growth@boostmybusinesses.com",
      supportEmailSnapshot: "growth@boostmybusinesses.com",
      configVersion: 2,
      category: "account_paused",
      trigger: "automatic_initial",
      reminderIndex: 0,
      parentType: "lifecycle_episode",
      parentKey: "account_paused:acct-1:2026-07-02T00:00:00.000Z",
      idempotencyKey: "lifecycle:account_paused:acct-1:episode:ep-1:index:0",
    },
    ...overrides,
  };
  return enrichEffectiveCandidateWithGateProjections(row, {
    plannedAt: "2026-07-03T00:00:00.000Z",
    readOnly: true,
    mutationExecuted: false,
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
  }, materializeReadyEnv);
}

test("lifecycle category maps to create_lifecycle_initial_intent", () => {
  const built = buildMaterializeCandidateCommand({
    candidate: buildEffectiveRow(),
    recipientEmail: "client@example.com",
    deliverySettings,
    demoValues: buildClientEmailDemoValues(deliverySettings),
  });
  assert.equal(built.valid, true);
  if (!built.valid) return;
  assert.equal(built.command.operation, "create_lifecycle_initial_intent");
  assert.equal(built.command.businessIdentity?.reminderIndex, 0);
});

test("needs-more initial maps to create_needs_more_initial_intent", () => {
  const built = buildMaterializeCandidateCommand({
    candidate: buildEffectiveRow({
      category: "needs_more_target_accounts",
      parentType: "sequence",
      parentKey: "needs_more_targets:acct-1:2026-07-02T00:00:00.000Z",
      decision: "would_create_initial_intent",
      futureIntentSnapshot: {
        templateId: "tpl-2",
        templateVersion: 1,
        snapshotSubject: "Need targets",
        snapshotBodyText: "Body",
        snapshotBodyHtml: "<p>Body</p>",
        fromEmailSnapshot: "growth@boostmybusinesses.com",
        supportEmailSnapshot: "growth@boostmybusinesses.com",
        configVersion: 2,
        category: "needs_more_target_accounts",
        trigger: "automatic_initial",
        reminderIndex: 0,
        parentType: "sequence",
        parentKey: "needs_more_targets:acct-1:2026-07-02T00:00:00.000Z",
        idempotencyKey: "needs_more_targets:acct-1:episode:seq-1:index:0",
      },
      idempotencyKey: "needs_more_targets:acct-1:episode:seq-1:index:0",
    }),
    recipientEmail: "client@example.com",
    deliverySettings,
    demoValues: buildClientEmailDemoValues(deliverySettings),
  });
  assert.equal(built.valid, true);
  if (!built.valid) return;
  assert.equal(built.command.operation, "create_needs_more_initial_intent");
});

test("category and parent type mismatch is rejected", () => {
  const validation = validateMaterializeEffectiveCandidate({
    candidate: buildEffectiveRow({ parentType: "sequence" }),
    env: materializeReadyEnv,
    recipientEmail: "client@example.com",
  });
  assert.equal(validation.valid, false);
  if (validation.valid) return;
  assert.equal(validation.code, "category_parent_mismatch");
});

test("missing canonical email or snapshot is rejected", () => {
  const missingEmail = validateMaterializeEffectiveCandidate({
    candidate: buildEffectiveRow(),
    env: materializeReadyEnv,
    recipientEmail: "",
  });
  assert.equal(missingEmail.valid, false);

  const missingSnapshot = buildMaterializeCandidateCommand({
    candidate: buildEffectiveRow({ futureIntentSnapshot: null }),
    recipientEmail: "client@example.com",
    deliverySettings,
    demoValues: buildClientEmailDemoValues(deliverySettings),
  });
  assert.equal(missingSnapshot.valid, false);
});

test("CLIENT_EMAIL_SENDING_ENABLED=false does not block materialize build", () => {
  const row = buildEffectiveRow();
  assert.equal(row.materializationEligible, true);
  assert.equal(row.dispatchEligible, false);

  const built = buildMaterializeCandidateCommand({
    candidate: row,
    recipientEmail: "client@example.com",
    deliverySettings,
    demoValues: buildClientEmailDemoValues(deliverySettings),
  });
  assert.equal(built.valid, true);
});

test("automation/watermark gate blocks materialize validation", () => {
  const validation = validateMaterializeEffectiveCandidate({
    candidate: buildEffectiveRow(),
    env: {
      ...materializeReadyEnv,
      CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "false",
    },
    recipientEmail: "client@example.com",
  });
  assert.equal(validation.valid, false);
});

test("suppressed candidate is rejected", () => {
  const row = buildEffectiveRow();
  const validation = validateMaterializeEffectiveCandidate({
    candidate: { ...row, isEffectiveCandidate: false },
    env: materializeReadyEnv,
    recipientEmail: "client@example.com",
    suppressed: true,
  });
  assert.equal(validation.valid, false);
  if (validation.valid) return;
  assert.equal(validation.code, "suppressed_candidate");
});

test("same idempotency key and same business identity is accepted", () => {
  const identity = buildMaterializeIntentBusinessIdentity({
    accountId: "acct-1",
    clientId: "client-1",
    category: "account_paused",
    trigger: "automatic_initial",
    reminderIndex: 0,
    parentType: "lifecycle_episode",
    parentId: "ep-1",
    idempotencyKey: "lifecycle:account_paused:acct-1:episode:ep-1:index:0",
  });
  const match = assertMaterializeIntentBusinessIdentityMatch(identity, { ...identity });
  assert.equal(match.ok, true);
});

test("same idempotency key with different account triggers identity conflict", () => {
  const expected = buildMaterializeIntentBusinessIdentity({
    accountId: "acct-1",
    clientId: "client-1",
    category: "account_paused",
    trigger: "automatic_initial",
    reminderIndex: 0,
    parentType: "lifecycle_episode",
    parentId: "ep-1",
    idempotencyKey: "same-key",
  });
  const actual = { ...expected, accountId: "acct-2" };
  const match = assertMaterializeIntentBusinessIdentityMatch(expected, actual);
  assert.equal(match.ok, false);
  if (match.ok) return;
  assert.equal(match.code, CLIENT_EMAIL_IDEMPOTENCY_IDENTITY_CONFLICT);
});

test("same idempotency key with different client triggers identity conflict", () => {
  const expected = buildMaterializeIntentBusinessIdentity({
    accountId: "acct-1",
    clientId: "client-1",
    category: "account_paused",
    trigger: "automatic_initial",
    reminderIndex: 0,
    parentType: "lifecycle_episode",
    parentId: "ep-1",
    idempotencyKey: "same-key",
  });
  const match = assertMaterializeIntentBusinessIdentityMatch(expected, { ...expected, clientId: "client-2" });
  assert.equal(match.ok, false);
});

test("same idempotency key with different category trigger parent or reminder index conflicts", () => {
  const base = buildMaterializeIntentBusinessIdentity({
    accountId: "acct-1",
    clientId: "client-1",
    category: "account_paused",
    trigger: "automatic_initial",
    reminderIndex: 0,
    parentType: "lifecycle_episode",
    parentId: "ep-1",
    idempotencyKey: "same-key",
  });
  assert.equal(assertMaterializeIntentBusinessIdentityMatch(base, { ...base, category: "needs_assistance" }).ok, false);
  assert.equal(assertMaterializeIntentBusinessIdentityMatch(base, { ...base, trigger: "automatic_reminder" }).ok, false);
  assert.equal(assertMaterializeIntentBusinessIdentityMatch(base, { ...base, parentId: "ep-2" }).ok, false);
  assert.equal(assertMaterializeIntentBusinessIdentityMatch(base, { ...base, reminderIndex: 1 }).ok, false);
});

test("lifecycle reminder operation is never resolved in V1", () => {
  assert.equal(resolveStrictMaterializeOperation({
    category: "account_paused",
    decision: "would_create_reminder_intent",
    reminderIndex: 1,
    parentId: "ep-1",
  }), null);
});

test("needs-more reminder without active sequence parent is rejected", () => {
  const built = buildMaterializeCandidateCommand({
    candidate: buildEffectiveRow({
      category: "needs_more_target_accounts",
      parentType: "sequence",
      parentId: null,
      parentKey: "needs_more_targets:acct-1:2026-07-02T00:00:00.000Z",
      decision: "would_create_reminder_intent",
      trigger: "automatic_reminder",
      reminderIndex: 2,
      futureIntentSnapshot: {
        templateId: "tpl-2",
        templateVersion: 1,
        snapshotSubject: "Reminder",
        snapshotBodyText: "Body",
        snapshotBodyHtml: "<p>Body</p>",
        fromEmailSnapshot: "growth@boostmybusinesses.com",
        supportEmailSnapshot: "growth@boostmybusinesses.com",
        configVersion: 2,
        category: "needs_more_target_accounts",
        trigger: "automatic_reminder",
        reminderIndex: 2,
        parentType: "sequence",
        parentKey: "needs_more_targets:acct-1:2026-07-02T00:00:00.000Z",
        idempotencyKey: "needs_more_targets:acct-1:episode:seq-1:index:2",
      },
      idempotencyKey: "needs_more_targets:acct-1:episode:seq-1:index:2",
    }),
    recipientEmail: "client@example.com",
    deliverySettings,
    demoValues: buildClientEmailDemoValues(deliverySettings),
  });
  assert.equal(built.valid, false);
  if (built.valid) return;
  assert.equal(built.code, "needs_more_active_sequence_required");
});

test("lifecycle non-zero reminder index is rejected", () => {
  const validation = validateMaterializeEffectiveCandidate({
    candidate: buildEffectiveRow({ reminderIndex: 1, decision: "would_create_initial_intent" }),
    env: materializeReadyEnv,
    recipientEmail: "client@example.com",
  });
  assert.equal(validation.valid, false);
});

test("stable idempotency payload excludes rendered snapshot identity comparisons", () => {
  const first = buildMaterializeCandidateCommand({
    candidate: buildEffectiveRow(),
    recipientEmail: "client@example.com",
    deliverySettings,
    demoValues: buildClientEmailDemoValues(deliverySettings),
  });
  const second = buildMaterializeCandidateCommand({
    candidate: buildEffectiveRow({
      futureIntentSnapshot: {
        ...(buildEffectiveRow().futureIntentSnapshot as NonNullable<ClientEmailOutboxPlanRow["futureIntentSnapshot"]>),
        snapshotSubject: "Different subject after template change",
      },
    }),
    recipientEmail: "client@example.com",
    deliverySettings,
    demoValues: buildClientEmailDemoValues(deliverySettings),
  });
  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  if (!first.valid || !second.valid) return;
  assert.equal(
    projectMaterializeRpcPayload(first.command).p_idempotency_key,
    projectMaterializeRpcPayload(second.command).p_idempotency_key,
  );
  assert.notEqual(
    first.command.intentSnapshot?.snapshotSubject,
    second.command.intentSnapshot?.snapshotSubject,
  );
});

test("intent operations use strict operation names and exclude dispatch fields", () => {
  const built = buildMaterializeCandidateCommand({
    candidate: buildEffectiveRow(),
    recipientEmail: "client@example.com",
    deliverySettings,
    demoValues: buildClientEmailDemoValues(deliverySettings),
  });
  assert.equal(built.valid, true);
  if (!built.valid) return;
  assert.equal(isIntentMaterializeOperation(built.command.operation), true);
  const payload = projectMaterializeRpcPayload(built.command);
  assert.doesNotMatch(JSON.stringify(payload), /claim_token|provider_message_id|dispatch_uncertain/i);
});

test("open lifecycle episode has no intent snapshot payload", () => {
  const built = buildMaterializeCandidateCommand({
    candidate: buildEffectiveRow({
      decision: "would_open_episode",
      trigger: null,
      reminderIndex: null,
      futureIntentSnapshot: null,
      idempotencyKey: null,
    }),
    deliverySettings,
    demoValues: buildClientEmailDemoValues(deliverySettings),
  });
  assert.equal(built.valid, true);
  if (!built.valid) return;
  assert.equal(built.command.operation, "open_lifecycle_episode");
  assert.equal(built.command.intentSnapshot, null);
});

test("ownership mismatch code is exported for RPC mapping", () => {
  assert.equal(CLIENT_EMAIL_ACCOUNT_CLIENT_OWNERSHIP_MISMATCH, "client_email_account_client_ownership_mismatch");
});

test("RPC name is stable for future internal caller", () => {
  assert.equal(MATERIALIZE_CLIENT_EMAIL_OUTBOX_RPC, "materialize_client_email_outbox_candidate_v1");
});
