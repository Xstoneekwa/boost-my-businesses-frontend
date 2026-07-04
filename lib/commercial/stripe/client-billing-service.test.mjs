import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  assertClientBillingPayloadSafe,
  buildClientBillingView,
  resolveAuthorizedClientInvoiceDocument,
} from "./client-billing-service.ts";
import { clientBillingCopy, invoiceStatusLabel } from "./client-billing-copy.ts";

const TEST_ENV = {
  STRIPE_SECRET_KEY: "sk_test_client_billing",
  STRIPE_TEST_CHECKOUT_ENABLED: "true",
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_test_portal",
};

function readString(value, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function createFakeSupabase(initial = {}) {
  const tables = {
    commercial_stripe_billing_profiles: [],
    commercial_stripe_subscriptions: [],
    client_account_entitlements: [],
    client_instagram_accounts: [],
    ig_accounts: [],
    ...initial,
  };

  function matches(row, filters) {
    return filters.every(({ column, value, values, op }) => {
      if (op === "in") return values.includes(row[column]);
      return readString(row[column]) === readString(value);
    });
  }

  function from(table) {
    const filters = [];
    let limitCount = Infinity;
    let returnMode = "array";

    const builder = {
      select() { return builder; },
      eq(column, value) { filters.push({ column, value }); return builder; },
      in(column, values) { filters.push({ column, values, op: "in" }); return builder; },
      limit(count) { limitCount = count; return builder; },
      maybeSingle() { returnMode = "single"; return builder; },
      then(resolve, reject) {
        try {
          const rows = tables[table].filter((row) => matches(row, filters)).slice(0, limitCount);
          const data = returnMode === "single" ? (rows[0] ?? null) : rows;
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

function packageSummary(accountId, label, code = "pro") {
  return [accountId, {
    accountId,
    commercialPackageCode: code,
    commercialPackageLabel: label,
    commercialAddonsLabel: "No add-ons",
    outreachSourceLabel: "pending",
    entitlementSummary: "unknown",
    runtimeProfilesLabel: "full_cycle",
  }];
}

function fakeStripeGateway(input = {}) {
  const customerId = input.customerId ?? "cus_tenant_a";
  const invoices = input.invoices ?? [];
  return {
    async retrieveCustomer() {
      return {
        invoice_settings: {
          default_payment_method: {
            id: "pm_default",
            card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
          },
        },
      };
    },
    async listSubscriptions() {
      return input.subscriptions ?? [{
        id: "sub_account_a",
        default_payment_method: {
          id: "pm_default",
          card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
        },
      }];
    },
    async listInvoices() {
      return invoices;
    },
    async retrieveInvoice(invoiceId) {
      const invoice = invoices.find((row) => row.id === invoiceId);
      if (!invoice) throw new Error("invoice_missing");
      return invoice;
    },
  };
}

describe("client billing view", () => {
  it("builds a standard tenant view with masked card and tenant invoices only", async () => {
    const { supabase, tables } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
      client_instagram_accounts: [{ client_id: "client-a", account_id: "acct-a" }],
      ig_accounts: [{ id: "acct-a", username: "brand_a" }],
      commercial_stripe_subscriptions: [{
        client_id: "client-a",
        stripe_subscription_id: "sub_account_a",
        account_id: "acct-a",
        client_account_entitlement_id: "ent-a",
        commercial_mode: "full_cycle",
        status: "active",
        current_period_end: "2026-08-01T00:00:00.000Z",
      }],
      client_account_entitlements: [{
        id: "ent-a",
        client_id: "client-a",
        account_id: "acct-a",
        plan_key: "pro",
        billing_interval_months: 1,
        pack_monthly_discounted_cents: 19700,
      }],
    });

    const gateway = fakeStripeGateway({
      invoices: [{
        id: "in_a1",
        customer: "cus_tenant_a",
        subscription: "sub_account_a",
        status: "paid",
        created: Math.floor(new Date("2026-06-01T00:00:00Z").getTime() / 1000),
        currency: "eur",
        total: 19700,
        amount_due: 0,
        amount_paid: 19700,
        amount_remaining: 0,
        hosted_invoice_url: "https://pay.example.test/in_a1",
        invoice_pdf: "https://pay.example.test/in_a1.pdf",
        lines: { data: [{ description: "Pro plan" }] },
      }],
    });

    const view = await buildClientBillingView({
      supabase,
      clientId: "client-a",
      lang: "fr",
      env: TEST_ENV,
      stripeGateway: gateway,
      packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
    });

    assert.equal(view.mode, "standard");
    assert.equal(view.defaultPaymentMethod.available, true);
    assert.equal(view.defaultPaymentMethod.last4, "4242");
    assert.equal(view.defaultPaymentMethod.brand, "Visa");
    assert.match(view.defaultPaymentMethod.displayLabel, /4242/);
    assert.doesNotMatch(JSON.stringify(view), /cus_|sub_|pm_/);
    assert.equal(view.recentInvoices.length, 1);
    assert.equal(view.recentInvoices[0].accountUsername, "brand_a");
    assert.equal(view.recentInvoices[0].canView, true);
    assert.equal(view.recentInvoices[0].canDownloadPdf, true);
    assertClientBillingPayloadSafe(view);
  });

  it("associates agency invoices to the correct account without cross-account leakage", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "agency", stripe_customer_id: "cus_agency" }],
      client_instagram_accounts: [
        { client_id: "agency", account_id: "acct-a" },
        { client_id: "agency", account_id: "acct-b" },
      ],
      ig_accounts: [
        { id: "acct-a", username: "brand_a" },
        { id: "acct-b", username: "brand_b" },
      ],
      commercial_stripe_subscriptions: [
        {
          client_id: "agency",
          stripe_subscription_id: "sub_a",
          account_id: "acct-a",
          client_account_entitlement_id: "ent-a",
          commercial_mode: "full_cycle",
          status: "active",
          current_period_end: "2026-08-01T00:00:00.000Z",
        },
        {
          client_id: "agency",
          stripe_subscription_id: "sub_b",
          account_id: "acct-b",
          client_account_entitlement_id: "ent-b",
          commercial_mode: "outreach_only",
          status: "active",
          current_period_end: "2026-08-15T00:00:00.000Z",
        },
      ],
      client_account_entitlements: [
        {
          id: "ent-a",
          client_id: "agency",
          account_id: "acct-a",
          plan_key: "pro",
          billing_interval_months: 1,
          pack_monthly_discounted_cents: 19700,
        },
        {
          id: "ent-b",
          client_id: "agency",
          account_id: "acct-b",
          outreach_addon_key: "outreach_standard",
          billing_interval_months: 1,
          pack_monthly_discounted_cents: 8900,
        },
      ],
    });

    const gateway = fakeStripeGateway({
      customerId: "cus_agency",
      subscriptions: [
        { id: "sub_a", default_payment_method: null },
        { id: "sub_b", default_payment_method: null },
      ],
      invoices: [
        {
          id: "in_a",
          customer: "cus_agency",
          subscription: "sub_a",
          status: "paid",
          created: Math.floor(new Date("2026-06-02T00:00:00Z").getTime() / 1000),
          currency: "eur",
          total: 19700,
          amount_due: 0,
          amount_paid: 19700,
          amount_remaining: 0,
          hosted_invoice_url: "https://pay.example.test/in_a",
          invoice_pdf: null,
        },
        {
          id: "in_b",
          customer: "cus_agency",
          subscription: "sub_b",
          status: "paid",
          created: Math.floor(new Date("2026-06-03T00:00:00Z").getTime() / 1000),
          currency: "eur",
          total: 8900,
          amount_due: 0,
          amount_paid: 8900,
          amount_remaining: 0,
          hosted_invoice_url: "https://pay.example.test/in_b",
          invoice_pdf: "https://pay.example.test/in_b.pdf",
        },
      ],
    });

    const view = await buildClientBillingView({
      supabase,
      clientId: "agency",
      lang: "en",
      env: TEST_ENV,
      stripeGateway: gateway,
      packageSummaries: new Map([
        packageSummary("acct-a", "Pro"),
        packageSummary("acct-b", "Growth", "growth"),
      ]),
    });

    assert.equal(view.mode, "agency");
    assert.equal(view.accounts.length, 2);
    assert.equal(view.accounts[0].invoices.length, 1);
    assert.equal(view.accounts[0].invoices[0].invoiceRef, "in_a");
    assert.equal(view.accounts[1].invoices.length, 1);
    assert.equal(view.accounts[1].invoices[0].invoiceRef, "in_b");
    assert.equal(view.unassignedInvoices.length, 0);
  });

  it("keeps uncertain invoice correlation out of account rows", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "agency", stripe_customer_id: "cus_agency" }],
      client_instagram_accounts: [
        { client_id: "agency", account_id: "acct-a" },
        { client_id: "agency", account_id: "acct-b" },
      ],
      ig_accounts: [
        { id: "acct-a", username: "brand_a" },
        { id: "acct-b", username: "brand_b" },
      ],
      commercial_stripe_subscriptions: [],
    });

    const gateway = fakeStripeGateway({
      customerId: "cus_agency",
      invoices: [{
        id: "in_unknown",
        customer: "cus_agency",
        subscription: "sub_missing",
        status: "open",
        created: Math.floor(new Date("2026-06-04T00:00:00Z").getTime() / 1000),
        currency: "eur",
        total: 1000,
        amount_due: 1000,
        amount_paid: 0,
        amount_remaining: 1000,
        hosted_invoice_url: "https://pay.example.test/in_unknown",
        invoice_pdf: null,
      }],
    });

    const view = await buildClientBillingView({
      supabase,
      clientId: "agency",
      lang: "fr",
      env: TEST_ENV,
      stripeGateway: gateway,
      packageSummaries: new Map([
        packageSummary("acct-a", "Pro"),
        packageSummary("acct-b", "Growth", "growth"),
      ]),
    });

    assert.equal(view.accounts.every((account) => account.invoices.length === 0), true);
    assert.equal(view.unassignedInvoices.length, 1);
    assert.equal(view.unassignedInvoices[0].correlationCertain, false);
    assert.equal(view.unassignedInvoices[0].accountUsername, null);
  });

  it("marks portal unavailable when configuration is missing", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
      client_instagram_accounts: [{ client_id: "client-a", account_id: "acct-a" }],
      ig_accounts: [{ id: "acct-a", username: "brand_a" }],
    });

    const view = await buildClientBillingView({
      supabase,
      clientId: "client-a",
      lang: "en",
      env: {
        ...TEST_ENV,
        STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "",
      },
      stripeGateway: fakeStripeGateway({ invoices: [] }),
      packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
    });

    assert.equal(view.portal.available, false);
    assert.equal(view.portal.reason, "portal_not_configured");
  });
});

describe("client billing document access", () => {
  it("rejects foreign invoice ownership", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
    });

    const result = await resolveAuthorizedClientInvoiceDocument({
      supabase,
      clientId: "client-a",
      invoiceRef: "in_foreign",
      kind: "hosted",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        invoices: [{
          id: "in_foreign",
          customer: "cus_other",
          status: "paid",
          hosted_invoice_url: "https://pay.example.test/in_foreign",
        }],
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });

  it("redirects only to authorized hosted invoice urls", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
    });

    const result = await resolveAuthorizedClientInvoiceDocument({
      supabase,
      clientId: "client-a",
      invoiceRef: "in_a1",
      kind: "hosted",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        invoices: [{
          id: "in_a1",
          customer: "cus_tenant_a",
          status: "paid",
          hosted_invoice_url: "https://pay.example.test/in_a1",
        }],
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.url, "https://pay.example.test/in_a1");
  });

  it("fails closed when pdf is unavailable", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
    });

    const result = await resolveAuthorizedClientInvoiceDocument({
      supabase,
      clientId: "client-a",
      invoiceRef: "in_a1",
      kind: "pdf",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        invoices: [{
          id: "in_a1",
          customer: "cus_tenant_a",
          status: "paid",
          invoice_pdf: null,
        }],
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.code, "invoice_pdf_missing");
  });
});

describe("client billing i18n", () => {
  it("exposes FR and EN labels without technical jargon", () => {
    const fr = clientBillingCopy("fr");
    const en = clientBillingCopy("en");
    assert.equal(fr.updatePaymentMethod, "Modifier le moyen de paiement");
    assert.equal(en.updatePaymentMethod, "Update payment method");
    assert.equal(invoiceStatusLabel("paid", "fr"), "Payé");
    assert.equal(invoiceStatusLabel("open", "en"), "Pending");
    for (const copy of [fr, en]) {
      const serialized = JSON.stringify(copy).toLowerCase();
      assert.doesNotMatch(serialized, /stripe|webhook|entitlement|foundation|internal test/);
    }
  });
});

describe("billing portal route hardening", () => {
  it("uses allowlisted redirect origin and server-side portal creation", () => {
    const route = readFileSync(
      new URL("../../../app/api/commercial/stripe/billing-portal/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(route, /resolveStripeTestCheckoutRedirectOrigin\(request\.url\)/);
    assert.match(route, /createStripeBillingPortalSession/);
    assert.doesNotMatch(route, /body\.return_url|portal_url/);
    assert.match(route, /redirect_url/);
  });
});

describe("client billing drawer source", () => {
  it("creates portal sessions only through authenticated server route", () => {
    const drawer = readFileSync(
      new URL("../../../app/instagram-client/ClientPaymentBillingDrawer.tsx", import.meta.url),
      "utf8",
    );
    assert.match(drawer, /fetch\("\/api\/commercial\/stripe\/billing-portal"/);
    assert.doesNotMatch(drawer, /stripe\.com|Stripe\(/);
  });
});
