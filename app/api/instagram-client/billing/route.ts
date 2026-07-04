import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { requireClientInstagramSession, readString } from "@/lib/instagram-client/_utils";
import {
  assertClientBillingPayloadSafe,
  buildClientBillingView,
} from "@/lib/commercial/stripe/client-billing-service.ts";
import { StripeFoundationError } from "@/lib/commercial/stripe/stripe-config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resolveLang(request: Request): "fr" | "en" {
  const fromQuery = new URL(request.url).searchParams.get("lang");
  return readString(fromQuery).toLowerCase() === "en" ? "en" : "fr";
}

export async function GET(request: Request) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }

  try {
    const view = await buildClientBillingView({
      supabase: createSupabaseClient(),
      clientId: session.clientId,
      lang: resolveLang(request),
    });
    assertClientBillingPayloadSafe(view);
    return NextResponse.json({ ok: true, data: view });
  } catch (error) {
    if (error instanceof StripeFoundationError) {
      return NextResponse.json({ ok: false, error: "Billing is unavailable right now." }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "Billing is unavailable right now." }, { status: 503 });
  }
}
