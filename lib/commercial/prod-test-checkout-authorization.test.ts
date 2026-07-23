import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createProdTestCheckoutAuthorization,
  evaluateProdTestCheckoutAuthorization,
  hashProdTestCheckoutEmail,
  PRODUCTION_CHECKOUT_ALLOWED_REF,
  recordProdTestCheckoutAuthorizationUsage,
  redactEmailHint,
  validateProdTestCheckoutAuthorization,
} from "./prod-test-checkout-authorization.ts";
import { evaluateCheckoutSimulationAccess } from "./checkout-simulation-access.ts";
import { withInitialCheckoutAllowlist } from "./initial-checkout-test-env.ts";
import { confirmCommercialPayment } from "./confirm-commercial-payment.ts";

const PROD_ENV = {
  SUPABASE_URL: `https://${PRODUCTION_CHECKOUT_ALLOWED_REF}.supabase.co`,
  SIMULATED_CHECKOUT_ENABLED: "true",
  SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "isolated@example.invalid",
};

const ISOLATED_ENV = withInitialCheckoutAllowlist(["isolated@example.invalid"]);

type AuthRow = Record<string, unknown>;

function createMockSupabase(initialRows: AuthRow[] = []) {
  const rows = [...initialRows];
  return {
    from(table: string) {
      if (table !== "commercial_prod_test_checkout_authorizations") {
        throw new Error(`unexpected table ${table}`);
      }
      const state = {
        filters: [] as Array<(row: AuthRow) => boolean>,
        patch: null as Record<string, unknown> | null,
        insertPayload: null as Record<string, unknown> | null,
      };
      const api = {
        select() { return api; },
        eq(column: string, value: unknown) {
          state.filters.push((row) => row[column] === value);
          return api;
        },
        order() { return api; },
        limit() { return api; },
        maybeSingle() {
          const match = rows.find((row) => state.filters.every((filter) => filter(row)));
          return Promise.resolve({ data: match ?? null, error: null });
        },
        single() {
          if (state.insertPayload) {
            const created = {
              id: `auth-${rows.length + 1}`,
              ...state.insertPayload,
              entitlements_created_count: 0,
              client_id: state.insertPayload.client_id ?? null,
              first_checkout_used_at: null,
              add_account_used_at: null,
              status: "active",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            rows.push(created);
            return Promise.resolve({ data: created, error: null });
          }
          const match = rows.find((row) => state.filters.every((filter) => filter(row)));
          return Promise.resolve({ data: match ?? null, error: match ? null : { message: "missing" } });
        },
        insert(payload: Record<string, unknown>) {
          state.insertPayload = payload;
          return api;
        },
        update(payload: Record<string, unknown>) {
          state.patch = payload;
          return api;
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          const matches = rows.filter((row) => state.filters.every((filter) => filter(row)));
          if (!state.patch) {
            return Promise.resolve({ data: matches, error: null }).then(onFulfilled, onRejected);
          }
          const matchIndex = rows.findIndex((row) => state.filters.every((filter) => filter(row)));
          if (matchIndex >= 0 && state.patch) {
            rows[matchIndex] = { ...rows[matchIndex], ...state.patch };
            return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
          }
          return Promise.resolve({ error: { message: "update_failed" } }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
    _rows: rows,
  } as unknown as SupabaseClient & { _rows: AuthRow[] };
}

test("real email without authorization stays blocked on production", async () => {
  const supabase = createMockSupabase();
  const access = await evaluateCheckoutSimulationAccess({
    supabase,
    email: "liam.real@company.com",
    flowType: "first_purchase",
    env: PROD_ENV,
  });
  assert.equal(access.allowed, false);
  assert.match(access.messageFr ?? "", /fictives|indisponible/i);
});

test("authorized real email enables prod test checkout on production", async () => {
  const email = "liam.agency@company.com";
  const supabase = createMockSupabase([{
    id: "auth-1",
    email_hash: hashProdTestCheckoutEmail(email),
    email_hint: redactEmailHint(email),
    authorized_flows: ["first_purchase", "new_account"],
    max_accounts: 2,
    plan_key: null,
    billing_interval_months: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    status: "active",
    client_id: null,
    entitlements_created_count: 0,
    first_checkout_used_at: null,
    add_account_used_at: null,
    created_by_auth_user_id: "admin-1",
    admin_confirmation_acknowledged: true,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }]);

  const access = await evaluateCheckoutSimulationAccess({
    supabase,
    email,
    flowType: "first_purchase",
    env: PROD_ENV,
  });
  assert.equal(access.allowed, true);
  assert.equal(access.source, "prod_test_authorization");
});

test("expired authorization is rejected", async () => {
  const email = "expired@company.com";
  const row = {
    id: "auth-expired",
    email_hash: hashProdTestCheckoutEmail(email),
    email_hint: redactEmailHint(email),
    authorized_flows: ["first_purchase", "new_account"],
    max_accounts: 2,
    plan_key: null,
    billing_interval_months: null,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    status: "active",
    client_id: null,
    entitlements_created_count: 0,
    first_checkout_used_at: null,
    add_account_used_at: null,
    created_by_auth_user_id: "admin-1",
    admin_confirmation_acknowledged: true,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const validation = validateProdTestCheckoutAuthorization({
    authorization: row as never,
    flowType: "first_purchase",
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, "authorization_expired");
});

test("add-account requires same workspace and blocks third account", async () => {
  const email = "agency@company.com";
  const clientId = "client-tenant-3";
  const authorization = {
    id: "auth-2",
    email_hash: hashProdTestCheckoutEmail(email),
    email_hint: redactEmailHint(email),
    authorized_flows: ["first_purchase", "new_account"],
    max_accounts: 2,
    plan_key: null,
    billing_interval_months: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    status: "active",
    client_id: clientId,
    entitlements_created_count: 2,
    first_checkout_used_at: new Date().toISOString(),
    add_account_used_at: new Date().toISOString(),
    created_by_auth_user_id: "admin-1",
    admin_confirmation_acknowledged: true,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const blocked = validateProdTestCheckoutAuthorization({
    authorization: authorization as never,
    flowType: "additional_account",
    clientId,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "account_limit_reached");

  const mismatch = validateProdTestCheckoutAuthorization({
    authorization: { ...authorization, entitlements_created_count: 1 } as never,
    flowType: "additional_account",
    clientId: "other-client",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "workspace_mismatch");
});

test("authorization usage increments and consumes at max accounts", async () => {
  const email = "usage@company.com";
  const supabase = createMockSupabase([{
    id: "auth-usage",
    email_hash: hashProdTestCheckoutEmail(email),
    email_hint: redactEmailHint(email),
    authorized_flows: ["first_purchase", "new_account"],
    max_accounts: 2,
    plan_key: null,
    billing_interval_months: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    status: "active",
    client_id: null,
    entitlements_created_count: 1,
    first_checkout_used_at: new Date().toISOString(),
    add_account_used_at: null,
    created_by_auth_user_id: "admin-1",
    admin_confirmation_acknowledged: true,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }]);

  await recordProdTestCheckoutAuthorizationUsage({
    supabase,
    authorizationId: "auth-usage",
    flowType: "additional_account",
    clientId: "client-1",
  });

  const updated = supabase._rows[0];
  assert.equal(updated.entitlements_created_count, 2);
  assert.equal(updated.status, "consumed");
});

test("confirmCommercialPayment accepts prod test authorization bypass", () => {
  const result = confirmCommercialPayment({
    provider: "simulated",
    purchaserEmail: "liam.real@company.com",
    amountDueCents: 14700,
    idempotencyKey: "idem-1",
    checkoutContext: "public_new_workspace",
    simulationAccessSource: "prod_test_authorization",
    env: PROD_ENV,
  });
  assert.equal(result.ok, true);
});

test("isolated @example.invalid path remains available off production", async () => {
  const supabase = createMockSupabase();
  const access = await evaluateCheckoutSimulationAccess({
    supabase,
    email: "isolated@example.invalid",
    flowType: "first_purchase",
    env: ISOLATED_ENV,
  });
  assert.equal(access.allowed, true);
  assert.equal(access.source, "isolated_first_purchase");
});

test("admin create stores hash and redacted hint only", async () => {
  const supabase = createMockSupabase();
  const created = await createProdTestCheckoutAuthorization({
    supabase,
    email: "liam.real@company.com",
    createdByAuthUserId: "admin-user",
    expiresAt: new Date(Date.now() + 60_000),
    adminConfirmationAcknowledged: true,
    maxAccounts: 2,
    env: PROD_ENV,
  });
  assert.match(created.emailHint, /^\w\*{3}@/);
  assert.equal(supabase._rows[0].email_hash, hashProdTestCheckoutEmail("liam.real@company.com"));
  assert.equal("email" in (supabase._rows[0] as object), false);
  assert.deepEqual(supabase._rows[0].authorized_flows, ["first_purchase"]);
  assert.equal(supabase._rows[0].client_id, null);
});

test("admin create never authorizes new_account without a proven client scope", async () => {
  const supabase = createMockSupabase();
  await assert.rejects(
    createProdTestCheckoutAuthorization({
      supabase,
      email: "unscoped.workspace@company.com",
      createdByAuthUserId: "admin-user",
      expiresAt: new Date(Date.now() + 60_000),
      adminConfirmationAcknowledged: true,
      authorizedFlows: ["new_account"],
      maxAccounts: 1,
      env: PROD_ENV,
    }),
    /prod_test_authorization_client_scope_required/,
  );
  assert.equal(supabase._rows.length, 0);
});

test("admin create carries forward one proven client workspace for add-account", async () => {
  const email = "existing.workspace@company.com";
  const supabase = createMockSupabase([{
    id: "auth-consumed",
    email_hash: hashProdTestCheckoutEmail(email),
    email_hint: redactEmailHint(email),
    client_id: "client-existing",
    status: "consumed",
    created_at: new Date(Date.now() - 60_000).toISOString(),
  }]);

  await createProdTestCheckoutAuthorization({
    supabase,
    email,
    createdByAuthUserId: "admin-user",
    expiresAt: new Date(Date.now() + 60_000),
    adminConfirmationAcknowledged: true,
    maxAccounts: 1,
    env: PROD_ENV,
  });

  const created = supabase._rows[1];
  assert.equal(created.client_id, "client-existing");
  assert.deepEqual(created.metadata, {
    purpose: "agency_tenant_internal_test",
    client_scope_source: "prior_authorization",
  });
  const validation = validateProdTestCheckoutAuthorization({
    authorization: created as never,
    flowType: "additional_account",
    clientId: "client-existing",
  });
  assert.equal(validation.ok, true);

  const proMonthlyAccess = await evaluateCheckoutSimulationAccess({
    supabase,
    email,
    flowType: "additional_account",
    clientId: "client-existing",
    planKey: "pro",
    billingIntervalMonths: 1,
    env: PROD_ENV,
  });
  assert.equal(proMonthlyAccess.allowed, true);

  const wrongWorkspaceAccess = await evaluateCheckoutSimulationAccess({
    supabase,
    email,
    flowType: "additional_account",
    clientId: "client-other",
    planKey: "pro",
    billingIntervalMonths: 1,
    env: PROD_ENV,
  });
  assert.equal(wrongWorkspaceAccess.allowed, false);
  assert.equal(wrongWorkspaceAccess.reason, "workspace_mismatch");
});

test("consumed authorization is rejected explicitly", () => {
  const validation = validateProdTestCheckoutAuthorization({
    authorization: {
      id: "auth-consumed",
      email_hash: hashProdTestCheckoutEmail("consumed@company.com"),
      email_hint: redactEmailHint("consumed@company.com"),
      authorized_flows: ["first_purchase", "new_account"],
      max_accounts: 1,
      plan_key: "pro",
      billing_interval_months: 1,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      status: "consumed",
      client_id: "client-existing",
      entitlements_created_count: 1,
      first_checkout_used_at: null,
      add_account_used_at: new Date().toISOString(),
      created_by_auth_user_id: "admin-user",
      admin_confirmation_acknowledged: true,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    flowType: "additional_account",
    clientId: "client-existing",
    planKey: "pro",
    billingIntervalMonths: 1,
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, "authorization_consumed");
});

test("admin create refuses ambiguous historical client workspaces", async () => {
  const email = "ambiguous.workspace@company.com";
  const supabase = createMockSupabase([
    {
      id: "auth-client-1",
      email_hash: hashProdTestCheckoutEmail(email),
      client_id: "client-1",
      status: "consumed",
      created_at: new Date(Date.now() - 120_000).toISOString(),
    },
    {
      id: "auth-client-2",
      email_hash: hashProdTestCheckoutEmail(email),
      client_id: "client-2",
      status: "consumed",
      created_at: new Date(Date.now() - 60_000).toISOString(),
    },
  ]);

  await assert.rejects(
    createProdTestCheckoutAuthorization({
      supabase,
      email,
      createdByAuthUserId: "admin-user",
      expiresAt: new Date(Date.now() + 60_000),
      adminConfirmationAcknowledged: true,
      maxAccounts: 1,
      env: PROD_ENV,
    }),
    /prod_test_authorization_client_scope_ambiguous/,
  );
  assert.equal(supabase._rows.length, 2);
});

test("evaluateProdTestCheckoutAuthorization hides not found as generic path", async () => {
  const supabase = createMockSupabase();
  const result = await evaluateProdTestCheckoutAuthorization({
    supabase,
    email: "unknown@company.com",
    flowType: "first_purchase",
    env: PROD_ENV,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "authorization_not_found");
  }
});
