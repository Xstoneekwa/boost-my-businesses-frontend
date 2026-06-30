import { createSupabaseClient } from "@/lib/supabase";
import {
  extractScheduleSessionCronToken,
  runScheduleSessionCron,
} from "@/lib/instagram-dashboard/schedule-session-cron";
import { jsonError, jsonOk } from "../../_utils";

export const dynamic = "force-dynamic";

async function handleCronRequest(request: Request) {
  try {
    const run = await runScheduleSessionCron(createSupabaseClient() as never, {
      callerToken: extractScheduleSessionCronToken(request),
    });

    if (run.status === 401 || run.status === 403 || run.status === 503) {
      return jsonError(run.result.reason ?? "Schedule session cron blocked.", run.status);
    }

    return jsonOk(run.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run schedule session cron.";
    return jsonError(message, 500);
  }
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}
