import { readJsonBody, jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { requireInstagramAdmin } from "@/app/api/instagram-dashboard/_utils";
import { createStripeSubscriptionCheckoutSession } from "@/lib/commercial/stripe/stripe-subscription-checkout.ts";
import { StripeFoundationError } from "@/lib/commercial/stripe/stripe-config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export async function POST(request: Request) {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return unauthorized;

  try {
    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body) {
      return jsonError("Invalid Stripe test checkout payload.", 400, { code: "invalid_payload" });
    }
    const origin = new URL(request.url).origin;
    const result = await createStripeSubscriptionCheckoutSession(createSupabaseClient(), {
      planKey: readString(body.plan_key, "pro"),
      billingIntervalMonths: Number(body.billing_interval_months ?? 1),
      outreachAddonKey: readString(body.outreach_addon_key) || null,
      purchaserEmail: readString(body.purchaser_email),
      flowType: readString(body.flow_type) === "additional_account" ? "additional_account" : "first_purchase",
      idempotencyKey: readString(body.idempotency_key) || crypto.randomUUID(),
      clientId: readString(body.client_id) || null,
      password: readString(body.password) || null,
      successUrl: `${origin}/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/commercial/stripe-test/cancel`,
    });

    if (!result.ok) {
      return jsonError(result.messageEn, result.status, { code: result.code });
    }

    return jsonOk({
      checkout_url: result.checkoutUrl,
      internal_checkout_session_id: result.internalCheckoutSessionId,
      internal_attempt_id: result.internalAttemptId,
      message_en: "Stripe Test checkout session created. Complete payment in Stripe Test mode.",
    });
  } catch (error) {
    const code = error instanceof StripeFoundationError ? error.code : "stripe_unavailable";
    return jsonError("Stripe Test checkout is not configured.", 503, { code });
  }
}
