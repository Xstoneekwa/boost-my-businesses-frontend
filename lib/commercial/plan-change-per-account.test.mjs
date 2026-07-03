import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanChangeProrationQuote } from "./plan-change-proration.ts";
import { buildCommercialQuote } from "./pricing.ts";
import { createPlanChangeQuote, readAccountScopedCreditBalanceCents } from "./plan-change-quote.ts";
import { loadPlanChangeSourceForAccount } from "./plan-change-source.ts";
import { assertPlanChangeAccountEligible } from "./plan-change-account-eligibility.ts";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const ENTITLEMENT_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const ENTITLEMENT_B = "ffffffff-ffff-4fff-8fff-fffffffffff02";
const SESSION_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CANONICAL_REVISION = "canonical-revision-from-postgres:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";

function buildAccountSourceRows(accountId, entitlementId, sessionId, planKey = "growth", outreach = null) {
  return {
    entitlement: {
      id: entitlementId,
      client_id: CLIENT_ID,
      checkout_session_id: sessionId,
      plan_key: planKey,
      billing_interval_months: 12,
      status: "entitlement_consumed",
      account_id: accountId,
      outreach_addon_key: outreach,
      consumed_at: "2026-06-01 12:00:00+00",
      pack_period_total_cents: 120_000,
      updated_at: "2026-06-01 12:00:00+00",
      created_at: "2026-06-01 12:00:00+00",
      metadata: {
        period_end_at: "2027-06-01T12:00:00.000Z",
        commercial_period_value_cents: 120_000,
      },
    },
    session: {
      id: sessionId,
      client_id: CLIENT_ID,
      flow_type: "additional_account",
      status: "checkout_activated_test",
      plan_key: planKey,
      billing_interval_months: 12,
      total_period_cents: 120_000,
      pack_period_total_cents: 120_000,
      activated_at: "2026-06-01 12:00:00+00",
      created_at: "2026-06-01 12:00:00+00",
      updated_at: "2026-06-01 12:00:00+00",
      purchaser_email: "plan_change_test_actor@example.invalid",
      billable_account_count: 3,
      metadata: {},
    },
  };
}

function createPerAccountMockSupabase(options = {}) {
  const accountId = options.accountId ?? ACCOUNT_A;
  const entitlementId = options.entitlementId ?? ENTITLEMENT_A;
  const sessionId = options.sessionId ?? SESSION_A;
  const { entitlement, session } = buildAccountSourceRows(
    accountId,
    entitlementId,
    sessionId,
    options.planKey ?? "growth",
    options.outreach ?? "outreach_standard",
  );

  const ledgerByAccount = new Map([
    [ACCOUNT_A, options.creditA ?? 0],
    [ACCOUNT_B, options.creditB ?? 5000],
  ]);

  return {
    entitlement,
    session,
    rpc(name, args) {
      if (name === "commercial_plan_change_source_revision_for_account_source") {
        return { data: options.revision ?? CANONICAL_REVISION, error: null };
      }
      if (name === "account_scoped_credit_balance_cents") {
        const balance = ledgerByAccount.get(args.p_account_id) ?? 0;
        return { data: balance, error: null };
      }
      if (name === "activate_commercial_plan_change_per_account") {
        return {
          data: {
            ok: true,
            idempotent_replay: false,
            client_id: CLIENT_ID,
            account_id: accountId,
            checkout_session_id: "session-new-1",
          },
          error: null,
        };
      }
      return { data: null, error: { message: "unexpected rpc" } };
    },
    from(table) {
      const chain = {
        _filters: [],
        select() { return chain; },
        eq(col, val) {
          chain._filters.push([col, val]);
          return chain;
        },
        in(col, vals) {
          chain._in = [col, vals];
          return chain;
        },
        is() { return chain; },
        order() { return chain; },
        limit() {
          return {
            maybeSingle: async () => {
              if (table === "client_instagram_accounts") {
                const accountFilter = chain._filters.find(([c]) => c === "account_id");
                if (accountFilter && accountFilter[1] === ACCOUNT_B && options.foreignAccount) {
                  return { data: null, error: null };
                }
                return { data: { account_id: accountId, client_id: CLIENT_ID }, error: null };
              }
              if (table === "ig_accounts") {
                const status = options.accountStatus ?? "active";
                return {
                  data: {
                    id: accountId,
                    status,
                    admin_lifecycle_status: options.adminStatus ?? status,
                  },
                  error: null,
                };
              }
              return { data: null, error: null };
            },
            then(resolve, reject) {
              if (table === "client_account_entitlements") {
                if (options.entitlementMismatch) {
                  return Promise.resolve({
                    data: [{
                      ...entitlement,
                      account_id: ACCOUNT_B,
                      status: "entitlement_consumed",
                    }],
                    error: null,
                  }).then(resolve, reject);
                }
                if (options.reservedEntitlement) {
                  return Promise.resolve({
                    data: [{
                      ...entitlement,
                      status: "entitlement_reserved",
                      account_id: null,
                    }],
                    error: null,
                  }).then(resolve, reject);
                }
                return Promise.resolve({ data: [entitlement], error: null }).then(resolve, reject);
              }
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            },
          };
        },
        insert(row) {
          if (table === "commercial_plan_change_quotes") {
            return {
              select() {
                return {
                  maybeSingle: async () => ({
                    data: { id: "quote-per-account-1", quote_expires_at: row.quote_expires_at },
                    error: null,
                  }),
                };
              },
            };
          }
          return chain;
        },
        maybeSingle: async () => {
          if (table === "client_account_entitlements") {
            return { data: entitlement, error: null };
          }
          return chain.limit().maybeSingle();
        },
      };

      if (table === "commercial_checkout_sessions") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: session, error: null }),
                };
              },
            };
          },
        };
      }

      if (table === "client_instagram_accounts" || table === "ig_accounts") {
        return chain;
      }

      if (table === "commercial_plan_change_quotes") {
        return {
          ...chain,
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { change_scope: "per_account", account_id: accountId },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      return chain;
    },
  };
}

test("proration formula unchanged for per-account quotes", () => {
  const proration = buildPlanChangeProrationQuote({
    activeCommercialPeriodValueCents: 120_000,
    targetFullPeriodPriceCents: 180_000,
    periodStartAt: "2026-06-01T12:00:00.000Z",
    periodEndAt: "2027-06-01T12:00:00.000Z",
    effectiveChangeAt: "2026-12-01T12:00:00.000Z",
    existingCustomerCreditCents: 2_000,
  });
  assert.ok(proration.remainingRatioBps > 0);
  assert.equal(
    proration.amountDueCents,
    Math.max(0, proration.targetRemainingCostCents - proration.availableCreditCents),
  );
});

test("agency max(duration, agency) preserved in target pricing snapshot", () => {
  const quote = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 12,
    outreachAddonKey: "outreach_standard",
    pricingContext: "plan_change",
    billableAccountCountOverride: 6,
  });
  assert.ok(!("error" in quote));
  assert.equal(quote.pricingSnapshot.tieBreakRule, "duration_wins_on_equal_percent");
  assert.equal(
    quote.appliedDiscountPercent,
    Math.max(quote.termDiscountPercent, quote.agencyDiscountPercent),
  );
});

test("account A quote uses only account A scoped credit", async () => {
  const supabase = createPerAccountMockSupabase({ creditA: 1000, creditB: 9000 });
  const result = await createPlanChangeQuote(supabase, {
    clientId: CLIENT_ID,
    accountId: ACCOUNT_A,
    targetPlanKey: "pro",
    idempotencyKey: "quote-a",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.quote.existingCustomerCreditCents, 1000);
    assert.equal(result.quote.accountId, ACCOUNT_A);
  }
});

test("entitlement/account mismatch is rejected", async () => {
  const supabase = createPerAccountMockSupabase();
  supabase.from = (table) => {
    const base = createPerAccountMockSupabase({ entitlementMismatch: true }).from(table);
    if (table !== "client_account_entitlements") return base;
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit: async () => ({
        data: [{
          ...buildAccountSourceRows(ACCOUNT_A, ENTITLEMENT_A, SESSION_A).entitlement,
          account_id: ACCOUNT_B,
          status: "entitlement_consumed",
        }],
        error: null,
      }),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return chain;
  };
  const result = await createPlanChangeQuote(supabase, {
    clientId: CLIENT_ID,
    accountId: ACCOUNT_A,
    sourceEntitlementId: ENTITLEMENT_A,
    targetPlanKey: "pro",
    idempotencyKey: "quote-mismatch",
  });
  assert.equal(result.ok, false);
});

test("reserved entitlement with null account_id is rejected", async () => {
  const supabase = createPerAccountMockSupabase({ reservedEntitlement: true });
  const eligibility = await assertPlanChangeAccountEligible(supabase, {
    clientId: CLIENT_ID,
    accountId: ACCOUNT_A,
  });
  assert.equal(eligibility.ok, false);
  if (!eligibility.ok) assert.equal(eligibility.code, "entitlement_reserved");
});

test("foreign client account is rejected", async () => {
  const supabase = createPerAccountMockSupabase({ foreignAccount: true });
  const eligibility = await assertPlanChangeAccountEligible(supabase, {
    clientId: CLIENT_ID,
    accountId: ACCOUNT_B,
  });
  assert.equal(eligibility.ok, false);
  if (!eligibility.ok) assert.equal(eligibility.code, "account_client_mismatch");
});

test("outreach from source is included in pricing snapshot target quote", async () => {
  const supabase = createPerAccountMockSupabase({ outreach: "outreach_ai" });
  const result = await createPlanChangeQuote(supabase, {
    clientId: CLIENT_ID,
    accountId: ACCOUNT_A,
    targetPlanKey: "premium",
    idempotencyKey: "quote-outreach",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.quote.pricingSnapshot?.outreachAddonKey, "outreach_ai");
  }
});

test("legacy unscoped credit reader remains available but separate from account scope", async () => {
  const supabase = {
    rpc(name) {
      if (name === "account_scoped_credit_balance_cents") {
        return { data: 0, error: null };
      }
      return { data: null, error: null };
    },
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    limit: async () => ({
                      data: table === "client_credit_ledger"
                        ? [{ direction: "credit", amount_cents: 9999 }]
                        : [],
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const scoped = await readAccountScopedCreditBalanceCents(supabase, CLIENT_ID, ACCOUNT_A);
  assert.equal(scoped, 0);
});

test("loadPlanChangeSourceForAccount binds account and outreach", async () => {
  const supabase = createPerAccountMockSupabase({ outreach: "outreach_standard" });
  const loaded = await loadPlanChangeSourceForAccount(supabase, {
    clientId: CLIENT_ID,
    accountId: ACCOUNT_A,
    sourceEntitlementId: ENTITLEMENT_A,
  });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.source.accountId, ACCOUNT_A);
    assert.equal(loaded.source.outreachAddonKey, "outreach_standard");
    assert.equal(loaded.source.changeScope, "per_account");
  }
});
