import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import {
  processExpiredCommercialPauses,
  processRecoverableCommercialLifecycleOperations,
} from "@/lib/commercial/account-lifecycle-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseClient();
    const expiredResults = await processExpiredCommercialPauses({
      supabase,
      limit: 50,
    });
    const recoveredResults = await processRecoverableCommercialLifecycleOperations({
      supabase,
      limit: 50,
    });
    const results = [...expiredResults, ...recoveredResults];
    return NextResponse.json({
      ok: true,
      processed: results.length,
      expired_processed: expiredResults.length,
      recovered_processed: recoveredResults.length,
      cancelled: results.filter((row) => row.commercialState === "cancelled").length,
      action_required: results.filter((row) => row.actionRequired).length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "expiry_cron_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
