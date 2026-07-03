import type { SupabaseClient } from "@supabase/supabase-js";
import { assertStripeTestLivemode } from "./stripe-config.ts";
import {
  resolveWebhookClaimDecision,
  STRIPE_WEBHOOK_PROCESSING_STALE_MS,
  mapWebhookRpcClaimResult,
} from "./stripe-webhook-claim.ts";

type Row = Record<string, unknown>;

export type WebhookLedgerClaimResult =
  | { ok: true; deduplicated: true; eventRowId: string | null }
  | { ok: true; deduplicated: false; eventRowId: string; reclaimed?: boolean }
  | { ok: false; code: "webhook_ledger_unavailable" | "webhook_concurrent_processing"; status: number };

export type WebhookLedgerFinishStatus = "processed" | "ignored" | "failed" | "retryable";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

async function claimWebhookEventViaRpc(
  supabase: SupabaseClient,
  input: {
    stripeEventId: string;
    eventType: string;
    livemode: boolean;
    stripeObjectId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeCheckoutSessionId?: string | null;
    metadataSafe?: Record<string, unknown>;
  },
): Promise<WebhookLedgerClaimResult | null> {
  const { data, error } = await supabase.rpc("claim_commercial_stripe_webhook_event", {
    p_stripe_event_id: input.stripeEventId,
    p_event_type: input.eventType,
    p_livemode: input.livemode,
    p_stripe_object_id: input.stripeObjectId ?? null,
    p_stripe_customer_id: input.stripeCustomerId ?? null,
    p_stripe_subscription_id: input.stripeSubscriptionId ?? null,
    p_stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
    p_metadata_safe: input.metadataSafe ?? {},
    p_stale_after_seconds: Math.floor(STRIPE_WEBHOOK_PROCESSING_STALE_MS / 1000),
  });

  if (error) {
    if (readString(error.message).includes("stripe_livemode_rejected")) {
      throw error;
    }
    return null;
  }

  const row = Array.isArray(data) ? data[0] as Row | undefined : data as Row | null;
  if (!row) {
    return { ok: false, code: "webhook_ledger_unavailable", status: 503 };
  }

  const claimResult = mapWebhookRpcClaimResult(readString(row.claim_result));
  const eventRowId = readString(row.event_row_id) || null;

  if (claimResult === "deduplicated") {
    return { ok: true, deduplicated: true, eventRowId };
  }
  if (claimResult === "concurrent_retry") {
    return { ok: false, code: "webhook_concurrent_processing", status: 503 };
  }
  if (!eventRowId) {
    return { ok: false, code: "webhook_ledger_unavailable", status: 503 };
  }

  return {
    ok: true,
    deduplicated: false,
    eventRowId,
    reclaimed: claimResult === "reclaim_stale",
  };
}

async function claimWebhookEventFallback(
  supabase: SupabaseClient,
  input: {
    stripeEventId: string;
    eventType: string;
    livemode: boolean;
    stripeObjectId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeCheckoutSessionId?: string | null;
    metadataSafe?: Record<string, unknown>;
  },
): Promise<WebhookLedgerClaimResult> {
  const { data: existing, error: lookupError } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("id,status,processing_started_at")
    .eq("stripe_event_id", input.stripeEventId)
    .maybeSingle<Row>();

  if (lookupError) {
    return { ok: false, code: "webhook_ledger_unavailable", status: 503 };
  }

  const nowIso = new Date().toISOString();
  const decision = resolveWebhookClaimDecision(
    existing?.status
      ? {
          status: readString(existing.status),
          processingStartedAtMs: existing.processing_started_at
            ? Date.parse(String(existing.processing_started_at))
            : null,
        }
      : null,
    Date.now(),
  );

  if (decision.action === "deduplicated") {
    return { ok: true, deduplicated: true, eventRowId: readString(existing?.id) || null };
  }

  if (decision.action === "concurrent_retry") {
    return { ok: false, code: "webhook_concurrent_processing", status: 503 };
  }

  if (decision.action === "insert") {
    const { data, error } = await supabase
      .from("commercial_stripe_webhook_events")
      .insert({
        stripe_event_id: input.stripeEventId,
        event_type: input.eventType,
        livemode: false,
        status: "processing",
        stripe_object_id: input.stripeObjectId ?? null,
        stripe_customer_id: input.stripeCustomerId ?? null,
        stripe_subscription_id: input.stripeSubscriptionId ?? null,
        stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
        metadata_safe: input.metadataSafe ?? {},
        processing_started_at: nowIso,
        attempts_count: 1,
      })
      .select("id")
      .single<Row>();

    if (error || !data?.id) {
      if (error?.code === "23505") {
        return claimWebhookEventFallback(supabase, input);
      }
      return { ok: false, code: "webhook_ledger_unavailable", status: 503 };
    }

    return { ok: true, deduplicated: false, eventRowId: readString(data.id) };
  }

  const eventRowId = readString(existing?.id);
  if (!eventRowId) {
    return { ok: false, code: "webhook_ledger_unavailable", status: 503 };
  }

  const { error: updateError } = await supabase
    .from("commercial_stripe_webhook_events")
    .update({
      status: "processing",
      processing_started_at: nowIso,
      attempts_count: Number(existing?.attempts_count ?? 0) + 1,
      event_type: input.eventType,
      stripe_object_id: input.stripeObjectId ?? null,
      stripe_customer_id: input.stripeCustomerId ?? null,
      stripe_subscription_id: input.stripeSubscriptionId ?? null,
      stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
      metadata_safe: input.metadataSafe ?? {},
      last_error_redacted: null,
      processed_at: null,
      error_redacted: null,
    })
    .eq("id", eventRowId)
    .in("status", ["failed", "retryable", "received", "processing"]);

  if (updateError) {
    return { ok: false, code: "webhook_ledger_unavailable", status: 503 };
  }

  return {
    ok: true,
    deduplicated: false,
    eventRowId,
    reclaimed: decision.action === "reclaim_stale",
  };
}

export async function claimStripeWebhookEvent(
  supabase: SupabaseClient,
  input: {
    stripeEventId: string;
    eventType: string;
    livemode: boolean;
    stripeObjectId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeCheckoutSessionId?: string | null;
    metadataSafe?: Record<string, unknown>;
  },
): Promise<WebhookLedgerClaimResult> {
  assertStripeTestLivemode(input.livemode);

  const rpcClaim = await claimWebhookEventViaRpc(supabase, input);
  if (rpcClaim) {
    return rpcClaim;
  }
  return claimWebhookEventFallback(supabase, input);
}

export async function finishStripeWebhookEvent(
  supabase: SupabaseClient,
  input: {
    eventRowId: string;
    status: WebhookLedgerFinishStatus;
    errorRedacted?: string | null;
  },
) {
  const redacted = input.errorRedacted ? String(input.errorRedacted).slice(0, 500) : null;
  await supabase
    .from("commercial_stripe_webhook_events")
    .update({
      status: input.status,
      processed_at: new Date().toISOString(),
      error_redacted: redacted,
      last_error_redacted: redacted,
      processing_started_at: null,
    })
    .eq("id", input.eventRowId);
}

// Backward-compatible alias used by older imports during transition.
export const beginStripeWebhookEvent = claimStripeWebhookEvent;
