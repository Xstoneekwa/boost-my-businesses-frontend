import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { ClientEmailOutboxPlanRow } from "./client-email-lifecycle-outbox-plan.ts";
import { enrichEffectiveCandidateWithGateProjections } from "./client-email-lifecycle-outbox-gates.ts";
import {
  buildClientEmailMaterializationRunPlan,
  planClientEmailMaterializationShadowRun,
} from "./client-email-materialization-runner.ts";
import type { OutboxEffectiveCandidateRow, OutboxSuppressedCandidateRow } from "./client-email-lifecycle-outbox-precedence.ts";

const runnerSource = readFileSync(
  new URL("./client-email-materialization-runner.ts", import.meta.url),
  "utf8",
);

const materializeReadyEnv = {
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
};

const gatesClosedEnv = {
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "false",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
};

const watermarkMissingEnv = {
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
};

function basePlan(): Parameters<typeof enrichEffectiveCandidateWithGateProjections>[1] {
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

const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

test("lifecycle effective candidate materialization eligible maps to create_lifecycle_initial_intent", () => {
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [buildEffectiveRow()],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  assert.equal(plan.summary.wouldMaterialize, 1);
  assert.equal(plan.items[0]?.operation, "create_lifecycle_initial_intent");
  assert.equal(plan.items[0]?.parentType, "lifecycle_episode");
  assert.equal(plan.items[0]?.status, "would_materialize");
});

test("needs-more initial maps to create_needs_more_initial_intent", () => {
  const candidate = buildEffectiveRow({
    category: "needs_more_target_accounts",
    parentType: "sequence",
    parentKey: "needs_more:acct-1:2026-07-02T00:00:00.000Z",
    parentId: null,
    decision: "would_create_initial_intent",
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
      trigger: "automatic_initial",
      reminderIndex: 0,
      parentType: "sequence",
      parentKey: "needs_more:acct-1:2026-07-02T00:00:00.000Z",
      idempotencyKey: "needs-more:acct-1:index:0",
    },
  }, materializeReadyEnv);
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [candidate],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  assert.equal(plan.items[0]?.operation, "create_needs_more_initial_intent");
  assert.equal(plan.items[0]?.parentType, "sequence");
});

test("needs-more reminder maps to create_needs_more_reminder_intent", () => {
  const candidate = buildEffectiveRow({
    category: "needs_more_target_accounts",
    parentType: "sequence",
    parentKey: "needs_more:acct-1:2026-07-02T00:00:00.000Z",
    parentId: "seq-1",
    decision: "would_create_reminder_intent",
    reminderIndex: 2,
    trigger: "automatic_reminder",
    futureIntentSnapshot: {
      templateId: "tpl-nm",
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
      parentKey: "needs_more:acct-1:2026-07-02T00:00:00.000Z",
      idempotencyKey: "needs-more:acct-1:index:2",
    },
  }, materializeReadyEnv);
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [candidate],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  assert.equal(plan.items[0]?.operation, "create_needs_more_reminder_intent");
  assert.equal(plan.items[0]?.reminderIndex, 2);
});

test("precedence-suppressed candidate is excluded from shadow plan input", () => {
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [buildEffectiveRow(), buildSuppressedRow() as never],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  assert.equal(plan.summary.inputEffectiveCandidates, 1);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0]?.category, "account_paused");
});

test("watermark absent skips with watermark reason not sending disabled", () => {
  const candidate = buildEffectiveRow({}, watermarkMissingEnv);
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [candidate],
    env: watermarkMissingEnv,
    materializationReadinessStatus: "partial",
  });
  assert.equal(plan.summary.wouldMaterialize, 0);
  assert.match(plan.items[0]?.skipReason ?? "", /watermark/i);
  assert.doesNotMatch(plan.items[0]?.skipReason ?? "", /CLIENT_EMAIL_SENDING_ENABLED/i);
  assert.equal(plan.items[0]?.skipCode, "watermark_not_configured");
});

test("automation off skips materialization plan item", () => {
  const candidate = buildEffectiveRow({}, gatesClosedEnv);
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [candidate],
    env: gatesClosedEnv,
    materializationReadinessStatus: "partial",
  });
  assert.equal(plan.summary.wouldMaterialize, 0);
  assert.equal(plan.items[0]?.status, "skipped");
  assert.match(plan.items[0]?.skipReason ?? "", /automation/i);
});

test("sending disabled does not block theoretical materialize when automation gates open", () => {
  const candidate = buildEffectiveRow({}, materializeReadyEnv);
  assert.equal(candidate.materializationEligible, true);
  assert.equal(candidate.dispatchEligible, false);
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [candidate],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  assert.equal(plan.summary.wouldMaterialize, 1);
});

test("missing template snapshot skips materialization plan item", () => {
  const candidate = buildEffectiveRow({ futureIntentSnapshot: null });
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [candidate],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  assert.equal(plan.summary.wouldMaterialize, 0);
  assert.equal(plan.items[0]?.skipCode, "missing_intent_snapshot");
});

test("parent type mismatch skips materialization plan item", () => {
  const candidate = buildEffectiveRow({ parentType: "sequence" });
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [candidate],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  assert.equal(plan.summary.wouldMaterialize, 0);
  assert.equal(plan.items[0]?.skipCode, "category_parent_mismatch");
});

test("raw non-effective observation is never included when only effective candidates are passed", () => {
  const rawRow = buildEffectiveRow({
    decision: "blocked_legacy_pre_watermark",
    reason: "Legacy pre-watermark",
    futureIntentSnapshot: null,
  });
  const enriched = enrichEffectiveCandidateWithGateProjections(rawRow, basePlan(), materializeReadyEnv);
  assert.equal(enriched.materializationEligible, false);
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [enriched],
    env: materializeReadyEnv,
    materializationReadinessStatus: "partial",
  });
  assert.equal(plan.summary.wouldMaterialize, 0);
});

test("shadow plan output is redacted", () => {
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [buildEffectiveRow()],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  const json = JSON.stringify(plan);
  assert.doesNotMatch(json, /growth@boostmybusinesses\.com/i);
  assert.doesNotMatch(json, /snapshotBody/i);
  assert.doesNotMatch(json, /acct-1|client-1|tpl-1|ep-1/);
  uuidRe.lastIndex = 0;
  assert.doesNotMatch(json, uuidRe);
});

test("runner source has no supabase rpc mutation postmark or insert", () => {
  assert.doesNotMatch(runnerSource, /supabase\.rpc/i);
  assert.doesNotMatch(runnerSource, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/i);
  assert.doesNotMatch(runnerSource, /postmark/i);
  assert.doesNotMatch(runnerSource, /materializeClientEmailOutboxCandidateInternal/i);
});

test("shadow loader returns shadow envelope without rpc", async () => {
  const supabase = {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };

  const run = await planClientEmailMaterializationShadowRun(supabase as never, {
    env: gatesClosedEnv,
    now: new Date("2026-07-03T00:00:00.000Z"),
  });

  assert.equal(run.executionMode, "shadow");
  assert.equal(run.readOnly, true);
  assert.equal(run.mutationExecuted, false);
  assert.equal(run.rpcInvoked, false);
  assert.equal(typeof run.rawObservations, "number");
  assert.equal(typeof run.effectiveCandidates, "number");
});

test("no app route or api imports materialization runner", () => {
  const appRoot = new URL("../../app", import.meta.url);
  const stack = [appRoot.pathname];
  const hits: string[] = [];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const source = readFileSync(full, "utf8");
        if (source.includes("client-email-materialization-runner")) hits.push(full);
      }
    }
  }
  assert.deepEqual(hits, []);
});
