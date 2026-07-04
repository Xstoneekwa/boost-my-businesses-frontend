import { createSupabaseClient } from "@/lib/supabase";
import { handleStripeWebhookEvent, verifyStripeWebhookSignature } from "@/lib/commercial/stripe/stripe-webhook-handler.ts";
import { StripeFoundationError } from "@/lib/commercial/stripe/stripe-config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    const verified = await verifyStripeWebhookSignature(rawBody, signature);
    if (!verified.ok) {
      return new Response(JSON.stringify({ ok: false, code: verified.code }), {
        status: verified.code === "stripe_signature_invalid" || verified.code === "stripe_signature_missing" ? 400 : 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await handleStripeWebhookEvent(createSupabaseClient(), verified.event);
    return new Response(JSON.stringify({ ok: result.ok, code: "code" in result ? result.code : undefined }), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const code = error instanceof StripeFoundationError ? error.code : "webhook_failed";
    return new Response(JSON.stringify({ ok: false, code }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
