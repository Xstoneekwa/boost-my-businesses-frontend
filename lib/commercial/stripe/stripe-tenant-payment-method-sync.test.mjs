import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildTenantPaymentMethodSyncMetadataSafe,
  customerDefaultPaymentMethodChanged,
  syncTenantDefaultPaymentMethodToSubscriptions,
} from "./stripe-tenant-payment-method-sync.ts";
import { resolveHeaderPaymentMethod } from "./client-billing-service.ts";

function createFakeSupabase(initial = {}) {
  const tables = {
    commercial_stripe_billing_profiles: [],
    commercial_stripe_subscriptions: [],
    ...initial,
  };

  function from(table) {
    const filters = [];
    let limitCount = Infinity;
    let returnMode = "array";

    const builder = {
      select() { return builder; },
      eq(column, value) { filters.push({ column, value }); return builder; },
      limit(count) { limitCount = count; return builder; },
      maybeSingle() { returnMode = "single"; return builder; },
      then(resolve, reject) {
        try {
          const rows = tables[table].filter((row) => filters.every(({ column, value }) => String(row[column]) === String(value)));
          const data = returnMode === "single" ? (rows[0] ?? null) : rows.slice(0, limitCount);
          resolve({ data, error: null });
        } catch (error) {
          reject(error);
        }
      },
    };
    return builder;
  }

  return { supabase: { from }, tables };
}

function cardPm(id, last4 = "4242") {
  return {
    id,
    customer: "cus_tenant_a",
    card: { brand: "visa", last4, exp_month: 5, exp_year: 2039 },
  };
}

function createFakeStripe(state = {}) {
  const updates = [];
  const subscriptions = state.subscriptions ?? {
    sub_a: { id: "sub_a", status: "active", default_payment_method: "pm_old" },
    sub_b: { id: "sub_b", status: "active", default_payment_method: "pm_old" },
    sub_foreign: { id: "sub_foreign", status: "active", default_payment_method: "pm_old" },
    sub_canceled: { id: "sub_canceled", status: "canceled", default_payment_method: "pm_old" },
  };
  const paymentMethods = state.paymentMethods ?? {
    pm_new: cardPm("pm_new", "9999"),
    pm_old: cardPm("pm_old", "4242"),
    pm_foreign: { id: "pm_foreign", customer: "cus_other", card: { brand: "visa", last4: "1111", exp_month: 1, exp_year: 2030 } },
  };

  return {
    updates,
    stripe: {
      customers: {
        retrieve: async () => ({
          id: "cus_tenant_a",
          deleted: false,
          livemode: false,
          invoice_settings: { default_payment_method: "pm_new" },
        }),
      },
      paymentMethods: {
        retrieve: async (id) => paymentMethods[id] ?? (() => { throw new Error("pm_missing"); })(),
      },
      subscriptions: {
        retrieve: async (id) => subscriptions[id],
        update: async (id, payload) => {
          updates.push({ id, payload });
          subscriptions[id] = {
            ...subscriptions[id],
            default_payment_method: payload.default_payment_method,
          };
          return subscriptions[id];
        },
      },
    },
  };
}

describe("customer.updated payment method detection", () => {
  it("detects invoice default payment method changes only", () => {
    assert.equal(customerDefaultPaymentMethodChanged({
      type: "customer.updated",
      data: {
        object: { id: "cus_1" },
        previous_attributes: { invoice_settings: { default_payment_method: "pm_old" } },
      },
    }), true);

    assert.equal(customerDefaultPaymentMethodChanged({
      type: "customer.updated",
      data: { object: { id: "cus_1" }, previous_attributes: { email: "a@b.test" } },
    }), false);
  });
});

describe("tenant payment method propagation", () => {
  it("updates every active tenant subscription when customer default changes", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
      commercial_stripe_subscriptions: [
        { client_id: "client-a", stripe_subscription_id: "sub_a", status: "active" },
        { client_id: "client-a", stripe_subscription_id: "sub_b", status: "active" },
        { client_id: "client-a", stripe_subscription_id: "sub_canceled", status: "canceled" },
        { client_id: "client-other", stripe_subscription_id: "sub_foreign", status: "active" },
      ],
    });
    const fake = createFakeStripe();

    const result = await syncTenantDefaultPaymentMethodToSubscriptions({
      supabase,
      stripeCustomerId: "cus_tenant_a",
      stripe: fake.stripe,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.code, "synced");
      assert.equal(result.updatedSubscriptionCount, 2);
    }
    assert.deepEqual(
      fake.updates.map((row) => row.id).sort(),
      ["sub_a", "sub_b"],
    );
    assert.equal(fake.updates.every((row) => row.payload.default_payment_method === "pm_new"), true);
  });

  it("is a no-op when subscriptions already use the new default payment method", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
      commercial_stripe_subscriptions: [
        { client_id: "client-a", stripe_subscription_id: "sub_a", status: "active" },
      ],
    });
    const fake = createFakeStripe({
      subscriptions: {
        sub_a: { id: "sub_a", status: "active", default_payment_method: "pm_new" },
      },
    });

    const result = await syncTenantDefaultPaymentMethodToSubscriptions({
      supabase,
      stripeCustomerId: "cus_tenant_a",
      stripe: fake.stripe,
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.code, "noop_already_applied");
    assert.equal(fake.updates.length, 0);
  });

  it("fail-closes when customer is unknown internally", async () => {
    const { supabase } = createFakeSupabase({ commercial_stripe_billing_profiles: [] });
    const fake = createFakeStripe();

    const result = await syncTenantDefaultPaymentMethodToSubscriptions({
      supabase,
      stripeCustomerId: "cus_unknown",
      stripe: fake.stripe,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "stripe_customer_unknown");
  });

  it("fail-closes when payment method belongs to another customer", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
      commercial_stripe_subscriptions: [
        { client_id: "client-a", stripe_subscription_id: "sub_a", status: "active" },
      ],
    });
    const fake = createFakeStripe({
      paymentMethods: {
        pm_new: { id: "pm_new", customer: "cus_other", card: { brand: "visa", last4: "9999", exp_month: 1, exp_year: 2030 } },
      },
    });

    const result = await syncTenantDefaultPaymentMethodToSubscriptions({
      supabase,
      stripeCustomerId: "cus_tenant_a",
      stripe: fake.stripe,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "payment_method_foreign");
  });
});

describe("header payment method resolution", () => {
  it("shows subscription default for a standard single-account tenant", () => {
    const header = resolveHeaderPaymentMethod({
      mode: "standard",
      lang: "fr",
      customerDefault: null,
      accountRows: [{
        accountId: "acct-a",
        username: "brand",
        planLabel: "Pro",
        subscriptionStatusLabel: "Actif",
        priceLabel: "197€",
        billingCadenceLabel: "Mensuel",
        nextBillingLabel: null,
        paymentMethod: {
          available: true,
          brand: "Visa",
          last4: "4242",
          expMonth: 5,
          expYear: 2039,
          displayLabel: "Visa •••• 4242 · 05/2039",
          scope: "subscription",
        },
        invoices: [],
      }],
    });

    assert.equal(header.available, true);
    assert.match(header.displayLabel, /4242/);
  });

  it("marks agency header as shared when every account uses the same card", () => {
    const shared = {
      available: true,
      brand: "Visa",
      last4: "4242",
      expMonth: 5,
      expYear: 2039,
      displayLabel: "Visa •••• 4242 · 05/2039",
      scope: "subscription",
    };
    const header = resolveHeaderPaymentMethod({
      mode: "agency",
      lang: "en",
      customerDefault: null,
      accountRows: [
        { accountId: "a1", username: "a", planLabel: "Pro", subscriptionStatusLabel: "Active", priceLabel: "€197", billingCadenceLabel: "Monthly", nextBillingLabel: null, paymentMethod: shared, invoices: [] },
        { accountId: "a2", username: "b", planLabel: "Pro", subscriptionStatusLabel: "Active", priceLabel: "€197", billingCadenceLabel: "Monthly", nextBillingLabel: null, paymentMethod: shared, invoices: [] },
      ],
    });

    assert.equal(header.scope, "agency_default");
  });
});

describe("safe webhook metadata", () => {
  it("never includes payment method ids in metadata_safe", () => {
    const metadata = buildTenantPaymentMethodSyncMetadataSafe({
      ok: true,
      code: "synced",
      clientId: "client-a",
      stripeCustomerId: "cus_tenant_a",
      paymentMethodId: "pm_secret_should_not_leak",
      updatedSubscriptionCount: 2,
      skippedSubscriptionCount: 0,
    });
    const serialized = JSON.stringify(metadata);
    assert.doesNotMatch(serialized, /pm_/);
    assert.doesNotMatch(serialized, /cus_/);
  });
});

describe("webhook registration", () => {
  it("allows signed customer.updated events for tenant payment method sync", () => {
    const source = readFileSync(
      new URL("./stripe-webhook-handler.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /customer\.updated/);
    assert.match(source, /syncTenantDefaultPaymentMethodToSubscriptions/);
  });
});
