import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  pickLatestSubscriptionSnapshot,
  resolveCanonicalSubscriptionStatus,
  type StripeSubscriptionStatusSignal,
} from "./stripe-subscription-projection-state.ts";
import {
  loadStripeSubscriptionProjection,
  upsertStripeSubscriptionProjection,
} from "./stripe-subscription-projection.ts";

type Row = Record<string, unknown>;

export type StripeSubscriptionSnapshot = {
  stripe_subscription_id: string;
  stripe_customer_id: string;
  stripe_price_id: string | null;
  status: string;
  current_period_start: number | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
  billing_paused: boolean;
  pause_collection_behavior: string | null;
};

export type StripeSubscriptionWebhookCorrelation =
  | { action: "defer"; reason: "awaiting_billing_profile" }
  | { action: "reject"; reason: "stripe_customer_unknown" };

export type ReconcilePaidSubscriptionProjectionResult = {
  ok: true;
  recoveredCount: number;
  recoveryMetadataPatchedCount: number;
  projectionUpdated: boolean;
  canonicalStatus: string | null;
  appliedStatus: string | null;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function isoFromUnix(value: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

function receivedAtMs(value: unknown) {
  const parsed = Date.parse(readString(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildStripeSubscriptionSnapshot(subscription: Stripe.Subscription): StripeSubscriptionSnapshot {
  const customerRef = subscription.customer;
  const stripeCustomerId = typeof customerRef === "string"
    ? customerRef
    : readString(customerRef?.id);
  const pauseCollection = subscription.pause_collection;
  return {
    stripe_subscription_id: subscription.id,
    stripe_customer_id: stripeCustomerId,
    stripe_price_id: subscription.items.data[0]?.price?.id ?? null,
    status: subscription.status,
    current_period_start: subscription.current_period_start ?? null,
    current_period_end: subscription.current_period_end ?? null,
    cancel_at_period_end: subscription.cancel_at_period_end,
    billing_paused: Boolean(pauseCollection),
    pause_collection_behavior: pauseCollection?.behavior ?? null,
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
    billing_paused: row.billing_paused === true,
    pause_collection_behavior: readString(row.pause_collection_behavior) || null,
  };
}

function isRecoverableSubscriptionWebhookRow(row: Row) {
  const status = readString(row.status);
  const metadata = row.metadata_safe && typeof row.metadata_safe === "object"
    ? row.metadata_safe as Row
    : {};
  const error = readString(row.error_redacted) || readString(row.last_error_redacted);
  if (status === "retryable" || status === "failed") {
    return error.includes("not linked to an internal client")
      || readString(metadata.defer_reason) === "awaiting_billing_profile";
  }
  if (status === "processed") {
    return !readString(metadata.recovered_at)
      && (readString(metadata.defer_reason) === "awaiting_billing_profile"
        || error.includes("not linked to an internal client"));
  }
  return false;
}

async function loadSubscriptionProjectionLinkages(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  },
) {
  const { data: attempt } = await supabase
    .from("commercial_stripe_checkout_attempts")
    .select("commercial_checkout_session_id,client_account_entitlement_id,account_id,status")
    .eq("stripe_subscription_id", input.stripeSubscriptionId)
    .maybeSingle<Row>();

  const checkoutSessionId = readString(attempt?.commercial_checkout_session_id) || null;
  let commercialMode: string | null = null;
  let pricingSnapshotFingerprint: string | null = null;

  if (checkoutSessionId) {
    const { data: checkoutSession } = await supabase
      .from("commercial_checkout_sessions")
      .select("commercial_mode,pricing_snapshot")
      .eq("id", checkoutSessionId)
      .maybeSingle<Row>();
    commercialMode = readString(checkoutSession?.commercial_mode) === "outreach_only"
      ? "outreach_only"
      : (readString(checkoutSession?.commercial_mode) ? "full_cycle" : null);
    pricingSnapshotFingerprint = readString((checkoutSession?.pricing_snapshot as Row | null)?.version) || null;
  }

  let entitlementId = readString(attempt?.client_account_entitlement_id) || null;
  if (!entitlementId && checkoutSessionId) {
    const { data: entitlementRows } = await supabase
      .from("client_account_entitlements")
      .select("id")
      .eq("client_id", input.clientId)
      .eq("checkout_session_id", checkoutSessionId)
      .limit(1);
    entitlementId = readString(entitlementRows?.[0]?.id) || null;
  }

  return {
    checkoutFulfilled: readString(attempt?.status) === "fulfilled",
    commercialCheckoutSessionId: checkoutSessionId,
    clientAccountEntitlementId: entitlementId,
    accountId: readString(attempt?.account_id) || null,
    commercialMode,
    pricingMode: checkoutSessionId ? "public_catalog" : null,
    pricingSnapshotFingerprint,
  };
}

async function loadSubscriptionWebhookSignals(
  supabase: SupabaseClient,
  input: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  },
) {
  const { data: rows } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("event_type,status,received_at,processed_at,metadata_safe")
    .eq("stripe_customer_id", input.stripeCustomerId)
    .eq("stripe_subscription_id", input.stripeSubscriptionId)
    .in("event_type", [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ])
    .order("received_at", { ascending: true });

  const signals: StripeSubscriptionStatusSignal[] = [];
  const snapshots: StripeSubscriptionSnapshot[] = [];

  for (const row of rows ?? []) {
    const metadata = row.metadata_safe && typeof row.metadata_safe === "object"
      ? row.metadata_safe as Row
      : {};
    const snapshot = snapshotFromMetadata(metadata);
    if (snapshot) snapshots.push(snapshot);

    const eventType = readString(row.event_type);
    const status = snapshot?.status
      ?? (eventType === "customer.subscription.deleted" ? "canceled" : "");
    if (!status) continue;

    signals.push({
      status,
      receivedAtMs: receivedAtMs(row.received_at) || receivedAtMs(row.processed_at),
      source: eventType,
      isTerminalEvent: eventType === "customer.subscription.deleted",
    });
  }

  const { data: invoicePaidRows } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("id")
    .eq("stripe_customer_id", input.stripeCustomerId)
    .eq("event_type", "invoice.paid")
    .eq("status", "processed")
    .limit(1);

  return {
    signals,
    snapshots,
    invoicePaid: Boolean(invoicePaidRows?.length),
  };
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

  const { data: ledgerRows } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("id,event_type,status")
    .or([
      `stripe_customer_id.eq.${input.stripeCustomerId}`,
      `stripe_subscription_id.eq.${input.stripeSubscriptionId}`,
    ].join(","))
    .limit(10);

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

async function markWebhookEventsRecovered(
  supabase: SupabaseClient,
  rows: Row[],
  correlationBasis: string,
  recoveredVia = "checkout_fulfillment",
) {
  const nowIso = new Date().toISOString();
  let patched = 0;

  for (const row of rows) {
    const existing = row.metadata_safe && typeof row.metadata_safe === "object"
      ? row.metadata_safe as Record<string, unknown>
      : {};
    const eventRowId = readString(row.id);
    if (!eventRowId) continue;

    await supabase
      .from("commercial_stripe_webhook_events")
      .update({
        status: "processed",
        processed_at: readString(row.processed_at) || nowIso,
        error_redacted: null,
        last_error_redacted: null,
        metadata_safe: {
          ...existing,
          recovered_at: readString(existing.recovered_at) || nowIso,
          recovered_via: readString(existing.recovered_via) || recoveredVia,
          correlation_basis: readString(existing.correlation_basis) || correlationBasis,
        },
      })
      .eq("id", eventRowId);
    patched += 1;
  }

  return patched;
}

export async function reconcilePaidStripeSubscriptionProjection(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    correlationBasis?: string;
    incomingSnapshot?: StripeSubscriptionSnapshot | null;
    incomingIsTerminalEvent?: boolean;
  },
): Promise<ReconcilePaidSubscriptionProjectionResult> {
  const correlationBasis = input.correlationBasis ?? "checkout_fulfillment";
  const linkages = await loadSubscriptionProjectionLinkages(supabase, input);
  const ledger = await loadSubscriptionWebhookSignals(supabase, input);

  if (input.incomingSnapshot) {
    ledger.signals.push({
      status: input.incomingSnapshot.status,
      receivedAtMs: Date.now(),
      source: "incoming_webhook_snapshot",
      isTerminalEvent: input.incomingIsTerminalEvent,
    });
    ledger.snapshots.push(input.incomingSnapshot);
  }

  const canonicalStatus = resolveCanonicalSubscriptionStatus(ledger.signals, {
    checkoutFulfilled: linkages.checkoutFulfilled,
    invoicePaid: ledger.invoicePaid,
  });

  const latestSnapshot = pickLatestSubscriptionSnapshot(ledger.snapshots);
  const existing = await loadStripeSubscriptionProjection(supabase, input.stripeSubscriptionId);

  let projectionUpdated = false;
  let appliedStatus: string | null = existing ? readString(existing.status) : null;

  if (latestSnapshot || canonicalStatus || existing) {
    const upsertResult = await upsertStripeSubscriptionProjection(supabase, {
      clientId: input.clientId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeCustomerId: input.stripeCustomerId,
      stripePriceId: (latestSnapshot?.stripe_price_id ?? readString(existing?.stripe_price_id)) || null,
      clientAccountEntitlementId: linkages.clientAccountEntitlementId,
      accountId: linkages.accountId || readString(existing?.account_id) || null,
      commercialCheckoutSessionId: linkages.commercialCheckoutSessionId,
      commercialMode: linkages.commercialMode,
      pricingMode: linkages.pricingMode,
      pricingSnapshotFingerprint: linkages.pricingSnapshotFingerprint,
      status: canonicalStatus,
      currentPeriodStart: isoFromUnix(latestSnapshot?.current_period_start ?? null),
      currentPeriodEnd: isoFromUnix(latestSnapshot?.current_period_end ?? null),
      cancelAtPeriodEnd: latestSnapshot?.cancel_at_period_end ?? existing?.cancel_at_period_end === true,
      billingPaused: latestSnapshot?.billing_paused ?? existing?.billing_paused === true,
      pauseCollectionBehavior: (latestSnapshot?.pause_collection_behavior
        ?? readString(existing?.pause_collection_behavior)) || null,
      incomingIsTerminalEvent: input.incomingIsTerminalEvent,
    });
    projectionUpdated = true;
    appliedStatus = upsertResult.appliedStatus;
  }

  const { data: recoverableRows } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("id,event_type,status,metadata_safe,error_redacted,last_error_redacted,processed_at")
    .in("event_type", ["customer.subscription.created", "customer.subscription.updated"])
    .eq("stripe_customer_id", input.stripeCustomerId)
    .eq("stripe_subscription_id", input.stripeSubscriptionId)
    .order("received_at", { ascending: true });

  const recoverable = (recoverableRows ?? []).filter((row) => isRecoverableSubscriptionWebhookRow(row as Row));
  const recoveredCount = recoverable.filter((row) => ["failed", "retryable"].includes(readString(row.status))).length;
  const recoveryMetadataPatchedCount = await markWebhookEventsRecovered(
    supabase,
    recoverable,
    correlationBasis,
  );

  return {
    ok: true,
    recoveredCount,
    recoveryMetadataPatchedCount,
    projectionUpdated,
    canonicalStatus,
    appliedStatus,
  };
}

export async function reconcileDeferredStripeSubscriptionWebhookEvents(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  },
) {
  const result = await reconcilePaidStripeSubscriptionProjection(supabase, {
    ...input,
    correlationBasis: "deferred_subscription_webhook_recovery",
  });
  return { ok: true as const, recoveredCount: result.recoveredCount, recoveryMetadataPatchedCount: result.recoveryMetadataPatchedCount };
}

export async function patchSubscriptionWebhookRecoveryMetadata(
  supabase: SupabaseClient,
  input: {
    stripeEventIds: string[];
    correlationBasis: string;
    recoveredVia?: string;
  },
) {
  const { data: rows } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("id,stripe_event_id,event_type,status,metadata_safe,processed_at")
    .in("stripe_event_id", input.stripeEventIds);

  const matched = (rows ?? []).filter((row) => readString(row.stripe_event_id));
  if (matched.length !== input.stripeEventIds.length) {
    throw new Error("Expected subscription webhook events were not found for recovery metadata patch");
  }

  return markWebhookEventsRecovered(
    supabase,
    matched as Row[],
    input.correlationBasis,
    input.recoveredVia ?? "solomon_handoff_repair",
  );
}

export async function planPaidStripeSubscriptionProjectionRepair(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripeEventIds?: string[];
  },
) {
  const existing = await loadStripeSubscriptionProjection(supabase, input.stripeSubscriptionId);
  const linkages = await loadSubscriptionProjectionLinkages(supabase, input);
  const ledger = await loadSubscriptionWebhookSignals(supabase, input);
  const canonicalStatus = resolveCanonicalSubscriptionStatus(ledger.signals, {
    checkoutFulfilled: linkages.checkoutFulfilled,
    invoicePaid: ledger.invoicePaid,
  });
  const latestSnapshot = pickLatestSubscriptionSnapshot(ledger.snapshots);

  let eventRows: Row[] = [];
  if (input.stripeEventIds?.length) {
    const { data } = await supabase
      .from("commercial_stripe_webhook_events")
      .select("id,stripe_event_id,event_type,status,metadata_safe,error_redacted,last_error_redacted")
      .in("stripe_event_id", input.stripeEventIds);
    eventRows = (data ?? []) as Row[];
  }

  const recoveryPatches = eventRows.map((row) => {
    const existingMetadata = row.metadata_safe && typeof row.metadata_safe === "object"
      ? row.metadata_safe as Row
      : {};
    return {
      stripe_event_id: readString(row.stripe_event_id),
      current_status: readString(row.status),
      metadata_safe_patch: {
        ...existingMetadata,
        recovered_at: readString(existingMetadata.recovered_at) || "<planned>",
        recovered_via: readString(existingMetadata.recovered_via) || "solomon_handoff_repair",
        correlation_basis: readString(existingMetadata.correlation_basis) || "solomon_stripe_test_checkout",
      },
    };
  });

  return {
    before: {
      projection_status: readString(existing?.status) || null,
      commercial_checkout_session_id: readString(existing?.commercial_checkout_session_id) || null,
      client_account_entitlement_id: readString(existing?.client_account_entitlement_id) || null,
    },
    planned: {
      canonical_status: canonicalStatus,
      commercial_checkout_session_id: linkages.commercialCheckoutSessionId,
      client_account_entitlement_id: linkages.clientAccountEntitlementId,
      stripe_price_id: (latestSnapshot?.stripe_price_id ?? readString(existing?.stripe_price_id)) || null,
      current_period_start: isoFromUnix(latestSnapshot?.current_period_start ?? null),
      current_period_end: isoFromUnix(latestSnapshot?.current_period_end ?? null),
      cancel_at_period_end: latestSnapshot?.cancel_at_period_end ?? false,
      webhook_recovery_metadata_patches: recoveryPatches,
    },
  };
}
