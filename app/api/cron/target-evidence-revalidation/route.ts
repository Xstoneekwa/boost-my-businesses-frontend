import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import {
  buildTargetEvidenceRevalidationEnv,
  extractTargetVerificationCronToken,
  runTargetVerificationCron,
} from "@/lib/instagram-target-verification-cron";
import type { TargetVerificationSupabaseClient } from "@/lib/instagram-target-verification-processor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const run = await runTargetVerificationCron(
      createSupabaseClient() as unknown as TargetVerificationSupabaseClient,
      {
        callerToken: extractTargetVerificationCronToken(request),
        env: buildTargetEvidenceRevalidationEnv(process.env),
        processorMode: "evidence_only",
      },
    );
    return NextResponse.json({
      ok: run.status === 200,
      mode: "evidence_only",
      ...run.result,
      business_requalification: false,
      enforcement: false,
    }, { status: run.status });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "target_evidence_revalidation_failed")
      .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
      .slice(0, 160);
    return NextResponse.json({
      ok: false,
      mode: "evidence_only",
      error: "target_evidence_revalidation_failed",
      reason,
      business_requalification: false,
      enforcement: false,
    }, { status: 503 });
  }
}
