import assert from "node:assert/strict";
import test from "node:test";
import {
  isIdempotentlyResolvedOperatorReview,
  resolveOperatorReviewActor,
} from "./operator-review-auth.ts";

const operatorId = "11111111-1111-4111-8111-111111111111";

test("authenticated relay supplies the trusted operator identity", () => {
  assert.deepEqual(resolveOperatorReviewActor({
    relayKeyProvided: true,
    relayAuth: { ok: true, mode: "relay_key" },
    relayOperatorId: operatorId,
    adminUserId: null,
    adminAuthorized: false,
  }), { ok: true, actorId: operatorId, mode: "relay_key" });
});

test("missing relay and admin authentication returns 401", () => {
  assert.deepEqual(resolveOperatorReviewActor({
    relayKeyProvided: false,
    relayAuth: null,
    relayOperatorId: null,
    adminUserId: null,
    adminAuthorized: false,
  }), { ok: false, status: 401, error: "Authentication required." });
});

test("relay identity is rejected unless relay authentication succeeds", () => {
  assert.deepEqual(resolveOperatorReviewActor({
    relayKeyProvided: true,
    relayAuth: { ok: false, reason: "relay_auth_invalid" },
    relayOperatorId: operatorId,
    adminUserId: null,
    adminAuthorized: false,
  }), {
    ok: false,
    status: 403,
    error: "Operator review relay authentication failed.",
    reason: "relay_auth_invalid",
  });
});

test("already resolved operator review is idempotent only after its blocker is cleared", () => {
  assert.equal(isIdempotentlyResolvedOperatorReview({
    action_type: "operator_review_required",
    status: "resolved",
    blocking_campaign: false,
  }), true);
  assert.equal(isIdempotentlyResolvedOperatorReview({
    action_type: "operator_review_required",
    status: "resolved",
    blocking_campaign: true,
  }), false);
});
