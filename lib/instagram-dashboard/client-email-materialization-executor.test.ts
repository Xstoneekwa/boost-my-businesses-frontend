import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { ClientEmailOutboxPlanRow } from "./client-email-lifecycle-outbox-plan.ts";
import { enrichEffectiveCandidateWithGateProjections } from "./client-email-lifecycle-outbox-gates.ts";
import {
  CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV,
} from "./client-email-materialization-execution-gate.ts";
import {
  executeSingleClientEmailMaterializationInternal,
  revalidateSingleMaterializationCandidate,
} from "./client-email-materialization-executor.ts";
import type { OutboxEffectiveCandidateRow, OutboxSuppressedCandidateRow } from "./client-email-lifecycle-outbox-precedence.ts";
import type { ResolvedTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";
import type { MaterializeCandidateCommand } from "./client-email-outbox-materializer.ts";

const executorSource = readFileSync(
  new URL("./client-email-materialization-executor.ts", import.meta.url),
  "utf8",
);

const materializeReadyEnv = {
  CLIENT_EMAIL_MATERIALIZE_ENABLED: "true",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
};

const gateClosedEnv = {
  ...materializeReadyEnv,
  [CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV]: undefined,
};

const watermarkMissingEnv = {
  ...materializeReadyEnv,
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: undefined,
};

const deliverySettings: ResolvedTransactionalDeliverySettings = {
  activeFromEmail: "growth@boostmybusinesses.com",
  supportEmail: "growth@boostmybusinesses.com",
  configVersion: 2,
  source: "database",
  schemaReady: true,
  updatedAt: "2026-07-01T00:00:00.000Z",
};

test("watermark missing fails revalidation", () => {
  const candidate = buildEffectiveRow({}, watermarkMissingEnv);
  const revalidation = revalidateSingleMaterializationCandidate({
    candidate,
    recipientEmail: "client@example.com",
    deliverySettings,
    env: watermarkMissingEnv,
  });
  assert.equal(revalidation.status, "revalidation_failed");
  assert.equal(revalidation.code, "materialize_gate_closed");
});

function basePlan() {
  return {
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
  };
}

function buildEffectiveRow(
  overrides: Partial<ClientEmailOutboxPlanRow> = {},
  env: Record<string, string | undefined> = materializeReadyEnv,
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
  return enrichEffectiveCandidateWithGateProjections(row, basePlan(), env);
}

function buildSuppressedRow(): OutboxSuppressedCandidateRow {
  const row = buildEffectiveRow({ category: "needs_assistance" }, materializeReadyEnv);
  return {
    ...row,
    materializationEligible: false,
    materializationGateState: "not_applicable",
    dispatchEligible: false,
    dispatchGateState: "not_applicable",
    suppressedByCategory: "account_paused",
    suppressionReason: "needs assistance was suppressed because account paused takes precedence",
    isEffectiveCandidate: false,
  };
}

function createMockSupabase() {
  return {
    rpc: () => {
      throw new Error("rpc should not be called in executor tests");
    },
  };
}

test("execution gate closed returns execution_disabled without materializer call", async () => {
  let materializerCalls = 0;
  const decision = await executeSingleClientEmailMaterializationInternal({
    supabase: createMockSupabase(),
    candidate: buildEffectiveRow(),
    recipientEmail: "client@example.com",
    deliverySettings,
    env: gateClosedEnv,
    materializeInternal: async () => {
      materializerCalls += 1;
      throw new Error("materializer should not run");
    },
  });
  assert.equal(decision.status, "execution_disabled");
  assert.equal(materializerCalls, 0);
});

test("sending disabled does not block theoretical execute when materialize gate is open", () => {
  const revalidation = revalidateSingleMaterializationCandidate({
    candidate: buildEffectiveRow({}, {
      ...materializeReadyEnv,
      CLIENT_EMAIL_SENDING_ENABLED: "false",
    }),
    recipientEmail: "client@example.com",
    deliverySettings,
    env: {
      ...materializeReadyEnv,
      CLIENT_EMAIL_SENDING_ENABLED: "false",
    },
  });
  assert.equal("valid" in revalidation && revalidation.valid, true);
  if ("valid" in revalidation && revalidation.valid) {
    assert.equal(revalidation.command.operation, "create_lifecycle_initial_intent");
  }
});

test("suppressed or non-effective candidate fails revalidation", () => {
  const suppressed = revalidateSingleMaterializationCandidate({
    candidate: buildSuppressedRow() as unknown as OutboxEffectiveCandidateRow,
    recipientEmail: "client@example.com",
    deliverySettings,
    env: materializeReadyEnv,
  });
  assert.equal(suppressed.status, "revalidation_failed");
  assert.equal(suppressed.code, "suppressed_candidate");
});

test("watermark or automation invalid fails revalidation", () => {
  const automationClosedEnv = {
    ...materializeReadyEnv,
    CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "false",
  };
  const candidate = buildEffectiveRow({}, automationClosedEnv);
  const revalidation = revalidateSingleMaterializationCandidate({
    candidate,
    recipientEmail: "client@example.com",
    deliverySettings,
    env: automationClosedEnv,
  });
  assert.equal(revalidation.status, "revalidation_failed");
  assert.equal(revalidation.code, "materialize_gate_closed");
});

test("missing recipient email fails revalidation", () => {
  const revalidation = revalidateSingleMaterializationCandidate({
    candidate: buildEffectiveRow(),
    recipientEmail: null,
    deliverySettings,
    env: materializeReadyEnv,
  });
  assert.equal(revalidation.status, "revalidation_failed");
  assert.equal(revalidation.code, "missing_recipient_email");
});

test("would_open_episode candidate is rejected for execute initial path", () => {
  const revalidation = revalidateSingleMaterializationCandidate({
    candidate: buildEffectiveRow({ decision: "would_open_episode" }),
    recipientEmail: "client@example.com",
    deliverySettings,
    env: materializeReadyEnv,
  });
  assert.equal(revalidation.status, "revalidation_failed");
  assert.equal(revalidation.reason, "execute_initial_must_not_use_open_operation");
});

test("needs-more reminder requires active sequence parent", () => {
  const revalidation = revalidateSingleMaterializationCandidate({
    candidate: buildEffectiveRow({
      category: "needs_more_target_accounts",
      parentType: "sequence",
      parentKey: "needs_more:acct-1:2026-07-02T00:00:00.000Z",
      parentId: null,
      decision: "would_create_reminder_intent",
      reminderIndex: 1,
      trigger: "automatic_reminder",
      futureIntentSnapshot: {
        templateId: "tpl-nm",
        templateVersion: 1,
        snapshotSubject: "Subject",
        snapshotBodyText: "Body",
        snapshotBodyHtml: "<p>Body</p>",
        fromEmailSnapshot: "growth@boostmybusinesses.com",
        supportEmailSnapshot: "growth@boostmybusinesses.com",
        configVersion: 2,
        category: "needs_more_target_accounts",
        trigger: "automatic_reminder",
        reminderIndex: 1,
        parentType: "sequence",
        parentKey: "needs_more:acct-1:2026-07-02T00:00:00.000Z",
        idempotencyKey: "needs_more_targets:acct-1:episode:seq-1:index:1",
      },
    }),
    recipientEmail: "client@example.com",
    deliverySettings,
    env: materializeReadyEnv,
  });
  assert.equal(revalidation.status, "revalidation_failed");
  assert.equal(revalidation.code, "needs_more_active_sequence_required");
});

test("gate open with valid candidate invokes materializer exactly once", async () => {
  let materializerCalls = 0;
  let capturedCommand: MaterializeCandidateCommand | null = null;
  const decision = await executeSingleClientEmailMaterializationInternal({
    supabase: createMockSupabase(),
    candidate: buildEffectiveRow(),
    recipientEmail: "client@example.com",
    deliverySettings,
    env: materializeReadyEnv,
    materializeInternal: async (_supabase, command) => {
      materializerCalls += 1;
      capturedCommand = command;
      return {
        ok: true,
        parent: { id: "parent-1", kind: "lifecycle_episode", created: true },
        intent: {
          id: "intent-1",
          created: true,
          status: "pending",
          idempotencyKey: command.idempotencyKey ?? "",
        },
      };
    },
  });
  assert.equal(materializerCalls, 1);
  assert.equal(decision.status, "materialized");
  assert.equal(capturedCommand?.operation, "create_lifecycle_initial_intent");
});

test("executor source excludes dispatch postmark and claim integrations", () => {
  assert.doesNotMatch(executorSource, /from ['"].*client-email-postmark/);
  assert.doesNotMatch(executorSource, /from ['"].*dispatch/);
  assert.doesNotMatch(executorSource, /supabase\.rpc\(/);
});

test("executor module is not imported by app routes cron queue webhook or BotApp", () => {
  const roots = [
    join(process.cwd(), "app"),
    join(process.cwd(), "lib"),
  ];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
      if (full.includes("client-email-materialization-executor")) continue;
      if (full.includes("client-email-materialization-executor.test")) continue;
      const source = readFileSync(full, "utf8");
      if (/client-email-materialization-executor/.test(source)) {
        offenders.push(full.replace(`${process.cwd()}/`, ""));
      }
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, []);
});

test("executor accepts only one candidate per invocation by design", () => {
  assert.doesNotMatch(executorSource, /candidates\s*:\s*\[/);
  assert.doesNotMatch(executorSource, /for\s*\(\s*const\s+candidate\s+of\s+input\.candidates/);
  assert.match(executorSource, /candidate:\s*OutboxEffectiveCandidateRow/);
});
