import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { requireClientInstagramSession, readString } from "@/lib/instagram-client/_utils";
import { resolveAuthorizedClientInvoiceDocument } from "@/lib/commercial/stripe/client-billing-service.ts";
import { StripeFoundationError } from "@/lib/commercial/stripe/stripe-config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ invoiceRef: string }>;
};

function readDocumentKind(value: string | null): "hosted" | "pdf" | null {
  if (value === "hosted" || value === "pdf") return value;
  return null;
}

export async function GET(request: Request, context: RouteContext) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }

  const params = await context.params;
  const invoiceRef = readString(params.invoiceRef);
  const kind = readDocumentKind(new URL(request.url).searchParams.get("kind"));
  if (!invoiceRef || !kind) {
    return NextResponse.json({ ok: false, error: "Invalid invoice request." }, { status: 400 });
  }

  try {
    const result = await resolveAuthorizedClientInvoiceDocument({
      supabase: createSupabaseClient(),
      clientId: session.clientId,
      invoiceRef,
      kind,
    });

    if (!result.ok) {
      const message = result.status === 403
        ? "You are not allowed to access this invoice."
        : "Invoice document is unavailable.";
      return NextResponse.json({ ok: false, error: message }, { status: result.status });
    }

    return NextResponse.redirect(result.url, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof StripeFoundationError) {
      return NextResponse.json({ ok: false, error: "Invoice document is unavailable." }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "Invoice document is unavailable." }, { status: 503 });
  }
}
