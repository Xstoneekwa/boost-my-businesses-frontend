import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createStripeSubscriptionCheckoutSession } from "./stripe-subscription-checkout.ts";
import { resolveStripePaidPublicAuth } from "../checkout-auth.ts";
import { setCheckoutPasswordProofOverrideForTests } from "../checkout-orphan-resume.ts";
import { buildStripePublicPricesManifest } from "./stripe-public-catalog-manifest.ts";
import { handleStripeWebhookEvent, verifyStripeWebhookSignature } from "./stripe-webhook-handler.ts";
import { setStripeClientForTests } from "./stripe-client.ts";
import {
  hashProdTestCheckoutEmail,
  PRODUCTION_CHECKOUT_ALLOWED_REF,
} from "../prod-test-checkout-authorization.ts";

const TEST_ENV = {
  STRIPE_SECRET_KEY: ["sk", "test", "checkout", "fake"].join("_"),
  STRIPE_WEBHOOK_SECRET: "whsec_fake",
  STRIPE_TEST_CHECKOUT_ENABLED: "true",
};
const PROD_TEST_ENV = {
  ...TEST_ENV,
  SUPABASE_URL: `https://${PRODUCTION_CHECKOUT_ALLOWED_REF}.supabase.co`,
  CHECKOUT_SIGNUP_CREDENTIAL_SECRET: "test-checkout-signup-secret-32bytes-min!!",
};

function readString(value, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function createRows() {
  const componentRows = buildStripePublicPricesManifest().map((entry, index) => ({
    id: `map-${index + 1}`,
    environment: "test",
    product_key: entry.productKey,
    component_kind: entry.componentKind,
    package_key: entry.packageKey,
    outreach_key: entry.outreachKey,
    billing_interval_months: entry.billingIntervalMonths,
    stripe_product_id: `prod_${entry.productKey.replaceAll("_", "")}`,
    stripe_price_id: `price_${entry.productKey.replaceAll("_", "")}${entry.billingIntervalMonths}`,
    expected_amount_cents: entry.unitAmountCents,
    currency: "eur",
    active: true,
    catalog_version: entry.catalogVersion,
  }));
  return {
    commercial_stripe_component_price_catalog: componentRows,
    commercial_stripe_price_catalog: Array.from({ length: 20 }, (_, index) => ({
      id: `legacy-${index}`,
      environment: "test",
      active: true,
    })),
    commercial_checkout_sessions: [],
    commercial_stripe_checkout_attempts: [],
    commercial_stripe_billing_profiles: [],
    commercial_stripe_webhook_events: [],
    commercial_stripe_subscriptions: [],
    commercial_prod_test_checkout_authorizations: [],
    clients: [],
    tenant_users: [],
    client_users: [],
    client_subscriptions: [],
    client_account_entitlements: [],
    commercial_checkout_audit_events: [],
    account_assignments: [],
    phone_app_instances: [],
    device_actions: [],
    runtime_events: [],
  };
}

function createFakeSupabase(initial = {}) {
  const { authUsers: initialAuthUsers = [], ...initialTables } = initial;
  const tables = { ...createRows(), ...initialTables };
  const authUsers = structuredClone(initialAuthUsers);

  function readColumn(row, column) {
    const jsonTextMatch = String(column).match(/^([^>]+)->>(.+)$/);
    if (!jsonTextMatch) return row[column];
    const container = row[jsonTextMatch[1]];
    return container && typeof container === "object" ? container[jsonTextMatch[2]] : undefined;
  }

  function matches(row, filters) {
    return filters.every(({ column, value, values, op }) => {
      if (op === "in") {
        return values.includes(readColumn(row, column));
      }
      const left = readColumn(row, column);
      const right = value;
      if (typeof left === "number" || typeof right === "number") {
        return Number(left) === Number(right);
      }
      return readString(left) === readString(right);
    });
  }

  function from(table) {
    if (!tables[table]) tables[table] = [];
    const filters = [];
    let pendingInsert = null;
    let pendingUpdate = null;
    let pendingUpsert = null;
    let countHead = false;
    let returnMode = "array";

    async function execute() {
      if (countHead) {
        return { data: null, error: null, count: tables[table].filter((row) => matches(row, filters)).length };
      }
      if (pendingInsert) {
        const row = { id: `${table}-${tables[table].length + 1}`, ...pendingInsert };
        tables[table].push(row);
        return { data: returnMode === "array" ? [row] : row, error: null };
      }
      if (pendingUpsert) {
        const conflict = pendingUpsert.conflict;
        const payload = pendingUpsert.payload;
        const existing = tables[table].find((row) => conflict.every((column) => readString(row[column]) === readString(payload[column])));
        if (existing) Object.assign(existing, payload);
        else tables[table].push({ id: `${table}-${tables[table].length + 1}`, ...payload });
        const row = existing ?? tables[table].at(-1);
        return { data: returnMode === "array" ? [row] : row, error: null };
      }
      if (pendingUpdate) {
        const rows = tables[table].filter((row) => matches(row, filters));
        for (const row of rows) Object.assign(row, pendingUpdate);
        return { data: returnMode === "array" ? rows : rows[0] ?? null, error: null };
      }
      const rows = tables[table].filter((row) => matches(row, filters));
      if (returnMode === "single") return { data: rows[0] ?? null, error: rows[0] ? null : { code: "PGRST116" } };
      if (returnMode === "maybeSingle") return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }

    const api = {
      select(_columns, opts) {
        countHead = opts?.count === "exact" && opts?.head === true;
        return api;
      },
      eq(column, value) {
        filters.push({ column, value });
        return api;
      },
      filter(column, operator, value) {
        assert.equal(operator, "eq");
        filters.push({ column, value });
        return api;
      },
      in(column, values) {
        filters.push({ column, values, op: "in" });
        return api;
      },
      order() {
        return api;
      },
      insert(payload) {
        pendingInsert = Array.isArray(payload) ? payload[0] : payload;
        return api;
      },
      update(payload) {
        pendingUpdate = payload;
        return api;
      },
      upsert(payload, options = {}) {
        pendingUpsert = {
          payload,
          conflict: String(options.onConflict || "id").split(",").map((value) => value.trim()),
        };
        return api;
      },
      limit() {
        return api;
      },
      maybeSingle() {
        returnMode = "maybeSingle";
        return execute();
      },
      single() {
        returnMode = "single";
        return execute();
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };
    return api;
  }

  return {
    tables,
    supabase: {
      from,
      auth: {
        admin: {
          async listUsers() {
            return { data: { users: authUsers.map((user) => ({ id: user.id, email: user.email })) }, error: null };
          },
          async createUser(input) {
            const email = readString(input.email).toLowerCase();
            if (authUsers.some((user) => user.email === email)) {
              return { data: { user: null }, error: { message: "already exists" } };
            }
            const user = { id: `auth-${authUsers.length + 1}`, email, password: input.password ?? null };
            authUsers.push(user);
            return { data: { user }, error: null };
          },
          async getUserById(id) {
            const user = authUsers.find((entry) => entry.id === id);
            return { data: { user: user ? { id: user.id, email: user.email } : null }, error: user ? null : { message: "missing" } };
          },
        },
      },
      async rpc(name, params) {
        if (name !== "claim_commercial_stripe_webhook_event") return { data: null, error: { message: "unknown rpc" } };
        const existing = tables.commercial_stripe_webhook_events.find((row) => row.stripe_event_id === params.p_stripe_event_id);
        if (existing?.status === "processed") {
          return { data: [{ event_row_id: existing.id, claim_result: "deduplicated", prior_status: "processed" }], error: null };
        }
        const row = existing ?? {
          id: `evt-row-${tables.commercial_stripe_webhook_events.length + 1}`,
          stripe_event_id: params.p_stripe_event_id,
        };
        Object.assign(row, {
          event_type: params.p_event_type,
          livemode: false,
          status: "processing",
          stripe_object_id: params.p_stripe_object_id,
          stripe_customer_id: params.p_stripe_customer_id,
          stripe_subscription_id: params.p_stripe_subscription_id,
          stripe_checkout_session_id: params.p_stripe_checkout_session_id,
          metadata_safe: params.p_metadata_safe,
        });
        if (!existing) tables.commercial_stripe_webhook_events.push(row);
        return { data: [{ event_row_id: row.id, claim_result: "claimed", prior_status: existing?.status ?? null }], error: null };
      },
    },
    authUsers,
  };
}

function createFakeStripe() {
  const calls = { customersCreate: [], checkoutCreate: [], subscriptionsRetrieve: [] };
  const checkoutByIdempotency = new Map();
  const fake = {
    calls,
    customers: {
      async create(payload, options) {
        calls.customersCreate.push({ payload, options });
        return { id: `cus_${calls.customersCreate.length}`, livemode: false };
      },
    },
    checkout: {
      sessions: {
        async create(payload, options) {
          calls.checkoutCreate.push({ payload, options });
          if (checkoutByIdempotency.has(options?.idempotencyKey)) return checkoutByIdempotency.get(options.idempotencyKey);
          const session = {
            id: `cs_test_${calls.checkoutCreate.length}`,
            url: `https://checkout.stripe.test/session/${calls.checkoutCreate.length}`,
            customer: payload.customer ?? "cus_email_only",
            expires_at: Math.floor(Date.now() / 1000) + 86_400,
          };
          checkoutByIdempotency.set(options?.idempotencyKey, session);
          return session;
        },
      },
    },
    subscriptions: {
      async retrieve(id) {
        calls.subscriptionsRetrieve.push(id);
        return { id, status: "active", livemode: false, items: { data: [] } };
      },
    },
  };
  return fake;
}

async function checkout(input, overrides = {}) {
  const fakeDb = createFakeSupabase(overrides.tables);
  const stripe = createFakeStripe();
  const result = await createStripeSubscriptionCheckoutSession(fakeDb.supabase, {
    commercialMode: input.commercialMode,
    packageKey: input.packageKey,
    planKey: input.packageKey,
    outreachAddonKey: input.outreachAddonKey ?? null,
    billingIntervalMonths: input.billingIntervalMonths ?? 1,
    purchaserEmail: "client@example.com",
    flowType: "additional_account",
    idempotencyKey: input.idempotencyKey ?? "idem-1",
    clientId: "client-1",
    successUrl: "https://app.example.test/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: input.cancelUrl ?? "https://app.example.test/commercial/stripe-test/cancel",
    allowedOrigins: ["https://app.example.test"],
    stripe,
    stripePriceId: "price_from_browser",
  }, TEST_ENV);
  return { result, stripe, tables: fakeDb.tables };
}

function prodAuthorization(email, overrides = {}) {
  return {
    id: overrides.id ?? "auth-public-1",
    email_hash: hashProdTestCheckoutEmail(email),
    email_hint: "c***@example.com",
    authorized_flows: ["first_purchase", "new_account"],
    max_accounts: 2,
    plan_key: overrides.plan_key ?? "growth",
    billing_interval_months: overrides.billing_interval_months ?? 1,
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
    ...overrides,
  };
}

async function publicCheckout(input = {}, overrides = {}) {
  const email = input.email ?? "client@example.com";
  const fakeDb = createFakeSupabase({
    authUsers: overrides.authUsers ?? [],
    commercial_prod_test_checkout_authorizations: [prodAuthorization(email, input.authorization ?? {})],
    ...(overrides.tables ?? {}),
  });
  const stripe = createFakeStripe();
  const result = await createStripeSubscriptionCheckoutSession(fakeDb.supabase, {
    commercialMode: "full_cycle",
    packageKey: "growth",
    planKey: "growth",
    billingIntervalMonths: 1,
    outreachAddonKey: null,
    purchaserEmail: email,
    flowType: "first_purchase",
    idempotencyKey: input.idempotencyKey ?? "public-idem-1",
    clientId: input.clientId ?? "browser-client-id",
    password: input.password ?? "BrowserPassword12!",
    passwordConfirmation: input.passwordConfirmation ?? input.password ?? "BrowserPassword12!",
    successUrl: input.successUrl ?? "https://app.example.test/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: input.cancelUrl ?? "https://app.example.test/commercial/stripe-test/cancel",
    allowedOrigins: ["https://app.example.test"],
    stripe,
    stripePriceId: "price_from_browser",
  }, PROD_TEST_ENV);
  return { result, stripe, tables: fakeDb.tables, authUsers: fakeDb.authUsers, supabase: fakeDb.supabase };
}

function installStripePasswordProof(expectedPassword) {
  setCheckoutPasswordProofOverrideForTests(async (input) => (
    input.password === expectedPassword
      ? { ok: true, authUserId: input.expectedAuthUserId }
      : { ok: false, reason: "password_verification_failed" }
  ));
}

describe("stripe test checkout foundation v1", () => {
  it("creates full_cycle Growth only from server-side mapping", async () => {
    const { result, stripe } = await checkout({ commercialMode: "full_cycle", packageKey: "growth" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(stripe.calls.checkoutCreate[0].payload.mode, "subscription");
    assert.equal(stripe.calls.checkoutCreate[0].payload.line_items.length, 1);
    assert.doesNotMatch(JSON.stringify(stripe.calls.checkoutCreate[0].payload), /price_from_browser|payment_method_types|coupon|promotion_code|customer_balance/);
  });

  it("creates full_cycle Pro plus Outreach Standard", async () => {
    const { result, stripe } = await checkout({ commercialMode: "full_cycle", packageKey: "pro", outreachAddonKey: "outreach_standard" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(stripe.calls.checkoutCreate[0].payload.line_items.length, 2);
  });

  it("creates full_cycle Pro on a 3-month billing interval from the canonical component catalog", async () => {
    const { result, stripe } = await checkout({
      commercialMode: "full_cycle",
      packageKey: "pro",
      billingIntervalMonths: 3,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const lineItem = stripe.calls.checkoutCreate[0].payload.line_items[0];
    assert.equal(lineItem.price, "price_boostaipro3");
    assert.equal(lineItem.quantity, 1);
  });

  it("passes readiness when legacy catalog is empty but component catalog is populated", async () => {
    const { result } = await checkout(
      { commercialMode: "full_cycle", packageKey: "growth", planKey: "growth" },
      { tables: { commercial_stripe_price_catalog: [] } },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  it("fails readiness before any checkout write when the component catalog is empty", async () => {
    const db = createFakeSupabase({
      commercial_stripe_price_catalog: [{ id: "legacy-1", environment: "test", active: true }],
      commercial_stripe_component_price_catalog: [],
    });
    const stripe = createFakeStripe();
    const result = await createStripeSubscriptionCheckoutSession(db.supabase, {
      commercialMode: "full_cycle",
      packageKey: "pro",
      planKey: "pro",
      billingIntervalMonths: 3,
      outreachAddonKey: null,
      purchaserEmail: "client@example.com",
      flowType: "additional_account",
      idempotencyKey: "component-empty-readiness",
      clientId: "client-1",
      successUrl: "https://app.example.test/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.example.test/commercial/stripe-test/cancel",
      allowedOrigins: ["https://app.example.test"],
      stripe,
    }, TEST_ENV);
    assert.equal(result.ok, false);
    assert.equal(result.code, "stripe_test_not_configured");
    assert.match(result.messageEn, /incomplete/i);
    assert.equal(stripe.calls.checkoutCreate.length, 0);
    assert.equal(db.tables.commercial_checkout_sessions.length, 0);
    assert.equal(db.tables.commercial_stripe_checkout_attempts.length, 0);
  });

  it("creates full_cycle Premium plus Outreach AI", async () => {
    const { result, stripe } = await checkout({ commercialMode: "full_cycle", packageKey: "premium", outreachAddonKey: "outreach_ai" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(stripe.calls.checkoutCreate[0].payload.line_items.length, 2);
  });

  it("creates outreach_only Standard and AI without package", async () => {
    const standard = await checkout({ commercialMode: "outreach_only", outreachAddonKey: "outreach_standard", idempotencyKey: "std" });
    const ai = await checkout({ commercialMode: "outreach_only", outreachAddonKey: "outreach_ai", idempotencyKey: "ai" });
    assert.equal(standard.result.ok, true, JSON.stringify(standard.result));
    assert.equal(ai.result.ok, true, JSON.stringify(ai.result));
    assert.equal(standard.stripe.calls.checkoutCreate[0].payload.line_items.length, 1);
    assert.equal(ai.stripe.calls.checkoutCreate[0].payload.line_items.length, 1);
  });

  it("rejects invalid commercial matrices", async () => {
    assert.equal((await checkout({ commercialMode: "full_cycle" })).result.code, "full_cycle_package_required");
    assert.equal((await checkout({ commercialMode: "outreach_only", packageKey: "growth", outreachAddonKey: "outreach_standard" })).result.code, "outreach_only_package_forbidden");
    assert.equal((await checkout({ commercialMode: "outreach_only" })).result.code, "outreach_only_outreach_required");
    assert.equal((await checkout({ commercialMode: "full_cycle", packageKey: "growth", billingIntervalMonths: 2 })).result.code, "invalid_billing_interval");
    assert.equal((await checkout({ commercialMode: "full_cycle", packageKey: "growth", outreachAddonKey: "outreach_standard,outreach_ai" })).result.code, "invalid_outreach");
  });

  it("rejects absent or incoherent mapping and non-allowlisted redirect origins", async () => {
    const missing = await checkout({ commercialMode: "full_cycle", packageKey: "growth" }, { tables: { commercial_stripe_component_price_catalog: [] } });
    assert.equal(missing.result.code, "stripe_test_not_configured");
    assert.match(missing.result.messageEn, /incomplete/i);
    const missingProQuarter = await checkout({
      commercialMode: "full_cycle",
      packageKey: "pro",
      billingIntervalMonths: 3,
    }, {
      tables: {
        commercial_stripe_component_price_catalog: createRows().commercial_stripe_component_price_catalog
          .filter((row) => !(row.package_key === "pro" && row.billing_interval_months === 3)),
      },
    });
    assert.equal(missingProQuarter.result.ok, false);
    assert.equal(missingProQuarter.result.code, "stripe_component_price_mapping_missing");
    const badRows = createRows().commercial_stripe_component_price_catalog.map((row) => ({ ...row, stripe_price_id: "bad_client_value" }));
    const bad = await checkout({ commercialMode: "full_cycle", packageKey: "growth" }, { tables: { commercial_stripe_component_price_catalog: badRows } });
    assert.equal(bad.result.code, "stripe_component_price_mapping_missing");
    const badUrl = await checkout({ commercialMode: "full_cycle", packageKey: "growth", cancelUrl: "https://evil.example/cancel" });
    assert.equal(badUrl.result.code, "checkout_url_origin_forbidden");
  });

  it("reuses a client customer and keeps retry idempotent", async () => {
    const db = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ id: "bp-1", client_id: "client-1", stripe_customer_id: "cus_existing", livemode: false }],
    });
    const stripe = createFakeStripe();
    const input = {
      commercialMode: "full_cycle",
      packageKey: "growth",
      planKey: "growth",
      billingIntervalMonths: 1,
      purchaserEmail: "client@example.com",
      flowType: "additional_account",
      idempotencyKey: "idem-retry",
      clientId: "client-1",
      successUrl: "https://app.example.test/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.example.test/commercial/stripe-test/cancel",
      allowedOrigins: ["https://app.example.test"],
      stripe,
    };
    const first = await createStripeSubscriptionCheckoutSession(db.supabase, input, TEST_ENV);
    const second = await createStripeSubscriptionCheckoutSession(db.supabase, input, TEST_ENV);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true);
    assert.equal(stripe.calls.customersCreate.length, 0);
    assert.equal(stripe.calls.checkoutCreate[0].payload.customer, "cus_existing");
    assert.equal(db.tables.commercial_checkout_sessions.length, 1);
    assert.equal(db.tables.commercial_stripe_checkout_attempts.length, 1);
  });

  it("rejects public first purchase when email is not authorized", async () => {
    const db = createFakeSupabase();
    const stripe = createFakeStripe();
    const result = await createStripeSubscriptionCheckoutSession(db.supabase, {
      commercialMode: "full_cycle",
      packageKey: "growth",
      planKey: "growth",
      billingIntervalMonths: 1,
      outreachAddonKey: null,
      purchaserEmail: "unknown@example.com",
      password: "BrowserPassword12!",
      passwordConfirmation: "BrowserPassword12!",
      flowType: "first_purchase",
      idempotencyKey: "unauthorized",
      successUrl: "https://app.example.test/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.example.test/commercial/stripe-test/cancel",
      allowedOrigins: ["https://app.example.test"],
      stripe,
    }, PROD_TEST_ENV);
    assert.equal(result.ok, false);
    assert.equal(result.code, "authorization_not_found");
    assert.equal(db.tables.commercial_checkout_sessions.length, 0);
    assert.equal(db.authUsers.length, 0);
  });

  it("prepares authorized public Growth monthly Stripe checkout without preprovisioning", async () => {
    const { result, tables, authUsers } = await publicCheckout();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(authUsers.length, 0);
    assert.equal(tables.clients.length, 0);
    assert.equal(tables.client_account_entitlements.length, 0);
    assert.equal(tables.account_assignments.length, 0);
    assert.equal(tables.phone_app_instances.length, 0);
    assert.equal(tables.device_actions.length, 0);
    assert.equal(tables.commercial_checkout_sessions[0].client_id, null);
    assert.equal(tables.commercial_checkout_sessions[0].auth_user_id, null);
    assert.equal(tables.commercial_checkout_sessions[0].metadata.prod_test_authorization_id, "auth-public-1");
    assert.ok(typeof tables.commercial_checkout_sessions[0].metadata.pending_signup_credential_ciphertext === "string");
    assert.ok(typeof tables.commercial_checkout_sessions[0].metadata.pending_signup_credential_expires_at === "string");
    assert.doesNotMatch(JSON.stringify(tables.commercial_checkout_sessions[0].metadata), /BrowserPassword12!/);
  });

  it("rejects public first purchase when dedicated signup credential secret is missing", async () => {
    const email = "missing-secret@example.com";
    const db = createFakeSupabase({
      commercial_prod_test_checkout_authorizations: [prodAuthorization(email)],
    });
    const stripe = createFakeStripe();
    const env = { ...PROD_TEST_ENV };
    delete env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET;
    const result = await createStripeSubscriptionCheckoutSession(db.supabase, {
      commercialMode: "full_cycle",
      packageKey: "growth",
      planKey: "growth",
      billingIntervalMonths: 1,
      outreachAddonKey: null,
      purchaserEmail: email,
      flowType: "first_purchase",
      idempotencyKey: "missing-secret",
      password: "BrowserPassword12!",
      passwordConfirmation: "BrowserPassword12!",
      successUrl: "https://app.example.test/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.example.test/commercial/stripe-test/cancel",
      allowedOrigins: ["https://app.example.test"],
      stripe,
    }, env);
    assert.equal(result.ok, false);
    assert.equal(result.code, "checkout_signup_credential_secret_missing");
    assert.equal(db.tables.commercial_checkout_sessions.length, 0);
    assert.equal(stripe.calls.checkoutCreate.length, 0);
  });

  it("rejects service-role key reuse as signup credential secret", async () => {
    const email = "forbidden-secret@example.com";
    const db = createFakeSupabase({
      commercial_prod_test_checkout_authorizations: [prodAuthorization(email)],
    });
    const stripe = createFakeStripe();
    const shared = "shared-operational-secret-32bytes-min!!";
    const result = await createStripeSubscriptionCheckoutSession(db.supabase, {
      commercialMode: "full_cycle",
      packageKey: "growth",
      planKey: "growth",
      billingIntervalMonths: 1,
      outreachAddonKey: null,
      purchaserEmail: email,
      flowType: "first_purchase",
      idempotencyKey: "forbidden-secret",
      password: "BrowserPassword12!",
      passwordConfirmation: "BrowserPassword12!",
      successUrl: "https://app.example.test/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.example.test/commercial/stripe-test/cancel",
      allowedOrigins: ["https://app.example.test"],
      stripe,
    }, {
      ...PROD_TEST_ENV,
      CHECKOUT_SIGNUP_CREDENTIAL_SECRET: shared,
      SUPABASE_SERVICE_ROLE_KEY: shared,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "checkout_signup_credential_secret_forbidden");
    assert.equal(stripe.calls.checkoutCreate.length, 0);
    assert.equal(db.tables.commercial_checkout_sessions.length, 0);
  });

  it("keeps public checkout retry idempotent", async () => {
    const email = "retry@example.com";
    const db = createFakeSupabase({
      commercial_prod_test_checkout_authorizations: [prodAuthorization(email)],
    });
    const stripe = createFakeStripe();
    const input = {
      commercialMode: "full_cycle",
      packageKey: "growth",
      planKey: "growth",
      billingIntervalMonths: 1,
      outreachAddonKey: null,
      purchaserEmail: email,
      flowType: "first_purchase",
      idempotencyKey: "public-retry",
      password: "BrowserPassword12!",
      passwordConfirmation: "BrowserPassword12!",
      successUrl: "https://app.example.test/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.example.test/commercial/stripe-test/cancel",
      allowedOrigins: ["https://app.example.test"],
      stripe,
    };
    const first = await createStripeSubscriptionCheckoutSession(db.supabase, input, PROD_TEST_ENV);
    const second = await createStripeSubscriptionCheckoutSession(db.supabase, input, PROD_TEST_ENV);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(db.tables.commercial_checkout_sessions.length, 1);
    assert.equal(db.tables.commercial_stripe_checkout_attempts.length, 1);
  });

  it("allows an existing orphan Auth identity only after proving its current password", async () => {
    const email = "existing-orphan@example.com";
    const password = "ExistingPassword12!";
    installStripePasswordProof(password);
    try {
      const checkoutResult = await publicCheckout({ email, password }, {
        authUsers: [{ id: "auth-existing-orphan", email, password }],
      });
      assert.equal(checkoutResult.result.ok, true, JSON.stringify(checkoutResult.result));
      assert.equal(checkoutResult.stripe.calls.checkoutCreate.length, 1);

      const authResult = await resolveStripePaidPublicAuth(checkoutResult.supabase, {
        email,
        password,
        idempotencyKey: "existing-orphan-fulfillment",
      });
      assert.equal(authResult.ok, true, JSON.stringify(authResult));
      if (!authResult.ok) return;
      assert.equal(authResult.authUserId, "auth-existing-orphan");
      assert.equal(authResult.createdAuth, false);
      assert.equal(checkoutResult.authUsers.length, 1);
      assert.equal(checkoutResult.authUsers[0].password, password);
    } finally {
      setCheckoutPasswordProofOverrideForTests(null);
    }
  });

  it("blocks an unproven existing Auth collision before Stripe or checkout writes", async () => {
    const email = "collision@example.com";
    installStripePasswordProof("DifferentExistingPassword12!");
    try {
      const { result, stripe, tables } = await publicCheckout({ email }, {
        authUsers: [{ id: "auth-collision", email, password: "DifferentExistingPassword12!" }],
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, "existing_auth_requires_verified_access");
      assert.equal(stripe.calls.checkoutCreate.length, 0);
      assert.equal(tables.commercial_checkout_sessions.length, 0);
      assert.equal(tables.commercial_stripe_checkout_attempts.length, 0);
    } finally {
      setCheckoutPasswordProofOverrideForTests(null);
    }
  });

  it("blocks an existing commercial workspace before proving or replacing a password", async () => {
    const email = "existing-workspace@example.com";
    let proofCalls = 0;
    setCheckoutPasswordProofOverrideForTests(async () => {
      proofCalls += 1;
      return { ok: true, authUserId: "auth-existing-workspace" };
    });
    try {
      const { result, stripe, tables } = await publicCheckout({ email }, {
        authUsers: [{ id: "auth-existing-workspace", email, password: "ExistingPassword12!" }],
        tables: {
          tenant_users: [{ user_id: "auth-existing-workspace", tenant_id: "tenant-existing", role: "tenant" }],
        },
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, "existing_workspace_use_choose_plan");
      assert.equal(proofCalls, 0);
      assert.equal(stripe.calls.checkoutCreate.length, 0);
      assert.equal(tables.commercial_checkout_sessions.length, 0);
      assert.equal(tables.commercial_stripe_checkout_attempts.length, 0);
    } finally {
      setCheckoutPasswordProofOverrideForTests(null);
    }
  });
});

describe("stripe test webhook foundation v1", () => {
  function event(type, object, livemode = false) {
    return { id: `evt_${type}_${object.id}`, type, livemode, data: { object } };
  }

  it("rejects invalid live and unsupported events before activation", async () => {
    const db = createFakeSupabase();
    assert.deepEqual(await handleStripeWebhookEvent(db.supabase, event("invoice.paid", { id: "in_1", customer: "cus_1", livemode: false }, true)), {
      ok: false,
      status: 400,
      code: "stripe_livemode_rejected",
    });
    assert.deepEqual(await handleStripeWebhookEvent(db.supabase, event("charge.succeeded", { id: "ch_1", livemode: false })), {
      ok: false,
      status: 400,
      code: "stripe_event_type_not_allowed",
    });
  });

  it("verifies signatures with raw body and rejects missing or invalid signatures", async () => {
    setStripeClientForTests({
      webhooks: {
        constructEvent(rawBody, signature, secret) {
          if (rawBody !== "{\"id\":\"evt_valid\"}" || signature !== "sig_valid" || secret !== "whsec_fake") {
            throw new Error("bad signature");
          }
          return { id: "evt_valid", type: "invoice.paid", livemode: false, data: { object: { id: "in_valid", customer: "cus_1", livemode: false } } };
        },
      },
    });
    const valid = await verifyStripeWebhookSignature("{\"id\":\"evt_valid\"}", "sig_valid", TEST_ENV);
    const invalid = await verifyStripeWebhookSignature("{\"id\":\"evt_valid\"}", "sig_bad", TEST_ENV);
    const missing = await verifyStripeWebhookSignature("{\"id\":\"evt_valid\"}", null, TEST_ENV);
    setStripeClientForTests(null);
    assert.equal(valid.ok, true);
    assert.equal(invalid.code, "stripe_signature_invalid");
    assert.equal(missing.code, "stripe_signature_missing");
  });

  it("does not activate unpaid checkout.session.completed", async () => {
    const db = createFakeSupabase({
      commercial_stripe_checkout_attempts: [{ id: "att-1", stripe_checkout_session_id: "cs_1", status: "session_created", checkout_mode: "subscription", purchaser_email: "c@example.com", idempotency_key: "idem", metadata_safe: {} }],
    });
    setStripeClientForTests(createFakeStripe());
    const result = await handleStripeWebhookEvent(db.supabase, event("checkout.session.completed", {
      id: "cs_1",
      livemode: false,
      mode: "subscription",
      payment_status: "unpaid",
      subscription: "sub_1",
      customer: "cus_1",
    }));
    setStripeClientForTests(null);
    assert.equal(result.ok, true);
    assert.equal(db.tables.commercial_stripe_checkout_attempts[0].status, "awaiting_payment");
  });

  it("paid public checkout webhook provisions once without phone/runtime side effects", async () => {
    const { result, stripe, tables, authUsers, supabase } = await publicCheckout({
      email: "paid@example.com",
      idempotencyKey: "paid-public",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const attempt = tables.commercial_stripe_checkout_attempts[0];
    setStripeClientForTests(stripe);
    const paidEvent = event("checkout.session.completed", {
      id: attempt.stripe_checkout_session_id,
      livemode: false,
      mode: "subscription",
      payment_status: "paid",
      subscription: "sub_paid",
      customer: "cus_paid",
      payment_intent: "pi_paid",
    });
    const fulfilled = await handleStripeWebhookEvent(supabase, paidEvent, PROD_TEST_ENV);
    const duplicate = await handleStripeWebhookEvent(supabase, paidEvent, PROD_TEST_ENV);
    setStripeClientForTests(null);

    assert.equal(fulfilled.ok, true, JSON.stringify(fulfilled));
    assert.equal(duplicate.deduplicated, true);
    assert.equal(authUsers.length, 1);
    assert.equal(tables.clients.length, 1);
    assert.equal(tables.tenant_users.length, 1);
    assert.equal(tables.client_users.length, 1);
    assert.equal(tables.client_account_entitlements.length, 1);
    assert.equal(tables.commercial_checkout_sessions[0].status, "checkout_paid");
    assert.equal(tables.commercial_checkout_sessions[0].client_id, tables.clients[0].id);
    assert.equal(tables.commercial_stripe_checkout_attempts[0].status, "fulfilled");
    assert.equal(tables.commercial_prod_test_checkout_authorizations[0].client_id, tables.clients[0].id);
    assert.equal(tables.commercial_prod_test_checkout_authorizations[0].entitlements_created_count, 1);
    assert.equal(tables.commercial_checkout_sessions[0].metadata.pending_signup_credential_ciphertext, undefined);
    assert.equal(authUsers[0].password, "BrowserPassword12!");
    assert.equal(tables.account_assignments.length, 0);
    assert.equal(tables.phone_app_instances.length, 0);
    assert.equal(tables.device_actions.length, 0);
    assert.equal(tables.runtime_events.length, 0);
  });

  it("fulfills a verified existing orphan Auth identity once without duplicate ownership", async () => {
    const email = "existing-paid@example.com";
    const password = "ExistingPassword12!";
    const proofCalls = [];
    setCheckoutPasswordProofOverrideForTests(async (input) => {
      proofCalls.push({ email: input.email, expectedAuthUserId: input.expectedAuthUserId, passwordMatched: input.password === password });
      return input.password === password
        ? { ok: true, authUserId: input.expectedAuthUserId }
        : { ok: false, reason: "password_verification_failed" };
    });
    try {
      const { result, stripe, tables, authUsers, supabase } = await publicCheckout({
        email,
        password,
        idempotencyKey: "existing-paid-public",
      }, {
        authUsers: [{ id: "auth-existing-paid", email, password }],
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      const attempt = tables.commercial_stripe_checkout_attempts[0];
      setStripeClientForTests(stripe);
      const paidEvent = event("checkout.session.completed", {
        id: attempt.stripe_checkout_session_id,
        livemode: false,
        mode: "subscription",
        payment_status: "paid",
        subscription: "sub_existing_paid",
        customer: "cus_existing_paid",
        payment_intent: "pi_existing_paid",
      });
      const fulfilled = await handleStripeWebhookEvent(supabase, paidEvent, PROD_TEST_ENV);
      const duplicate = await handleStripeWebhookEvent(supabase, paidEvent, PROD_TEST_ENV);

      assert.deepEqual(proofCalls, [
        { email, expectedAuthUserId: "auth-existing-paid", passwordMatched: true },
        { email, expectedAuthUserId: "auth-existing-paid", passwordMatched: true },
      ]);
      assert.equal(fulfilled.ok, true, JSON.stringify(fulfilled));
      assert.equal(duplicate.deduplicated, true);
      assert.equal(authUsers.length, 1);
      assert.equal(authUsers[0].id, "auth-existing-paid");
      assert.equal(authUsers[0].password, password);
      assert.equal(tables.clients.length, 1);
      assert.equal(tables.tenant_users.length, 1);
      assert.equal(tables.tenant_users[0].user_id, "auth-existing-paid");
      assert.equal(tables.client_users.length, 1);
      assert.equal(tables.client_users[0].auth_user_id, "auth-existing-paid");
      assert.equal(tables.client_account_entitlements.length, 1);
      assert.equal(tables.commercial_stripe_checkout_attempts[0].status, "fulfilled");
    } finally {
      setStripeClientForTests(null);
      setCheckoutPasswordProofOverrideForTests(null);
    }
  });

  it("clears pending signup credential on checkout.session.expired", async () => {
    const { tables, supabase } = await publicCheckout({
      email: "expired@example.com",
      idempotencyKey: "expired-public",
    });
    const attempt = tables.commercial_stripe_checkout_attempts[0];
    assert.ok(tables.commercial_checkout_sessions[0].metadata.pending_signup_credential_ciphertext);
    await handleStripeWebhookEvent(supabase, event("checkout.session.expired", {
      id: attempt.stripe_checkout_session_id,
      livemode: false,
    }), PROD_TEST_ENV);
    assert.equal(tables.commercial_checkout_sessions[0].status, "checkout_expired");
    assert.equal(tables.commercial_checkout_sessions[0].metadata.pending_signup_credential_ciphertext, undefined);
    assert.equal(tables.commercial_checkout_sessions[0].metadata.pending_signup_credential_expires_at, undefined);
    await handleStripeWebhookEvent(supabase, event("checkout.session.expired", {
      id: attempt.stripe_checkout_session_id,
      livemode: false,
    }), PROD_TEST_ENV);
    assert.equal(tables.commercial_checkout_sessions[0].status, "checkout_expired");
  });

  it("deduplicates processed events and fails closed on unknown correlation", async () => {
    const db = createFakeSupabase({
      commercial_stripe_webhook_events: [{ id: "evt-row-1", stripe_event_id: "evt_dup", status: "processed" }],
    });
    const duplicate = await handleStripeWebhookEvent(db.supabase, { id: "evt_dup", type: "invoice.paid", livemode: false, data: { object: { id: "in_dup", customer: "cus_1", livemode: false } } });
    assert.equal(duplicate.deduplicated, true);
    const unknown = await handleStripeWebhookEvent(db.supabase, event("invoice.payment_failed", { id: "in_2", customer: "cus_unknown", livemode: false }));
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, "stripe_customer_unknown");
  });

  it("keeps subscription deleted/payment failed as projection state only", async () => {
    const db = createFakeSupabase({
      commercial_stripe_billing_profiles: [{ id: "bp-1", client_id: "client-1", stripe_customer_id: "cus_1", livemode: false }],
      commercial_stripe_subscriptions: [{ id: "sub-row-1", client_id: "client-1", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active", livemode: false }],
    });
    const deleted = await handleStripeWebhookEvent(db.supabase, event("customer.subscription.deleted", {
      id: "sub_1",
      customer: "cus_1",
      livemode: false,
      status: "canceled",
      items: { data: [] },
    }));
    assert.equal(deleted.ok, true);
    assert.equal(db.tables.commercial_stripe_subscriptions[0].status, "canceled");
    const failed = await handleStripeWebhookEvent(db.supabase, event("invoice.payment_failed", { id: "in_3", customer: "cus_1", livemode: false }));
    assert.equal(failed.ok, true);
    assert.equal(db.tables.commercial_stripe_subscriptions[0].status, "past_due");
  });
});

describe("stripe checkout webhook migration invariants", () => {
  it("does not allow null package fields unless the row is explicitly outreach_only", () => {
    const migration = readFileSync(
      new URL("../../../supabase/migrations/20260710150500_stripe_checkout_webhook_foundation_v1.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /\(commercial_mode is null or commercial_mode = 'full_cycle'\)[\s\S]*plan_key is not null[\s\S]*plan_key in \('growth', 'pro', 'premium'\)/);
    assert.match(migration, /metadata->>'commercial_mode'\) is null or metadata->>'commercial_mode' = 'full_cycle'[\s\S]*plan_key is not null[\s\S]*commercial_package_code is not null[\s\S]*commercial_package_code in \('growth', 'pro', 'premium'\)/);
    assert.match(migration, /commercial_mode = 'outreach_only'[\s\S]*plan_key is null[\s\S]*outreach_addon_key is not null[\s\S]*outreach_addon_key in \('outreach_standard', 'outreach_ai'\)/);
    assert.match(migration, /metadata->>'commercial_mode' = 'outreach_only'[\s\S]*commercial_package_code is null[\s\S]*outreach_addon_key is not null[\s\S]*outreach_addon_key in \('outreach_standard', 'outreach_ai'\)/);
  });
});
