import { readJsonBody, jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { requireInstagramAdmin } from "@/app/api/instagram-dashboard/_utils";
import { recoverStripeCheckoutAttemptFulfillment } from "@/lib/commercial/stripe/stripe-fulfillment.ts";
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

  const body = await readJsonBody<Record<string, unknown>>(request);
  if (!body) {
    return jsonError("Invalid recovery payload.", 400, { code: "invalid_payload" });
  }

  const attemptId = readString(body.attempt_id);
  if (!attemptId) {
    return jsonError("Attempt id is required.", 400, { code: "attempt_required" });
  }

  try {
    const result = await recoverStripeCheckoutAttemptFulfillment(createSupabaseClient(), { attemptId });
    if (!result.ok) {
      return jsonError("Recovery is unavailable for this attempt.", result.status, { code: result.code });
    }
    return jsonOk({
      recovered: !result.alreadyFulfilled,
      already_fulfilled: result.alreadyFulfilled,
      message_en: result.alreadyFulfilled
        ? "Attempt was already fulfilled."
        : "Fulfillment recovery completed for the paid attempt.",
    });
  } catch (error) {
    const code = error instanceof StripeFoundationError ? error.code : "stripe_recovery_unavailable";
    return jsonError("Stripe Test recovery is not configured.", 503, { code });
  }
}
