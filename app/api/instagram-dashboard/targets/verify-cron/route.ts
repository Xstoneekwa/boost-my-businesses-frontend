import { createSupabaseClient } from "@/lib/supabase";
import { handleTargetVerificationCronRequest } from "@/lib/instagram-target-verification-cron";
import type { TargetVerificationSupabaseClient } from "@/lib/instagram-target-verification-processor";
import { jsonError, jsonOk } from "../../_utils";

export const dynamic = "force-dynamic";

async function respondToCronRequest(request: Request) {
  try {
    const supabase = createSupabaseClient();
    const run = await handleTargetVerificationCronRequest(
      request,
      supabase as unknown as TargetVerificationSupabaseClient,
    );

    if (run.status === 401 || run.status === 403 || run.status === 405 || run.status === 503) {
      return jsonError(run.result.reason ?? "Target verification cron blocked.", run.status);
    }

    return jsonOk(run.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run target verification cron.";
    return jsonError(message, 500);
  }
}

export async function GET(request: Request) {
  return respondToCronRequest(request);
}

export async function POST(request: Request) {
  return respondToCronRequest(request);
}
