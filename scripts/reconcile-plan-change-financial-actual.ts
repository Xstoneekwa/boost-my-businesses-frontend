import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { collectStripePlanChangeFinancialActual } from "../lib/commercial/stripe/stripe-plan-change-financial-actual.ts";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() ?? "" : "";
}

const quoteId = arg("--quote-id");
const mutationUnix = Number(arg("--mutation-unix"));
const apply = process.argv.includes("--apply");
const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";

if (!quoteId || !Number.isFinite(mutationUnix) || mutationUnix <= 0) {
  throw new Error("usage: --quote-id <uuid> --mutation-unix <seconds> [--apply]");
}
if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey.startsWith("sk_test_")) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and Stripe Test STRIPE_SECRET_KEY are required");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: quote, error: quoteError } = await supabase
  .from("commercial_plan_change_quotes")
  .select("id,client_id,account_id,status,provider_transaction_id,metadata")
  .eq("id", quoteId)
  .maybeSingle<Record<string, unknown>>();
if (quoteError || !quote?.id || quote.status !== "quote_activated") throw new Error("activated quote not found");

const { data: projection, error: projectionError } = await supabase
  .from("commercial_stripe_subscriptions")
  .select("stripe_subscription_id,stripe_customer_id")
  .eq("client_id", quote.client_id)
  .eq("account_id", quote.account_id)
  .in("status", ["active", "trialing"])
  .eq("livemode", false)
  .limit(1)
  .maybeSingle<Record<string, unknown>>();
if (projectionError || !projection?.stripe_subscription_id || !projection.stripe_customer_id) {
  throw new Error("canonical Stripe Test subscription projection not found");
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" });
const subscription = await stripe.subscriptions.retrieve(String(projection.stripe_subscription_id), {
  expand: ["items.data.price"],
});
if (subscription.livemode) throw new Error("Stripe live-mode subscription is forbidden");
const actualPlanPeriodTotalCents = Number(subscription.items.data[0]?.price?.unit_amount ?? 0);
const actualPeriodStartAt = subscription.current_period_start
  ? new Date(subscription.current_period_start * 1000).toISOString()
  : "";
const actualPeriodEndAt = subscription.current_period_end
  ? new Date(subscription.current_period_end * 1000).toISOString()
  : "";
if (
  !Number.isInteger(actualPlanPeriodTotalCents)
  || actualPlanPeriodTotalCents <= 0
  || !actualPeriodStartAt
  || !actualPeriodEndAt
  || Date.parse(actualPeriodEndAt) <= Date.parse(actualPeriodStartAt)
) {
  throw new Error("canonical Stripe period projection is invalid");
}
const metadata = quote.metadata && typeof quote.metadata === "object" ? quote.metadata as Record<string, unknown> : {};
const baseline = Number(metadata.stripe_customer_balance_before_cents);
const actual = await collectStripePlanChangeFinancialActual(stripe, {
  stripeSubscriptionId: String(projection.stripe_subscription_id),
  stripeCustomerId: String(projection.stripe_customer_id),
  mutationUnix,
  customerBalanceBeforeCents: Number.isFinite(baseline) ? baseline : null,
});
if (!actual) throw new Error("canonical Stripe financial actual not available");

if (!apply) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    quoteId,
    actual,
    actualPlanPeriodTotalCents,
    actualPeriodStartAt,
    actualPeriodEndAt,
  }, null, 2));
  process.exit(0);
}

const { data, error } = await supabase.rpc("reconcile_plan_change_stripe_financial_actual_v1", {
  p_quote_id: quoteId,
  p_stripe_subscription_id: projection.stripe_subscription_id,
  p_actual_source: actual.source,
  p_actual_amount_due_cents: actual.amountDueCents,
  p_actual_remaining_credit_cents: actual.remainingCreditCents,
  p_actual_proration_net_cents: actual.signedProrationNetCents,
  p_actual_plan_period_total_cents: actualPlanPeriodTotalCents,
  p_actual_period_start_at: actualPeriodStartAt,
  p_actual_period_end_at: actualPeriodEndAt,
  p_source_object_ids: actual.sourceObjectIds,
  p_reconciled_at: actual.reconciledAt,
});
if (error || !data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
  throw new Error("financial actual reconciliation failed");
}
console.log(JSON.stringify({ ok: true, dryRun: false, quoteId, actual, result: data }, null, 2));
