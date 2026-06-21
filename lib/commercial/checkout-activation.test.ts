import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClientUserInsertPayload,
  buildSimulatedCheckoutSubscriptionPayload,
  buildTenantUserInsertPayload,
  CHECKOUT_TENANT_USER_ROLE,
} from "./checkout-workspace-payloads.ts";

function isSimulatedCheckoutClientMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>).checkout_source === "simulated_checkout";
}

test("tenant_users insert payload uses role tenant exactly", () => {
  const payload = buildTenantUserInsertPayload({
    authUserId: "auth-123",
    clientId: "client-456",
  });
  assert.equal(payload.role, "tenant");
  assert.equal(payload.role, CHECKOUT_TENANT_USER_ROLE);
  assert.notEqual(payload.role, "client");
  assert.equal(payload.user_id, "auth-123");
  assert.equal(payload.tenant_id, "client-456");
});

test("client_users insert payload uses owner role", () => {
  const payload = buildClientUserInsertPayload({
    authUserId: "auth-123",
    clientId: "client-456",
  });
  assert.equal(payload.role, "owner");
  assert.equal(payload.status, "active");
});

test("simulated checkout subscription payload is scoped to client", () => {
  const payload = buildSimulatedCheckoutSubscriptionPayload("client-456");
  assert.equal(payload.client_id, "client-456");
  assert.equal(payload.metadata.source, "simulated_checkout");
});

test("simulated checkout client metadata detector", () => {
  assert.equal(isSimulatedCheckoutClientMetadata({ checkout_source: "simulated_checkout" }), true);
  assert.equal(isSimulatedCheckoutClientMetadata({ checkout_source: "other" }), false);
  assert.equal(isSimulatedCheckoutClientMetadata(null), false);
});

test("audit payload must not include password fields", () => {
  const payload = {
    plan_key: "pro",
    billing_interval_months: 1,
    outreach_addon_key: null,
    total_period_cents: 19700,
    idempotency_key: "key-1",
    flow_type: "first_purchase",
    checkout_context: "public_new_workspace",
  };
  assert.equal("password" in payload, false);
  assert.equal("password_confirmation" in payload, false);
});
