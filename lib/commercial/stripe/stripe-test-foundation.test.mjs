import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isStripeLiveSecretKey,
  isStripeTestSecretKey,
  readStripeTestConfig,
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
  it("CommercialCheckoutForm still uses simulated activate route", () => {
    const source = readFileSync(new URL("../../../app/instagram-growth/checkout/CommercialCheckoutForm.tsx", import.meta.url), "utf8");
    assert.match(source, /\/api\/commercial\/checkout\/simulated\/activate/);
    assert.match(source, /Simuler l'activation|Simulate activation/);
    assert.doesNotMatch(source, /checkout\/stripe\/create-session/);
  });

  it("legal pages remain untouched by stripe public naming", () => {
    const terms = readFileSync(new URL("../../../app/terms-and-conditions/TermsAndConditionsClient.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(terms, /Paddle/);
  });
});

describe("stripe price id validation", () => {
  it("validates price and product id formats only", () => {
    assert.equal(isValidStripePriceId("price_123"), true);
    assert.equal(isValidStripePriceId("price_from_client"), false);
  });
});
