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
    checkoutAuthUserId = "auth-user-1",
    checkoutStatus = "checkout_paid",
    activatedAt = "2026-07-04T12:00:00.000Z",
    entitlementRows = [{ id: "entitlement-1", status: "entitlement_consumed" }],
  } = {}) {
    const checkoutSessionId = "checkout-session-1";
    const clientId = "client-1";
    return {
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
            if (this._table === "commercial_stripe_checkout_attempts") {
              assert.equal(this._filters.stripe_checkout_session_id, stripeSessionId);
              return {
                data: {
                  id: "attempt-1",
                  flow_type: "first_purchase",
                  stripe_checkout_session_id: stripeSessionId,
                  commercial_checkout_session_id: checkoutSessionId,
                  client_id: clientId,
                  status: STRIPE_ATTEMPT_STATUS.FULFILLED,
                  auth_user_id: attemptAuthUserId,
                  fulfilled_at: "2026-07-04T12:00:00.000Z",
                },
                error: null,
              };
            }
            if (this._table === "commercial_checkout_sessions") {
              assert.equal(this._filters.id, checkoutSessionId);
              return {
                data: {
                  id: checkoutSessionId,
                  status: checkoutStatus,
                  activated_at: activatedAt,
                  auth_user_id: checkoutAuthUserId,
                  client_id: clientId,
                },
                error: null,
              };
            }
            throw new Error(`Unexpected maybeSingle table ${this._table}`);
          },
          then(resolve) {
            if (this._table === "client_account_entitlements") {
              assert.equal(this._filters.checkout_session_id, checkoutSessionId);
              assert.equal(this._filters.client_id, clientId);
              return Promise.resolve({ data: entitlementRows, error: null }).then(resolve);
            }
            throw new Error(`Unexpected query table ${this._table}`);
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

  it("resolves ready_for_login from canonical checkout session when attempt auth is missing", async () => {
    const status = await getSafeStripeSessionStatus(
      statusSupabaseFixture({ attemptAuthUserId: null, checkoutAuthUserId: "auth-user-1" }),
      { stripeCheckoutSessionId: "cs_test_public_poll" },
    );

    assert.equal(status.ok, true);
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
