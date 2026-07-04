import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { upsertStripeSubscriptionProjection } from "./stripe-subscription-projection.ts";

type Row = Record<string, unknown>;

export type StripeSubscriptionSnapshot = {
  stripe_subscription_id: string;
  stripe_customer_id: string;
  stripe_price_id: string | null;
  status: string;
  current_period_start: number | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
};

export type StripeSubscriptionWebhookCorrelation =
  | { action: "defer"; reason: "awaiting_billing_profile" }
  | { action: "reject"; reason: "stripe_customer_unknown" };

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export function buildStripeSubscriptionSnapshot(subscription: Stripe.Subscription): StripeSubscriptionSnapshot {
  const customerRef = subscription.customer;
  const stripeCustomerId = typeof customerRef === "string"
    ? customerRef
    : readString(customerRef?.id);
  return {
    stripe_subscription_id: subscription.id,
    stripe_customer_id: stripeCustomerId,
    stripe_price_id: subscription.items.data[0]?.price?.id ?? null,
    status: subscription.status,
    current_period_start: subscription.current_period_start ?? null,
    current_period_end: subscription.current_period_end ?? null,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };
}

function snapshotFromMetadata(metadataSafe: unknown): StripeSubscriptionSnapshot | null {
  if (!metadataSafe || typeof metadataSafe !== "object") return null;
  const snapshot = (metadataSafe as Row).subscription_snapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const row = snapshot as Row;
  const subscriptionId = readString(row.stripe_subscription_id);
  const customerId = readString(row.stripe_customer_id);
  if (!subscriptionId || !customerId) return null;
  return {
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    stripe_price_id: readString(row.stripe_price_id) || null,
    status: readString(row.status, "active"),
    current_period_start: typeof row.current_period_start === "number" ? row.current_period_start : null,
    current_period_end: typeof row.current_period_end === "number" ? row.current_period_end : null,
    cancel_at_period_end: row.cancel_at_period_end === true,
  };
}

function isoFromUnix(value: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

export async function resolveStripeSubscriptionWebhookCorrelation(
  supabase: SupabaseClient,
  input: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    excludeEventRowId?: string | null;
  },
): Promise<StripeSubscriptionWebhookCorrelation> {
  if (!input.stripeCustomerId || !input.stripeSubscriptionId) {
    return { action: "reject", reason: "stripe_customer_unknown" };
  }

  const { data: attemptRows } = await supabase
    .from("commercial_stripe_checkout_attempts")
    .select("id,status")
    .or([
      `stripe_customer_id.eq.${input.stripeCustomerId}`,
      `stripe_subscription_id.eq.${input.stripeSubscriptionId}`,
    ].join(","))
    .limit(1);

  const attempt = attemptRows?.[0];
  if (attempt?.id && !["expired", "cancelled", "failed"].includes(readString(attempt.status))) {
    return { action: "defer", reason: "awaiting_billing_profile" };
  }

  let ledgerQuery = supabase
    .from("commercial_stripe_webhook_events")
    .select("id,event_type,status")
    .or([
      `stripe_customer_id.eq.${input.stripeCustomerId}`,
      `stripe_subscription_id.eq.${input.stripeSubscriptionId}`,
    ].join(","))
    .limit(10);

  const { data: ledgerRows } = await ledgerQuery;
  const related = (ledgerRows ?? []).filter((row) => readString(row.id) !== readString(input.excludeEventRowId));
  if (related.some((row) => readString(row.event_type) === "checkout.session.completed")) {
    return { action: "defer", reason: "awaiting_billing_profile" };
  }
  if (related.length > 0) {
    return { action: "defer", reason: "awaiting_billing_profile" };
  }

  return { action: "reject", reason: "stripe_customer_unknown" };
}

export async function patchStripeWebhookEventMetadata(
  supabase: SupabaseClient,
  eventRowId: string,
  metadataPatch: Record<string, unknown>,
) {
  const { data } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("metadata_safe")
    .eq("id", eventRowId)
    .maybeSingle<Row>();
  const existing = data?.metadata_safe && typeof data.metadata_safe === "object"
    ? data.metadata_safe as Record<string, unknown>
    : {};
  await supabase
    .from("commercial_stripe_webhook_events")
    .update({
      metadata_safe: {
        ...existing,
        ...metadataPatch,
      },
    })
    .eq("id", eventRowId);
}

export async function reconcileDeferredStripeSubscriptionWebhookEvents(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  },
) {
  const { data: deferredEvents } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("id,event_type,status,metadata_safe,error_redacted,last_error_redacted")
    .in("status", ["retryable", "failed"])
    .in("event_type", ["customer.subscription.created", "customer.subscription.updated"])
    .eq("stripe_customer_id", input.stripeCustomerId)
    .eq("stripe_subscription_id", input.stripeSubscriptionId)
    .order("received_at", { ascending: true });

  const recoverable = (deferredEvents ?? []).filter((row) => {
    const error = readString(row.error_redacted) || readString(row.last_error_redacted);
    return error.includes("not linked to an internal client")
      || readString((row.metadata_safe as Row | undefined)?.defer_reason) === "awaiting_billing_profile";
  });

  if (!recoverable.length) {
    return { ok: true as const, recoveredCount: 0 };
  }

  const snapshots = recoverable
    .map((row) => snapshotFromMetadata(row.metadata_safe))
    .filter((snapshot): snapshot is StripeSubscriptionSnapshot => snapshot != null);
  const latestSnapshot = snapshots.at(-1) ?? null;

  if (latestSnapshot) {
    await upsertStripeSubscriptionProjection(supabase, {
      clientId: input.clientId,
      stripeSubscriptionId: latestSnapshot.stripe_subscription_id,
      stripeCustomerId: latestSnapshot.stripe_customer_id,
      stripePriceId: latestSnapshot.stripe_price_id,
      status: latestSnapshot.status,
      currentPeriodStart: isoFromUnix(latestSnapshot.current_period_start),
      currentPeriodEnd: isoFromUnix(latestSnapshot.current_period_end),
      cancelAtPeriodEnd: latestSnapshot.cancel_at_period_end,
    });
  }

  const nowIso = new Date().toISOString();
  for (const row of recoverable) {
    const existing = row.metadata_safe && typeof row.metadata_safe === "object"
      ? row.metadata_safe as Record<string, unknown>
      : {};
    await supabase
      .from("commercial_stripe_webhook_events")
      .update({
        status: "processed",
        processed_at: nowIso,
        error_redacted: null,
        last_error_redacted: null,
        metadata_safe: {
          ...existing,
          recovered_at: nowIso,
          recovered_via: "checkout_fulfillment",
        },
      })
      .eq("id", readString(row.id));
  }

  return { ok: true as const, recoveredCount: recoverable.length };
}
