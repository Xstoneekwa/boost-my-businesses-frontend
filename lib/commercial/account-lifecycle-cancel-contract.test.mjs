import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMMERCIAL_CANCEL_CONTRACT } from "./account-lifecycle-cancel-contract.ts";
import { createAccountLifecycleStripeGateway } from "./account-lifecycle-stripe.ts";

describe("commercial cancel contract", () => {
  it("defines immediate cancellation without automatic proration or refund", () => {
    assert.equal(COMMERCIAL_CANCEL_CONTRACT.effective, "immediate");
    assert.deepEqual(COMMERCIAL_CANCEL_CONTRACT.stripeCancelParams, {
      invoice_now: false,
      prorate: false,
    });
    assert.equal(COMMERCIAL_CANCEL_CONTRACT.automaticRefund, false);
  });

  it("keeps operational account states non-blocking and integrity gates explicit", () => {
    assert.deepEqual(COMMERCIAL_CANCEL_CONTRACT.nonBlockingOperationalStates, [
      "identity_required_unverified",
      "login_required",
      "needs_assistance",
      "operator_review",
      "open_incident",
      "insufficient_ct",
      "readiness_false",
    ]);
    assert.deepEqual(COMMERCIAL_CANCEL_CONTRACT.hardIntegrityBlockers, [
      "commercial_entitlement_missing",
      "commercial_subscription_missing",
      "commercial_subscription_ambiguous",
      "lifecycle_operation_conflict",
      "runtime_still_active",
      "capacity_release_pending",
    ]);
  });

  it("passes explicit cancel parameters and idempotency in the Stripe request options", async () => {
    const calls = [];
    const stripe = {
      subscriptions: {
        async cancel(...args) {
          calls.push(args);
          return { status: "canceled" };
        },
      },
    };
    const gateway = createAccountLifecycleStripeGateway(stripe);

    const result = await gateway.cancelSubscriptionImmediately("sub_test", "cancel-idempotency-key");

    assert.deepEqual(result, { status: "canceled" });
    assert.deepEqual(calls, [[
      "sub_test",
      { invoice_now: false, prorate: false },
      { idempotencyKey: "cancel-idempotency-key" },
    ]]);
  });
});
