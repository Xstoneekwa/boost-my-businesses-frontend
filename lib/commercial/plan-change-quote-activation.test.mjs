import assert from "node:assert/strict";
import test from "node:test";
import { createPlanChangeQuote, activatePlanChangeQuote } from "./plan-change-quote.ts";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ENTITLEMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const QUOTE_ID = "quote-0001-0001-4001-8001-000000000001";
const IDEMPOTENCY_KEY = "plan_change_test_quote_activate_key";
const CANONICAL_REVISION = "canonical-revision-from-postgres";

function buildSourceRows(overrides = {}) {
  const entitlement = {
    id: ENTITLEMENT_ID,
    client_id: CLIENT_ID,
    checkout_session_id: SESSION_ID,
    plan_key: "growth",
    billing_interval_months: 12,
    status: "entitlement_consumed",
    account_id: null,
    pack_period_total_cents: 120_000,
    updated_at: "2026-06-01 12:00:00+00",
    created_at: "2026-06-01 12:00:00+00",
    metadata: {
      workspace_plan: "true",
      period_end_at: "2027-06-01T12:00:00.000Z",
      commercial_period_value_cents: 120_000,
    },
    ...overrides.entitlement,
  };
  const session = {
    id: SESSION_ID,
    client_id: CLIENT_ID,
    flow_type: "first_purchase",
    status: "checkout_activated_test",
    plan_key: "growth",
    billing_interval_months: 12,
    total_period_cents: 120_000,
    pack_period_total_cents: 120_000,
    activated_at: "2026-06-01 12:00:00+00",
    created_at: "2026-06-01 12:00:00+00",
    updated_at: "2026-06-01 12:00:00+00",
    purchaser_email: "plan_change_test_actor@example.invalid",
    billable_account_count: 1,
    metadata: {},
    ...overrides.session,
  };
  return { entitlement, session };
}

function createMockSupabase(options = {}) {
  const { entitlement, session } = buildSourceRows(options.rowOverrides ?? {});
  const quotes = new Map();
  const rpcCalls = [];

  const supabase = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "commercial_plan_change_source_revision_for_source") {
        return { data: options.revision ?? CANONICAL_REVISION, error: null };
      }
      if (name === "activate_commercial_plan_change") {
        if (options.activateResult) {
          return options.activateResult(args);
        }
        return {
          data: {
            ok: true,
            idempotent_replay: false,
            client_id: CLIENT_ID,
            checkout_session_id: "session-new-1",
          },
          error: null,
        };
      }
      return { data: null, error: { message: "unexpected rpc" } };
    },
    from(table) {
      const api = {
        eq(_col, _val) {
          return api;
        },
        in(_col, _vals) {
          return api;
        },
        order(_col, _opts) {
          return api;
        },
        limit(_n) {
          return api;
        },
        select(_cols) {
          return api;
        },
        insert(row) {
          if (table === "commercial_plan_change_quotes") {
            const stored = {
              ...row,
              id: QUOTE_ID,
              quote_expires_at: row.quote_expires_at,
              status: "quote_pending",
            };
            quotes.set(row.idempotency_key, stored);
            return {
              select() {
                return {
                  maybeSingle: async () => ({ data: { id: QUOTE_ID, quote_expires_at: row.quote_expires_at }, error: null }),
                };
              },
            };
          }
          return api;
        },
        maybeSingle: async () => {
          if (table === "client_account_entitlements") {
            if (options.entitlementMissing) return { data: null, error: null };
            return { data: entitlement, error: null };
          }
          if (table === "commercial_checkout_sessions") {
            return { data: [session], error: null };
          }
          if (table === "commercial_plan_change_quotes") {
            const stored = [...quotes.values()][0];
            return { data: stored ?? null, error: null };
          }
          if (table === "client_credit_ledger") {
            return { data: [], error: null };
          }
          return { data: null, error: null };
        },
      };
      if (table === "client_account_entitlements") {
        return {
          ...api,
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      order() {
                        return {
                          limit: async () => ({ data: [entitlement], error: null }),
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "commercial_checkout_sessions") {
        return {
          select() {
            return {
              in: async () => ({ data: [session], error: null }),
            };
          },
        };
      }
      if (table === "client_credit_ledger") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      limit: async () => ({ data: [], error: null }),
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "commercial_plan_change_quotes") {
        return {
          select() {
            return {
              eq(_col, val) {
                return {
                  maybeSingle: async () => {
                    if (_col === "id") {
                      const stored = [...quotes.values()].find((q) => q.id === val) ?? {
                        id: QUOTE_ID,
                        client_id: CLIENT_ID,
                        amount_due_cents: 5000,
                        payment_status: "pending",
                      };
                      return { data: stored, error: null };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
          insert(row) {
            quotes.set(row.idempotency_key, { ...row, id: QUOTE_ID });
            return {
              select() {
                return {
                  maybeSingle: async () => ({ data: { id: QUOTE_ID, quote_expires_at: row.quote_expires_at }, error: null }),
                };
              },
            };
          },
        };
      }
      return api;
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "plan_change_test_actor@example.invalid" } } }),
      },
    },
    _rpcCalls: rpcCalls,
    _quotes: quotes,
  };

  return supabase;
}

test("createPlanChangeQuote persists postgres source_revision and activate succeeds unchanged", async () => {
  const supabase = createMockSupabase();
  process.env.SIMULATED_CHECKOUT_ENABLED = "true";
  process.env.SIMULATED_CHECKOUT_EMAIL_ALLOWLIST = "plan_change_test_actor@example.invalid";

  const quoteResult = await createPlanChangeQuote(supabase, {
    clientId: CLIENT_ID,
    targetPlanKey: "pro",
    idempotencyKey: IDEMPOTENCY_KEY,
  });

  assert.equal(quoteResult.ok, true);
  const stored = [...supabase._quotes.values()][0];
  assert.equal(stored.source_revision, CANONICAL_REVISION);
  assert.equal(supabase._rpcCalls.some((call) => call.name === "commercial_plan_change_source_revision_for_source"), true);

  const activateResult = await activatePlanChangeQuote(supabase, {
    quoteId: QUOTE_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    actorEmail: "plan_change_test_actor@example.invalid",
    simulatedActivation: true,
  });

  assert.equal(activateResult.ok, true);
  assert.equal(activateResult.idempotentReplay, false);
});

test("activate returns quote_stale when postgres revision no longer matches stored quote", async () => {
  const supabase = createMockSupabase({
    activateResult: () => ({
      data: { ok: false, code: "quote_stale" },
      error: null,
    }),
  });

  const activateResult = await activatePlanChangeQuote(supabase, {
    quoteId: QUOTE_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    actorEmail: "plan_change_test_actor@example.invalid",
    simulatedActivation: true,
  });

  assert.equal(activateResult.ok, false);
  if (!activateResult.ok) {
    assert.equal(activateResult.code, "quote_stale");
    assert.equal(activateResult.status, 409);
  }
});

test("activate rejects idempotency mismatch when key differs from quote", async () => {
  const supabase = createMockSupabase({
    activateResult: () => ({
      data: { ok: false, code: "idempotency_mismatch" },
      error: null,
    }),
  });

  const activateResult = await activatePlanChangeQuote(supabase, {
    quoteId: QUOTE_ID,
    idempotencyKey: "different-key-than-quote",
    actorEmail: "plan_change_test_actor@example.invalid",
    simulatedActivation: true,
  });

  assert.equal(activateResult.ok, false);
  if (!activateResult.ok) assert.equal(activateResult.code, "idempotency_mismatch");
});
