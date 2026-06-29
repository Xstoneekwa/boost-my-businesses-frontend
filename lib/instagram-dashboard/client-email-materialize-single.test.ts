import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  relayAuthStatus,
  verifyCompassRelayKey,
} from "../../app/api/instagram-dashboard/compass/relay-auth.ts";
import type { ClientEmailOutboxPlanRow } from "./client-email-lifecycle-outbox-plan.ts";
import { enrichEffectiveCandidateWithGateProjections } from "./client-email-lifecycle-outbox-gates.ts";
import {
  buildMaterializeSingleGateClosedResponse,
  executeMaterializeSingleRequest,
  findMaterializeSingleEffectiveCandidate,
  MATERIALIZE_SINGLE_CONFIRMATION,
  parseMaterializeSingleRequestBody,
  projectMaterializeSingleSuccessResponse,
} from "./client-email-materialize-single.ts";
import {
  CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV,
} from "./client-email-materialization-execution-gate.ts";
import type { OutboxEffectiveCandidateRow, OutboxSuppressedCandidateRow } from "./client-email-lifecycle-outbox-precedence.ts";
import type { ResolvedTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";

const routeSource = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-lifecycle/materialize-single/route.ts", import.meta.url),
  "utf8",
);

const materializeSingleSource = readFileSync(
  new URL("./client-email-materialize-single.ts", import.meta.url),
  "utf8",
);

const materializeReadyEnv = {
  [CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV]: "true",
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

function buildEffectiveRow(
  overrides: Partial<ClientEmailOutboxPlanRow> = {},
  env = materializeReadyEnv,
): OutboxEffectiveCandidateRow {
  const row: ClientEmailOutboxPlanRow = {
    accountId: "acct-1",
    clientId: "client-1",
    instagramUsername: "pilot_user",
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

function buildSuppressedRow(overrides: Partial<ClientEmailOutboxPlanRow> = {}): OutboxSuppressedCandidateRow {
  const row = buildEffectiveRow({
    category: "needs_assistance",
    decision: "would_create_initial_intent",
    ...overrides,
  });
  return {
    ...row,
    materializationEligible: false,
    materializationGateState: "not_applicable",
    dispatchEligible: false,
    dispatchGateState: "not_applicable",
    suppressedByCategory: "account_canceled",
    suppressionReason: "needs assistance was suppressed because account canceled takes precedence",
    isEffectiveCandidate: false,
  };
}

test("materialize-single route checks auth then execution gate before body parsing", () => {
  assert.match(routeSource, /requireRelayOrAdmin/);
  assert.match(routeSource, /evaluateClientEmailMaterializationExecutionGate/);
  assert.match(routeSource, /buildMaterializeSingleGateClosedResponse/);
  assert.match(routeSource, /Cache-Control/);
  assert.match(routeSource, /no-store/);
  assert.doesNotMatch(routeSource, /planClientEmailMaterializationShadowRun|materializeClientEmailOutboxCandidateInternal|supabase\.rpc|postmark/i);

  const gateIndex = routeSource.indexOf("evaluateClientEmailMaterializationExecutionGate(process.env)");
  const jsonIndex = routeSource.indexOf("await request.json()");
  const executeIndex = routeSource.indexOf("await executeMaterializeSingleRequest(");
  assert.ok(gateIndex >= 0);
  assert.ok(jsonIndex >= 0);
  assert.ok(executeIndex >= 0);
  assert.ok(gateIndex < jsonIndex);
  assert.ok(gateIndex < executeIndex);
});

test("gate closed response is safe and stable", () => {
  const response = buildMaterializeSingleGateClosedResponse();
  assert.deepEqual(response, {
    ok: false,
    reason: "materialize_execution_disabled",
    executionMode: "disabled",
    readOnly: true,
    mutationExecuted: false,
    rpcInvoked: false,
  });
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

test("executeMaterializeSingleRequest returns 409 when gate unset without planner or executor", async () => {
  let plannerCalls = 0;
  let executorCalls = 0;
  const result = await executeMaterializeSingleRequest({
    supabase: {
      from() {
        plannerCalls += 1;
        throw new Error("planner should not run when gate closed");
      },
    } as never,
    body: {
      instagramUsername: "pilot_user",
      category: "account_paused",
      confirmation: MATERIALIZE_SINGLE_CONFIRMATION,
    },
    env: gateClosedEnv,
    executeInternal: async () => {
      executorCalls += 1;
      throw new Error("executor should not run when gate closed");
    },
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, "materialize_execution_disabled");
  assert.equal(result.body.rpcInvoked, false);
  assert.equal(plannerCalls, 0);
  assert.equal(executorCalls, 0);
});

test("executeMaterializeSingleRequest returns 409 when gate is false", async () => {
  const result = await executeMaterializeSingleRequest({
    supabase: { from: () => { throw new Error("no planner"); } } as never,
    body: {
      instagramUsername: "pilot_user",
      category: "account_paused",
      confirmation: MATERIALIZE_SINGLE_CONFIRMATION,
    },
    env: {
      ...materializeReadyEnv,
      [CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV]: "false",
    },
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, "materialize_execution_disabled");
});

test("parseMaterializeSingleRequestBody rejects forbidden client-controlled fields", () => {
  const parsed = parseMaterializeSingleRequestBody({
    instagramUsername: "pilot_user",
    category: "account_paused",
    confirmation: MATERIALIZE_SINGLE_CONFIRMATION,
    accountId: "acct-1",
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.reason, "invalid_materialize_single_request");
  }
});

test("parseMaterializeSingleRequestBody requires exact confirmation phrase", () => {
  assert.equal(
    parseMaterializeSingleRequestBody({
      instagramUsername: "pilot_user",
      category: "account_paused",
      confirmation: "YES",
    }).ok,
    false,
  );
  assert.equal(
    parseMaterializeSingleRequestBody({
      instagramUsername: "pilot_user",
      category: "account_paused",
    }).ok,
    false,
  );
});

test("findMaterializeSingleEffectiveCandidate rejects legacy pre-watermark effective rows", () => {
  const legacy = buildEffectiveRow({
    instagramUsername: "botapp",
    category: "account_canceled",
    decision: "blocked_legacy_pre_watermark",
  }, materializeReadyEnv);
  const lookup = findMaterializeSingleEffectiveCandidate({
    effectiveCandidates: [legacy],
    suppressedCandidates: [],
    instagramUsername: "botapp",
    category: "account_canceled",
  });
  assert.equal(lookup.ok, false);
  if (!lookup.ok) {
    assert.equal(lookup.reason, "materialize_single_candidate_not_eligible");
  }
});

test("findMaterializeSingleEffectiveCandidate rejects precedence-suppressed rows", () => {
  const lookup = findMaterializeSingleEffectiveCandidate({
    effectiveCandidates: [buildEffectiveRow({ instagramUsername: "acct_a", category: "account_canceled" })],
    suppressedCandidates: [buildSuppressedRow({ instagramUsername: "acct_a", category: "needs_assistance" })],
    instagramUsername: "acct_a",
    category: "needs_assistance",
  });
  assert.equal(lookup.ok, false);
  if (!lookup.ok) {
    assert.equal(lookup.reason, "materialize_single_candidate_not_effective");
  }
});

test("findMaterializeSingleEffectiveCandidate rejects open parent-only decisions", () => {
  const openOnly = buildEffectiveRow({
    decision: "would_open_episode",
    parentId: null,
    trigger: null,
    reminderIndex: null,
  });
  const lookup = findMaterializeSingleEffectiveCandidate({
    effectiveCandidates: [openOnly],
    suppressedCandidates: [],
    instagramUsername: "pilot_user",
    category: "account_paused",
  });
  assert.equal(lookup.ok, false);
  if (!lookup.ok) {
    assert.equal(lookup.reason, "materialize_single_revalidation_failed");
  }
});

test("findMaterializeSingleEffectiveCandidate rejects multiple matches", () => {
  const first = buildEffectiveRow({ parentKey: "a", parentId: "ep-1" });
  const second = buildEffectiveRow({ parentKey: "b", parentId: "ep-2" });
  const lookup = findMaterializeSingleEffectiveCandidate({
    effectiveCandidates: [first, second],
    suppressedCandidates: [],
    instagramUsername: "pilot_user",
    category: "account_paused",
  });
  assert.equal(lookup.ok, false);
  if (!lookup.ok) {
    assert.equal(lookup.reason, "materialize_single_multiple_matches");
  }
});

test("projectMaterializeSingleSuccessResponse is redacted", () => {
  const candidate = buildEffectiveRow();
  const response = projectMaterializeSingleSuccessResponse({
    request: {
      instagramUsername: "pilot_user",
      category: "account_paused",
      confirmation: MATERIALIZE_SINGLE_CONFIRMATION,
    },
    candidate,
    decision: {
      status: "materialized",
      operation: "create_lifecycle_initial_intent",
      rpcInvoked: true,
      result: {
        ok: true,
        parent: { id: "parent-secret", kind: "lifecycle_episode", created: true },
        intent: {
          id: "intent-secret",
          created: true,
          status: "pending",
          idempotencyKey: "secret-key",
        },
      },
    },
  });
  const json = JSON.stringify(response);
  assert.doesNotMatch(json, /parent-secret|intent-secret|secret-key|acct-1|client-1|tpl-1|ep-1|Subject|Body/i);
  assert.equal(response.data?.intentStatus, "pending");
  assert.equal(response.data?.operation, "create_lifecycle_initial_intent");
});

test("gate open path invokes mocked executor once when canonical candidate matches", async () => {
  const candidate = buildEffectiveRow();
  let executorCalls = 0;
  const deliverySettings: ResolvedTransactionalDeliverySettings = {
    activeFromEmail: "growth@boostmybusinesses.com",
    supportEmail: "growth@boostmybusinesses.com",
    configVersion: 2,
    source: "database",
    schemaReady: true,
    updatedAt: "2026-07-01T00:00:00.000Z",
  };

  const result = await executeMaterializeSingleRequest({
    supabase: {} as never,
    body: {
      instagramUsername: "pilot_user",
      category: "account_paused",
      confirmation: MATERIALIZE_SINGLE_CONFIRMATION,
    },
    env: materializeReadyEnv,
    loadPlan: async () => ({
      ...basePlan(),
      rows: [candidate],
    }),
    loadDeliverySettings: async () => deliverySettings,
    loadRecipientEmail: async () => "client@example.com",
    executeInternal: async (input) => {
      executorCalls += 1;
      assert.equal(input.candidate.instagramUsername, "pilot_user");
      assert.equal(input.recipientEmail, "client@example.com");
      return {
        status: "materialized",
        operation: "create_lifecycle_initial_intent",
        rpcInvoked: true,
        result: {
          ok: true,
          parent: { id: "parent-1", kind: "lifecycle_episode", created: true },
          intent: {
            id: "intent-1",
            created: true,
            status: "pending",
            idempotencyKey: "key-1",
          },
        },
      };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(executorCalls, 1);
  assert.equal(result.body.rpcInvoked, true);
  assert.equal(result.body.mutationExecuted, true);
  assert.equal(result.body.data?.intentStatus, "pending");
});

test("sending disabled does not block materialize-single lookup eligibility when automation gates open", () => {
  const candidate = buildEffectiveRow({}, {
    ...materializeReadyEnv,
    CLIENT_EMAIL_SENDING_ENABLED: "false",
  });
  assert.equal(candidate.materializationEligible, true);
  assert.equal(candidate.dispatchEligible, false);
});

test("materialize-single and lifecycle cron are the only lib importers of executor besides tests", () => {
  const roots = [join(process.cwd(), "lib")];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (full.includes("client-email-materialization-executor")) continue;
      if (full.includes("client-email-materialize-single")) continue;
      if (full.includes("client-email-lifecycle-cron")) continue;
      const source = readFileSync(full, "utf8");
      if (/client-email-materialization-executor/.test(source)) {
        offenders.push(full.replace(`${process.cwd()}/`, ""));
      }
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, []);
});

test("route is not imported by BotApp or client dashboard modules", () => {
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
      if (full.includes("materialize-single/route.ts")) continue;
      if (full.includes("client-email-materialize-single")) continue;
      const source = readFileSync(full, "utf8");
      if (/materialize-single\/route|email-lifecycle\/materialize-single/.test(source)) {
        offenders.push(full.replace(`${process.cwd()}/`, ""));
      }
    }
  };
  walk(join(process.cwd(), "app"));
  walk(join(process.cwd(), "lib"));
  assert.deepEqual(offenders, []);
});

test("materialize-single source excludes postmark dispatch and direct rpc", () => {
  assert.doesNotMatch(materializeSingleSource, /client-email-postmark|dispatch_claim|supabase\.rpc\(/);
  assert.match(materializeSingleSource, /executeSingleClientEmailMaterializationInternal/);
  assert.match(materializeSingleSource, /buildClientEmailLifecycleOutboxPlan/);
});

test("route returns gate-closed envelope in early-return branch before body parse", () => {
  assert.match(routeSource, /buildMaterializeSingleGateClosedResponse\(\)/);
  assert.match(routeSource, /status: 409/);
  const gateBlockIndex = routeSource.indexOf("if (!executionGate.enabled)");
  const jsonIndex = routeSource.indexOf("await request.json()");
  assert.ok(gateBlockIndex >= 0);
  assert.ok(jsonIndex >= 0);
  assert.ok(gateBlockIndex < jsonIndex);
});
