import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { createStripeBillingPortalSession } from "@/lib/commercial/stripe/stripe-subscription-projection.ts";
import {
  resolveStripeTestCheckoutRedirectOrigin,
  StripeFoundationError,
} from "@/lib/commercial/stripe/stripe-config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await requireClientInstagramSession();
    if (!session.ok) {
      return jsonError("Client login is required.", 401, { code: "session_required" });
    }

    const origin = resolveStripeTestCheckoutRedirectOrigin(request.url);
    const result = await createStripeBillingPortalSession(createSupabaseClient(), {
      clientId: session.clientId,
      returnUrl: `${origin}/instagram-client`,
    });

    if (!result.ok) {
      const clientMessage = result.code === "stripe_portal_not_configured"
        ? "Payment method updates are unavailable right now."
        : "Billing portal is unavailable.";
      return jsonError(clientMessage, 503, { code: result.code });
    }

    return jsonOk({ redirect_url: result.url });
  } catch (error) {
    if (error instanceof StripeFoundationError) {
      const clientMessage = error.code === "stripe_test_not_configured"
        ? "Payment method updates are unavailable right now."
        : "Billing portal is unavailable.";
      return jsonError(clientMessage, 503, { code: error.code });
    }
    return jsonError("Billing portal is unavailable.", 503, { code: "stripe_portal_unavailable" });
  }
}
