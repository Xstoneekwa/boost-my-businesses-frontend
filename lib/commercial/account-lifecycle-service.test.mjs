import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  executeCommercialCancelForDeletedSubscription,
  executeCommercialAccountLifecycle,
  processExpiredCommercialPauses,
  recoverFailedCommercialResumeToPaused,
} from "./account-lifecycle-service.ts";
import { assertPlanChangeAccountEligible } from "./plan-change-account-eligibility.ts";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const ENTITLEMENT_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const ENTITLEMENT_B = "ffffffff-ffff-4fff-8fff-fffffffffff02";
const SUB_A = "sub_lifecycle_a";
const SUB_B = "sub_lifecycle_b";

const ACTOR = { actorType: "admin", actorId: "admin-1", sourceSurface: "test" };

function entitlementRow(accountId, entitlementId, subId) {
  return {
    id: entitlementId,
    client_id: CLIENT_ID,
    account_id: accountId,
    status: "entitlement_consumed",
    consumed_at: "2026-06-01T12:00:00.000Z",
  };
}

function stripeProjection(entitlementId, subId, status = "active") {
  return {
    stripe_subscription_id: subId,
    client_account_entitlement_id: entitlementId,
    status,
    billing_paused: false,
    pause_collection_behavior: null,
    updated_at: "2026-06-01T12:00:00.000Z",
  };
}

function createLifecycleFakeSupabase(options = {}) {
  const tables = {
    ig_accounts: (options.accounts ?? [ACCOUNT_A]).map((accountId) => ({
      id: accountId,
      admin_lifecycle_status: options.adminStatus?.[accountId] ?? "active",
      status: options.accountStatus?.[accountId] ?? "active",
    })),
    commercial_account_lifecycle_states: [...(options.lifecycleStates ?? [])],
    commercial_account_lifecycle_operations: [...(options.lifecycleOperations ?? [])],
    client_account_entitlements: (options.accounts ?? [ACCOUNT_A]).map((accountId) => {
      const entitlementId = accountId === ACCOUNT_A ? ENTITLEMENT_A : ENTITLEMENT_B;
      return entitlementRow(accountId, entitlementId, accountId === ACCOUNT_A ? SUB_A : SUB_B);
    }).concat(options.extraEntitlements ?? []),
    commercial_stripe_subscriptions: (options.omitDefaultStripeSubscriptions ? [] : (options.accounts ?? [ACCOUNT_A]).map((accountId) => {
      const entitlementId = accountId === ACCOUNT_A ? ENTITLEMENT_A : ENTITLEMENT_B;
      return stripeProjection(entitlementId, accountId === ACCOUNT_A ? SUB_A : SUB_B);
    })).concat(options.extraStripeSubscriptions ?? []),
    account_run_requests: [...(options.runRequests ?? [])],
    ig_runs: [...(options.igRuns ?? [])],
    ig_action_logs: [],
    commercial_checkout_audit_events: [],
    client_instagram_accounts: (options.accounts ?? [ACCOUNT_A]).map((accountId) => ({
      account_id: accountId,
      client_id: CLIENT_ID,
    })),
    ig_dm_jobs: [...(options.dmJobs ?? [])],
    ct_target_verification_jobs: [...(options.ctJobs ?? [])],
    client_email_send_intents: [...(options.emailJobs ?? [])],
    auto_restart_decisions: [...(options.autoRestartJobs ?? [])],
    phone_app_instances: (options.accounts ?? [ACCOUNT_A]).map((accountId) => ({
      id: `app-${accountId}`,
      current_account_id: accountId,
      status: "assigned",
    })),
  };

  const persistRunningAfterCancel = options.persistRunningAfterCancel ?? false;
  const releaseCapacityFails = options.releaseCapacityFails ?? false;
  let operationSeq = 0;

  function filterRows(rows, query) {
    let result = [...(rows ?? [])];
    for (const filter of query._filters ?? []) {
      if (filter.op === "eq") {
        result = result.filter((row) => row[filter.column] === filter.value);
      }
      if (filter.op === "in") {
        result = result.filter((row) => filter.values.includes(row[filter.column]));
      }
      if (filter.op === "lte") {
        result = result.filter((row) => {
          const value = row[filter.column];
          if (value == null) return false;
          return Date.parse(String(value)) <= Date.parse(String(filter.value));
        });
      }
    }
    return result;
  }

  function makeUpdateBuilder(table, patch) {
    const state = { filters: [] };
    const builder = {
      eq(column, value) {
        state.filters.push({ column, value });
        return builder;
      },
      in(column, values) {
        state.filters.push({ column, values, op: "in" });
        return builder;
      },
      then(resolve, reject) {
        (tables[table] ?? []).forEach((row) => {
          const matches = state.filters.every((filter) => {
            if (filter.op === "in") return filter.values.includes(row[filter.column]);
            return row[filter.column] === filter.value;
          });
          if (matches) Object.assign(row, patch);
        });
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  const supabase = {
    from(table) {
      const query = {
        _filters: [],
        select() { return query; },
        insert(row) {
          const records = Array.isArray(row) ? row : [row];
          for (const entry of records) {
            (tables[table] ??= []).push({
              id: entry.id ?? `${table}-${++operationSeq}`,
              ...entry,
            });
          }
          const result = {
            select() { return result; },
            maybeSingle: async () => ({ data: tables[table]?.at(-1) ?? null, error: null }),
            then(resolve, reject) {
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return result;
        },
        update(patch) {
          return makeUpdateBuilder(table, patch);
        },
        upsert(row, opts = {}) {
          tables[table] ??= [];
          const conflictKey = opts.onConflict ?? "id";
          const existing = tables[table].find((entry) => entry[conflictKey] === row[conflictKey]);
          if (existing) Object.assign(existing, row);
          else tables[table].push({ id: `${table}-${++operationSeq}`, ...row });
          return Promise.resolve({ error: null });
        },
        eq(column, value) {
          query._filters.push({ column, value, op: "eq" });
          return query;
        },
        in(column, values) {
          query._filters.push({ column, values, op: "in" });
          return query;
        },
        lte(column, value) {
          query._filters.push({ column, value, op: "lte" });
          return query;
        },
        order() { return query; },
        limit() { return query; },
        maybeSingle: async () => {
          const rows = filterRows(tables[table], query);
          return { data: rows[0] ?? null, error: null };
        },
        then(resolve, reject) {
          const rows = filterRows(tables[table], query);
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc(name, args) {
      if (name === "reconcile_commercial_resume_blockers_v1") {
        const result = options.resumeBlockerPreflight ?? {
          ok: true,
          reason: "commercial_resume_preflight_clear",
          reconciled_count: 0,
        };
        return Promise.resolve({ data: result, error: null });
      }
      if (name === "reconcile_account_operational_projection_v1") {
        if (options.operationalProjectionFails) {
          return Promise.resolve({
            data: { ok: false, reason: options.operationalProjectionFailureReason ?? "blocking_dashboard_action_active" },
            error: null,
          });
        }
        const account = tables.ig_accounts.find((row) => row.id === args.p_account_id);
        if (!account) return Promise.resolve({ data: { ok: false, reason: "account_not_found" }, error: null });
        account.status = "active";
        return Promise.resolve({ data: { ok: true, reason: "operational_projection_reconciled" }, error: null });
      }
      if (name === "cancel_account_run_request") {
        if (persistRunningAfterCancel) {
          return Promise.resolve({ error: null });
        }
        const accountId = args.p_account_id;
        const requestId = args.p_request_id;
        (tables.account_run_requests ?? []).forEach((row) => {
          const match = requestId ? row.id === requestId : row.account_id === accountId;
          if (match && row.status === "running") {
            row.cancel_requested_at = new Date().toISOString();
          } else if (match) {
            row.status = "canceled";
          }
        });
        return Promise.resolve({ error: null });
      }
      if (name === "release_account_schedule_capacity") {
        if (releaseCapacityFails) {
          return Promise.resolve({ error: { message: "release_failed" } });
        }
        (tables.phone_app_instances ?? []).forEach((row) => {
          if (row.current_account_id === args.p_account_id) {
            row.current_account_id = null;
            row.status = "available";
          }
        });
        return Promise.resolve({ data: { ok: true, released_count: 1, app_instances_released_count: 1 }, error: null });
      }
      if (name === "upsert_account_dashboard_action") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ error: { message: `unexpected rpc ${name}` } });
    },
  };

  return { supabase, tables };
}

function createStripeGateway(options = {}) {
  const calls = [];
  const gateway = {
    calls,
    async pauseCollectionVoid(subscriptionId, idempotencyKey) {
      calls.push({ op: "pause", subscriptionId, idempotencyKey });
      if (options.pauseFails) throw new Error("stripe_unavailable");
    },
    async resumeCollection(subscriptionId, idempotencyKey) {
      calls.push({ op: "resume", subscriptionId, idempotencyKey });
      if (options.resumeFails) throw new Error("stripe_unavailable");
    },
    async cancelSubscriptionImmediately(subscriptionId, idempotencyKey) {
      calls.push({ op: "cancel", subscriptionId, idempotencyKey });
      if (options.cancelFails) throw new Error("stripe_unavailable");
    },
  };
  return gateway;
}

describe("commercial account lifecycle service", () => {
  it("recovers a failed resume to the original paused state without applying Active", async () => {
    const pausedAt = "2026-08-14T14:48:54.960Z";
    const pauseExpiresAt = "2026-09-13T14:48:54.961Z";
    const failedOperationId = "resume-failed-1";
    const { supabase, tables } = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "active" },
      lifecycleStates: [{
        account_id: ACCOUNT_A,
        commercial_state: "resume_requested",
        entitlement_id: ENTITLEMENT_A,
        stripe_subscription_id: SUB_A,
        stripe_billing_paused: false,
        last_operation_id: failedOperationId,
      }],
      lifecycleOperations: [{
        id: failedOperationId,
        account_id: ACCOUNT_A,
        operation_type: "resume",
        state: "failed",
        error_redacted: "blocking_dashboard_action_active",
      }],
    });
    const stripe = createStripeGateway();

    const result = await recoverFailedCommercialResumeToPaused({
      supabase,
      accountId: ACCOUNT_A,
      pausedAt,
      pauseExpiresAt,
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.deepEqual(result, { recovered: true, reason: "failed_resume_recovered_to_paused" });
    assert.equal(stripe.calls.length, 1);
    assert.equal(stripe.calls[0].op, "pause");
    assert.equal(tables.ig_accounts[0].admin_lifecycle_status, "paused");
    const state = tables.commercial_account_lifecycle_states[0];
    assert.equal(state.commercial_state, "paused");
    assert.equal(state.paused_at, pausedAt);
    assert.equal(state.pause_expires_at, pauseExpiresAt);
    assert.equal(state.stripe_billing_paused, true);
  });

  it("failed-resume recovery is idempotent once the account is paused", async () => {
    const pausedAt = "2026-08-14T14:48:54.960Z";
    const pauseExpiresAt = "2026-09-13T14:48:54.961Z";
    const { supabase } = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "paused" },
      lifecycleStates: [{
        account_id: ACCOUNT_A,
        commercial_state: "paused",
        entitlement_id: ENTITLEMENT_A,
        stripe_subscription_id: SUB_A,
        paused_at: pausedAt,
        pause_expires_at: pauseExpiresAt,
        stripe_billing_paused: true,
      }],
    });
    const stripe = createStripeGateway();

    const result = await recoverFailedCommercialResumeToPaused({
      supabase,
      accountId: ACCOUNT_A,
      pausedAt,
      pauseExpiresAt,
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.deepEqual(result, { recovered: false, reason: "already_paused" });
    assert.equal(stripe.calls.length, 0);
  });

  it("pause with a real running request does not converge on cancel_requested_at alone", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase({
      runRequests: [{
        id: "req-1",
        account_id: ACCOUNT_A,
        status: "running",
        run_id: "run-1",
        created_at: "2026-07-04T10:00:00.000Z",
      }],
      igRuns: [{
        id: "run-1",
        account_id: ACCOUNT_A,
        status: "running",
        created_at: "2026-07-04T10:00:00.000Z",
      }],
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "pause",
      idempotencyKey: "pause-a-1",
      reason: "manual_pause",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, false);
    assert.equal(result.commercialState, "action_required");
    assert.equal(result.actionRequiredReason, "runtime_still_active");
    assert.equal(stripe.calls.length, 0);
    assert.ok(tables.account_run_requests[0].cancel_requested_at);
    assert.equal(tables.ig_accounts[0].admin_lifecycle_status, "paused");
  });

  it("pause without active run still pauses Stripe and keeps slot", async () => {
    const { supabase } = createLifecycleFakeSupabase();
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "pause",
      idempotencyKey: "pause-a-2",
      reason: "manual_pause",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, true);
    assert.equal(result.commercialState, "paused");
    assert.equal(stripe.calls[0].op, "pause");
    assert.equal(result.capacityReleaseStatus, "not_applicable");
  });

  it("pause cancels pending account-scoped jobs without touching another account", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase({
      accounts: [ACCOUNT_A, ACCOUNT_B],
      dmJobs: [
        { id: "dm-a", account_id: ACCOUNT_A, status: "queued" },
        { id: "dm-b", account_id: ACCOUNT_B, status: "queued" },
      ],
      ctJobs: [{ id: "ct-a", account_id: ACCOUNT_A, status: "pending" }],
      emailJobs: [{ id: "email-a", account_id: ACCOUNT_A, status: "scheduled" }],
      autoRestartJobs: [{ id: "restart-a", account_id: ACCOUNT_A, status: "pending" }],
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "pause",
      idempotencyKey: "pause-jobs-a",
      reason: "manual_pause",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, true);
    assert.equal(tables.ig_dm_jobs.find((row) => row.id === "dm-a").status, "canceled");
    assert.equal(tables.ig_dm_jobs.find((row) => row.id === "dm-b").status, "queued");
    assert.equal(tables.ct_target_verification_jobs[0].status, "canceled");
    assert.equal(tables.client_email_send_intents[0].status, "canceled");
    assert.equal(tables.auto_restart_decisions[0].status, "canceled");
  });

  it("resume before J+30 lifts Stripe pause and restores active state", async () => {
    const pauseExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { supabase, tables } = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "paused" },
      accountStatus: { [ACCOUNT_A]: "inactive" },
      lifecycleStates: [{
        account_id: ACCOUNT_A,
        commercial_state: "paused",
        entitlement_id: ENTITLEMENT_A,
        stripe_subscription_id: SUB_A,
        pause_expires_at: pauseExpiresAt,
        paused_at: "2026-07-01T12:00:00.000Z",
        stripe_billing_paused: true,
      }],
    });
    tables.commercial_stripe_subscriptions[0].billing_paused = true;
    tables.commercial_stripe_subscriptions[0].pause_collection_behavior = "void";
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "resume",
      idempotencyKey: "resume-a-1",
      reason: "manual_resume",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, true);
    assert.equal(result.commercialState, "active");
    assert.equal(stripe.calls[0].op, "resume");
    assert.equal(tables.ig_accounts[0].admin_lifecycle_status, "active");
    assert.equal(tables.ig_accounts[0].status, "active");
    assert.equal(tables.commercial_stripe_subscriptions[0].billing_paused, false);
  });

  it("resume refuses a real open blocker before lifecycle or Stripe mutation", async () => {
    const pauseExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const { supabase, tables } = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "paused" },
      lifecycleStates: [{
        account_id: ACCOUNT_A,
        commercial_state: "paused",
        entitlement_id: ENTITLEMENT_A,
        stripe_subscription_id: SUB_A,
        paused_at: "2026-07-01T12:00:00.000Z",
        pause_expires_at: pauseExpiresAt,
        stripe_billing_paused: true,
      }],
      resumeBlockerPreflight: {
        ok: false,
        reason: "blocking_dashboard_action_active",
        reconciled_count: 0,
      },
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "resume",
      idempotencyKey: "resume-blocked-before-mutation",
      reason: "manual_resume",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, false);
    assert.equal(result.commercialState, "paused");
    assert.equal(result.actionRequiredReason, "blocking_dashboard_action_active");
    assert.equal(stripe.calls.length, 0);
    assert.equal(tables.ig_accounts[0].admin_lifecycle_status, "paused");
    assert.equal(tables.commercial_account_lifecycle_states[0].commercial_state, "paused");
  });

  it("resolved stale blocker reconciles in preflight and resume proceeds", async () => {
    const pauseExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const { supabase } = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "paused" },
      lifecycleStates: [{
        account_id: ACCOUNT_A,
        commercial_state: "paused",
        entitlement_id: ENTITLEMENT_A,
        stripe_subscription_id: SUB_A,
        pause_expires_at: pauseExpiresAt,
        stripe_billing_paused: true,
      }],
      resumeBlockerPreflight: {
        ok: true,
        reason: "commercial_resume_preflight_clear",
        reconciled_count: 1,
      },
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "resume",
      idempotencyKey: "resume-after-stale-reconciliation",
      reason: "manual_resume",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, true);
    assert.equal(result.commercialState, "active");
    assert.deepEqual(stripe.calls.map((call) => call.op), ["resume"]);
  });

  it("post-Stripe blocker failure compensates back to the original paused state", async () => {
    const pausedAt = "2026-07-01T12:00:00.000Z";
    const pauseExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const { supabase, tables } = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "paused" },
      lifecycleStates: [{
        account_id: ACCOUNT_A,
        commercial_state: "paused",
        entitlement_id: ENTITLEMENT_A,
        stripe_subscription_id: SUB_A,
        paused_at: pausedAt,
        pause_expires_at: pauseExpiresAt,
        stripe_billing_paused: true,
      }],
      operationalProjectionFails: true,
      operationalProjectionFailureReason: "blocking_incident_active",
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "resume",
      idempotencyKey: "resume-compensated",
      reason: "manual_resume",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, false);
    assert.equal(result.commercialState, "paused");
    assert.equal(result.actionRequiredReason, "blocking_incident_active");
    assert.deepEqual(stripe.calls.map((call) => call.op), ["resume", "pause"]);
    assert.equal(tables.ig_accounts[0].admin_lifecycle_status, "paused");
    assert.equal(tables.commercial_account_lifecycle_states[0].commercial_state, "paused");
    assert.equal(tables.commercial_account_lifecycle_states[0].paused_at, pausedAt);
    assert.equal(tables.commercial_stripe_subscriptions[0].billing_paused, true);
  });

  it("fails closed when multiple consumed entitlements have compatible subscriptions", async () => {
    const { supabase } = createLifecycleFakeSupabase({
      extraEntitlements: [{
        ...entitlementRow(ACCOUNT_A, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee99", "sub_extra"),
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee99",
      }],
      extraStripeSubscriptions: [stripeProjection("eeeeeeee-eeee-4eee-8eee-eeeeeeeeee99", "sub_extra")],
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "pause",
      idempotencyKey: "pause-ambiguous-entitlement",
      reason: "manual_pause",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, false);
    assert.equal(result.actionRequiredReason, "commercial_subscription_ambiguous");
    assert.equal(stripe.calls.length, 0);
  });

  it("fails closed when no compatible subscription exists", async () => {
    const { supabase } = createLifecycleFakeSupabase({
      accounts: [ACCOUNT_A],
      omitDefaultStripeSubscriptions: true,
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "pause",
      idempotencyKey: "pause-missing-subscription",
      reason: "manual_pause",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, false);
    assert.equal(result.actionRequiredReason, "commercial_subscription_missing");
    assert.equal(stripe.calls.length, 0);
  });

  it("cancel from active stops runtime, cancels Stripe, closes entitlement, releases capacity", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase({
      runRequests: [{
        id: "req-cancel",
        account_id: ACCOUNT_A,
        status: "queued",
        created_at: "2026-07-04T10:00:00.000Z",
      }],
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "cancel",
      idempotencyKey: "cancel-a-1",
      reason: "manual_cancel",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, true);
    assert.equal(result.commercialState, "cancelled");
    assert.equal(stripe.calls[0].op, "cancel");
    assert.equal(tables.client_account_entitlements[0].status, "entitlement_cancelled");
    assert.equal(tables.commercial_stripe_subscriptions[0].status, "canceled");
    assert.equal(result.capacityReleaseStatus, "released");
    assert.equal(tables.ig_accounts[0].admin_lifecycle_status, "cancelled");
    assert.equal(tables.phone_app_instances[0].status, "available");
    assert.equal(tables.phone_app_instances[0].current_account_id, null);
  });

  it("cancel with a real running request does not call Stripe or release capacity yet", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase({
      runRequests: [{
        id: "req-running-cancel",
        account_id: ACCOUNT_A,
        status: "running",
        run_id: "run-running-cancel",
        created_at: "2026-07-04T10:00:00.000Z",
      }],
      igRuns: [{
        id: "run-running-cancel",
        account_id: ACCOUNT_A,
        status: "running",
      }],
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "cancel",
      idempotencyKey: "cancel-running-a",
      reason: "manual_cancel",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, false);
    assert.equal(result.actionRequiredReason, "runtime_still_active");
    assert.equal(stripe.calls.length, 0);
    assert.equal(tables.client_account_entitlements[0].status, "entitlement_consumed");
    assert.equal(tables.phone_app_instances[0].status, "assigned");
  });

  it("stripe cancel failure leaves capacity reserved and account quiesced", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase();
    const stripe = createStripeGateway({ cancelFails: true });

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "cancel",
      idempotencyKey: "cancel-stripe-fail-a",
      reason: "manual_cancel",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, false);
    assert.equal(result.actionRequiredReason, "stripe_cancel_failed");
    assert.equal(tables.client_account_entitlements[0].status, "entitlement_consumed");
    assert.equal(tables.phone_app_instances[0].status, "assigned");
    assert.equal(tables.ig_accounts[0].admin_lifecycle_status, "paused");
  });

  it("cancel from paused applies full teardown", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "paused" },
      lifecycleStates: [{
        account_id: ACCOUNT_A,
        commercial_state: "paused",
        entitlement_id: ENTITLEMENT_A,
        stripe_subscription_id: SUB_A,
        pause_expires_at: new Date(Date.now() + 10 * 86400000).toISOString(),
        stripe_billing_paused: true,
      }],
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "cancel",
      idempotencyKey: "cancel-paused-a",
      reason: "manual_cancel",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, true);
    assert.equal(result.commercialState, "cancelled");
    assert.equal(stripe.calls[0].op, "cancel");
    assert.equal(tables.client_account_entitlements[0].status, "entitlement_cancelled");
  });

  it("customer.subscription.deleted converges internal cancel without a second Stripe cancel", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase();

    const result = await executeCommercialCancelForDeletedSubscription({
      supabase,
      stripeSubscriptionId: SUB_A,
      stripeEventId: "evt_deleted_1",
    });

    assert.equal(result.ok, true);
    assert.equal(result.commercialState, "cancelled");
    assert.equal(tables.client_account_entitlements[0].status, "entitlement_cancelled");
    assert.equal(tables.phone_app_instances[0].status, "available");
  });

  it("expired pause triggers canonical cancel once", async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const { supabase, tables } = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "paused" },
      lifecycleStates: [{
        account_id: ACCOUNT_A,
        commercial_state: "paused",
        entitlement_id: ENTITLEMENT_A,
        stripe_subscription_id: SUB_A,
        pause_expires_at: expiredAt,
        stripe_billing_paused: true,
      }],
    });
    const stripe = createStripeGateway();

    const results = await processExpiredCommercialPauses({
      supabase,
      stripeGateway: stripe,
      limit: 10,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].commercialState, "cancelled");
    assert.equal(stripe.calls.filter((call) => call.op === "cancel").length, 1);

    const replay = await processExpiredCommercialPauses({ supabase, stripeGateway: stripe, limit: 10 });
    assert.equal(replay.length, 0);
    assert.equal(tables.commercial_account_lifecycle_states[0].commercial_state, "cancelled");
  });

  it("stripe unavailable during pause leaves safe action_required without runtime restart", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase();
    const stripe = createStripeGateway({ pauseFails: true });

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "pause",
      idempotencyKey: "pause-stripe-fail",
      reason: "manual_pause",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, false);
    assert.equal(result.commercialState, "action_required");
    assert.equal(result.actionRequiredReason, "stripe_pause_failed");
    assert.equal(tables.ig_accounts[0].admin_lifecycle_status, "paused");
    const state = tables.commercial_account_lifecycle_states.find((row) => row.account_id === ACCOUNT_A);
    assert.notEqual(state?.commercial_state, "paused");
  });

  it("runtime still active blocks pause and does not release capacity", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase({
      persistRunningAfterCancel: true,
      runRequests: [{
        id: "req-stuck",
        account_id: ACCOUNT_A,
        status: "running",
        run_id: "run-stuck",
        created_at: "2026-07-04T10:00:00.000Z",
      }],
      igRuns: [{
        id: "run-stuck",
        account_id: ACCOUNT_A,
        status: "running",
      }],
    });
    const stripe = createStripeGateway();

    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "pause",
      idempotencyKey: "pause-runtime-block",
      reason: "manual_pause",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    assert.equal(result.ok, false);
    assert.equal(result.actionRequiredReason, "runtime_still_active");
    assert.equal(stripe.calls.length, 0);
    assert.notEqual(tables.commercial_stripe_subscriptions[0].billing_paused, true);
  });

  it("idempotent replay returns completed operation without duplicate Stripe calls", async () => {
    const { supabase } = createLifecycleFakeSupabase();
    const stripe = createStripeGateway();
    const input = {
      supabase,
      accountId: ACCOUNT_A,
      operationType: "pause",
      idempotencyKey: "pause-idem",
      reason: "manual_pause",
      actor: ACTOR,
      stripeGateway: stripe,
    };

    await executeCommercialAccountLifecycle(input);
    const replay = await executeCommercialAccountLifecycle(input);

    assert.equal(replay.converged, true);
    assert.equal(stripe.calls.length, 1);
  });

  it("agency isolation: pause account A leaves account B unchanged", async () => {
    const { supabase, tables } = createLifecycleFakeSupabase({
      accounts: [ACCOUNT_A, ACCOUNT_B],
    });
    const stripe = createStripeGateway();

    await executeCommercialAccountLifecycle({
      supabase,
      accountId: ACCOUNT_A,
      operationType: "pause",
      idempotencyKey: "pause-agency-a",
      reason: "manual_pause",
      actor: ACTOR,
      stripeGateway: stripe,
    });

    const accountB = tables.ig_accounts.find((row) => row.id === ACCOUNT_B);
    const entitlementB = tables.client_account_entitlements.find((row) => row.account_id === ACCOUNT_B);
    const stateB = tables.commercial_account_lifecycle_states.find((row) => row.account_id === ACCOUNT_B);

    assert.equal(accountB.admin_lifecycle_status, "active");
    assert.equal(entitlementB.status, "entitlement_consumed");
    assert.equal(stateB, undefined);
    assert.equal(stripe.calls.length, 1);
    assert.equal(stripe.calls[0].subscriptionId, SUB_A);
  });

  it("plan change remains blocked on paused and cancelled accounts", async () => {
    const pausedSupabase = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "paused" },
    }).supabase;
    const cancelledSupabase = createLifecycleFakeSupabase({
      adminStatus: { [ACCOUNT_A]: "cancelled" },
    }).supabase;

    const paused = await assertPlanChangeAccountEligible(pausedSupabase, {
      clientId: CLIENT_ID,
      accountId: ACCOUNT_A,
    });
    const cancelled = await assertPlanChangeAccountEligible(cancelledSupabase, {
      clientId: CLIENT_ID,
      accountId: ACCOUNT_A,
    });

    assert.equal(paused.ok, false);
    if (!paused.ok) assert.equal(paused.code, "account_paused");
    assert.equal(cancelled.ok, false);
    if (!cancelled.ok) assert.equal(cancelled.code, "account_cancelled");
  });
});
