#!/usr/bin/env node
/**
 * Dry-run / apply repair for Solomon Stripe Test handoff (P0.2 projection coherence).
 *
 * Usage:
 *   node scripts/reconcile-solomon-stripe-handoff.mjs
 *   GO=1 node scripts/reconcile-solomon-stripe-handoff.mjs --apply
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 * Never calls Stripe APIs. Never mutates client_subscriptions or entitlements.
 */
import { createClient } from "@supabase/supabase-js";
import {
  patchSubscriptionWebhookRecoveryMetadata,
  planPaidStripeSubscriptionProjectionRepair,
  reconcilePaidStripeSubscriptionProjection,
} from "../lib/commercial/stripe/stripe-subscription-webhook-reconciliation.ts";
import { loadStripeSubscriptionProjection } from "../lib/commercial/stripe/stripe-subscription-projection.ts";

const SOLOMON_CLIENT_ID = "4a9b1a8c-6eb0-46d0-a1fc-821f38e1e031";
const SOLOMON_CHECKOUT_SESSION_ID = "1cb0f986-f7cd-4aa9-a843-4ee2b5e06eb7";
const SOLOMON_STRIPE_CUSTOMER_ID = "cus_UpBSUX1rBbj80E";
const SOLOMON_STRIPE_SUBSCRIPTION_ID = "sub_1TpX5EFdctrIt9kb7N9lIe9j";
const SOLOMON_SUBSCRIPTION_EVENT_IDS = [
  "evt_1TpX5HFdctrIt9kbbYqas6uw",
  "evt_1TpX5IFdctrIt9kbfzUUCTz7",
];

const apply = process.argv.includes("--apply");

function readString(value, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function requireEnv(name) {
  const value = readString(process.env[name]);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function loadScope(supabase) {
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id,name,metadata")
    .eq("id", SOLOMON_CLIENT_ID)
    .maybeSingle();
  if (clientError || !client?.id) throw new Error("Solomon client scope not found");

  const { data: checkoutSession } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,status,metadata,client_id")
    .eq("id", SOLOMON_CHECKOUT_SESSION_ID)
    .maybeSingle();
  if (!checkoutSession?.id || readString(checkoutSession.client_id) !== SOLOMON_CLIENT_ID) {
    throw new Error("Solomon checkout session scope mismatch");
  }

  const { data: attempt } = await supabase
    .from("commercial_stripe_checkout_attempts")
    .select("id,status,stripe_checkout_session_id,stripe_customer_id,stripe_subscription_id,commercial_checkout_session_id")
    .eq("commercial_checkout_session_id", SOLOMON_CHECKOUT_SESSION_ID)
    .maybeSingle();
  if (!attempt?.id || attempt.status !== "fulfilled") {
    throw new Error("Solomon checkout attempt is not fulfilled");
  }
  if (
    readString(attempt.stripe_customer_id) !== SOLOMON_STRIPE_CUSTOMER_ID
    || readString(attempt.stripe_subscription_id) !== SOLOMON_STRIPE_SUBSCRIPTION_ID
  ) {
    throw new Error("Solomon attempt Stripe identifiers mismatch locked scope");
  }

  const { data: subscriptionEvents } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("id,stripe_event_id,event_type,status,metadata_safe,stripe_customer_id,stripe_subscription_id")
    .in("stripe_event_id", SOLOMON_SUBSCRIPTION_EVENT_IDS);
  if ((subscriptionEvents ?? []).length !== SOLOMON_SUBSCRIPTION_EVENT_IDS.length) {
    throw new Error("Expected Solomon subscription webhook events were not found");
  }
  for (const row of subscriptionEvents ?? []) {
    if (
      readString(row.stripe_customer_id) !== SOLOMON_STRIPE_CUSTOMER_ID
      || readString(row.stripe_subscription_id) !== SOLOMON_STRIPE_SUBSCRIPTION_ID
    ) {
      throw new Error("Solomon subscription webhook event scope collision");
    }
  }

  const stripeProjection = await loadStripeSubscriptionProjection(supabase, SOLOMON_STRIPE_SUBSCRIPTION_ID);
  if (stripeProjection && readString(stripeProjection.client_id) !== SOLOMON_CLIENT_ID) {
    throw new Error("Solomon stripe projection client scope collision");
  }

  const { count: duplicateCount } = await supabase
    .from("commercial_stripe_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("stripe_subscription_id", SOLOMON_STRIPE_SUBSCRIPTION_ID);
  if ((duplicateCount ?? 0) > 1) {
    throw new Error("Multiple stripe subscription projections detected for Solomon scope");
  }

  return { client, checkoutSession, attempt, subscriptionEvents: subscriptionEvents ?? [], stripeProjection };
}

async function main() {
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const scope = await loadScope(supabase);
  const repairPlan = await planPaidStripeSubscriptionProjectionRepair(supabase, {
    clientId: SOLOMON_CLIENT_ID,
    stripeCustomerId: SOLOMON_STRIPE_CUSTOMER_ID,
    stripeSubscriptionId: SOLOMON_STRIPE_SUBSCRIPTION_ID,
    stripeEventIds: SOLOMON_SUBSCRIPTION_EVENT_IDS,
  });

  const before = {
    stripe_projection_status: readString(scope.stripeProjection?.status) || null,
    stripe_projection_checkout_session_id: readString(scope.stripeProjection?.commercial_checkout_session_id) || null,
    stripe_projection_entitlement_id: readString(scope.stripeProjection?.client_account_entitlement_id) || null,
    webhook_events_missing_recovery_trace: scope.subscriptionEvents.filter((row) => {
      const metadata = row.metadata_safe && typeof row.metadata_safe === "object" ? row.metadata_safe : {};
      return !readString(metadata.recovered_at);
    }).length,
    client_checkout_source: readString(scope.client.metadata?.checkout_source),
    checkout_session_checkout_source: readString(scope.checkoutSession.metadata?.checkout_source),
  };

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scope: {
      client_id: SOLOMON_CLIENT_ID,
      checkout_session_id: SOLOMON_CHECKOUT_SESSION_ID,
      stripe_customer_id: SOLOMON_STRIPE_CUSTOMER_ID,
      stripe_subscription_id: SOLOMON_STRIPE_SUBSCRIPTION_ID,
      subscription_event_ids: SOLOMON_SUBSCRIPTION_EVENT_IDS,
    },
    before,
    planned: repairPlan,
  }, null, 2));

  if (!apply) {
    console.error("Dry-run only. Set GO=1 and pass --apply to execute.");
    return;
  }

  if (process.env.GO !== "1") {
    throw new Error("Refusing apply without GO=1");
  }

  await loadScope(supabase);

  const reconcile = await reconcilePaidStripeSubscriptionProjection(supabase, {
    clientId: SOLOMON_CLIENT_ID,
    stripeCustomerId: SOLOMON_STRIPE_CUSTOMER_ID,
    stripeSubscriptionId: SOLOMON_STRIPE_SUBSCRIPTION_ID,
    correlationBasis: "solomon_stripe_test_checkout",
  });

  const recoveryMetadataPatchedCount = await patchSubscriptionWebhookRecoveryMetadata(supabase, {
    stripeEventIds: SOLOMON_SUBSCRIPTION_EVENT_IDS,
    correlationBasis: "solomon_stripe_test_checkout",
    recoveredVia: "solomon_handoff_repair",
  });

  const afterProjection = await loadStripeSubscriptionProjection(supabase, SOLOMON_STRIPE_SUBSCRIPTION_ID);
  const afterScope = await loadScope(supabase);

  console.log(JSON.stringify({
    mode: "apply",
    reconcile,
    recovery_metadata_patched_count: recoveryMetadataPatchedCount,
    after: {
      stripe_projection_status: readString(afterProjection?.status) || null,
      stripe_projection_checkout_session_id: readString(afterProjection?.commercial_checkout_session_id) || null,
      stripe_projection_entitlement_id: readString(afterProjection?.client_account_entitlement_id) || null,
      webhook_events_missing_recovery_trace: afterScope.subscriptionEvents.filter((row) => {
        const metadata = row.metadata_safe && typeof row.metadata_safe === "object" ? row.metadata_safe : {};
        return !readString(metadata.recovered_at);
      }).length,
      client_checkout_source: readString(afterScope.client.metadata?.checkout_source),
      checkout_session_checkout_source: readString(afterScope.checkoutSession.metadata?.checkout_source),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
