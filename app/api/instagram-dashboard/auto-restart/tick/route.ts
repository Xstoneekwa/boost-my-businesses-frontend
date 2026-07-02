import { createSupabaseClient } from "@/lib/supabase";
import {
  extractAutoRestartTickToken,
  getAutoRestartTickStatus,
  runAutoRestartTick,
} from "@/lib/instagram-dashboard/auto-restart-tick";
import { jsonError, jsonOk, readJsonBody, readString } from "../../_utils";

export const dynamic = "force-dynamic";

function resolveTrustedWorkerId(request: Request, body: Record<string, unknown> | null) {
  const headerWorker = readString(request.headers.get("x-run-control-worker-id"), "");
  if (headerWorker) return headerWorker;
  return "";
}

export async function GET() {
  try {
    const supabase = createSupabaseClient();
    return jsonOk({
      log_event: "auto_restart_tick_status",
      ...(await getAutoRestartTickStatus(supabase as never)),
      side_effects: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Auto Restart tick status.";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  try {
    const token = extractAutoRestartTickToken(request);
    if (!token) {
      return jsonError("Auto Restart tick authentication failed.", 401, { reason: "missing_caller_token" });
    }

    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    const workerId = resolveTrustedWorkerId(request, body);
    if (!workerId) {
      return jsonError("Trusted dispatcher worker id required.", 403, { reason: "missing_trusted_worker_id" });
    }

    const run = await runAutoRestartTick(createSupabaseClient() as never, {
      workerId,
      callerToken: token,
      dryRun: body?.dry_run === true,
      manual: false,
      actor: "dispatcher",
    });

    if (run.status === 401 || run.status === 403 || run.status === 503) {
      return jsonError(run.result.reason ?? "Auto Restart tick blocked.", run.status);
    }

    return jsonOk({
      log_event: "auto_restart_tick_started",
      ...run.result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run Auto Restart tick.";
    return jsonError(message, 500);
  }
}
