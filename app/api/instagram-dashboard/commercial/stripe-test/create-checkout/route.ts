import {
  getInstagramAdminUserContext,
  readJsonBody,
  jsonError,
  jsonOk,
} from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { requireInstagramAdmin } from "@/app/api/instagram-dashboard/_utils";
import { createStripeSubscriptionCheckoutSession } from "@/lib/commercial/stripe/stripe-subscription-checkout.ts";
import {
  resolveStripeTestCheckoutRedirectOrigin,
  StripeFoundationError,
} from "@/lib/commercial/stripe/stripe-config.ts";
import { isCommercialTestMode } from "@/lib/commercial/stripe/commercial-test-mode.ts";

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
    const adminContext = await getInstagramAdminUserContext();
    if (!adminContext?.userId) {
      return jsonError("Authenticated admin identity is required.", 401, { code: "admin_identity_required" });
    }
    if (!isCommercialTestMode(body.commercial_test_mode)) {
      return jsonError("Explicit commercial test mode is required.", 400, {
        code: "commercial_test_mode_required",
      });
    }
    const origin = resolveStripeTestCheckoutRedirectOrigin(request.url);
    const result = await createStripeSubscriptionCheckoutSession(createSupabaseClient(), {
      commercialTestMode: body.commercial_test_mode,
      realStripeTestE2E: body.real_stripe_test_e2e === true,
      planKey: readString(body.plan_key, "pro"),
      billingIntervalMonths: Number(body.billing_interval_months ?? 1),
      outreachAddonKey: readString(body.outreach_addon_key) || null,
      purchaserEmail: readString(body.purchaser_email),
      flowType: readString(body.flow_type) === "additional_account" ? "additional_account" : "first_purchase",
      idempotencyKey: readString(body.idempotency_key) || crypto.randomUUID(),
      clientId: readString(body.client_id) || null,
      authUserId: adminContext.userId,
      targetAccountId: readString(body.target_account_id) || null,
      billingSource: readString(body.billing_source) || null,
      commercialMigrationReason: readString(body.commercial_migration_reason) || null,
      commercialMigrationKind: readString(body.commercial_migration_kind) === "simulated_to_stripe_test"
        ? "simulated_to_stripe_test"
        : null,
      commercialMigrationAuthorizationId: readString(body.commercial_migration_authorization_id) || null,
      password: readString(body.password) || null,
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
      message_en: "Stripe Test checkout session created. Complete payment in Stripe Test mode.",
    });
  } catch (error) {
    const code = error instanceof StripeFoundationError ? error.code : "stripe_unavailable";
    return jsonError("Stripe Test checkout is not configured.", 503, { code });
  }
}
