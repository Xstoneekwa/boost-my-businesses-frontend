import type { SupabaseClient } from "@supabase/supabase-js";
import { projectSocialProfileSnapshots, type SocialProfileSnapshotRow } from "./social-profile-snapshot-contract.ts";
import { projectSocialProfileFollowerDelta3d } from "./social-profile-growth-projection.ts";

export const CANONICAL_SOCIAL_SNAPSHOT_TABLE = "ig_account_social_profile_snapshots";
export const CANONICAL_SOCIAL_SNAPSHOT_FIELDS = "account_id,username_normalized,followers_count,following_count,posts_count,observed_at,snapshot_local_date,account_timezone,timezone_source,source_provider,source_trigger,source_event_id,source_run_id,source_business_session_id,lookup_status,freshness_status,idempotency_key";

// Shared by full Profiles (and therefore Live) and Stats. Never substitute
// ig_accounts mutable counters or an absent legacy table for canonical evidence.
export async function readCanonicalSocialSnapshots(client: SupabaseClient, input: {
  accountIds: string[]; since: string; until: string;
}) {
  const ids = [...new Set(input.accountIds)];
  const rows: SocialProfileSnapshotRow[] = [];
  if (!ids.length) return { data: rows, error: null };
  const pageSize = 500;
  let expectedCount: number | null = null;
  for (let page = 0; page < 40; page++) {
    const result = await client.from(CANONICAL_SOCIAL_SNAPSHOT_TABLE)
      .select(CANONICAL_SOCIAL_SNAPSHOT_FIELDS, { count: "exact" }).in("account_id", ids).eq("lookup_status", "found")
      .gte("observed_at", input.since).lte("observed_at", input.until)
      .order("observed_at", { ascending: true }).order("idempotency_key", { ascending: true })
      .range(rows.length, rows.length + pageSize - 1);
    if (result.error) return { data: [], error: result.error };
    if (result.count === null || (expectedCount !== null && expectedCount !== result.count)) {
      return { data: [], error: { message: "Canonical snapshot completeness changed or unavailable" } };
    }
    expectedCount = result.count;
    const batch = (result.data ?? []) as SocialProfileSnapshotRow[];
    if (batch.some(row => !ids.includes(row.account_id))) return { data: [], error: { message: "Canonical snapshot account scope mismatch" } };
    rows.push(...batch);
    if (rows.length === expectedCount && new Set(rows.map(row => row.idempotency_key)).size === rows.length) return { data: rows, error: null };
    if (!batch.length || rows.length > expectedCount) break;
  }
  return { data: [], error: { message: "Canonical snapshot read incomplete" } };
}

export function canonicalSocialSnapshotProjection(rows: SocialProfileSnapshotRow[], accountId: string, now: Date) {
  const scoped = rows.filter(row => row.account_id === accountId && Date.parse(row.observed_at) <= now.getTime());
  return {
    stats: projectSocialProfileSnapshots({ rows: scoped, now }),
    followerDelta3d: projectSocialProfileFollowerDelta3d({ rows: scoped, now }),
  };
}
