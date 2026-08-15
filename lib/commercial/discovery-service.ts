import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCommercialCrmAccess } from "./crm-access";
import type { CommercialDiscoveryReadModel, CommercialDiscoveryRun, CommercialDiscoveryTrigger } from "./discovery-contract";

type Row = Record<string, unknown>;
function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown) { const parsed = text(value).trim(); return parsed || null; }
function runFromRow(value: unknown): CommercialDiscoveryRun {
  const data = row(value); return { id: text(data.id), city: text(data.city) as CommercialDiscoveryRun["city"], subsegment: nullableText(data.subsegment) as CommercialDiscoveryRun["subsegment"], maxProspects: number(data.max_prospects), status: text(data.status) as CommercialDiscoveryRun["status"],
    discoveredCount: number(data.discovered_count), createdCount: number(data.created_count), duplicateCount: number(data.duplicate_count), enrichedCount: number(data.enriched_count), scoredCount: number(data.scored_count), qualifiedCount: number(data.qualified_count),
    p1Count: number(data.p1_count), p2Count: number(data.p2_count), p3Count: number(data.p3_count), hardRejectedCount: number(data.hard_rejected_count), precheckRejectedCount: number(data.precheck_rejected_count),
    aiPendingCount: number(data.ai_pending_count), errorCount: number(data.error_count), elapsedMs: number(data.elapsed_ms), startedAt: nullableText(data.started_at), completedAt: nullableText(data.completed_at), createdAt: text(data.created_at) };
}

export async function createCommercialDiscoveryRun(trigger: CommercialDiscoveryTrigger) {
  const context = await requireCommercialCrmAccess();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("create_commercial_discovery_run_v2", { p_actor_user_id: context.userId, p_city: trigger.city, p_subsegment: trigger.subsegment ?? null, p_max_prospects: trigger.maxProspects, p_idempotency_key: trigger.idempotencyKey, p_force_rescore: trigger.forceRescore });
  if (error) throw new Error("commercial_discovery_create_failed");
  return row(data);
}

export async function getCommercialDiscoveryReadModel(): Promise<CommercialDiscoveryReadModel> {
  await requireCommercialCrmAccess();
  const { data, error } = await createSupabaseAdminClient().rpc("commercial_discovery_run_read_model_v2", { p_limit: 10 });
  if (error) throw new Error("commercial_discovery_read_failed");
  const root = row(data); const summary = row(root.summary);
  return { latest: (Array.isArray(root.latest) ? root.latest : []).map(runFromRow), summary: { lastRunAt: nullableText(summary.last_run_at), running: number(summary.running), discovered: number(summary.discovered), enriched: number(summary.enriched), scored: number(summary.scored), p1: number(summary.p1), p2: number(summary.p2) } };
}
