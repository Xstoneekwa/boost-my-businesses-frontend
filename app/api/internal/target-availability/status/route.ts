import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { targetAvailabilityPrivateRequestAuthorized } from "@/lib/target-availability/private-auth";
import { parseTargetAvailabilityRuntimeState, targetAvailabilityRuntimeActive } from "@/lib/target-availability/runtime-pipeline";

export const dynamic = "force-dynamic";

const STORE_TABLES = [
  "ct_target_availability_observations",
  "ct_target_identity_history",
  "ct_target_identity_current",
  "ct_target_availability_assessments",
  "ct_target_availability_current",
] as const;

const percentile = (values: readonly number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0).toFixed(3));
};

export async function GET(request: Request) {
  if (!targetAvailabilityPrivateRequestAuthorized(request)) {
    return jsonError("Target Availability authentication failed.", 401, { reason: "invalid_caller_token" });
  }

  try {
    const supabase = createSupabaseClient();
    const [stateResult, metricsResult, alertsResult, ...storeResults] = await Promise.all([
      supabase.from("ct_target_availability_runtime_state").select("*").eq("id", "global").maybeSingle(),
      supabase.from("ct_target_availability_pipeline_metrics")
        .select("latency_ms,cpu_ms,memory_before_bytes,memory_peak_bytes,memory_after_bytes,retained_payload_count,counters_safe,created_at")
        .gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(2_000),
      supabase.from("ct_target_availability_alert_events")
        .select("severity,reason_code,source_component,requires_human_review,created_at")
        .order("created_at", { ascending: false }).limit(20),
      ...STORE_TABLES.map((table) => supabase.from(table).select("*", { count: "exact", head: true })),
    ]);
    if (stateResult.error) throw stateResult.error;
    if (metricsResult.error) throw metricsResult.error;
    if (alertsResult.error) throw alertsResult.error;
    const state = parseTargetAvailabilityRuntimeState(stateResult.data);
    const metrics = metricsResult.data ?? [];
    const latency = metrics.map((row) => Number(row.latency_ms)).filter(Number.isFinite);
    const counters = metrics.reduce<Record<string, number>>((total, row) => {
      const source = row.counters_safe && typeof row.counters_safe === "object" && !Array.isArray(row.counters_safe)
        ? row.counters_safe as Record<string, unknown> : {};
      for (const [key, value] of Object.entries(source)) total[key] = (total[key] ?? 0) + (Number(value) || 0);
      return total;
    }, {});
    const stores = Object.fromEntries(STORE_TABLES.map((table, index) => [table, storeResults[index]?.count ?? 0]));
    return jsonOk({
      log_event: "target_availability_runtime_status",
      active: targetAvailabilityRuntimeActive(state),
      state: stateResult.data,
      stores,
      metrics_24h: {
        samples: metrics.length,
        counters,
        latency_p50_ms: percentile(latency, 0.5),
        latency_p95_ms: percentile(latency, 0.95),
        latency_max_ms: latency.length ? Math.max(...latency) : 0,
        retained_payload_count: metrics.reduce((sum, row) => sum + (Number(row.retained_payload_count) || 0), 0),
      },
      alerts: alertsResult.data ?? [],
      side_effects: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "target_availability_status_failed";
    return jsonError("Target Availability status failed.", 500, {
      reason: message.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 160),
    });
  }
}
