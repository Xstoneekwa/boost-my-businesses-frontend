import assert from "node:assert/strict";
import test from "node:test";

import { activateClientAccountEntitlementFromCheckout } from "./activate-client-account-entitlement-from-checkout.ts";
import { inspectSimulatedCheckoutProvisioning } from "./checkout-provisioning-state.ts";
import {
  setCheckoutPasswordProofOverrideForTests,
} from "./checkout-orphan-resume.ts";
import {
  createCheckoutMockSupabase,
  mockPasswordSignIn,
} from "./checkout-test-mock-supabase.ts";

const REAL_AUTH_ID = "f2072cd8-98bb-42cf-9590-0d1507a23d2d";
const REAL_CLIENT_ID = "c51267f5-6c0d-46db-8ba0-7f1746a7b4bc";
const ORPHAN_EMAIL = "xstonekwa@hotmail.com";
const PASSWORD = "ValidPassword12!";

const TEST_ENV = {
  SIMULATED_CHECKOUT_ENABLED: "true",
  SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: ORPHAN_EMAIL,
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
};

function orphanMockStore() {
  return createCheckoutMockSupabase({
    authUsers: [{ id: REAL_AUTH_ID, email: ORPHAN_EMAIL, password: PASSWORD }],
    tables: {
      clients: [{
        id: REAL_CLIENT_ID,
        status: "active",
        metadata: {
          contact_email: ORPHAN_EMAIL,
          checkout_source: "simulated_checkout",
        },
      }],
    },
  });
}

test("real orphan auth + client inspects as link_orphan_client", async () => {
  const mockStore = orphanMockStore();
  const result = await inspectSimulatedCheckoutProvisioning(mockStore.supabase, {
    email: ORPHAN_EMAIL,
    authUserId: REAL_AUTH_ID,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.clientId, REAL_CLIENT_ID);
  assert.equal(result.resumeMode, "link_orphan_client");
  assert.equal(result.stages.client, true);
  assert.equal(result.stages.tenant_users, false);
});

test("forced storage error returns structured diagnostics without mutation", async () => {
  const mockStore = createCheckoutMockSupabase({
    authUsers: [{ id: REAL_AUTH_ID, email: ORPHAN_EMAIL, password: PASSWORD }],
    tables: {
      clients: [{
        id: REAL_CLIENT_ID,
        status: "active",
        metadata: { contact_email: ORPHAN_EMAIL, checkout_source: "simulated_checkout" },
      }],
    },
    failOnSelect: {
      client_subscriptions: { code: "42501", message: "permission denied for relation client_subscriptions" },
    },
  });
  setCheckoutPasswordProofOverrideForTests(async (input) => {
    const proof = await mockPasswordSignIn(mockStore.authUsers)(input);
    if (proof.error || !proof.data.user?.id) return { ok: false as const, reason: "password_verification_failed" as const };
    return { ok: true as const, authUserId: proof.data.user.id };
  });

  const before = mockStore.getCounts();
  const previousEnv = { ...process.env };
  Object.assign(process.env, TEST_ENV);
  const logs: unknown[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args);
    originalInfo(...args);
  };

  try {
    const result = await activateClientAccountEntitlementFromCheckout(mockStore.supabase, {
      planKey: "pro",
      billingIntervalMonths: 1,
      outreachAddonKey: null,
      purchaserEmail: ORPHAN_EMAIL,
      idempotencyKey: "storage-error-test",
      flowType: "first_purchase",
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
      mode: "simulated",
      browserSession: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 503);
    assert.equal(result.code, "checkout_storage_unavailable");
    assert.deepEqual(mockStore.getCounts(), before);

    const blockedLog = logs
      .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
      .find(
        (entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).event === "checkout_orphan_resume_blocked",
      ) as Record<string, unknown> | undefined;
    assert.ok(blockedLog);
    assert.equal(blockedLog.reason, "storage_error");
    assert.equal(blockedLog.postgres_code, "42501");
    assert.match(String(blockedLog.storage_query), /client_subscriptions/);
    assert.match(String(blockedLog.storage_message), /permission denied/i);
    assert.equal(blockedLog.client_id, null);
  } finally {
    console.info = originalInfo;
    process.env = previousEnv;
    setCheckoutPasswordProofOverrideForTests(null);
  }
});

test("dependency reads complete for valid simulated client", async () => {
  const mockStore = orphanMockStore();
  mockStore.tables.client_instagram_accounts.push({ id: "link-1", client_id: REAL_CLIENT_ID, account_id: "ig-1" });
  const result = await inspectSimulatedCheckoutProvisioning(mockStore.supabase, {
    email: ORPHAN_EMAIL,
    authUserId: REAL_AUTH_ID,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "client_has_instagram_account");
});

test("dependency reads succeed when client has no instagram links", async () => {
  const mockStore = orphanMockStore();
  const result = await inspectSimulatedCheckoutProvisioning(mockStore.supabase, {
    email: ORPHAN_EMAIL,
    authUserId: REAL_AUTH_ID,
  });
  assert.equal(result.ok, true);
});
