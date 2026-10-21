import { traceStep, traceMetric, traceFallback } from "./profiles-live-causal-context.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectSocialProfileSnapshots, type SocialProfileSnapshotRow } from "./social-profile-snapshot-contract.ts";
import { projectSocialProfileFollowerDelta3d } from "./social-profile-growth-projection.ts";
import { constrainProfilesLiveQuery } from "./profiles-live-resilience.ts";

export const CANONICAL_SOCIAL_SNAPSHOT_TABLE = "ig_account_social_profile_snapshots";
export const CANONICAL_SOCIAL_SNAPSHOT_FIELDS = "account_id,username_normalized,followers_count,following_count,posts_count,observed_at,snapshot_local_date,account_timezone,timezone_source,source_provider,source_trigger,source_event_id,source_run_id,source_business_session_id,lookup_status,freshness_status,idempotency_key";

// Shared by full Profiles (and therefore Live) and Stats. Never substitute
// ig_accounts mutable counters or an absent legacy table for canonical evidence.
export async function readCanonicalSocialSnapshots(client: SupabaseClient, input: {
  accountIds: string[]; since: string; until: string; includeLastValidGrowth?: boolean;
}) {
  const ids = [...new Set(input.accountIds)];
  const rows: SocialProfileSnapshotRow[] = [];
  if (!ids.length) return { data: rows, error: null };
  const pageSize = 500;
  let expectedCount: number | null = null;
  const paginationStartedAt = performance.now();
  for (let page = 0; page < 40; page++) {
    traceMetric("growth.pagination_pages", page + 1);
    const result = await traceStep("growth.snapshot_page", () => constrainProfilesLiveQuery(client.from(CANONICAL_SOCIAL_SNAPSHOT_TABLE)
      .select(CANONICAL_SOCIAL_SNAPSHOT_FIELDS, { count: "exact" }).in("account_id", ids).eq("lookup_status", "found")
      .gte("observed_at", input.since).lte("observed_at", input.until)
      .order("observed_at", { ascending: true }).order("idempotency_key", { ascending: true })
      .range(rows.length, rows.length + pageSize - 1)), { page: page + 1, offset: rows.length, page_size: pageSize });
    traceMetric("growth.pagination_ms", performance.now() - paginationStartedAt);
    if (result.error) {
      traceFallback("growth_snapshot_page_error");
      return { data: [], error: result.error };
    }
    if (!Array.isArray(result.data)) {
      traceFallback("growth_snapshot_data_unavailable");
      return { data: [], error: { message: "Canonical snapshot data unavailable" } };
    }
    if (result.count === null || (expectedCount !== null && expectedCount !== result.count)) {
      traceFallback("growth_snapshot_count_unavailable_or_changed");
      return { data: [], error: { message: "Canonical snapshot completeness changed or unavailable" } };
    }
    expectedCount = result.count;
    const batch = (result.data ?? []) as SocialProfileSnapshotRow[];
    if (batch.some(row => !ids.includes(row.account_id))) {
      traceFallback("growth_snapshot_scope_mismatch");
      return { data: [], error: { message: "Canonical snapshot account scope mismatch" } };
    }
    rows.push(...batch);
    traceMetric("growth.pagination_rows", rows.length);
    if (rows.length === expectedCount && new Set(rows.map(row => row.idempotency_key)).size === rows.length) {
      if (!input.includeLastValidGrowth) return { data: rows, error: null };
      // The display window must not expire a previously complete growth pair.
      // Read the pair from durable canonical history, never a process-local cache.
      const retained = await traceStep("growth.retained_snapshots_rpc", () => constrainProfilesLiveQuery(client.rpc("read_last_complete_growth_snapshots_v1", {
        p_account_ids: ids, p_until: input.until,
      })), { account_count: ids.length });
      if (retained.error) {
        traceFallback("growth_retained_snapshots_rpc_error");
        return { data: [], error: retained.error };
      }
      if (!Array.isArray(retained.data)) {
        traceFallback("growth_retained_snapshot_data_unavailable");
        return { data: [], error: { message: "Retained growth snapshot data unavailable" } };
      }
      const history = retained.data as SocialProfileSnapshotRow[];
      if (history.some(row => !ids.includes(row.account_id)
        || !Number.isFinite(Date.parse(row.observed_at)) || Date.parse(row.observed_at) > Date.parse(input.until))) {
        traceFallback("growth_retained_snapshot_scope_or_timestamp_mismatch");
        return { data: [], error: { message: "Retained growth snapshot scope or timestamp mismatch" } };
      }
      const combined = new Map(rows.map(row => [row.idempotency_key, row]));
      for (const row of history) if (!combined.has(row.idempotency_key)) combined.set(row.idempotency_key, row);
      return { data: [...combined.values()], error: null };
    }
    if (!batch.length || rows.length > expectedCount) break;
  }
  traceFallback("growth_snapshot_read_incomplete");
  return { data: [], error: { message: "Canonical snapshot read incomplete" } };
}

export function canonicalSocialSnapshotProjection(rows: SocialProfileSnapshotRow[], accountId: string, now: Date) {
  const scoped = rows.filter(row => row.account_id === accountId && Date.parse(row.observed_at) <= now.getTime());
  return {
    stats: projectSocialProfileSnapshots({ rows: scoped, now }),
    followerDelta3d: projectSocialProfileFollowerDelta3d({ rows: scoped, now }),
  };
}
