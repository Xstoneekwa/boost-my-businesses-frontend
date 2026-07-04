import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isStripeLiveSecretKey,
  isStripeTestSecretKey,
  readStripeTestAllowedRedirectOrigins,
  readStripeTestConfig,
  resolveStripeTestCheckoutRedirectOrigin,
  StripeFoundationError,
} from "./stripe-config.ts";
import {
  buildSafeStripeMetadata,
  isValidStripePriceId,
  rejectUnsafeStripeMetadataKeys,
} from "./stripe-catalog.ts";
import { confirmCommercialPayment } from "../confirm-commercial-payment.ts";
import { isStripeTestFoundationReady } from "./stripe-readiness.ts";

describe("stripe test config fail-closed", () => {
  it("rejects missing config", () => {
    assert.equal(readStripeTestConfig({}), null);
  });

  it("rejects live secret keys", () => {
    assert.throws(
      () => readStripeTestConfig({
        STRIPE_SECRET_KEY: "sk_live_abc",
        STRIPE_TEST_CHECKOUT_ENABLED: "true",
      }),
      (error) => error instanceof StripeFoundationError && error.code === "stripe_live_key_rejected",
    );
  });

  it("accepts test secret keys when enabled", () => {
    const config = readStripeTestConfig({
      STRIPE_SECRET_KEY: "sk_test_abc",
      STRIPE_TEST_CHECKOUT_ENABLED: "true",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
    });
    assert.ok(config);
    assert.equal(isStripeTestSecretKey(config.secretKey), true);
    assert.equal(isStripeLiveSecretKey("sk_live_x"), true);
  });

  it("requires an explicit allowlist for Stripe Test redirect origins", () => {
    assert.deepEqual(readStripeTestAllowedRedirectOrigins({}), []);
    assert.deepEqual(
      readStripeTestAllowedRedirectOrigins({
        STRIPE_TEST_CHECKOUT_ALLOWED_ORIGINS: "https://app.example.test, https://preview.example.test/path",
      }),
      ["https://app.example.test", "https://preview.example.test"],
    );

    assert.throws(
      () => resolveStripeTestCheckoutRedirectOrigin("https://app.example.test/api/commercial/checkout/stripe/create-session", {}),
      (error) => error instanceof StripeFoundationError && error.code === "stripe_redirect_origin_not_configured",
    );
    assert.throws(
      () => resolveStripeTestCheckoutRedirectOrigin("https://evil.example/api/commercial/checkout/stripe/create-session", {
        STRIPE_TEST_CHECKOUT_ALLOWED_ORIGINS: "https://app.example.test",
      }),
      (error) => error instanceof StripeFoundationError && error.code === "stripe_redirect_origin_forbidden",
    );
    assert.equal(
      resolveStripeTestCheckoutRedirectOrigin("https://app.example.test/api/commercial/checkout/stripe/create-session", {
        STRIPE_TEST_CHECKOUT_ALLOWED_ORIGINS: "https://app.example.test",
      }),
      "https://app.example.test",
    );
  });
});

describe("stripe metadata safety", () => {
  it("rejects password-like metadata keys", () => {
    assert.throws(
      () => rejectUnsafeStripeMetadataKeys({ password: "secret" }),
      /unsafe_stripe_metadata_key/,
    );
  });

  it("builds safe metadata for allowed keys", () => {
    const metadata = buildSafeStripeMetadata({
      internal_attempt_id: "attempt-1",
      flow_type: "first_purchase",
    });
    assert.equal(metadata.internal_attempt_id, "attempt-1");
    rejectUnsafeStripeMetadataKeys(metadata);
  });
});

describe("confirmCommercialPayment stripe provider", () => {
  it("requires webhook verification for stripe", () => {
    const denied = confirmCommercialPayment({
      provider: "stripe",
      purchaserEmail: "test@example.com",
      amountDueCents: 1000,
      idempotencyKey: "key-1",
      checkoutContext: "public_new_workspace",
    });
    assert.equal(denied.ok, false);
  });

  it("accepts stripe when webhook verified", () => {
    const ok = confirmCommercialPayment({
      provider: "stripe",
      purchaserEmail: "test@example.com",
      amountDueCents: 1000,
      idempotencyKey: "key-1",
      checkoutContext: "public_new_workspace",
      stripeWebhookVerified: true,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.paymentProvider, "stripe");
      assert.equal(ok.paymentStatus, "confirmed");
    }
  });
});

describe("stripe readiness", () => {
  it("requires full test foundation", () => {
    assert.equal(isStripeTestFoundationReady({
      stripeSdkAvailable: true,
      testModeConfigured: true,
      webhookConfigured: true,
      testCatalogMappingsCount: 2,
      portalConfigurationAvailable: true,
      testCheckoutEnabled: true,
    }), true);
    assert.equal(isStripeTestFoundationReady({
      stripeSdkAvailable: true,
      testModeConfigured: false,
      webhookConfigured: false,
      testCatalogMappingsCount: 0,
      portalConfigurationAvailable: false,
      testCheckoutEnabled: false,
    }), false);
  });
});

describe("public checkout preservation", () => {
  it("CommercialCheckoutForm routes Stripe Test mode through public checkout session creation", () => {
    const source = readFileSync(new URL("../../../app/instagram-growth/checkout/CommercialCheckoutForm.tsx", import.meta.url), "utf8");
    assert.match(source, /\/api\/commercial\/checkout\/simulated\/activate/);
    assert.match(source, /\/api\/commercial\/checkout\/stripe\/create-session/);
    assert.match(source, /Continue to Stripe Test|Continuer vers Stripe Test/);
    assert.match(source, /password_confirmation/);
    assert.match(source, /resolvePublicCheckoutSelection/);
    assert.doesNotMatch(source, /price_id|stripe_price_id|success_url|cancel_url/);
  });

  it("legal pages remain untouched by stripe public naming", () => {
    const terms = readFileSync(new URL("../../../app/terms-and-conditions/TermsAndConditionsClient.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(terms, /Paddle/);
  });
});

describe("stripe checkout route redirect hardening", () => {
  it("builds checkout return URLs only from the allowlisted server origin", () => {
    const publicRoute = readFileSync(
      new URL("../../../app/api/commercial/checkout/stripe/create-session/route.ts", import.meta.url),
      "utf8",
    );
    const adminRoute = readFileSync(
      new URL("../../../app/api/instagram-dashboard/commercial/stripe-test/create-checkout/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(publicRoute, /resolveStripeTestCheckoutRedirectOrigin\(request\.url\)/);
    assert.match(publicRoute, /allowedOrigins: \[origin\]/);
    assert.match(adminRoute, /resolveStripeTestCheckoutRedirectOrigin\(request\.url\)/);
    assert.match(adminRoute, /allowedOrigins: \[origin\]/);
  });

  it("does not accept browser-supplied plan-change redirect URLs", () => {
    const route = readFileSync(
      new URL("../../../app/api/commercial/checkout/stripe/plan-change/create-session/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(route, /resolveStripeTestCheckoutRedirectOrigin\(request\.url\)/);
    assert.match(route, /successUrl: `\$\{origin\}\/commercial\/stripe-test\/success/);
    assert.match(route, /cancelUrl: `\$\{origin\}\/commercial\/stripe-test\/cancel`/);
    assert.doesNotMatch(route, /body\.success_url|body\.cancel_url/);
  });
});

describe("stripe price id validation", () => {
  it("validates price and product id formats only", () => {
    assert.equal(isValidStripePriceId("price_123"), true);
    assert.equal(isValidStripePriceId("price_from_client"), false);
  });
});
