import assert from "node:assert/strict";
import test from "node:test";

import { runImmediateLifecycleEmailHandoff } from "./client-email-lifecycle-immediate-handoff.ts";

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function dispatchResult(submitted: number) {
  return {
    dispatchGateOpen: true,
    gateReason: null,
    candidates: submitted,
    submitted,
    canceled: 0,
    failed: 0,
    uncertain: 0,
    skipped: 0,
    results: submitted === 1
      ? [{ outcome: "submitted" as const, intentId: "intent-1", providerMessageId: "provider-1" }]
      : [],
  };
}

test("Pause handoff opens the episode, materializes its intent, and dispatches only the exact scope", async () => {
  const materializeScopes: Array<Record<string, unknown>> = [];
  const dispatchScopes: Array<Record<string, unknown>> = [];
  let materializeCall = 0;

  const result = await runImmediateLifecycleEmailHandoff({
    supabase: {} as never,
    accountId: ACCOUNT_ID,
    category: "account_paused",
    env: { CLIENT_EMAIL_ACCOUNT_PAUSED_ENABLED: "true" },
    now: new Date("2026-08-15T20:49:42.881Z"),
    materialize: async (_supabase, input) => {
      materializeScopes.push(input.scope ?? {});
      materializeCall += 1;
      return materializeCall === 1
        ? { candidates: 1, materialized: 1, skipped: 0, failed: 0 }
        : { candidates: 1, materialized: 1, skipped: 0, failed: 0 };
    },
    dispatch: async (_supabase, input) => {
      dispatchScopes.push(input.scope ?? {});
      return dispatchResult(1);
    },
  });

  const expectedScope = { accountId: ACCOUNT_ID, category: "account_paused" };
  assert.deepEqual(materializeScopes, [expectedScope, expectedScope]);
  assert.deepEqual(dispatchScopes, [expectedScope]);
  assert.deepEqual(result.scope, expectedScope);
  assert.deepEqual(result.materialize, {
    candidates: 2,
    materialized: 2,
    skipped: 0,
    failed: 0,
  });
  assert.equal(result.dispatch.submitted, 1);
});

test("replaying an already materialized and delivered episode remains a no-op", async () => {
  let materializeCalls = 0;
  let dispatchCalls = 0;

  const result = await runImmediateLifecycleEmailHandoff({
    supabase: {} as never,
    accountId: ACCOUNT_ID,
    category: "account_paused",
    materialize: async () => {
      materializeCalls += 1;
      return { candidates: 0, materialized: 0, skipped: 0, failed: 0 };
    },
    dispatch: async () => {
      dispatchCalls += 1;
      return dispatchResult(0);
    },
  });

  assert.equal(materializeCalls, 2);
  assert.equal(dispatchCalls, 1);
  assert.equal(result.materialize.materialized, 0);
  assert.equal(result.dispatch.candidates, 0);
  assert.equal(result.dispatch.submitted, 0);
});
