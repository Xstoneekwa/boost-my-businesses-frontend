import { jsonError, jsonOk } from "../../instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import {
  extractClientEmailLifecycleCronSecret,
  runClientEmailLifecycleCron,
} from "@/lib/instagram-dashboard/client-email-lifecycle-cron";
import { detectClientEmailLifecycleCronInvoker, readVercelCronTelemetry } from "@/lib/instagram-dashboard/client-email-lifecycle-scheduler-health";

export const dynamic = "force-dynamic";

async function handleCronRequest(request: Request) {
  try {
    const supabase = createSupabaseClient();
    const run = await runClientEmailLifecycleCron({
      supabase,
      callerSecret: extractClientEmailLifecycleCronSecret(request),
      invoker: detectClientEmailLifecycleCronInvoker(request.headers),
      cronTelemetry: readVercelCronTelemetry(request.headers),
    });

    if (run.status === 401 || run.status === 403 || run.status === 503) {
      return jsonError(run.result.reason, run.status);
    }

    return jsonOk(run.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run client email lifecycle cron.";
    return jsonError(message, 500);
  }
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}
