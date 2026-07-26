import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getSafeStripeSessionStatus,
  verifyStripeSessionStatusOwnership,
} from "@/lib/commercial/stripe/stripe-webhook-handler.ts";
import { getInstagramUserContext } from "@/lib/restaurant-analytics/session";
import { requireInstagramAdmin } from "@/app/api/instagram-dashboard/_utils";
import { publicCheckoutLoginPath } from "@/lib/commercial/public-checkout-lang.ts";
import { resolveCheckoutContext, resolveCheckoutHandoff } from "@/lib/commercial/checkout-context.ts";

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

  if (!internalCheckoutSessionId && !stripeCheckoutSessionId) {
    return jsonError("Checkout session identifier is required.", 400, { code: "session_required" });
  }

  const adminUnauthorized = await requireInstagramAdmin();
  const isAdmin = !adminUnauthorized;

  const userContext = await getInstagramUserContext();
  const allowPublicPostPaymentPoll = Boolean(
    stripeCheckoutSessionId
    && !internalCheckoutSessionId
    && !userContext?.userId
    && !isAdmin,
  );

  if (!isAdmin && !userContext?.userId && !allowPublicPostPaymentPoll) {
    return jsonError("Authentication is required.", 401, { code: "session_required" });
  }

  const supabase = createSupabaseClient();
  const ownership = await verifyStripeSessionStatusOwnership(supabase, {
    requesterUserId: userContext?.userId ?? "",
    requesterClientId: userContext?.tenantId ?? null,
    isAdmin,
    internalCheckoutSessionId: internalCheckoutSessionId || null,
    stripeCheckoutSessionId: stripeCheckoutSessionId || null,
  });

  if (!ownership.ok) {
    if (ownership.code === "session_not_found") {
      return jsonError("Checkout session was not found.", 404, { code: ownership.code });
    }
    return jsonError("You are not allowed to view this checkout session.", 403, { code: ownership.code });
  }

  const status = await getSafeStripeSessionStatus(supabase, {
    internalCheckoutSessionId: internalCheckoutSessionId || null,
    stripeCheckoutSessionId: stripeCheckoutSessionId || null,
  });

  if (!status.ok) {
    return jsonError("Checkout session was not found.", 404, { code: status.code });
  }

  const flowType = status.flowType === "additional_account" ? "additional_account" : "first_purchase";
  const handoff = resolveCheckoutHandoff(resolveCheckoutContext({ flowType }));
  const readyForHandoff = status.readyForLogin || status.readyForOnboarding;
  return jsonOk({
    commercial_status: status.commercialStatus,
    activated_at: status.activatedAt,
    ready_for_login: status.readyForLogin,
    login_path: status.readyForLogin ? publicCheckoutLoginPath("fr") : null,
    ready_for_handoff: readyForHandoff,
    redirect_path: readyForHandoff
      ? (handoff.type === "email_login" ? publicCheckoutLoginPath("fr") : handoff.redirectPath)
      : null,
  });
}
