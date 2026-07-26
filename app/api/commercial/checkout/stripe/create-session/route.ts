import { readJsonBody, jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { createStripeSubscriptionCheckoutSession } from "@/lib/commercial/stripe/stripe-subscription-checkout.ts";
import {
  resolveStripeTestCheckoutRedirectOrigin,
  StripeFoundationError,
} from "@/lib/commercial/stripe/stripe-config.ts";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function stripeRouteError(error: unknown) {
  if (error instanceof StripeFoundationError) {
    return jsonError("Stripe Test checkout is not configured.", 503, { code: error.code });
  }
  return jsonError("Stripe checkout is unavailable.", 503, { code: "stripe_unavailable" });
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body) {
      return jsonError("Invalid checkout payload.", 400, { code: "invalid_payload" });
    }
    const flowType = readString(body.flow_type) === "additional_account" ? "additional_account" : "first_purchase";
    const supabase = createSupabaseClient();
    let purchaserEmail = readString(body.purchaser_email);
    let clientId: string | null = null;
    let authUserId: string | null = null;
    if (flowType === "additional_account") {
      const session = await requireClientInstagramSession();
      if (!session.ok) {
        return jsonError("Client login is required for this purchase.", 401, { code: "session_required" });
      }
      clientId = session.clientId;
      authUserId = session.userId;
      const { data } = await supabase.auth.admin.getUserById(session.userId);
      purchaserEmail = readString(data.user?.email);
      if (!purchaserEmail) {
        return jsonError("Authenticated client email is required.", 400, { code: "email_required" });
      }
    }
    const origin = resolveStripeTestCheckoutRedirectOrigin(request.url);
    const result = await createStripeSubscriptionCheckoutSession(supabase, {
      commercialMode: readString(body.mode || body.commercial_mode),
      planKey: readString(body.plan_key),
      packageKey: readString(body.package_key || body.plan_key),
      billingIntervalMonths: Number(body.billing_interval_months ?? 1),
      outreachAddonKey: readString(body.outreach_addon_key) || null,
      purchaserEmail,
      flowType,
      idempotencyKey: readString(body.idempotency_key) || crypto.randomUUID(),
      clientId,
      authUserId,
      password: readString(body.password) || null,
      passwordConfirmation: readString(body.password_confirmation) || null,
      successUrl: `${origin}/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/commercial/stripe-test/cancel`,
      allowedOrigins: [origin],
    });

    if (!result.ok) {
      return jsonError(result.messageEn, result.status, { code: result.code });
    }

    return jsonOk({
      checkout_url: result.checkoutUrl,
      internal_checkout_session_id: result.internalCheckoutSessionId,
      internal_attempt_id: result.internalAttemptId,
    });
  } catch (error) {
    return stripeRouteError(error);
  }
}
