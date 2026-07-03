import type { SupabaseClient } from "@supabase/supabase-js";
import { assertStripeTestLivemode } from "./stripe-config.ts";

type Row = Record<string, unknown>;

export async function beginStripeWebhookEvent(
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
) {
  assertStripeTestLivemode(input.livemode);

  const { data: existing, error: lookupError } = await supabase
    .from("commercial_stripe_webhook_events")
    .select("id,status")
    .eq("stripe_event_id", input.stripeEventId)
    .maybeSingle<Row>();

  if (lookupError) {
    return { ok: false as const, code: "webhook_ledger_unavailable" as const };
  }

  if (existing?.id) {
    return {
      ok: true as const,
      deduplicated: true as const,
      eventRowId: String(existing.id),
      status: String(existing.status ?? "processed"),
    };
  }

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
    })
    .select("id")
    .single<Row>();

  if (error || !data?.id) {
    if (error?.code === "23505") {
      return { ok: true as const, deduplicated: true as const, eventRowId: null, status: "processed" };
    }
    return { ok: false as const, code: "webhook_ledger_unavailable" as const };
  }

  return {
    ok: true as const,
    deduplicated: false as const,
    eventRowId: String(data.id),
    status: "processing",
  };
}

export async function finishStripeWebhookEvent(
  supabase: SupabaseClient,
  input: {
    eventRowId: string;
    status: "processed" | "ignored" | "failed";
    errorRedacted?: string | null;
  },
) {
  await supabase
    .from("commercial_stripe_webhook_events")
    .update({
      status: input.status,
      processed_at: new Date().toISOString(),
      error_redacted: input.errorRedacted ? String(input.errorRedacted).slice(0, 500) : null,
    })
    .eq("id", input.eventRowId);
}
