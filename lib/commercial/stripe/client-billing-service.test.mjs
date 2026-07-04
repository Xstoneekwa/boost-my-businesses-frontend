import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  assertClientBillingPayloadSafe,
  buildClientBillingView,
  loadClientBillingPaymentSummary,
  resolveAuthorizedClientInvoiceDocument,
} from "./client-billing-service.ts";
import { buildLocalizedInvoiceServiceLabel, stripeInvoiceLineLooksRaw } from "./client-billing-invoice-label.ts";
import { clientBillingCopy, invoiceStatusLabel, paymentMethodScopeLabel } from "./client-billing-copy.ts";

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
  const customerDefaultPaymentMethod = input.customerDefaultPaymentMethod === undefined
    ? {
      id: "pm_default",
      card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
    }
    : input.customerDefaultPaymentMethod;
  const subscriptionDefaultPaymentMethod = input.subscriptionDefaultPaymentMethod ?? customerDefaultPaymentMethod ?? {
    id: "pm_default",
    card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
  };
  return {
    async retrieveCustomer() {
      return {
        invoice_settings: {
          default_payment_method: customerDefaultPaymentMethod,
        },
      };
    },
    async listSubscriptions() {
      return input.subscriptions ?? [{
        id: "sub_account_a",
        default_payment_method: subscriptionDefaultPaymentMethod,
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
    assert.match(view.defaultPaymentMethod.displayLabel, /4242/);
    assert.equal(view.defaultPaymentMethod.scope, "subscription");
    assert.notEqual(paymentMethodScopeLabel(view.defaultPaymentMethod.scope, "fr"), "Carte par défaut du compte agence");
    assert.doesNotMatch(JSON.stringify(view), /cus_|sub_|pm_/);
    assert.equal(view.recentInvoices.length, 1);
    assert.equal(view.recentInvoices[0].accountUsername, "brand_a");
    assert.equal(view.recentInvoices[0].canView, true);
    assert.equal(view.recentInvoices[0].canDownloadPdf, true);
    assert.doesNotMatch(JSON.stringify(view), /https?:\/\//);
    assertClientBillingPayloadSafe(view);
  });

  it("shows subscription default when customer invoice default is null", async () => {
    const { supabase } = createFakeSupabase({
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

    const view = await buildClientBillingView({
      supabase,
      clientId: "client-a",
      lang: "fr",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        customerDefaultPaymentMethod: null,
        subscriptionDefaultPaymentMethod: {
          id: "pm_sub",
          card: { brand: "visa", last4: "4242", exp_month: 5, exp_year: 2039 },
        },
        invoices: [],
      }),
      packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
    });

    assert.equal(view.defaultPaymentMethod.available, true);
    assert.equal(view.defaultPaymentMethod.last4, "4242");
    assert.equal(view.defaultPaymentMethod.scope, "subscription");
  });

  it("marks pdf unavailable in the view when stripe does not provide a pdf", async () => {
    const { supabase } = createFakeSupabase({
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

    const view = await buildClientBillingView({
      supabase,
      clientId: "client-a",
      lang: "en",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
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
          invoice_pdf: null,
        }],
      }),
      packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
    });

    assert.equal(view.recentInvoices.length, 1);
    assert.equal(view.recentInvoices[0].canView, true);
    assert.equal(view.recentInvoices[0].canDownloadPdf, false);
    assert.doesNotMatch(JSON.stringify(view), /https?:\/\//);
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
    assert.equal(view.accounts[0].invoices[0].canDownloadPdf, false);
    assert.equal(view.accounts[1].invoices.length, 1);
    assert.equal(view.accounts[1].invoices[0].invoiceRef, "in_b");
    assert.equal(view.accounts[1].invoices[0].canDownloadPdf, true);
    assert.doesNotMatch(JSON.stringify(view), /https?:\/\//);
    assertClientBillingPayloadSafe(view);
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

  it("redirects only to authorized pdf urls", async () => {
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
          invoice_pdf: "https://files.example.test/in_a1.pdf",
        }],
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.url, "https://files.example.test/in_a1.pdf");
  });

  it("rejects foreign invoice pdf download", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
    });

    const result = await resolveAuthorizedClientInvoiceDocument({
      supabase,
      clientId: "client-a",
      invoiceRef: "in_foreign",
      kind: "pdf",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        invoices: [{
          id: "in_foreign",
          customer: "cus_other",
          status: "paid",
          invoice_pdf: "https://files.example.test/in_foreign.pdf",
        }],
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
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
    assert.equal(fr.downloadPdf, "Télécharger la facture PDF");
    assert.equal(en.downloadPdf, "Download invoice PDF");
    assert.equal(fr.pdfUnavailable, "PDF indisponible");
    assert.equal(en.pdfUnavailable, "PDF unavailable");
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

  it("routes pdf downloads through the secure document endpoint without exposing stripe pdf urls", () => {
    const drawer = readFileSync(
      new URL("../../../app/instagram-client/ClientPaymentBillingDrawer.tsx", import.meta.url),
      "utf8",
    );
    const documentRoute = readFileSync(
      new URL("../../../app/api/instagram-client/billing/invoices/[invoiceRef]/document/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(drawer, /downloadPdf/);
    assert.match(drawer, /pdfUnavailable/);
    assert.match(drawer, /invoiceDocumentPath\(invoice\.invoiceRef, "pdf"\)/);
    assert.match(documentRoute, /resolveAuthorizedClientInvoiceDocument/);
    assert.match(documentRoute, /requireClientInstagramSession/);
    assert.match(documentRoute, /Cache-Control.*no-store/);
    assert.doesNotMatch(drawer, /invoice_pdf|hosted_invoice_url|files\.stripe\.com/);
  });
});

describe("payment method scope labels", () => {
  it("never uses agency label for standard subscription cards", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
      client_instagram_accounts: [{ client_id: "client-a", account_id: "acct-a" }],
      ig_accounts: [{ id: "acct-a", username: "brand_a" }],
      commercial_stripe_subscriptions: [{
        client_id: "client-a",
        stripe_subscription_id: "sub_account_a",
        account_id: "acct-a",
        status: "active",
      }],
    });

    const sharedPm = {
      id: "pm_shared",
      card: { brand: "mastercard", last4: "4444", exp_month: 5, exp_year: 2030 },
    };

    const view = await buildClientBillingView({
      supabase,
      clientId: "client-a",
      lang: "fr",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        customerDefaultPaymentMethod: sharedPm,
        subscriptionDefaultPaymentMethod: sharedPm,
        invoices: [],
      }),
      packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
    });

    assert.equal(view.mode, "standard");
    assert.equal(view.defaultPaymentMethod.scope, "subscription");
    assert.equal(paymentMethodScopeLabel(view.defaultPaymentMethod.scope, "fr"), "Moyen de paiement de l'abonnement");
    assert.equal(paymentMethodScopeLabel(view.defaultPaymentMethod.scope, "en"), "Subscription payment method");
  });

  it("uses account default label when only customer invoice default exists", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
      client_instagram_accounts: [{ client_id: "client-a", account_id: "acct-a" }],
      ig_accounts: [{ id: "acct-a", username: "brand_a" }],
      commercial_stripe_subscriptions: [{
        client_id: "client-a",
        stripe_subscription_id: "sub_account_a",
        account_id: "acct-a",
        status: "active",
      }],
    });

    const view = await buildClientBillingView({
      supabase,
      clientId: "client-a",
      lang: "en",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        customerDefaultPaymentMethod: {
          id: "pm_customer",
          card: { brand: "visa", last4: "1111", exp_month: 1, exp_year: 2031 },
        },
        subscriptionDefaultPaymentMethod: null,
        subscriptions: [{ id: "sub_account_a", default_payment_method: null }],
        invoices: [],
      }),
      packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
    });

    assert.equal(view.defaultPaymentMethod.scope, "account_default");
    assert.equal(paymentMethodScopeLabel(view.defaultPaymentMethod.scope, "en"), "Account default card");
  });

  it("uses agency label only when all active subscriptions share customer-level default", async () => {
    const sharedPm = {
      id: "pm_agency",
      card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
    };
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
        { client_id: "agency", stripe_subscription_id: "sub_a", account_id: "acct-a", status: "active" },
        { client_id: "agency", stripe_subscription_id: "sub_b", account_id: "acct-b", status: "active" },
      ],
    });

    const view = await buildClientBillingView({
      supabase,
      clientId: "agency",
      lang: "fr",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        customerId: "cus_agency",
        customerDefaultPaymentMethod: sharedPm,
        subscriptions: [
          { id: "sub_a", default_payment_method: sharedPm },
          { id: "sub_b", default_payment_method: sharedPm },
        ],
        invoices: [],
      }),
      packageSummaries: new Map([
        packageSummary("acct-a", "Pro"),
        packageSummary("acct-b", "Growth", "growth"),
      ]),
    });

    assert.equal(view.defaultPaymentMethod.scope, "agency_default");
    assert.equal(paymentMethodScopeLabel(view.defaultPaymentMethod.scope, "fr"), "Carte par défaut du compte agence");
  });

  it("uses subscription-specific label when agency subscriptions diverge", async () => {
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
        { client_id: "agency", stripe_subscription_id: "sub_a", account_id: "acct-a", status: "active" },
        { client_id: "agency", stripe_subscription_id: "sub_b", account_id: "acct-b", status: "active" },
      ],
    });

    const view = await buildClientBillingView({
      supabase,
      clientId: "agency",
      lang: "fr",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        customerId: "cus_agency",
        customerDefaultPaymentMethod: {
          id: "pm_customer",
          card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
        },
        subscriptions: [
          {
            id: "sub_a",
            default_payment_method: {
              id: "pm_a",
              card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
            },
          },
          {
            id: "sub_b",
            default_payment_method: {
              id: "pm_b",
              card: { brand: "mastercard", last4: "5555", exp_month: 6, exp_year: 2029 },
            },
          },
        ],
        invoices: [],
      }),
      packageSummaries: new Map([
        packageSummary("acct-a", "Pro"),
        packageSummary("acct-b", "Growth", "growth"),
      ]),
    });

    assert.notEqual(view.defaultPaymentMethod.scope, "agency_default");
    assert.equal(view.accounts[1].paymentMethod.scope, "subscription_specific");
    assert.equal(
      paymentMethodScopeLabel(view.accounts[1].paymentMethod.scope, "en"),
      "This subscription's payment method",
    );
  });
});

describe("localized invoice service labels", () => {
  it("detects raw stripe invoice descriptions", () => {
    assert.equal(
      stripeInvoiceLineLooksRaw("1 × Boost AI — Pro (at €1,773.00 / every 12 months)"),
      true,
    );
    assert.equal(stripeInvoiceLineLooksRaw("Pro plan"), false);
  });

  it("builds FR and EN invoice labels without english fragments", async () => {
    const { supabase } = createFakeSupabase({
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
      }],
      client_account_entitlements: [{
        id: "ent-a",
        client_id: "client-a",
        account_id: "acct-a",
        plan_key: "pro",
        billing_interval_months: 12,
        pack_monthly_discounted_cents: 177300,
      }],
    });

    const stripeDescription = "1 × Boost AI — Pro (at €1,773.00 / every 12 months)";
    for (const lang of ["fr", "en"]) {
      const view = await buildClientBillingView({
        supabase,
        clientId: "client-a",
        lang,
        env: TEST_ENV,
        stripeGateway: fakeStripeGateway({
          invoices: [{
            id: "in_a1",
            customer: "cus_tenant_a",
            subscription: "sub_account_a",
            status: "paid",
            created: Math.floor(new Date("2026-06-01T00:00:00Z").getTime() / 1000),
            currency: "eur",
            total: 177300,
            amount_due: 0,
            amount_paid: 177300,
            amount_remaining: 0,
            hosted_invoice_url: "https://pay.example.test/in_a1",
            invoice_pdf: null,
            lines: { data: [{ description: stripeDescription, amount: 177300, quantity: 1 }] },
          }],
        }),
        packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
      });

      const label = view.recentInvoices[0].serviceLabel;
      assert.doesNotMatch(label, /\(at\s|every \d/i);
      assert.match(label, /Boost AI — Pro/);
      assert.match(label, /1 ×/);
      if (lang === "fr") {
        assert.match(label, /\/ an$/);
        assert.match(label, /773/);
      } else {
        assert.match(label, /\/ year$/);
        assert.match(label, /1,773\.00|1\.773,00|773/);
      }
    }
  });

  it("formats cadences for 1, 3, 6 and 12 months", () => {
    const entitlement = {
      planKey: "pro",
      commercialPackageCode: "pro",
      outreachAddonKey: null,
      billingIntervalMonths: 12,
    };

    assert.match(
      buildLocalizedInvoiceServiceLabel({
        entitlement: { ...entitlement, billingIntervalMonths: 1 },
        commercialMode: "full_cycle",
        packageLabel: "Pro",
        amountMinor: 14700,
        currency: "eur",
        quantity: 1,
        lang: "fr",
      }),
      /147,00.*€.*\/ mois$/,
    );
    assert.match(
      buildLocalizedInvoiceServiceLabel({
        entitlement: { ...entitlement, billingIntervalMonths: 3 },
        commercialMode: "full_cycle",
        packageLabel: "Pro",
        amountMinor: 53190,
        currency: "eur",
        quantity: 1,
        lang: "fr",
      }),
      /531,90.*€.*tous les 3 mois$/,
    );
    assert.match(
      buildLocalizedInvoiceServiceLabel({
        entitlement: { ...entitlement, billingIntervalMonths: 12 },
        commercialMode: "full_cycle",
        packageLabel: "Pro",
        amountMinor: 177300,
        currency: "eur",
        quantity: 1,
        lang: "en",
      }),
      /\/ year$/,
    );
    assert.match(
      buildLocalizedInvoiceServiceLabel({
        entitlement: {
          planKey: null,
          commercialPackageCode: null,
          outreachAddonKey: "outreach_standard",
          billingIntervalMonths: 1,
        },
        commercialMode: "outreach_only",
        packageLabel: "",
        amountMinor: 8900,
        currency: "eur",
        quantity: 1,
        lang: "fr",
      }),
      /Instagram Outreach — Standard · 89,00.*€.*\/ mois$/,
    );
  });
});

describe("mon compte billing sync", () => {
  it("exposes the same canonical payment label through loadClientBillingPaymentSummary", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
      client_instagram_accounts: [{ client_id: "client-a", account_id: "acct-a" }],
      ig_accounts: [{ id: "acct-a", username: "brand_a" }],
      commercial_stripe_subscriptions: [{
        client_id: "client-a",
        stripe_subscription_id: "sub_account_a",
        account_id: "acct-a",
        status: "active",
      }],
    });

    const gateway = fakeStripeGateway({
      customerDefaultPaymentMethod: null,
      subscriptionDefaultPaymentMethod: {
        id: "pm_sub",
        card: { brand: "mastercard", last4: "4444", exp_month: 5, exp_year: 2030 },
      },
      invoices: [],
    });

    const view = await buildClientBillingView({
      supabase,
      clientId: "client-a",
      lang: "fr",
      env: TEST_ENV,
      stripeGateway: gateway,
      packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
    });
    const summary = await loadClientBillingPaymentSummary({
      supabase,
      clientId: "client-a",
      lang: "fr",
      env: TEST_ENV,
      stripeGateway: gateway,
      packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
    });

    assert.equal(summary.displayLabel, view.defaultPaymentMethod.displayLabel);
    assert.match(summary.displayLabel, /Mastercard •••• 4444 · 05\/2030/);
    assert.doesNotMatch(JSON.stringify(summary), /cus_|sub_|pm_/);
  });

  it("returns honest empty state when no active payment method exists", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ client_id: "client-a", stripe_customer_id: "cus_tenant_a" }],
      client_instagram_accounts: [{ client_id: "client-a", account_id: "acct-a" }],
      ig_accounts: [{ id: "acct-a", username: "brand_a" }],
    });

    const summary = await loadClientBillingPaymentSummary({
      supabase,
      clientId: "client-a",
      lang: "fr",
      env: TEST_ENV,
      stripeGateway: fakeStripeGateway({
        customerDefaultPaymentMethod: null,
        subscriptionDefaultPaymentMethod: null,
        invoices: [],
      }),
      packageSummaries: new Map([packageSummary("acct-a", "Pro")]),
    });

    assert.equal(summary.available, false);
    assert.equal(summary.displayLabel, clientBillingCopy("fr").noPaymentMethod);
  });
});

describe("client dashboard billing sync source", () => {
  it("loads canonical payment method from billing api instead of legacy metadata only", () => {
    const dashboard = readFileSync(
      new URL("../../../app/instagram-client/ClientDashboard.tsx", import.meta.url),
      "utf8",
    );
    const workspace = readFileSync(
      new URL("../../../lib/instagram-client/workspace-data.ts", import.meta.url),
      "utf8",
    );
    assert.match(dashboard, /loadCanonicalPaymentMethod/);
    assert.match(dashboard, /\/api\/instagram-client\/billing\?lang=/);
    assert.match(dashboard, /canonicalPaymentMethodDisplay/);
    assert.match(workspace, /loadClientBillingPaymentSummary/);
  });
});
