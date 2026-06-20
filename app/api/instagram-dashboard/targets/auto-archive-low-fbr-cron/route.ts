import { jsonError, jsonOk } from "../../_utils";
import {
  extractTargetAutoArchiveLowFbrCronToken,
  runTargetAutoArchiveLowFbrCron,
} from "@/lib/instagram-dashboard/target-auto-archive-low-fbr-cron";

export const dynamic = "force-dynamic";

async function handleCronRequest(request: Request) {
  try {
    const run = await runTargetAutoArchiveLowFbrCron({
      callerToken: extractTargetAutoArchiveLowFbrCronToken(request),
    });

    if (run.status === 401 || run.status === 403 || run.status === 503) {
      return jsonError(run.result.reason ?? "Target auto-archive cron blocked.", run.status);
    }

    return jsonOk(run.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run target auto-archive cron.";
    return jsonError(message, 500);
  }
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}
