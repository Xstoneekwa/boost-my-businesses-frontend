import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { activateClientAccountEntitlementFromCheckout } from "./activate-client-account-entitlement-from-checkout.ts";
import { setVerifyActivationCompletionOverrideForTests } from "./checkout-completion.ts";
import {
  setCheckoutPasswordProofOverrideForTests,
  verifyPurchaserPasswordControl,
} from "./checkout-orphan-resume.ts";
import {
  createCheckoutMockSupabase,
  mockPasswordSignIn,
} from "./checkout-test-mock-supabase.ts";

const TEST_ENV = {
  SIMULATED_CHECKOUT_ENABLED: "true",
  SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "resume@example.com,new@example.com",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
};

const PASSWORD = "ValidPassword12!";
const EMAIL = "resume@example.com";

function activationInput(idempotencyKey: string) {
  return {
    planKey: "pro",
    billingIntervalMonths: 1,
    outreachAddonKey: null,
    purchaserEmail: EMAIL,
    idempotencyKey,
    flowType: "first_purchase" as const,
    password: PASSWORD,
    passwordConfirmation: PASSWORD,
    mode: "simulated" as const,
    browserSession: null,
  };
}

function assertExactCounts(counts: ReturnType<ReturnType<typeof createCheckoutMockSupabase>["getCounts"]>) {
  assert.equal(counts.auth, 1);
  assert.equal(counts.clients, 1);
  assert.equal(counts.tenant_users, 1);
  assert.equal(counts.client_users, 1);
  assert.equal(counts.subscriptions, 1);
  assert.equal(counts.checkout_sessions, 1);
  assert.equal(counts.entitlements, 1);
  assert.equal(counts.audit_events, 1);
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

function registerFailureInjectionCase(
  label: string,
  options: {
    failOnInsert?: Parameters<typeof createCheckoutMockSupabase>[0]["failOnInsert"];
    seedStage?: Parameters<ReturnType<typeof createCheckoutMockSupabase>["seedPartialState"]>[0];
    verifyFailOnce?: boolean;
  },
) {
  test(`failure injection: ${label}`, async () => {
    const mockStore = createCheckoutMockSupabase({
      authUsers: options.seedStage
        ? [{ id: "auth-resume-1", email: EMAIL, password: PASSWORD }]
        : [],
      failOnInsert: options.failOnInsert,
    });
    if (options.seedStage) {
      mockStore.seedPartialState(options.seedStage);
    }

    installPasswordProof(mockStore.authUsers);

    let verifyCalls = 0;
    if (options.verifyFailOnce) {
      setVerifyActivationCompletionOverrideForTests(async () => {
        verifyCalls += 1;
        if (verifyCalls === 1) return { ok: false as const, reason: "audit_event_missing" };
        return { ok: true as const, activationCompletionVerified: true as const };
      });
    }

    const previousEnv = { ...process.env };
    Object.assign(process.env, TEST_ENV);

    try {
      const first = await activateClientAccountEntitlementFromCheckout(mockStore.supabase, activationInput("idem-1"));
      assert.equal(first.ok, false, "first attempt must fail");
      const afterFirst = mockStore.getCounts();

      const second = await activateClientAccountEntitlementFromCheckout(mockStore.supabase, activationInput("idem-2"));
      assert.equal(second.ok, true, "retry must succeed");
      assertExactCounts(mockStore.getCounts());

      assert.equal(mockStore.getCounts().auth, afterFirst.auth, "must not create second auth");
      assert.equal(mockStore.getCounts().clients, afterFirst.clients, "must not create second client");
      assert.equal(mockStore.getCounts().tenant_users, 1, "must not create second tenant_users");
    } finally {
      restoreEnv(previousEnv);
      setCheckoutPasswordProofOverrideForTests(null);
      setVerifyActivationCompletionOverrideForTests(null);
    }
  });
}

registerFailureInjectionCase("tenant_users then resume", {
  failOnInsert: { tenant_users: 1 },
});

registerFailureInjectionCase("client_users then resume", {
  seedStage: "tenant_users",
  failOnInsert: { client_users: 1 },
});

registerFailureInjectionCase("subscription then resume", {
  seedStage: "client_users",
  failOnInsert: { client_subscriptions: 1 },
});

registerFailureInjectionCase("checkout session then resume", {
  seedStage: "subscription",
  failOnInsert: { commercial_checkout_sessions: 1 },
});

registerFailureInjectionCase("entitlement then resume", {
  seedStage: "checkout_session",
  failOnInsert: { client_account_entitlements: 1 },
});

registerFailureInjectionCase("audit event then resume", {
  seedStage: "entitlement",
  failOnInsert: { commercial_checkout_audit_events: 1 },
});

registerFailureInjectionCase("verify completion then resume", {
  verifyFailOnce: true,
});

test("wrong password on partial state performs no additional mutations", async () => {
  const mockStore = createCheckoutMockSupabase({
    authUsers: [{ id: "auth-resume-1", email: EMAIL, password: PASSWORD }],
  });
  mockStore.seedPartialState("tenant_users");
  installPasswordProof(mockStore.authUsers);

  const before = mockStore.getCounts();
  const previousEnv = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  try {
    const result = await activateClientAccountEntitlementFromCheckout(mockStore.supabase, {
      ...activationInput("idem-wrong-pass"),
      password: "WrongPassword999!",
      passwordConfirmation: "WrongPassword999!",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "password_verification_failed");
    assert.deepEqual(mockStore.getCounts(), before);
  } finally {
    restoreEnv(previousEnv);
    setCheckoutPasswordProofOverrideForTests(null);
  }
});

test("password proof override is not used in production path by default", async () => {
  setCheckoutPasswordProofOverrideForTests(null);
  assert.equal(typeof verifyPurchaserPasswordControl, "function");
});

test("checkout success response excludes auth tokens", () => {
  const routeSource = readFileSync(
    new URL("../../app/api/commercial/checkout/simulated/activate/route.ts", import.meta.url),
    "utf8",
  );
  const responseBlock = routeSource.slice(routeSource.indexOf("return checkoutJsonOk"));
  assert.doesNotMatch(responseBlock, /access_token|refresh_token|session_token/);
  assert.doesNotMatch(responseBlock, /password|password_confirmation/);
});

test("checkout activation logs exclude passwords and tokens", () => {
  const logSource = readFileSync(new URL("./checkout-activation-log.ts", import.meta.url), "utf8");
  assert.doesNotMatch(logSource, /password|access_token|refresh_token/);
});
