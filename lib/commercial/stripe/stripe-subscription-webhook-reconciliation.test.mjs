import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStripeSubscriptionSnapshot,
  planPaidStripeSubscriptionProjectionRepair,
  reconcileDeferredStripeSubscriptionWebhookEvents,
  reconcilePaidStripeSubscriptionProjection,
  resolveStripeSubscriptionWebhookCorrelation,
} from "./stripe-subscription-webhook-reconciliation.ts";
import { handleStripeWebhookEvent } from "./stripe-webhook-handler.ts";
import { setStripeClientForTests } from "./stripe-client.ts";

function subscriptionObject(overrides = {}) {
  return {
    id: "sub_order_test",
    customer: "cus_order_test",
    livemode: false,
    status: "active",
    current_period_start: 1_700_000_000,
    current_period_end: 1_700_086_400,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_test_pro" } }] },
    ...overrides,
  };
}

function createFakeSupabase(initial = {}) {
  const tables = {
    commercial_stripe_checkout_attempts: [],
    commercial_stripe_billing_profiles: [],
    commercial_stripe_subscriptions: [],
    commercial_stripe_webhook_events: [],
    commercial_checkout_sessions: [],
    client_account_entitlements: [],
    clients: [],
    ...initial,
  };

  const supabase = {
    from(table) {
      return {
        select() { return this; },
        insert(row) {
          const records = Array.isArray(row) ? row : [row];
          tables[table].push(...records.map((entry, index) => ({
            id: `${table}-${tables[table].length + index + 1}`,
            ...entry,
          })));
          return {
            select() { return this; },
            single: async () => ({ data: tables[table].at(-1), error: null }),
          };
        },
        update(patch) {
          return {
            eq(column, value) {
              tables[table].forEach((row) => {
                if (row[column] === value) Object.assign(row, patch);
              });
              return Promise.resolve({ error: null });
            },
            in(column, values) {
              tables[table].forEach((row) => {
                if (values.includes(row[column])) Object.assign(row, patch);
              });
              return Promise.resolve({ error: null });
            },
          };
        },
        upsert(row, options = {}) {
          const conflictKey = options.onConflict ?? "id";
          const existing = tables[table].find((entry) => entry[conflictKey] === row[conflictKey]);
          if (existing) {
            Object.assign(existing, row);
          } else {
            tables[table].push({ id: `${table}-${tables[table].length + 1}`, ...row });
          }
          return Promise.resolve({ error: null });
        },
        eq(column, value) {
          this._filters = [...(this._filters ?? []), { column, value, op: "eq" }];
          return this;
        },
        in(column, values) {
          this._filters = [...(this._filters ?? []), { column, values, op: "in" }];
          return this;
        },
        or(expression) {
          this._or = expression;
          return this;
        },
        order() { return this; },
        limit() { return this; },
        maybeSingle: async () => {
          const rows = filterRows(tables[table], this);
          return { data: rows[0] ?? null, error: null };
        },
        single: async () => {
          const rows = filterRows(tables[table], this);
          return { data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } };
        },
        then(resolve) {
          const rows = filterRows(tables[table], this);
          resolve({ data: rows, error: null });
        },
      };
    },
    rpc(name, params) {
      if (name !== "claim_commercial_stripe_webhook_event") {
        return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
      }
      const existing = tables.commercial_stripe_webhook_events.find(
        (row) => row.stripe_event_id === params.p_stripe_event_id,
      );
      if (existing?.status === "processed") {
        return Promise.resolve({
          data: [{ claim_result: "deduplicated", event_row_id: existing.id }],
          error: null,
        });
      }
      const row = existing ?? {
        id: `evt-row-${tables.commercial_stripe_webhook_events.length + 1}`,
        stripe_event_id: params.p_stripe_event_id,
        event_type: params.p_event_type,
        status: "processing",
        metadata_safe: params.p_metadata_safe ?? {},
        stripe_customer_id: params.p_stripe_customer_id,
        stripe_subscription_id: params.p_stripe_subscription_id,
        received_at: new Date().toISOString(),
        error_redacted: null,
        last_error_redacted: null,
      };
      if (existing) {
        existing.status = "processing";
        existing.metadata_safe = { ...(existing.metadata_safe ?? {}), ...(params.p_metadata_safe ?? {}) };
      } else {
        tables.commercial_stripe_webhook_events.push(row);
      }
      return Promise.resolve({
        data: [{ claim_result: "insert", event_row_id: row.id }],
        error: null,
      });
    },
  };

  function filterRows(rows, query) {
    let result = [...rows];
    for (const filter of query._filters ?? []) {
      if (filter.op === "eq") {
        result = result.filter((row) => row[filter.column] === filter.value);
      }
      if (filter.op === "in") {
        result = result.filter((row) => filter.values.includes(row[filter.column]));
      }
    }
    if (query._or) {
      const parts = String(query._or).split(",");
      result = rows.filter((row) => parts.some((part) => {
        const [col, , val] = part.split(".");
        return row[col] === val;
      }));
    }
    if (query._statusIn) {
      result = result.filter((row) => query._statusIn.includes(row.status));
    }
    if (query._eventTypeIn) {
      result = result.filter((row) => query._eventTypeIn.includes(row.event_type));
    }
    return result;
  }

  return { supabase, tables };
}

describe("stripe subscription webhook reconciliation", () => {
  it("defers subscription.updated when billing profile is missing but attempt correlates", async () => {
    const { supabase, tables } = createFakeSupabase({
      commercial_stripe_checkout_attempts: [{
        id: "att-1",
        status: "session_created",
        stripe_customer_id: "cus_order_test",
        stripe_subscription_id: null,
        flow_type: "first_purchase",
      }],
    });
    const updated = await handleStripeWebhookEvent(supabase, {
      id: "evt_sub_updated_early",
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: subscriptionObject({ status: "active" }) },
    });
    assert.equal(updated.ok, false);
    assert.equal(updated.code, "stripe_customer_pending_link");
    assert.equal(tables.commercial_stripe_webhook_events[0].status, "retryable");
    assert.equal(tables.clients.length, 0);
  });

  it("converges to one subscription projection after created then updated then checkout completed", async () => {
    const snapshotCreated = buildStripeSubscriptionSnapshot(subscriptionObject({ status: "trialing" }));
    const snapshotUpdated = buildStripeSubscriptionSnapshot(subscriptionObject({
      status: "active",
      current_period_end: 1_700_172_800,
    }));
    const { supabase, tables } = createFakeSupabase({
      commercial_stripe_webhook_events: [
        {
          id: "evt-row-1",
          event_type: "customer.subscription.created",
          status: "retryable",
          stripe_customer_id: "cus_order_test",
          stripe_subscription_id: "sub_order_test",
          metadata_safe: { defer_reason: "awaiting_billing_profile", subscription_snapshot: snapshotCreated },
        },
        {
          id: "evt-row-2",
          event_type: "customer.subscription.updated",
          status: "retryable",
          stripe_customer_id: "cus_order_test",
          stripe_subscription_id: "sub_order_test",
          metadata_safe: { defer_reason: "awaiting_billing_profile", subscription_snapshot: snapshotUpdated },
        },
      ],
    });

    const result = await reconcileDeferredStripeSubscriptionWebhookEvents(supabase, {
      clientId: "client-1",
      stripeCustomerId: "cus_order_test",
      stripeSubscriptionId: "sub_order_test",
    });
    assert.equal(result.recoveredCount, 2);
    assert.equal(tables.commercial_stripe_subscriptions.length, 1);
    assert.equal(tables.commercial_stripe_subscriptions[0].status, "active");
    assert.equal(tables.commercial_stripe_subscriptions[0].current_period_end, new Date(1_700_172_800 * 1000).toISOString());
  });

  it("defers subscription.created when billing profile is missing but attempt correlates", async () => {
    const { supabase, tables } = createFakeSupabase({
      commercial_stripe_checkout_attempts: [{
        id: "att-1",
        status: "session_created",
        stripe_customer_id: "cus_order_test",
        stripe_subscription_id: null,
        flow_type: "first_purchase",
      }],
    });
    const created = await handleStripeWebhookEvent(supabase, {
      id: "evt_sub_created_early",
      type: "customer.subscription.created",
      livemode: false,
      data: { object: subscriptionObject() },
    });
    assert.equal(created.ok, false);
    assert.equal(created.code, "stripe_customer_pending_link");
    assert.equal(tables.commercial_stripe_webhook_events[0].status, "retryable");
    assert.equal(tables.commercial_stripe_webhook_events[0].metadata_safe.defer_reason, "awaiting_billing_profile");
    assert.equal(tables.commercial_stripe_webhook_events[0].metadata_safe.subscription_snapshot.stripe_subscription_id, "sub_order_test");
    assert.equal(tables.clients.length, 0);
  });

  it("reconciles deferred subscription events after checkout fulfillment linkage", async () => {
    const snapshot = buildStripeSubscriptionSnapshot(subscriptionObject({ status: "active" }));
    const { supabase, tables } = createFakeSupabase({
      commercial_stripe_webhook_events: [
        {
          id: "evt-row-1",
          event_type: "customer.subscription.created",
          status: "retryable",
          stripe_customer_id: "cus_order_test",
          stripe_subscription_id: "sub_order_test",
          error_redacted: "Stripe customer is not linked to an internal client yet.",
          metadata_safe: { defer_reason: "awaiting_billing_profile", subscription_snapshot: snapshot },
        },
        {
          id: "evt-row-2",
          event_type: "customer.subscription.updated",
          status: "failed",
          stripe_customer_id: "cus_order_test",
          stripe_subscription_id: "sub_order_test",
          error_redacted: "Stripe customer is not linked to an internal client.",
          metadata_safe: {
            defer_reason: "awaiting_billing_profile",
            subscription_snapshot: buildStripeSubscriptionSnapshot(subscriptionObject({
              status: "active",
              current_period_end: 1_700_172_800,
            })),
          },
        },
      ],
    });

    const result = await reconcileDeferredStripeSubscriptionWebhookEvents(supabase, {
      clientId: "client-1",
      stripeCustomerId: "cus_order_test",
      stripeSubscriptionId: "sub_order_test",
    });
    assert.equal(result.recoveredCount, 2);
    assert.equal(tables.commercial_stripe_webhook_events.every((row) => row.status === "processed"), true);
    assert.equal(tables.commercial_stripe_webhook_events.every((row) => row.metadata_safe.recovered_at), true);
    assert.equal(tables.commercial_stripe_webhook_events.every((row) => row.metadata_safe.correlation_basis), true);
    assert.equal(tables.commercial_stripe_subscriptions.length, 1);
    assert.equal(tables.commercial_stripe_subscriptions[0].client_id, "client-1");
  });

  it("does not downgrade active projection when replaying stale incomplete subscription webhook", async () => {
    const { supabase, tables } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{
        id: "bp-1",
        client_id: "client-1",
        stripe_customer_id: "cus_order_test",
      }],
      commercial_stripe_checkout_attempts: [{
        id: "att-1",
        status: "fulfilled",
        stripe_customer_id: "cus_order_test",
        stripe_subscription_id: "sub_order_test",
        commercial_checkout_session_id: "checkout-1",
      }],
      commercial_checkout_sessions: [{
        id: "checkout-1",
        commercial_mode: "full_cycle",
        pricing_snapshot: { version: "v1" },
      }],
      client_account_entitlements: [{
        id: "entitlement-1",
        client_id: "client-1",
        status: "entitlement_consumed",
        created_at: "2026-07-04T17:00:00.000Z",
      }],
      commercial_stripe_subscriptions: [{
        id: "sub-row-1",
        client_id: "client-1",
        stripe_subscription_id: "sub_order_test",
        stripe_customer_id: "cus_order_test",
        status: "active",
        commercial_checkout_session_id: "checkout-1",
        client_account_entitlement_id: "entitlement-1",
      }],
      commercial_stripe_webhook_events: [{
        id: "evt-row-invoice",
        event_type: "invoice.paid",
        status: "processed",
        stripe_customer_id: "cus_order_test",
        stripe_subscription_id: "sub_order_test",
        received_at: "2026-07-04T17:10:47.000Z",
      }],
    });
    setStripeClientForTests(null);

    const replay = await handleStripeWebhookEvent(supabase, {
      id: "evt_sub_replay_incomplete",
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: subscriptionObject({ status: "incomplete" }) },
    });

    assert.equal(replay.ok, true);
    assert.equal(tables.commercial_stripe_subscriptions.length, 1);
    assert.equal(tables.commercial_stripe_subscriptions[0].status, "active");
    assert.equal(tables.commercial_stripe_subscriptions[0].commercial_checkout_session_id, "checkout-1");
    assert.equal(tables.commercial_stripe_subscriptions[0].client_account_entitlement_id, "entitlement-1");
  });

  it("links projection to checkout and entitlement during paid reconciliation", async () => {
    const { supabase, tables } = createFakeSupabase({
      commercial_stripe_checkout_attempts: [{
        id: "att-1",
        status: "fulfilled",
        stripe_customer_id: "cus_order_test",
        stripe_subscription_id: "sub_order_test",
        commercial_checkout_session_id: "checkout-1",
      }],
      commercial_checkout_sessions: [{
        id: "checkout-1",
        commercial_mode: "full_cycle",
        pricing_snapshot: { version: "v1" },
      }],
      client_account_entitlements: [{
        id: "entitlement-1",
        client_id: "client-1",
        status: "entitlement_consumed",
        created_at: "2026-07-04T17:00:00.000Z",
      }],
      commercial_stripe_webhook_events: [
        {
          id: "evt-row-invoice",
          event_type: "invoice.paid",
          status: "processed",
          stripe_customer_id: "cus_order_test",
          stripe_subscription_id: "sub_order_test",
          received_at: "2026-07-04T17:10:47.000Z",
        },
        {
          id: "evt-row-2",
          event_type: "customer.subscription.created",
          status: "failed",
          stripe_customer_id: "cus_order_test",
          stripe_subscription_id: "sub_order_test",
          error_redacted: "Stripe customer is not linked to an internal client.",
          metadata_safe: {
            defer_reason: "awaiting_billing_profile",
            subscription_snapshot: buildStripeSubscriptionSnapshot(subscriptionObject({ status: "incomplete" })),
          },
        },
      ],
      commercial_stripe_subscriptions: [{
        id: "sub-row-1",
        client_id: "client-1",
        stripe_subscription_id: "sub_order_test",
        stripe_customer_id: "cus_order_test",
        status: "incomplete",
      }],
    });

    const result = await reconcilePaidStripeSubscriptionProjection(supabase, {
      clientId: "client-1",
      stripeCustomerId: "cus_order_test",
      stripeSubscriptionId: "sub_order_test",
      correlationBasis: "checkout_fulfillment",
    });

    assert.equal(result.canonicalStatus, "active");
    assert.equal(result.appliedStatus, "active");
    assert.equal(tables.commercial_stripe_subscriptions[0].commercial_checkout_session_id, "checkout-1");
    assert.equal(tables.commercial_stripe_subscriptions[0].client_account_entitlement_id, "entitlement-1");
    assert.equal(tables.commercial_stripe_webhook_events[1].metadata_safe.recovered_at != null, true);
  });

  it("rejects unknown subscription customers fail-closed", async () => {
    const correlation = await resolveStripeSubscriptionWebhookCorrelation(createFakeSupabase().supabase, {
      stripeCustomerId: "cus_foreign",
      stripeSubscriptionId: "sub_foreign",
    });
    assert.deepEqual(correlation, { action: "reject", reason: "stripe_customer_unknown" });
  });

  it("deduplicates processed subscription projections", async () => {
    const { supabase, tables } = createFakeSupabase({
      commercial_stripe_billing_profiles: [{
        id: "bp-1",
        client_id: "client-1",
        stripe_customer_id: "cus_order_test",
      }],
      commercial_stripe_subscriptions: [{
        id: "sub-row-1",
        client_id: "client-1",
        stripe_subscription_id: "sub_order_test",
        stripe_customer_id: "cus_order_test",
        status: "active",
      }],
    });
    setStripeClientForTests(null);
    const first = await handleStripeWebhookEvent(supabase, {
      id: "evt_sub_updated_1",
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: subscriptionObject({ status: "active" }) },
    });
    const duplicate = await handleStripeWebhookEvent(supabase, {
      id: "evt_sub_updated_1",
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: subscriptionObject({ status: "active" }) },
    });
    assert.equal(first.ok, true);
    assert.equal(duplicate.deduplicated, true);
    assert.equal(tables.commercial_stripe_subscriptions.length, 1);
  });

  it("plans solomon-style projection repair without creating duplicate rows", async () => {
    const { supabase } = createFakeSupabase({
      commercial_stripe_checkout_attempts: [{
        id: "att-1",
        status: "fulfilled",
        stripe_customer_id: "cus_order_test",
        stripe_subscription_id: "sub_order_test",
        commercial_checkout_session_id: "checkout-1",
      }],
      commercial_checkout_sessions: [{ id: "checkout-1", commercial_mode: "full_cycle", pricing_snapshot: { version: "v1" } }],
      client_account_entitlements: [{ id: "entitlement-1", client_id: "client-1", status: "entitlement_consumed", created_at: "2026-07-04T17:00:00.000Z" }],
      commercial_stripe_subscriptions: [{
        id: "sub-row-1",
        client_id: "client-1",
        stripe_subscription_id: "sub_order_test",
        stripe_customer_id: "cus_order_test",
        status: "incomplete",
      }],
      commercial_stripe_webhook_events: [
        {
          id: "evt-row-1",
          stripe_event_id: "evt_created",
          event_type: "customer.subscription.created",
          status: "processed",
          stripe_customer_id: "cus_order_test",
          stripe_subscription_id: "sub_order_test",
          metadata_safe: { type: "customer.subscription.created" },
        },
        {
          id: "evt-row-2",
          stripe_event_id: "evt_updated",
          event_type: "customer.subscription.updated",
          status: "processed",
          stripe_customer_id: "cus_order_test",
          stripe_subscription_id: "sub_order_test",
          metadata_safe: { type: "customer.subscription.updated" },
        },
        {
          id: "evt-row-invoice",
          event_type: "invoice.paid",
          status: "processed",
          stripe_customer_id: "cus_order_test",
          stripe_subscription_id: "sub_order_test",
          received_at: "2026-07-04T17:10:47.000Z",
        },
      ],
    });

    const plan = await planPaidStripeSubscriptionProjectionRepair(supabase, {
      clientId: "client-1",
      stripeCustomerId: "cus_order_test",
      stripeSubscriptionId: "sub_order_test",
      stripeEventIds: ["evt_created", "evt_updated"],
    });

    assert.equal(plan.before.projection_status, "incomplete");
    assert.equal(plan.planned.canonical_status, "active");
    assert.equal(plan.planned.commercial_checkout_session_id, "checkout-1");
    assert.equal(plan.planned.client_account_entitlement_id, "entitlement-1");
    assert.equal(plan.planned.webhook_recovery_metadata_patches.length, 2);
  });

  it("buildStripeSubscriptionSnapshot captures pause_collection void billing pause", () => {
    const snapshot = buildStripeSubscriptionSnapshot(subscriptionObject({
      status: "active",
      pause_collection: { behavior: "void" },
    }));
    assert.equal(snapshot.status, "active");
    assert.equal(snapshot.billing_paused, true);
    assert.equal(snapshot.pause_collection_behavior, "void");
  });
});
