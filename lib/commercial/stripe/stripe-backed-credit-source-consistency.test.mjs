import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260831153633_stripe_backed_credit_source_consistency_v1.sql", import.meta.url),
  "utf8",
);
const checkout = readFileSync(new URL("./stripe-plan-change-checkout.ts", import.meta.url), "utf8");

test("Stripe activation is separate from the unchanged simulated activation contract", () => {
  assert.match(migration, /activate_stripe_commercial_plan_change_per_account_v1/);
  assert.match(migration, /activate_commercial_plan_change_per_account\(\s*p_quote_id/);
  assert.match(checkout, /activate_stripe_commercial_plan_change_per_account_v1/);
  assert.doesNotMatch(migration, /create or replace function public\.activate_commercial_plan_change_per_account\(/);
});

test("stale gates bind exact source, webhook, subscription and target Price lineage", () => {
  assert.match(migration, /v_current_revision <> v_quote\.source_revision/);
  assert.match(migration, /canonical_target_stripe_price_id/);
  assert.match(migration, /v_event\.stripe_subscription_id is distinct from p_stripe_subscription_id/);
  assert.match(migration, /v_subscription\.client_id is distinct from v_quote\.client_id/);
  assert.match(migration, /v_subscription\.account_id is distinct from v_quote\.account_id/);
  assert.match(migration, /v_subscription\.stripe_price_id is distinct from p_current_stripe_price_id/);
  assert.match(migration, /v_subscription\.livemode/);
});

test("legacy local cents are reconciled exactly and never used as Stripe authority", () => {
  assert.match(migration, /canonical_stripe_pre_mutation_credit_alignment/);
  assert.match(migration, /canonical_stripe_post_mutation_credit_reconciliation/);
  assert.match(migration, /v_delta := p_quoted_stripe_credit_cents - v_balance/);
  assert.match(migration, /v_delta := p_actual_remaining_credit_cents - v_balance/);
  assert.match(migration, /cent_tolerance', 0/);
  assert.doesNotMatch(migration, /abs\([^)]*credit[^)]*\)\s*<=|between\s+-?9\s+and\s+9/i);

  const localHistorical = 26_976;
  const stripePreMutation = 26_967;
  const unusedGrowth = 39_343;
  const proRemaining = 52_725;
  const aligned = localHistorical + (stripePreMutation - localHistorical);
  const postActivation = aligned + unusedGrowth - proRemaining;
  assert.equal(aligned, 26_967);
  assert.equal(postActivation, 13_585);
});

test("historical quote estimates remain immutable while actual fields are separate", () => {
  assert.match(migration, /reconcile_plan_change_stripe_financial_actual_v1/);
  assert.doesNotMatch(migration, /set\s+existing_customer_credit_cents\s*=/i);
  assert.doesNotMatch(migration, /set\s+remaining_credit_cents\s*=/i);
  assert.match(migration, /actual_stripe_remaining_credit_cents/);
  assert.match(migration, /canonical_pre_mutation_stripe_credit_cents/);
  assert.match(migration, /canonical_post_mutation_stripe_credit_cents/);
});

test("webhook replay collects Stripe actual before one atomic local activation RPC", () => {
  const collectIndex = checkout.indexOf("const actual = await collectStripePlanChangeFinancialActual", checkout.indexOf("reconcileStripePlanChangeFromCanonicalSubscription"));
  const activateIndex = checkout.indexOf("activate_stripe_commercial_plan_change_per_account_v1");
  assert.ok(collectIndex > 0);
  assert.ok(activateIndex > collectIndex);
  assert.doesNotMatch(checkout.slice(checkout.indexOf("reconcileStripePlanChangeFromCanonicalSubscription")), /subscriptions\.update/);
});

test("atomic wrapper is replay-safe and has no operational or Stripe Tax side effects", () => {
  assert.match(migration, /v_quote\.status = 'quote_activated'/);
  assert.match(migration, /'idempotent_replay', true/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/g);
  assert.doesNotMatch(migration, /account_run_requests|ig_runs|tick_locks|auto_login/i);
  assert.doesNotMatch(migration, /automatic_tax|tax_registration|tax_id|tax_rate|tax_code/i);
});

