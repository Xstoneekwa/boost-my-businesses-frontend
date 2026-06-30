import { createSupabaseClient } from "@/lib/supabase";
import {
  loadBotAppSchedulerRuntimeHealth,
  normalizeBotAppSchedulerRuntimeHeartbeatPayload,
  projectBotAppSchedulerRuntimeHealth,
} from "@/lib/instagram-dashboard/botapp-scheduler-runtime-health";
import { jsonError, jsonOk, readJsonBody, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "BotApp scheduler runtime health");
    if (unauthorizedResponse) return unauthorizedResponse;

    const supabase = createSupabaseClient();
    const health = await loadBotAppSchedulerRuntimeHealth(supabase);
    return jsonOk(health);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load BotApp scheduler runtime health.";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "BotApp scheduler runtime heartbeat");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body) return jsonError("Invalid BotApp scheduler runtime heartbeat payload.", 400);

    const payload = normalizeBotAppSchedulerRuntimeHeartbeatPayload(body);
    if (!payload.worker_id) return jsonError("runtime_host or worker_id is required.", 400);

    const nowIso = new Date().toISOString();
    const supabase = createSupabaseClient();
    const { error } = await supabase.from("worker_heartbeats").upsert({
      worker_id: payload.worker_id,
      status: payload.status,
      last_seen_at: nowIso,
      metadata: {
        runtime_host: payload.runtime_host,
        scheduler_available: payload.scheduler_available,
        voluntary_shutdown: payload.voluntary_shutdown,
        dispatcher_observed_status: payload.dispatcher_observed_status,
        relay_authenticated: payload.relay_authenticated,
        component: "botapp_scheduler_runtime",
      },
    }, { onConflict: "worker_id" });

    if (error) return jsonError(error.message, 500);

    const health = projectBotAppSchedulerRuntimeHealth({
      heartbeat: {
        worker_id: payload.worker_id,
        status: payload.status,
        last_seen_at: nowIso,
        metadata: {
          runtime_host: payload.runtime_host,
          scheduler_available: payload.scheduler_available,
          voluntary_shutdown: payload.voluntary_shutdown,
          dispatcher_observed_status: payload.dispatcher_observed_status,
        },
      },
    });

    return jsonOk({
      accepted: true,
      worker_id: payload.worker_id,
      health,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not publish BotApp scheduler runtime heartbeat.";
    return jsonError(message, 500);
  }
}
