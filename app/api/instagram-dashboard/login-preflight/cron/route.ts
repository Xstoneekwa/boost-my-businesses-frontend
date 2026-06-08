import { createSupabaseClient } from "@/lib/supabase";
import {
  extractLoginPreflightCronToken,
  runLoginPreflightCron,
} from "@/lib/instagram-dashboard/login-preflight-cron";
import { jsonError, jsonOk } from "../../_utils";

export const dynamic = "force-dynamic";

async function handleCronRequest(request: Request) {
  try {
    const run = await runLoginPreflightCron(createSupabaseClient() as never, {
      callerToken: extractLoginPreflightCronToken(request),
    });

    if (run.status === 401 || run.status === 403 || run.status === 503) {
      return jsonError(run.result.reason ?? "Login preflight cron blocked.", run.status);
    }

    return jsonOk(run.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run login preflight cron.";
    return jsonError(message, 500);
  }
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}
