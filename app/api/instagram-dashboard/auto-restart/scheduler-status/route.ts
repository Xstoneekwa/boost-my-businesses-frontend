import { createSupabaseClient } from "@/lib/supabase";
import { getRunControlHealth } from "@/lib/instagram-dashboard/run-control";
import { buildSchedulerStatus } from "@/lib/instagram-dashboard/scheduler-status";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

/**
 * Read-only Scheduler observability contract for BotApp.
 *
 * Aggregates canonical facts only: auto_restart_settings (ON/OFF authority),
 * auto_restart_tick_locks (real ticks), auto_restart_decisions (canonical
 * per-account decisions) and the dispatcher heartbeat projection. It never
 * evaluates eligibility and never mutates anything. ON/OFF mutations go
 * through the existing PATCH /auto-restart/settings endpoint.
 */
export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Scheduler status");
    if (unauthorizedResponse) return unauthorizedResponse;

    const supabase = createSupabaseClient();
    const engineHealth = await getRunControlHealth();
    const status = await buildSchedulerStatus(supabase as never, {
      engineHealth: {
        healthy: engineHealth.healthy,
        dispatcherWorkerId: engineHealth.dispatcherWorkerId,
        lastSeenAt: engineHealth.lastSeenAt,
        reason: engineHealth.reason ?? null,
      },
    });
    return jsonOk({
      log_event: "scheduler_status_read",
      ...status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Scheduler status.";
    return jsonError(message, 500);
  }
}
