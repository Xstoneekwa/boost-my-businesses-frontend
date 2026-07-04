import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CHECKOUT_PASSWORD_MIN_LENGTH,
  validatePublicCheckoutPassword,
} from "./checkout-password.ts";
import {
  clearCheckoutPendingSignupCredential,
  consumeCheckoutPendingSignupCredential,
  sealCheckoutPendingSignupCredentialForTests,
  storeCheckoutPendingSignupCredential,
  unsealCheckoutPendingSignupCredentialForTests,
  validateStripeFirstPurchaseSignupPassword,
} from "./checkout-pending-signup-credential.ts";

const TEST_SECRET = "test-checkout-signup-secret";

function createMockSupabase(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row, metadata: { ...(row.metadata ?? {}) } }));
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

describe("checkout pending signup credential", () => {
  it("seals and unseals password material without exposing plaintext in token structure", () => {
    const token = sealCheckoutPendingSignupCredentialForTests({
      password: "ValidPassword12!",
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
    }, TEST_SECRET);
    assert.doesNotMatch(token, /ValidPassword12!/);
    const payload = unsealCheckoutPendingSignupCredentialForTests(token, TEST_SECRET);
    assert.equal(payload?.password, "ValidPassword12!");
  });

  it("stores encrypted credential on pending checkout session metadata", async () => {
    const previousSecret = process.env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET;
    process.env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET = TEST_SECRET;
    const supabase = createMockSupabase([{ id: "session-1", metadata: { prod_test_authorization_id: "auth-1" } }]);
    const stored = await storeCheckoutPendingSignupCredential(supabase, {
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
      password: "ValidPassword12!",
      passwordConfirmation: "ValidPassword12!",
    });
    assert.equal(stored.ok, true);
    const metadata = supabase.rows[0].metadata;
    assert.ok(typeof metadata.pending_signup_credential_ciphertext === "string");
    assert.doesNotMatch(JSON.stringify(metadata), /ValidPassword12!/);
    process.env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET = previousSecret;
  });

  it("consumes credential after load and clears metadata", async () => {
    const previousSecret = process.env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET;
    process.env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET = TEST_SECRET;
    const token = sealCheckoutPendingSignupCredentialForTests({
      password: "ValidPassword12!",
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
    }, TEST_SECRET);
    const supabase = createMockSupabase([{
      id: "session-1",
      metadata: { pending_signup_credential_ciphertext: token },
    }]);
    const consumed = await consumeCheckoutPendingSignupCredential(supabase, {
      checkoutSessionId: "session-1",
      idempotencyKey: "idem-1",
    });
    assert.equal(consumed.ok, true);
    assert.equal(consumed.password, "ValidPassword12!");
    assert.equal(supabase.rows[0].metadata.pending_signup_credential_ciphertext, undefined);
    const cleared = await clearCheckoutPendingSignupCredential(supabase, "session-1");
    assert.equal(cleared.ok, true);
    process.env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET = previousSecret;
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
