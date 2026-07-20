import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PUBLIC_CHECKOUT_COPY, publicCheckoutCopy } from "./public-checkout-copy.ts";
import {
  publicCheckoutLoginPath,
  resolvePublicCheckoutLangFromSearchParam,
} from "./public-checkout-lang.ts";
import { verifyStripeSessionStatusOwnership, getSafeStripeSessionStatus } from "./stripe/stripe-webhook-handler.ts";
import { STRIPE_ATTEMPT_STATUS } from "./stripe/stripe-attempt-state.ts";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("public checkout bilingual copy", () => {
  it("uses client-safe payment CTA in FR and EN", () => {
    assert.equal(publicCheckoutCopy("fr", "paymentCta"), "Confirmer le paiement");
    assert.equal(publicCheckoutCopy("en", "paymentCta"), "Confirm payment");
  });

  it("does not expose stripe/webhook/foundation jargon in public copy", () => {
    const corpus = Object.values(PUBLIC_CHECKOUT_COPY)
      .flatMap((entry) => [entry.fr, entry.en])
      .join("\n");
    assert.doesNotMatch(corpus, /stripe test|webhook|foundation/i);
  });
});

describe("public checkout client surfaces", () => {
  it("CommercialCheckoutForm uses bilingual payment CTA without technical banner", () => {
    const form = source("../../app/instagram-growth/checkout/CommercialCheckoutForm.tsx");
    assert.match(form, /publicCheckoutCopy\(lang, "paymentCta"\)/);
    assert.doesNotMatch(form, /Stripe Test|webhook|foundation|Continuer vers Stripe Test|Continue to Stripe Test/i);
  });

  it("success page polls read-only status then redirects to canonical login", () => {
    const page = source("../../app/commercial/stripe-test/success/page.tsx");
    assert.match(page, /session-status/);
    assert.match(page, /publicCheckoutLoginPath/);
    assert.match(page, /router\.replace\(loginPath\)/);
    assert.doesNotMatch(page, /Stripe Test|webhook|foundation|informational only|activateClientAccountEntitlementFromCheckout/i);
    assert.match(page, /successPending|retryCheck/);
  });

  it("cancel page stays client-safe and bilingual", () => {
    const page = source("../../app/commercial/stripe-test/cancel/page.tsx");
    assert.match(page, /publicCheckoutCopy/);
    assert.doesNotMatch(page, /Stripe Test|webhook|foundation/i);
  });

  it("login keeps client dashboard destination after auth", () => {
    const login = source("../../app/instagram-login/InstagramLoginClient.tsx");
    assert.match(login, /instagramPostLoginPath\(payload\.user\?\.role\)/);
  });
});

describe("public post-payment session status polling", () => {
  function statusSupabaseFixture({
    stripeSessionId = "cs_test_public_poll",
    attemptAuthUserId = "auth-user-1",
    attemptClientId = "client-1",
    checkoutAuthUserId = "auth-user-1",
    checkoutClientId = "client-1",
    checkoutStatus = "checkout_paid",
    activatedAt = "2026-07-04T12:00:00.000Z",
    attemptStatus = STRIPE_ATTEMPT_STATUS.FULFILLED,
    attemptFlowType = "first_purchase",
    attemptLivemode = false,
    attemptFulfilledAt = "2026-07-04T12:00:00.000Z",
    attemptFulfillmentError = null,
    attemptEntitlementId = "entitlement-1",
    authUserExists = true,
    clientStatus = "active",
    tenantUserExists = true,
    tenantRole = "tenant",
    clientUserExists = true,
    clientUserRole = "owner",
    clientUserStatus = "active",
    entitlementRows,
  } = {}) {
    const checkoutSessionId = "checkout-session-1";
    const clientId = "client-1";
    const canonicalEntitlements = entitlementRows ?? [{
      id: "entitlement-1",
      status: "entitlement_reserved",
      client_id: clientId,
      checkout_session_id: checkoutSessionId,
      account_id: null,
      plan_key: "growth",
      billing_interval_months: 12,
    }];
    const attempt = {
      id: "attempt-1",
      idempotency_key: "attempt-idempotency-1",
      flow_type: attemptFlowType,
      stripe_checkout_session_id: stripeSessionId,
      commercial_checkout_session_id: checkoutSessionId,
      client_account_entitlement_id: attemptEntitlementId,
      client_id: attemptClientId,
      status: attemptStatus,
      auth_user_id: attemptAuthUserId,
      fulfilled_at: attemptFulfilledAt,
      fulfillment_error_redacted: attemptFulfillmentError,
      checkout_mode: "subscription",
      livemode: attemptLivemode,
    };

    function filteredRows(table, filters) {
      const rows = {
        commercial_stripe_checkout_attempts: [attempt],
        commercial_checkout_sessions: [{
          id: checkoutSessionId,
          status: checkoutStatus,
          activated_at: activatedAt,
          auth_user_id: checkoutAuthUserId,
          client_id: checkoutClientId,
        }],
        clients: [{ id: clientId, status: clientStatus }],
        tenant_users: tenantUserExists
          ? [{ user_id: "auth-user-1", tenant_id: clientId, role: tenantRole }]
          : [],
        client_users: clientUserExists
          ? [{
            id: "client-user-1",
            client_id: clientId,
            auth_user_id: "auth-user-1",
            role: clientUserRole,
            status: clientUserStatus,
          }]
          : [],
        client_account_entitlements: canonicalEntitlements,
      }[table];
      if (!rows) throw new Error(`Unexpected query table ${table}`);
      return rows.filter((row) => Object.entries(filters).every(([column, value]) => row[column] === value));
    }

    return {
      auth: {
        admin: {
          getUserById(userId) {
            return Promise.resolve({
              data: { user: authUserExists && userId === "auth-user-1" ? { id: userId } : null },
              error: null,
            });
          },
        },
      },
      from(table) {
        return {
          _table: table,
          _filters: {},
          select() {
            return this;
          },
          eq(column, value) {
            this._filters[column] = value;
            return this;
          },
          in(column, value) {
            this._filters[column] = value;
            return this;
          },
          limit() {
            return this;
          },
          maybeSingle() {
            const rows = filteredRows(this._table, this._filters);
            return { data: rows.length === 1 ? rows[0] : null, error: null };
          },
          then(resolve) {
            return Promise.resolve({ data: filteredRows(this._table, this._filters), error: null }).then(resolve);
          },
        };
      },
    };
  }

  it("allows read-only poll for first_purchase stripe session without auth", async () => {
    const stripeSessionId = "cs_test_public_poll";
    const supabase = statusSupabaseFixture({ stripeSessionId });

    const ownership = await verifyStripeSessionStatusOwnership(supabase, {
      requesterUserId: "",
      isAdmin: false,
      stripeCheckoutSessionId: stripeSessionId,
    });
    assert.equal(ownership.ok, true);

    const status = await getSafeStripeSessionStatus(supabase, {
      stripeCheckoutSessionId: stripeSessionId,
    });
    assert.equal(status.ok, true);
    assert.equal(status.commercialStatus, "checkout_paid");
    assert.equal(status.readyForLogin, true);
  });

  for (const status of ["entitlement_reserved", "active", "entitlement_consumed"]) {
    it(`accepts the canonical handoff entitlement status ${status}`, async () => {
      const result = await getSafeStripeSessionStatus(
        statusSupabaseFixture({
          entitlementRows: [{
            id: "entitlement-1",
            status,
            client_id: "client-1",
            checkout_session_id: "checkout-session-1",
            account_id: status === "entitlement_reserved" ? null : "account-1",
          }],
        }),
        { stripeCheckoutSessionId: "cs_test_public_poll" },
      );

      assert.equal(result.ok, true);
      assert.equal(result.readyForLogin, true);
    });
  }

  it("resolves ready_for_login from canonical checkout session when attempt auth is missing", async () => {
    const status = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ attemptAuthUserId: null, checkoutAuthUserId: "auth-user-1" }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );

    assert.equal(status.ok, true);
    assert.equal(status.readyForLogin, true);
  });

  it("supports the production first-purchase shape with canonical links on checkout", async () => {
    const status = await getSafeStripeSessionStatus(
      statusSupabaseFixture({
        attemptAuthUserId: null,
        attemptClientId: null,
        attemptEntitlementId: null,
      }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );

    assert.equal(status.ok, true);
    assert.equal(status.commercialStatus, "checkout_paid");
    assert.equal(status.readyForLogin, true);
  });

  it("keeps ready_for_login false when auth user is absent", async () => {
    const status = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ attemptAuthUserId: null, checkoutAuthUserId: null }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );

    assert.equal(status.ok, true);
    assert.equal(status.readyForLogin, false);
  });

  it("keeps ready_for_login false until canonical activation and entitlement exist", async () => {
    const incompleteStatus = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ checkoutStatus: "checkout_pending_payment" }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );
    const missingEntitlement = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ entitlementRows: [] }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );

    assert.equal(incompleteStatus.ok, true);
    assert.equal(incompleteStatus.readyForLogin, false);
    assert.equal(missingEntitlement.ok, true);
    assert.equal(missingEntitlement.readyForLogin, false);
  });

  it("requires a unique entitlement linked to the exact checkout and client", async () => {
    const wrongClient = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ checkoutClientId: "client-other" }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );
    const duplicateEntitlements = await getSafeStripeSessionStatus(
      statusSupabaseFixture({
        entitlementRows: [
          {
            id: "entitlement-1",
            status: "entitlement_reserved",
            client_id: "client-1",
            checkout_session_id: "checkout-session-1",
            account_id: null,
          },
          {
            id: "entitlement-2",
            status: "entitlement_reserved",
            client_id: "client-1",
            checkout_session_id: "checkout-session-1",
            account_id: null,
          },
        ],
      }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );

    assert.equal(wrongClient.ok, true);
    assert.equal(wrongClient.readyForLogin, false);
    assert.equal(duplicateEntitlements.ok, true);
    assert.equal(duplicateEntitlements.readyForLogin, false);
  });

  it("requires active canonical tenant ownership", async () => {
    const missingTenant = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ tenantUserExists: false }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );
    const inactiveOwner = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ clientUserStatus: "inactive" }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );
    const missingAuth = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ authUserExists: false }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );

    assert.equal(missingTenant.readyForLogin, false);
    assert.equal(inactiveOwner.readyForLogin, false);
    assert.equal(missingAuth.readyForLogin, false);
  });

  it("requires the exact fulfilled Stripe Test first-purchase attempt", async () => {
    const notFulfilled = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ attemptStatus: STRIPE_ATTEMPT_STATUS.PAYMENT_CONFIRMED }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );
    const liveAttempt = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ attemptLivemode: true }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );
    const fulfillmentError = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ attemptFulfillmentError: "redacted_failure" }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );

    assert.equal(notFulfilled.readyForLogin, false);
    assert.equal(liveAttempt.readyForLogin, false);
    assert.equal(fulfillmentError.readyForLogin, false);
  });

  it("rejects cancelled and invalid reserved entitlement states", async () => {
    const cancelled = await getSafeStripeSessionStatus(
      statusSupabaseFixture({
        entitlementRows: [{
          id: "entitlement-1",
          status: "cancelled",
          client_id: "client-1",
          checkout_session_id: "checkout-session-1",
          account_id: null,
        }],
      }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );
    const reservedWithAccount = await getSafeStripeSessionStatus(
      statusSupabaseFixture({
        entitlementRows: [{
          id: "entitlement-1",
          status: "entitlement_reserved",
          client_id: "client-1",
          checkout_session_id: "checkout-session-1",
          account_id: "account-unexpected",
        }],
      }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );

    assert.equal(cancelled.readyForLogin, false);
    assert.equal(reservedWithAccount.readyForLogin, false);
  });

  it("applies the same handoff predicate to internal checkout polling", async () => {
    const ready = await getSafeStripeSessionStatus(
      statusSupabaseFixture(),
      { internalCheckoutSessionId: "checkout-session-1" },
    );
    const incomplete = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ attemptStatus: STRIPE_ATTEMPT_STATUS.PAYMENT_CONFIRMED }),
      { internalCheckoutSessionId: "checkout-session-1" },
    );

    assert.equal(ready.ok, true);
    assert.equal(ready.readyForLogin, true);
    assert.equal(incomplete.ok, true);
    assert.equal(incomplete.readyForLogin, false);
  });

  it("rejects unauthenticated poll for non first_purchase flows", async () => {
    const supabase = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() {
            return {
              data: {
                id: "attempt-plan-change",
                flow_type: "plan_change",
                auth_user_id: null,
              },
              error: null,
            };
          },
        };
      },
    };

    const ownership = await verifyStripeSessionStatusOwnership(supabase, {
      requesterUserId: "",
      isAdmin: false,
      stripeCheckoutSessionId: "cs_test_plan_change",
    });
    assert.equal(ownership.ok, false);
    assert.equal(ownership.code, "session_forbidden");
  });
});

describe("public checkout language handoff", () => {
  it("resolves lang from search param and builds login path", () => {
    assert.equal(resolvePublicCheckoutLangFromSearchParam("en"), "en");
    assert.equal(publicCheckoutLoginPath("en"), "/instagram-login?lang=en");
    assert.equal(publicCheckoutLoginPath("fr"), "/instagram-login");
  });

  it("session-status route exposes ready_for_login without activation jargon", () => {
    const route = source("../../app/api/commercial/checkout/stripe/session-status/route.ts");
    assert.match(route, /allowPublicPostPaymentPoll/);
    assert.match(route, /ready_for_login/);
    assert.doesNotMatch(route, /activation_source|webhook_only|informational_only/i);
  });
});
