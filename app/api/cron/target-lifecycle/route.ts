import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { processTargetLifecycleBatch } from "@/lib/target-lifecycle/runtime-pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const safeRelease = () => (
  process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.VERCEL_DEPLOYMENT_ID
  || "backend-local"
).trim().slice(0, 120);

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const minute = new Date();
  minute.setUTCSeconds(0, 0);
  try {
    const result = await processTargetLifecycleBatch(createSupabaseClient() as never, {
      workerId: "backend-target-lifecycle-cron",
      batchKey: `target-lifecycle-cron:${minute.toISOString()}`,
      processorRelease: safeRelease(),
    });
    return NextResponse.json({
      ok: true,
      log_event: "target_lifecycle_global_shadow_batch",
      ...result,
      side_effects: false,
      next_step_authorized: false,
    });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "target_lifecycle_cron_failed")
      .replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 160);
    return NextResponse.json({
      ok: false,
      error: "target_lifecycle_cron_failed",
      reason,
      side_effects: false,
      next_step_authorized: false,
    }, { status: 503 });
  }
}
