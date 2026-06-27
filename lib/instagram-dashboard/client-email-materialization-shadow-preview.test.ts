import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  relayAuthStatus,
  verifyCompassRelayKey,
} from "../../app/api/instagram-dashboard/compass/relay-auth.ts";
import type { ClientEmailOutboxPlanRow } from "./client-email-lifecycle-outbox-plan.ts";
import { enrichEffectiveCandidateWithGateProjections } from "./client-email-lifecycle-outbox-gates.ts";
import {
  buildClientEmailMaterializationRunPlan,
  planClientEmailMaterializationShadowRun,
} from "./client-email-materialization-runner.ts";

const shadowRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-lifecycle/materialization-shadow-preview/route.ts", import.meta.url),
  "utf8",
);

const materializeReadyEnv = {
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
};

const watermarkMissingEnv = {
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
};

function basePlan() {
  return {
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
  };
}

function buildEffectiveRow(overrides: Partial<ClientEmailOutboxPlanRow> = {}, env = materializeReadyEnv) {
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

test("materialization shadow route requires relay or admin and uses shadow runner only", () => {
  assert.match(shadowRoute, /requireRelayOrAdmin/);
  assert.match(shadowRoute, /planClientEmailMaterializationShadowRun/);
  assert.match(shadowRoute, /Cache-Control/);
  assert.match(shadowRoute, /no-store/);
  assert.doesNotMatch(shadowRoute, /materializeClientEmailOutboxCandidateInternal|supabase\.rpc|postmark|webhook/i);
  assert.doesNotMatch(shadowRoute, /insert\(|update\(|upsert\(|delete\(/i);
});

test("relay auth without key returns 401 when relay key configured", () => {
  const previous = process.env.BOTAPP_RELAY_API_KEY;
  process.env.BOTAPP_RELAY_API_KEY = "configured-relay-key";
  try {
    const auth = verifyCompassRelayKey(new Headers());
    assert.equal(auth.ok, false);
    if (!auth.ok) {
      assert.equal(auth.reason, "relay_auth_required");
      assert.equal(relayAuthStatus(auth.reason), 401);
    }
  } finally {
    process.env.BOTAPP_RELAY_API_KEY = previous;
  }
});

test("relay auth with invalid key returns 403 when relay key configured", () => {
  const previous = process.env.BOTAPP_RELAY_API_KEY;
  process.env.BOTAPP_RELAY_API_KEY = "configured-relay-key";
  try {
    const auth = verifyCompassRelayKey(new Headers({ "x-botapp-relay-key": "wrong-key" }));
    assert.equal(auth.ok, false);
    if (!auth.ok) {
      assert.equal(auth.reason, "relay_auth_invalid");
      assert.equal(relayAuthStatus(auth.reason), 403);
    }
  } finally {
    process.env.BOTAPP_RELAY_API_KEY = previous;
  }
});

test("relay auth with valid key passes relay mode", () => {
  const previous = process.env.BOTAPP_RELAY_API_KEY;
  process.env.BOTAPP_RELAY_API_KEY = "configured-relay-key";
  try {
    const auth = verifyCompassRelayKey(new Headers({ "x-botapp-relay-key": "configured-relay-key" }));
    assert.deepEqual(auth, { ok: true, mode: "relay_key" });
  } finally {
    process.env.BOTAPP_RELAY_API_KEY = previous;
  }
});

test("shadow preview envelope is fixed and includes operation summary", async () => {
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
    env: watermarkMissingEnv,
    now: new Date("2026-07-03T00:00:00.000Z"),
  });

  assert.equal(run.executionMode, "shadow");
  assert.equal(run.readOnly, true);
  assert.equal(run.mutationExecuted, false);
  assert.equal(run.rpcInvoked, false);
  assert.equal(typeof run.operationSummary.create_lifecycle_initial_intent, "number");
  assert.equal(typeof run.dispatchReadinessStatus, "string");
  assert.ok(Array.isArray(run.materializationBlockingReasons));
  assert.ok(Array.isArray(run.dispatchBlockingReasons));
});

test("shadow preview response excludes sensitive fields", () => {
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [buildEffectiveRow()],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  const json = JSON.stringify(plan);
  assert.doesNotMatch(json, /growth@boostmybusinesses\.com/i);
  assert.doesNotMatch(json, /snapshotSubject|snapshotBody|idempotencyKey|parentId|accountId|clientId|acct-1|tpl-1|ep-1/i);
});

test("watermark missing produces visible skip not sending disabled reason", () => {
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [buildEffectiveRow({}, watermarkMissingEnv)],
    env: watermarkMissingEnv,
    materializationReadinessStatus: "partial",
  });
  assert.equal(plan.summary.wouldMaterialize, 0);
  assert.match(plan.items[0]?.skipReason ?? "", /watermark/i);
  assert.doesNotMatch(plan.items[0]?.skipReason ?? "", /CLIENT_EMAIL_SENDING_ENABLED/i);
});

test("sending disabled allows theoretical materialize when automation and watermark gates open", () => {
  const candidate = buildEffectiveRow({}, materializeReadyEnv);
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [candidate],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  assert.equal(plan.summary.wouldMaterialize, 1);
  assert.equal(plan.items[0]?.operation, "create_lifecycle_initial_intent");
});

test("precedence-suppressed candidate never appears in shadow plan items", () => {
  const plan = buildClientEmailMaterializationRunPlan({
    effectiveCandidates: [buildEffectiveRow()],
    env: materializeReadyEnv,
    materializationReadinessStatus: "ready",
  });
  assert.equal(plan.summary.inputEffectiveCandidates, 1);
  assert.doesNotMatch(JSON.stringify(plan.items), /suppressed because/i);
});
