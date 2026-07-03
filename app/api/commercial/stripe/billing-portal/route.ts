import { readJsonBody, jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { createStripeBillingPortalSession } from "@/lib/commercial/stripe/stripe-subscription-projection.ts";
import { StripeFoundationError } from "@/lib/commercial/stripe/stripe-config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export async function POST(request: Request) {
  try {
    const session = await requireClientInstagramSession();
    if (!session.ok) {
      return jsonError("Client login is required.", 401, { code: "session_required" });
    }

    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body) {
      return jsonError("Invalid billing portal payload.", 400, { code: "invalid_payload" });
    }
    const origin = new URL(request.url).origin;
    const result = await createStripeBillingPortalSession(createSupabaseClient(), {
      clientId: session.clientId,
      returnUrl: readString(body.return_url) || `${origin}/instagram-client`,
    });

    if (!result.ok) {
      return jsonError("Billing portal is unavailable.", 503, { code: result.code });
    }

    return jsonOk({ portal_url: result.url });
  } catch (error) {
    if (error instanceof StripeFoundationError) {
      return jsonError("Stripe Test billing portal is not configured.", 503, { code: error.code });
    }
    return jsonError("Billing portal is unavailable.", 503, { code: "stripe_portal_unavailable" });
  }
}
