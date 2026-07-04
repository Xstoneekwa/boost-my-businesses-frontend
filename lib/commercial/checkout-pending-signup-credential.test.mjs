import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CHECKOUT_PASSWORD_MIN_LENGTH,
  validatePublicCheckoutPassword,
} from "./checkout-password.ts";
import {
  clearCheckoutPendingSignupCredential,
  clearCheckoutPendingSignupCredentialIdempotent,
  consumeCheckoutPendingSignupCredential,
  hashCheckoutSignupEmail,
  loadCheckoutPendingSignupCredential,
  requireCheckoutSignupCredentialSecret,
  sealCheckoutPendingSignupCredentialForTests,
  storeCheckoutPendingSignupCredential,
  unsealCheckoutPendingSignupCredentialForTests,
  validateStripeFirstPurchaseSignupPassword,
} from "./checkout-pending-signup-credential.ts";

const TEST_SECRET = "test-checkout-signup-secret-32bytes-min!!";
const TEST_ENV = {
  STRIPE_TEST_CHECKOUT_ENABLED: "true",
  CHECKOUT_SIGNUP_CREDENTIAL_SECRET: TEST_SECRET,
};
const TEST_CREDENTIAL_EXPIRES_AT_UNIX = Math.floor(Date.now() / 1000) + 7200;

function binding(overrides = {}) {
  return {
    checkoutSessionId: "session-1",
    idempotencyKey: "idem-1",
    purchaserEmail: "client@example.com",
    flowType: "first_purchase",
    commercialMode: "full_cycle",
    expiresAtUnix: TEST_CREDENTIAL_EXPIRES_AT_UNIX,
    ...overrides,
  };
}

function sealForBinding(input, secret = TEST_SECRET) {
  return sealCheckoutPendingSignupCredentialForTests({
    ...input,
    expiresAtUnix: input.expiresAtUnix ?? TEST_CREDENTIAL_EXPIRES_AT_UNIX,
  }, secret);
}

function createMockSupabase(initialRows = []) {
  const rows = initialRows.map((row) => ({
    status: "checkout_pending_payment",
    purchaser_email: "client@example.com",
    flow_type: "first_purchase",
    commercial_mode: "full_cycle",
    ...row,
    metadata: { ...(row.metadata ?? {}) },
  }));
  return {
    from(table) {
      if (table !== "commercial_checkout_sessions") {
        throw new Error(`unexpected table ${table}`);
      }
      let filterId = "";
      let pendingUpdate = null;
      const api = {
        select() {
          return api;
        },
        eq(_column, value) {
          filterId = String(value);
          if (pendingUpdate) {
            const index = rows.findIndex((entry) => entry.id === filterId);
            if (index >= 0) {
              rows[index] = { ...rows[index], ...pendingUpdate };
            }
            return Promise.resolve({ error: null });
          }
          return api;
        },
        maybeSingle: async () => {
          const row = rows.find((entry) => entry.id === filterId) ?? null;
          return { data: row, error: null };
        },
        update: (patch) => {
          pendingUpdate = patch;
          return api;
        },
      };
      return api;
    },
    rows,
  };
}

describe("checkout pending signup credential hardening", () => {
  it("requires dedicated secret and rejects service-role fallback", () => {
    assert.equal(requireCheckoutSignupCredentialSecret({
      STRIPE_TEST_CHECKOUT_ENABLED: "true",
      CHECKOUT_SIGNUP_CREDENTIAL_SECRET: TEST_SECRET,
    }).ok, true);

    assert.equal(requireCheckoutSignupCredentialSecret({
      STRIPE_TEST_CHECKOUT_ENABLED: "true",
    }).code, "checkout_signup_credential_secret_missing");

    const shared = "shared-operational-secret-32bytes-min!!";
    assert.equal(requireCheckoutSignupCredentialSecret({
      STRIPE_TEST_CHECKOUT_ENABLED: "true",
      CHECKOUT_SIGNUP_CREDENTIAL_SECRET: shared,
      SUPABASE_SERVICE_ROLE_KEY: shared,
    }).code, "checkout_signup_credential_secret_forbidden");

    const source = readFileSync(new URL("./checkout-pending-signup-credential.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\)\s*\|\|/);
    assert.doesNotMatch(source, /CHECKOUT_SIGNUP_CREDENTIAL_SECRET\s*\?\?\s*.*SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(source, /CHECKOUT_SIGNUP_CREDENTIAL_SECRET[^\n]*\|\|\s*[^\n]*SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("seals with authenticated context binding and hides plaintext", () => {
    const sealed = sealForBinding({
      password: "ValidPassword12!",
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      purchaserEmail: "client@example.com",
    });
    assert.doesNotMatch(sealed.token, /ValidPassword12!/);
    const payload = unsealCheckoutPendingSignupCredentialForTests(sealed.token, binding(), TEST_SECRET);
    assert.equal(payload?.password, "ValidPassword12!");
    const wrongBinding = unsealCheckoutPendingSignupCredentialForTests(
      sealed.token,
      binding({ checkoutSessionId: "session-2" }),
      TEST_SECRET,
    );
    assert.equal(wrongBinding, null);
  });

  it("stores encrypted credential with expiry metadata", async () => {
    const supabase = createMockSupabase([{ id: "session-1", metadata: { prod_test_authorization_id: "auth-1" } }]);
    const stored = await storeCheckoutPendingSignupCredential(supabase, {
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      password: "ValidPassword12!",
      passwordConfirmation: "ValidPassword12!",
      purchaserEmail: "client@example.com",
      flowType: "first_purchase",
      commercialMode: "full_cycle",
      expiresAtUnix: Math.floor(Date.now() / 1000) + 7200,
    }, TEST_ENV);
    assert.equal(stored.ok, true);
    assert.ok(typeof supabase.rows[0].metadata.pending_signup_credential_ciphertext === "string");
    assert.ok(typeof supabase.rows[0].metadata.pending_signup_credential_expires_at === "string");
    assert.doesNotMatch(JSON.stringify(supabase.rows[0].metadata), /ValidPassword12!/);
  });

  it("rejects expired credentials without exposing password material", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    const sealed = sealForBinding({
      password: "ValidPassword12!",
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      purchaserEmail: "client@example.com",
      expiresAtUnix: expiredAt,
    });
    const supabase = createMockSupabase([{
      id: "session-1",
      metadata: {
        pending_signup_credential_ciphertext: sealed.token,
        pending_signup_credential_expires_at: new Date(expiredAt * 1000).toISOString(),
      },
    }]);
    const loaded = await loadCheckoutPendingSignupCredential(supabase, {
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      purchaserEmail: "client@example.com",
      flowType: "first_purchase",
      commercialMode: "full_cycle",
    }, TEST_ENV);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.code, "checkout_pending_credential_expired");
    assert.doesNotMatch(JSON.stringify(loaded), /ValidPassword12!/);
  });

  it("rejects binding mismatch for email hash and commercial mode", async () => {
    const sealed = sealForBinding({
      password: "ValidPassword12!",
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      purchaserEmail: "client@example.com",
      commercialMode: "full_cycle",
    });
    const supabase = createMockSupabase([{
      id: "session-1",
      purchaser_email: "other@example.com",
      metadata: {
        pending_signup_credential_ciphertext: sealed.token,
        pending_signup_credential_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    }]);
    const loaded = await loadCheckoutPendingSignupCredential(supabase, {
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      purchaserEmail: "client@example.com",
      flowType: "first_purchase",
      commercialMode: "full_cycle",
    }, TEST_ENV);
    assert.equal(loaded.code, "checkout_pending_credential_binding_mismatch");
    assert.equal(hashCheckoutSignupEmail("client@example.com") !== hashCheckoutSignupEmail("other@example.com"), true);
  });

  it("consumes credential after load and clears metadata idempotently", async () => {
    const sealed = sealForBinding({
      password: "ValidPassword12!",
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      purchaserEmail: "client@example.com",
    });
    const supabase = createMockSupabase([{
      id: "session-1",
      metadata: {
        pending_signup_credential_ciphertext: sealed.token,
        pending_signup_credential_expires_at: new Date(TEST_CREDENTIAL_EXPIRES_AT_UNIX * 1000).toISOString(),
      },
    }]);
    const consumed = await consumeCheckoutPendingSignupCredential(supabase, {
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      purchaserEmail: "client@example.com",
      flowType: "first_purchase",
      commercialMode: "full_cycle",
    }, TEST_ENV);
    assert.equal(consumed.ok, true);
    assert.equal(consumed.password, "ValidPassword12!");
    assert.equal(supabase.rows[0].metadata.pending_signup_credential_ciphertext, undefined);
    assert.equal(supabase.rows[0].metadata.pending_signup_credential_expires_at, undefined);
    const secondClear = await clearCheckoutPendingSignupCredentialIdempotent(supabase, "session-1");
    assert.equal(secondClear.ok, true);
    assert.equal(secondClear.cleared, false);
  });

  it("blocks load after terminal checkout session status", async () => {
    const sealed = sealForBinding({
      password: "ValidPassword12!",
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      purchaserEmail: "client@example.com",
    });
    const supabase = createMockSupabase([{
      id: "session-1",
      status: "checkout_expired",
      metadata: {
        pending_signup_credential_ciphertext: sealed.token,
        pending_signup_credential_expires_at: new Date(TEST_CREDENTIAL_EXPIRES_AT_UNIX * 1000).toISOString(),
      },
    }]);
    const loaded = await loadCheckoutPendingSignupCredential(supabase, {
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      purchaserEmail: "client@example.com",
      flowType: "first_purchase",
      commercialMode: "full_cycle",
    }, TEST_ENV);
    assert.equal(loaded.code, "checkout_pending_credential_terminal");
  });

  it("rejects invalid signup passwords before storage", () => {
    const mismatch = validateStripeFirstPurchaseSignupPassword({
      password: "a".repeat(CHECKOUT_PASSWORD_MIN_LENGTH),
      passwordConfirmation: "b".repeat(CHECKOUT_PASSWORD_MIN_LENGTH),
    });
    assert.equal(mismatch.ok, false);
    assert.doesNotMatch(JSON.stringify(mismatch), /aaaa|bbbb/);
    assert.equal(
      validatePublicCheckoutPassword({
        password: "ValidPassword12!",
        passwordConfirmation: "ValidPassword12!",
      }).ok,
      true,
    );
  });
});

describe("public checkout signup UI markers", () => {
  it("restores email and password fields for Stripe Test public checkout", () => {
    const source = readFileSync(new URL("../../app/instagram-growth/checkout/CommercialCheckoutForm.tsx", import.meta.url), "utf8");
    assert.match(source, /Créer votre mot de passe|Create your password/);
    assert.match(source, /Confirmer votre mot de passe|Confirm your password/);
    assert.match(source, /showPasswordConfirmation/);
    assert.match(source, /password_confirmation/);
    assert.match(source, /requirePassword: isPublicCheckout/);
  });
});
