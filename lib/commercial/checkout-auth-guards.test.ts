import assert from "node:assert/strict";
import test from "node:test";

import { activateClientAccountEntitlementFromCheckout } from "./activate-client-account-entitlement-from-checkout.ts";
import { inspectSimulatedCheckoutProvisioning } from "./checkout-provisioning-state.ts";
import { resolveSimulatedPublicAuth } from "./checkout-auth.ts";
import {
  setCheckoutPasswordProofOverrideForTests,
} from "./checkout-orphan-resume.ts";
import {
  createCheckoutMockSupabase,
  mockPasswordSignIn,
} from "./checkout-test-mock-supabase.ts";
import { withInitialCheckoutAllowlist } from "./initial-checkout-test-env.ts";

const PASSWORD = "ValidPassword12!";
const PURCHASER_EMAIL = "resume@example.invalid";
const OTHER_CLIENT_EMAIL = "other@example.invalid";
const LIAM_CLIENT_ID = "c37c9143-ee14-4c9a-9a60-226759241733";

const TEST_ENV = withInitialCheckoutAllowlist([PURCHASER_EMAIL, OTHER_CLIENT_EMAIL, "new@example.invalid"]);

function activationInput(email = PURCHASER_EMAIL) {
  return {
    planKey: "pro",
    billingIntervalMonths: 1,
    outreachAddonKey: null,
    purchaserEmail: email,
    idempotencyKey: "guard-test-1",
    flowType: "first_purchase" as const,
    password: PASSWORD,
    passwordConfirmation: PASSWORD,
    mode: "simulated" as const,
    browserSession: null,
  };
}

function restoreEnv(previousEnv: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnv)) delete process.env[key];
  }
  Object.assign(process.env, previousEnv);
}

function installPasswordProof(authUsers: ReturnType<typeof createCheckoutMockSupabase>["authUsers"]) {
  setCheckoutPasswordProofOverrideForTests(async (input) => {
    const result = await mockPasswordSignIn(authUsers)(input);
    if (result.error || !result.data.user?.id) {
      return { ok: false as const, reason: "password_verification_failed" as const };
    }
    if (result.data.user.id !== input.expectedAuthUserId) {
      return { ok: false as const, reason: "auth_user_mismatch" as const };
    }
    return { ok: true as const, authUserId: result.data.user.id };
  });
}

test("case A: no existing auth uses createUser on nominal path", async () => {
  const mockStore = createCheckoutMockSupabase();
  installPasswordProof(mockStore.authUsers);
  const previousEnv = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  try {
    const authResult = await resolveSimulatedPublicAuth(mockStore.supabase, {
      email: "new@example.com",
      password: PASSWORD,
      idempotencyKey: "nominal-create",
    });
    assert.equal(authResult.ok, true);
    if (!authResult.ok) return;
    assert.equal(authResult.createdAuth, true);
    assert.equal(mockStore.authUsers.length, 1);
    assert.equal(mockStore.getCounts().clients, 0);
  } finally {
    restoreEnv(previousEnv);
    setCheckoutPasswordProofOverrideForTests(null);
  }
});

test("case B: existing auth with zero simulated_checkout client blocks without mutation", async () => {
  const mockStore = createCheckoutMockSupabase({
    authUsers: [{ id: "auth-existing-1", email: PURCHASER_EMAIL, password: PASSWORD }],
    tables: {
      tenant_users: [{ user_id: "liam-user", tenant_id: LIAM_CLIENT_ID, role: "tenant" }],
    },
  });
  installPasswordProof(mockStore.authUsers);
  const before = {
    counts: mockStore.getCounts(),
    tenantUsers: structuredClone(mockStore.tables.tenant_users),
    authUsers: mockStore.authUsers.length,
  };
  const previousEnv = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  try {
    const inspection = await inspectSimulatedCheckoutProvisioning(mockStore.supabase, {
      email: PURCHASER_EMAIL,
      authUserId: "auth-existing-1",
    });
    assert.equal(inspection.ok, false);
    if (inspection.ok) return;
    assert.equal(inspection.reason, "client_ambiguous");

    const authResult = await resolveSimulatedPublicAuth(mockStore.supabase, {
      email: PURCHASER_EMAIL,
      password: PASSWORD,
      idempotencyKey: "guard-no-client",
    });
    assert.equal(authResult.ok, false);
    if (authResult.ok) return;
    assert.equal(authResult.code, "auth_user_exists_no_workspace");

    const activation = await activateClientAccountEntitlementFromCheckout(
      mockStore.supabase,
      activationInput(),
    );
    assert.equal(activation.ok, false);
    if (activation.ok) return;
    assert.equal(activation.status, 409);
    assert.equal(activation.code, "auth_user_exists_no_workspace");

    assert.equal(mockStore.authUsers.length, before.authUsers);
    assert.equal(mockStore.getCounts().clients, 0);
    assert.equal(mockStore.getCounts().client_users, 0);
    assert.equal(mockStore.getCounts().subscriptions, 0);
    assert.equal(mockStore.getCounts().checkout_sessions, 0);
    assert.equal(mockStore.getCounts().entitlements, 0);
    assert.equal(mockStore.getCounts().audit_events, 0);
    assert.equal(mockStore.getCounts().tenant_users, before.counts.tenant_users);
    assert.deepEqual(mockStore.tables.tenant_users, before.tenantUsers);
    assert.equal(
      mockStore.tables.tenant_users.some((row) => row.user_id === "auth-existing-1"),
      false,
      "must not create tenant_users for purchaser auth",
    );
  } finally {
    restoreEnv(previousEnv);
    setCheckoutPasswordProofOverrideForTests(null);
  }
});

test("existing auth with simulated_checkout client for another email blocks without mutation", async () => {
  const mockStore = createCheckoutMockSupabase({
    authUsers: [{ id: "auth-existing-1", email: PURCHASER_EMAIL, password: PASSWORD }],
    tables: {
      clients: [{
        id: "client-other-email",
        status: "active",
        metadata: {
          contact_email: OTHER_CLIENT_EMAIL,
          checkout_source: "simulated_checkout",
        },
      }],
      tenant_users: [{ user_id: "liam-user", tenant_id: LIAM_CLIENT_ID, role: "tenant" }],
    },
  });
  installPasswordProof(mockStore.authUsers);
  const before = {
    counts: mockStore.getCounts(),
    clients: structuredClone(mockStore.tables.clients),
    tenantUsers: structuredClone(mockStore.tables.tenant_users),
    authUsers: mockStore.authUsers.length,
  };
  const previousEnv = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  try {
    const inspection = await inspectSimulatedCheckoutProvisioning(mockStore.supabase, {
      email: PURCHASER_EMAIL,
      authUserId: "auth-existing-1",
    });
    assert.equal(inspection.ok, false);
    if (inspection.ok) return;
    assert.equal(inspection.reason, "client_ambiguous");

    const activation = await activateClientAccountEntitlementFromCheckout(
      mockStore.supabase,
      activationInput(),
    );
    assert.equal(activation.ok, false);
    if (activation.ok) return;
    assert.equal(activation.status, 409);
    assert.equal(activation.code, "auth_user_exists_no_workspace");

    assert.equal(mockStore.authUsers.length, before.authUsers);
    assert.equal(mockStore.getCounts().clients, before.counts.clients);
    assert.deepEqual(mockStore.tables.clients, before.clients);
    assert.equal(mockStore.getCounts().tenant_users, before.counts.tenant_users);
    assert.equal(mockStore.getCounts().client_users, 0);
    assert.equal(mockStore.getCounts().subscriptions, 0);
    assert.equal(mockStore.getCounts().checkout_sessions, 0);
    assert.equal(mockStore.getCounts().entitlements, 0);
    assert.equal(mockStore.getCounts().audit_events, 0);
    assert.deepEqual(mockStore.tables.tenant_users, before.tenantUsers);
  } finally {
    restoreEnv(previousEnv);
    setCheckoutPasswordProofOverrideForTests(null);
  }
});

test("orphan resume path requires exactly one simulated_checkout client for purchaser email", async () => {
  const mockStore = createCheckoutMockSupabase({
    authUsers: [{ id: "auth-resume-1", email: PURCHASER_EMAIL, password: PASSWORD }],
    tables: {
      clients: [{
        id: "client-resume-1",
        status: "active",
        metadata: {
          contact_email: PURCHASER_EMAIL,
          checkout_source: "simulated_checkout",
        },
      }],
    },
  });
  installPasswordProof(mockStore.authUsers);
  const previousEnv = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  try {
    const inspection = await inspectSimulatedCheckoutProvisioning(mockStore.supabase, {
      email: PURCHASER_EMAIL,
      authUserId: "auth-resume-1",
    });
    assert.equal(inspection.ok, true);
    if (!inspection.ok) return;
    assert.equal(inspection.resumeMode, "link_orphan_client");
    assert.equal(inspection.stages.tenant_users, false);
    assert.equal(inspection.stages.client, true);
  } finally {
    restoreEnv(previousEnv);
    setCheckoutPasswordProofOverrideForTests(null);
  }
});
