import { createSupabaseClient } from "@/lib/supabase";
import {
  extractTargetVerificationCronToken,
  runTargetVerificationCron,
} from "@/lib/instagram-target-verification-cron";
import type { TargetVerificationSupabaseClient } from "@/lib/instagram-target-verification-processor";
import { jsonError, jsonOk } from "../../_utils";

export const dynamic = "force-dynamic";

async function handleCronRequest(request: Request) {
  try {
    const supabase = createSupabaseClient();
    const run = await runTargetVerificationCron(supabase as unknown as TargetVerificationSupabaseClient, {
      callerToken: extractTargetVerificationCronToken(request),
    });

    if (run.status === 401 || run.status === 403 || run.status === 503) {
      return jsonError(run.result.reason ?? "Target verification cron blocked.", run.status);
    }

    return jsonOk(run.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run target verification cron.";
    return jsonError(message, 500);
  }
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}
