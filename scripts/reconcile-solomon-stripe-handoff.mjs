#!/usr/bin/env node
/**
 * Dry-run / apply repair for Solomon Stripe Test handoff.
 *
 * Usage:
 *   node scripts/reconcile-solomon-stripe-handoff.mjs
 *   GO=1 node scripts/reconcile-solomon-stripe-handoff.mjs --apply
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 * Never calls Stripe APIs.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { reconcileDeferredStripeSubscriptionWebhookEvents } from "../lib/commercial/stripe/stripe-subscription-webhook-reconciliation.ts";

const SOLOMON_CLIENT_ID = "4a9b1a8c-6eb0-46d0-a1fc-821f38e1e031";
const SOLOMON_CHECKOUT_SESSION_ID = "1cb0f986-f7cd-4aa9-a843-4ee2b5e06eb7";
const SOLOMON_STRIPE_CUSTOMER_ID = "cus_UpBSUX1rBbj80E";
const SOLOMON_STRIPE_SUBSCRIPTION_ID = "sub_1TpX5EFdctrIt9kb7N9lIe9j";
const SOLOMON_FAILED_EVENT_IDS = [
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

  const { data: failedEvents } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("id,stripe_event_id,event_type,status,stripe_customer_id,stripe_subscription_id,error_redacted")
    .in("stripe_event_id", SOLOMON_FAILED_EVENT_IDS);
  if ((failedEvents ?? []).length !== SOLOMON_FAILED_EVENT_IDS.length) {
    throw new Error("Expected Solomon failed subscription webhook events were not found");
  }

  const { data: subscription } = await supabase
    .from("client_subscriptions")
    .select("id,metadata")
    .eq("client_id", SOLOMON_CLIENT_ID)
    .eq("status", "active")
    .maybeSingle();

  return { client, checkoutSession, attempt, failedEvents: failedEvents ?? [], subscription };
}

function provenancePatch(scope) {
  const clientMetadata = {
    ...(scope.client.metadata ?? {}),
    checkout_source: "stripe_test",
  };
  const subscriptionMetadata = {
    ...(scope.subscription?.metadata ?? {}),
    source: "stripe_test",
  };
  const checkoutMetadata = {
    ...(scope.checkoutSession.metadata ?? {}),
    checkout_source: "stripe_test",
    mode: "stripe_test",
  };
  return { clientMetadata, subscriptionMetadata, checkoutMetadata };
}

async function main() {
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const scope = await loadScope(supabase);
  const patch = provenancePatch(scope);

  const before = {
    failedWebhookEvents: scope.failedEvents.length,
    clientCheckoutSource: readString(scope.client.metadata?.checkout_source),
    subscriptionSource: readString(scope.subscription?.metadata?.source),
    checkoutSessionSource: readString(scope.checkoutSession.metadata?.checkout_source),
  };

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scope: {
      client_id: SOLOMON_CLIENT_ID,
      checkout_session_id: SOLOMON_CHECKOUT_SESSION_ID,
      stripe_customer_id: SOLOMON_STRIPE_CUSTOMER_ID,
      stripe_subscription_id: SOLOMON_STRIPE_SUBSCRIPTION_ID,
      failed_event_ids: SOLOMON_FAILED_EVENT_IDS,
    },
    before,
    planned: {
      reconcileDeferredStripeSubscriptionWebhookEvents: {
        clientId: SOLOMON_CLIENT_ID,
        stripeCustomerId: SOLOMON_STRIPE_CUSTOMER_ID,
        stripeSubscriptionId: SOLOMON_STRIPE_SUBSCRIPTION_ID,
      },
      provenance_updates: patch,
    },
  }, null, 2));

  if (!apply) {
    console.error("Dry-run only. Set GO=1 and pass --apply to execute.");
    return;
  }

  if (process.env.GO !== "1") {
    throw new Error("Refusing apply without GO=1");
  }

  const reconcile = await reconcileDeferredStripeSubscriptionWebhookEvents(supabase, {
    clientId: SOLOMON_CLIENT_ID,
    stripeCustomerId: SOLOMON_STRIPE_CUSTOMER_ID,
    stripeSubscriptionId: SOLOMON_STRIPE_SUBSCRIPTION_ID,
  });

  const { error: clientUpdateError } = await supabase
    .from("clients")
    .update({ metadata: patch.clientMetadata })
    .eq("id", SOLOMON_CLIENT_ID);
  if (clientUpdateError) throw clientUpdateError;

  if (scope.subscription?.id) {
    const { error: subscriptionUpdateError } = await supabase
      .from("client_subscriptions")
      .update({ metadata: patch.subscriptionMetadata })
      .eq("id", scope.subscription.id);
    if (subscriptionUpdateError) throw subscriptionUpdateError;
  }

  const { error: checkoutUpdateError } = await supabase
    .from("commercial_checkout_sessions")
    .update({ metadata: patch.checkoutMetadata })
    .eq("id", SOLOMON_CHECKOUT_SESSION_ID)
    .eq("client_id", SOLOMON_CLIENT_ID);
  if (checkoutUpdateError) throw checkoutUpdateError;

  const afterScope = await loadScope(supabase);
  console.log(JSON.stringify({
    mode: "apply",
    recovered_webhook_events: reconcile.recoveredCount,
    after: {
      failedWebhookEvents: afterScope.failedEvents.filter((row) => row.status !== "processed").length,
      clientCheckoutSource: readString(afterScope.client.metadata?.checkout_source),
      subscriptionSource: readString(afterScope.subscription?.metadata?.source),
      checkoutSessionSource: readString(afterScope.checkoutSession.metadata?.checkout_source),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
