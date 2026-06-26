import { createSupabaseClient } from "@/lib/supabase";
import { ingestPostmarkWebhookEvent } from "@/lib/instagram-dashboard/client-email-postmark-webhook";
import {
  postmarkWebhookAuthStatus,
  verifyPostmarkWebhookBasicAuth,
} from "@/lib/instagram-dashboard/client-email-postmark-webhook-auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function jsonOk(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

function jsonError(message: string, status: number, meta?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(meta ?? {}) }, { status });
}

export async function GET() {
  return jsonError("Method not allowed.", 405, { reason: "method_not_allowed" });
}

export async function POST(request: Request) {
  const auth = verifyPostmarkWebhookBasicAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return jsonError("Postmark webhook authentication failed.", postmarkWebhookAuthStatus(auth.reason), {
      reason: auth.reason,
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON payload.", 400, { reason: "invalid_json" });
  }

  try {
    const supabase = createSupabaseClient();
    const result = await ingestPostmarkWebhookEvent(supabase, payload);
    if (!result.ok) {
      if (result.reason === "intent_not_found") {
        return jsonOk({ action: "ignored", reason: result.reason }, 200);
      }
      if (result.reason === "infrastructure_unavailable") {
        return jsonError(result.message, 503, { reason: result.reason });
      }
      return jsonError(result.message, 400, { reason: result.reason });
    }

    return jsonOk({
      action: result.action,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  } catch {
    return jsonError("Postmark webhook processing failed.", 500, { reason: "processing_failed" });
  }
}
