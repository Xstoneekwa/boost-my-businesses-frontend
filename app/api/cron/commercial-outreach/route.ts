import { NextResponse } from "next/server";
import { processCommercialOutreachBatch } from "@/lib/commercial/outreach-processor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    return NextResponse.json(
      { ok: true, data: await processCommercialOutreachBatch() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "commercial_outreach_processor_failed" }, { status: 500 });
  }
}
