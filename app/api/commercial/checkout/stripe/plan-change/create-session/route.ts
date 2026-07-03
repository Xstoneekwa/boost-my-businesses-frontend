import { readJsonBody, jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { requireClientInstagramSession, readString } from "@/lib/instagram-client/_utils";
import { createStripePlanChangePaymentSession } from "@/lib/commercial/stripe/stripe-plan-change-checkout.ts";
import { StripeFoundationError } from "@/lib/commercial/stripe/stripe-config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await requireClientInstagramSession();
    if (!session.ok) {
      return jsonError("Client login is required.", 401, { code: "session_required" });
    }

    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body) {
      return jsonError("Invalid plan change payload.", 400, { code: "invalid_payload" });
    }
    if (body.amount_due_cents != null || readString(body.target_plan_key)) {
      return jsonError("Invalid confirmation. Amounts are recalculated server-side.", 400, {
        code: "client_payload_not_allowed",
      });
    }

    const quoteId = readString(body.quote_id);
    const idempotencyKey = readString(body.idempotency_key);
    if (!quoteId || !idempotencyKey) {
      return jsonError("Plan change quote is required.", 400, { code: "quote_required" });
    }

    const supabase = createSupabaseClient();
    const { data: authUser } = await supabase.auth.admin.getUserById(session.userId);
    const purchaserEmail = readString(authUser.user?.email);
    const origin = new URL(request.url).origin;

    const result = await createStripePlanChangePaymentSession(supabase, {
      quoteId,
      clientId: session.clientId,
      purchaserEmail,
      idempotencyKey,
      successUrl: readString(body.success_url) || `${origin}/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: readString(body.cancel_url) || `${origin}/commercial/stripe-test/cancel`,
    });

    if (!result.ok) {
      return jsonError(result.messageEn, result.status, { code: result.code });
    }

    return jsonOk({
      checkout_url: result.checkoutUrl,
      internal_attempt_id: result.internalAttemptId,
    });
  } catch (error) {
    if (error instanceof StripeFoundationError) {
      return jsonError("Stripe Test checkout is not configured.", 503, { code: error.code });
    }
    return jsonError("Stripe checkout is unavailable.", 503, { code: "stripe_unavailable" });
  }
}
