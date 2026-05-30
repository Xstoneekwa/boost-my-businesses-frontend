import { createSupabaseClient } from "@/lib/supabase";
import {
  processTargetVerificationBatch,
  type TargetVerificationSupabaseClient,
} from "@/lib/instagram-target-verification-processor";
import {
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
} from "../../_utils";

export const dynamic = "force-dynamic";

type VerifyBatchBody = {
  limit?: number | string;
  locked_by?: string;
  worker_id?: string;
  dry_run?: boolean | string;
  max_duration_ms?: number | string;
};

export async function POST(request: Request) {
  try {
    const unauthorized = await requireInstagramAdmin();
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<VerifyBatchBody>(request);
    const supabase = createSupabaseClient();
    const result = await processTargetVerificationBatch(supabase as unknown as TargetVerificationSupabaseClient, {
      limit: body?.limit,
      dryRun: body?.dry_run === true || readString(body?.dry_run, "").toLowerCase() === "true",
      workerId: readString(body?.worker_id, readString(body?.locked_by, "dashboard_verify_batch")),
      maxDurationMs: body?.max_duration_ms,
    });

    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify target batch.";
    return jsonError(message, 500);
  }
}
