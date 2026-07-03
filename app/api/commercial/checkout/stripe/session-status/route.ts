import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { getSafeStripeSessionStatus } from "@/lib/commercial/stripe/stripe-webhook-handler.ts";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { requireInstagramAdmin } from "@/app/api/instagram-dashboard/_utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const internalCheckoutSessionId = readString(url.searchParams.get("internal_checkout_session_id"));
  const stripeCheckoutSessionId = readString(url.searchParams.get("session_id"));

  const clientSession = await requireClientInstagramSession();
  const adminUnauthorized = await requireInstagramAdmin();
  if (!clientSession.ok && adminUnauthorized) {
    return jsonError("Authentication is required.", 401, { code: "session_required" });
  }

  const status = await getSafeStripeSessionStatus(createSupabaseClient(), {
    internalCheckoutSessionId: internalCheckoutSessionId || null,
    stripeCheckoutSessionId: stripeCheckoutSessionId || null,
  });

  if (!status.ok) {
    return jsonError("Checkout session was not found.", 404, { code: status.code });
  }

  return jsonOk({
    commercial_status: status.commercialStatus,
    activated_at: status.activatedAt,
    informational_only: true,
    activation_source: "webhook_only",
  });
}
