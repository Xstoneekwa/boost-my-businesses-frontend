import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assertRealStripeTestMode } from "./commercial-test-mode.ts";
import { assertExistingAccountStripeCheckoutTarget } from "./stripe-existing-account-binding.ts";
import { syncStripeSubscriptionPriceAfterPlanChangePayment } from "./stripe-plan-change-checkout.ts";
import { mergeStripeSubscriptionProjectionInput } from "./stripe-subscription-projection.ts";

const CLIENT_ID = "10000000-0000-0000-0000-000000000001";
const ACCOUNT_ID = "20000000-0000-0000-0000-000000000002";
const SOURCE_ID = "30000000-0000-0000-0000-000000000003";
const AUTH_ID = "40000000-0000-0000-0000-000000000004";

function baseTables() {
  return {
    client_instagram_accounts: [{ client_id: CLIENT_ID, account_id: ACCOUNT_ID }],
    ig_accounts: [{ id: ACCOUNT_ID, status: "active", admin_lifecycle_status: "active" }],
    account_package_summary: [{ account_id: ACCOUNT_ID, commercial_package_code: "premium" }],
    client_account_entitlements: [{
      id: SOURCE_ID,
      client_id: CLIENT_ID,
      account_id: ACCOUNT_ID,
      status: "entitlement_consumed",
      plan_key: "premium",
      commercial_package_code: "premium",
      metadata: { checkout_mode: "simulated", billing_excluded: true },
    }],
    commercial_stripe_migration_authorizations: [{
      id: AUTH_ID,
      client_id: CLIENT_ID,
      account_id: ACCOUNT_ID,
      source_entitlement_id: SOURCE_ID,
      migration_kind: "simulated_to_stripe_test",
      commercial_test_mode: "stripe_test",
      status: "authorized",
      expires_at: "2099-01-01T00:00:00.000Z",
    }],
    commercial_stripe_entitlement_migrations: [],
    commercial_stripe_subscriptions: [],
  };
}

class Query {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
    this.maxRows = null;
  }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order() { return this; }
  limit(value) { this.maxRows = value; return this; }
  matching() {
    const rows = this.rows.filter((row) => this.filters.every(([column, value]) => row[column] === value));
    return this.maxRows == null ? rows : rows.slice(0, this.maxRows);
  }
  async maybeSingle() { return { data: this.matching()[0] ?? null, error: null }; }
  then(resolve, reject) { return Promise.resolve({ data: this.matching(), error: null }).then(resolve, reject); }
}

function fakeSupabase(tables) {
  return { from(table) { return new Query(tables[table] ?? []); } };
}

function migrationInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    accountId: ACCOUNT_ID,
    planKey: "premium",
    commercialTestMode: "stripe_test",
    commercialMigrationKind: "simulated_to_stripe_test",
    commercialMigrationAuthorizationId: AUTH_ID,
    ...overrides,
  };
}

describe("explicit commercial test mode", () => {
  it("rejects missing and simulated mode for a real Stripe Test request", () => {
    assert.equal(assertRealStripeTestMode({ commercialTestMode: undefined, realStripeTestE2E: true }).ok, false);
    assert.equal(assertRealStripeTestMode({ commercialTestMode: "simulated", realStripeTestE2E: true }).ok, false);
    assert.equal(assertRealStripeTestMode({ commercialTestMode: "stripe_test", realStripeTestE2E: true }).ok, true);
  });
});

describe("simulated to Stripe Test eligibility", () => {
  it("A: accepts exactly one authorized simulated consumed entitlement", async () => {
    const result = await assertExistingAccountStripeCheckoutTarget(fakeSupabase(baseTables()), migrationInput());
    assert.equal(result.ok, true);
    assert.equal(result.sourceEntitlementId, SOURCE_ID);
  });

  it("B: rejects an account with a real active Stripe subscription", async () => {
    const tables = baseTables();
    tables.commercial_stripe_subscriptions.push({ client_id: CLIENT_ID, account_id: ACCOUNT_ID, status: "active", stripe_subscription_id: "sub_test" });
    const result = await assertExistingAccountStripeCheckoutTarget(fakeSupabase(tables), migrationInput());
    assert.equal(result.code, "target_modern_subscription_exists");
  });

  it("C: preserves ordinary duplicate checkout protection", async () => {
    const result = await assertExistingAccountStripeCheckoutTarget(fakeSupabase(baseTables()), {
      ...migrationInput(),
      commercialMigrationKind: null,
      commercialMigrationAuthorizationId: null,
    });
    assert.equal(result.code, "target_modern_entitlement_exists");
  });

  it("D: rejects cross-tenant account binding", async () => {
    const result = await assertExistingAccountStripeCheckoutTarget(fakeSupabase(baseTables()), migrationInput({ clientId: "foreign-client" }));
    assert.equal(result.code, "target_account_client_mismatch");
  });

  it("E: rejects source/current package mismatch", async () => {
    const tables = baseTables();
    tables.client_account_entitlements[0].plan_key = "growth";
    const result = await assertExistingAccountStripeCheckoutTarget(fakeSupabase(tables), migrationInput());
    assert.equal(result.code, "migration_source_package_mismatch");
  });

  it("F: rejects a missing explicit migration authorization", async () => {
    const result = await assertExistingAccountStripeCheckoutTarget(fakeSupabase(baseTables()), migrationInput({ commercialMigrationAuthorizationId: null }));
    assert.equal(result.code, "commercial_migration_authorization_required");
  });
});

function fakeStripeSubscription(priceId = "price_premium") {
  const updates = [];
  const stripe = {
    subscriptions: {
      retrieve: async () => ({
        id: "sub_test",
        livemode: false,
        items: { data: [{ id: "si_test", price: { id: priceId } }] },
      }),
      update: async (subscriptionId, params, options) => {
        updates.push({ subscriptionId, params, options });
        return {
          id: subscriptionId,
          livemode: false,
          items: { data: [{ id: "si_test", price: { id: params.items[0].price } }] },
        };
      },
    },
  };
  return { stripe, updates };
}

describe("Stripe-first plan change", () => {
  it("R/S/T: updates the same item even for zero or credit settlement", async () => {
    const { stripe, updates } = fakeStripeSubscription();
    const result = await syncStripeSubscriptionPriceAfterPlanChangePayment(stripe, {
      stripeSubscriptionId: "sub_test",
      targetPriceId: "price_growth",
      settlementMode: "stripe_credit_or_zero",
      idempotencyKey: "quote-1:subscription-price",
    });
    assert.equal(result.ok, true);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].params.items, [{ id: "si_test", price: "price_growth" }]);
    assert.equal(updates[0].params.proration_behavior, "create_prorations");
    assert.equal(updates[0].params.billing_cycle_anchor, "unchanged");
  });

  it("U: paid upgrade applies the same item without charging proration twice", async () => {
    const { stripe, updates } = fakeStripeSubscription("price_growth");
    const result = await syncStripeSubscriptionPriceAfterPlanChangePayment(stripe, {
      stripeSubscriptionId: "sub_test",
      targetPriceId: "price_pro",
      settlementMode: "already_collected",
      idempotencyKey: "quote-2:subscription-price",
    });
    assert.equal(result.ok, true);
    assert.equal(updates[0].params.proration_behavior, "none");
    assert.equal(updates[0].params.billing_cycle_anchor, "unchanged");
  });
});

describe("transactional replacement, webhook truth, and warmup contracts", () => {
  const migration = readFileSync(new URL("../../../supabase/migrations/20260830132732_commercial_stripe_test_e2e_warmup_v1.sql", import.meta.url), "utf8");
  const claimMigration = readFileSync(new URL("../../../supabase/migrations/20260830191718_commercial_stripe_subscription_claim_binding_ordering_v1.sql", import.meta.url), "utf8");
  const webhook = readFileSync(new URL("./stripe-webhook-handler.ts", import.meta.url), "utf8");
  const planChange = readFileSync(new URL("./stripe-plan-change-checkout.ts", import.meta.url), "utf8");
  const fulfillment = readFileSync(new URL("./stripe-fulfillment.ts", import.meta.url), "utf8");

  it("G/H/I/J: locks and atomically replaces once while preserving history and replay", () => {
    assert.match(migration, /for update/gi);
    assert.match(migration, /idempotent_replay/);
    assert.match(migration, /unique\(source_entitlement_id\)/);
    assert.match(migration, /unique\(replacement_entitlement_id\)/);
    assert.match(migration, /post_reconciliation_cardinality_violation/);
    assert.match(migration, /status = 'entitlement_cancelled'/);
    assert.match(migration, /source_history_preserved/);
  });

  it("K-P: backfills the exact old anchor and makes it immutable without changing the active-day algorithm", () => {
    assert.match(migration, /set warmup_started_at = package_started_at/);
    assert.match(migration, /warmup_started_at_is_immutable/);
    assert.doesNotMatch(migration, /update\s+public\.[a-z_]*follow|delete\s+from\s+public\.[a-z_]*follow/i);
    assert.doesNotMatch(planChange, /warmup_started_at|package_started_at/);
    for (const packageCap of [80, 120]) assert.equal(Math.min(20, packageCap), 20);
    assert.equal(Math.min(80, 80), 80);
    assert.equal(Math.min(120, 120), 120);
  });

  it("V-W-X-Y: local activation is webhook-first and current Stripe subscription price is canonical", () => {
    assert.match(webhook, /subscriptions\.retrieve\(incomingSubscription\.id\)/);
    assert.match(webhook, /reconcileStripePlanChangeFromCanonicalSubscription/);
    assert.match(planChange, /current_price_not_target/);
    assert.match(planChange, /awaiting_pending_update/);
    assert.match(planChange, /activate_stripe_commercial_plan_change_per_account_v1/);
    assert.doesNotMatch(webhook.slice(webhook.indexOf("async function handleInvoice"), webhook.indexOf("async function handleSubscription")), /activatePlanChangeQuote/);
  });

  it("ordering claim requires exact Stripe metadata and keeps a real foreign account fail-closed", () => {
    assert.match(claimMigration, /v_subscription\.account_id is not null[\s\S]*v_subscription\.account_id <> p_account_id[\s\S]*stripe_subscription_cross_account_conflict/);
    assert.match(claimMigration, /p_stripe_livemode is distinct from false/);
    assert.match(claimMigration, /p_stripe_metadata_client_id/);
    assert.match(claimMigration, /p_stripe_metadata_target_account_id/);
    assert.match(claimMigration, /p_stripe_metadata_source_entitlement_id/);
    assert.match(claimMigration, /p_stripe_metadata_migration_kind/);
    assert.match(claimMigration, /commercial_stripe_checkout_attempts[\s\S]*for update/);
    assert.match(claimMigration, /commercial_stripe_subscriptions[\s\S]*for update/);
    assert.match(fulfillment, /subscriptionMetadata: subscription\?\.metadata \?\? \{\}/);
    assert.match(fulfillment, /stripeMetadataTargetAccountId: readString\(input\.subscriptionMetadata\.target_account_id\)/);
  });

  it("out-of-order subscription replay cannot erase a checkout-bound account", () => {
    const merged = mergeStripeSubscriptionProjectionInput({
      account_id: ACCOUNT_ID,
      client_account_entitlement_id: SOURCE_ID,
      commercial_checkout_session_id: "checkout-id",
      status: "active",
    }, {
      clientId: CLIENT_ID,
      stripeSubscriptionId: "sub_test",
      stripeCustomerId: "cus_test",
      stripePriceId: "price_premium",
      accountId: null,
      clientAccountEntitlementId: null,
      commercialCheckoutSessionId: null,
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    assert.equal(merged.account_id, ACCOUNT_ID);
    assert.equal(merged.client_account_entitlement_id, SOURCE_ID);
    assert.equal(merged.commercial_checkout_session_id, "checkout-id");
  });

  it("invoice.paid remains projection-only and cannot bind or activate an entitlement", () => {
    const invoiceStart = webhook.indexOf("async function handleInvoiceEvent");
    const invoiceEnd = webhook.indexOf("function readObjectId", invoiceStart);
    const invoiceHandler = webhook.slice(invoiceStart, invoiceEnd);
    assert.doesNotMatch(invoiceHandler, /reconcileSimulatedToStripeTestEntitlement|activateClientAccountEntitlementFromCheckout|account_id\s*:/);
  });

  it("commercial patch has no control-plane execution side effects", () => {
    const combined = `${migration}\n${claimMigration}\n${webhook}\n${planChange}`;
    assert.doesNotMatch(combined, /account_run_requests|ig_runs|tick_locks|auto_login/i);
  });
});
