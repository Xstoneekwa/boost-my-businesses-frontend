import { readString } from "../instagram-client/guards.ts";
import type { createSupabaseClient } from "../supabase.ts";

type TargetEligibilitySupabase = ReturnType<typeof createSupabaseClient>;

export const ACCOUNT_TARGET_ELIGIBILITY_SELECT =
  "id,status,quality_status,verification_status,archived_at,deleted_at";

export type TargetEligibilityRow = {
  status?: unknown;
  quality_status?: unknown;
  verification_status?: unknown;
  archived_at?: unknown;
  deleted_at?: unknown;
};

export type TargetEligibilityCounts = {
  total: number;
  valid: number;
  eligible: number;
  pending: number;
  rejected: number;
  archived: number;
};

export function normalizeEligibilityToken(value: unknown) {
  return readString(value, "").trim().toLowerCase();
}

export function isTargetRowActive(row: TargetEligibilityRow) {
  const status = normalizeEligibilityToken(row.status);
  return status !== "archived"
    && status !== "deleted"
    && !readString(row.archived_at, "")
    && !readString(row.deleted_at, "");
}

export function isTargetRowCanonicallyEligible(row: TargetEligibilityRow) {
  if (!isTargetRowActive(row)) return false;
  const status = normalizeEligibilityToken(row.status);
  const quality = normalizeEligibilityToken(row.quality_status);
  const verification = normalizeEligibilityToken(row.verification_status);
  return ["valid", "active"].includes(status)
    && (!quality || quality === "eligible")
    && (!verification || verification === "found");
}

export function summarizeTargetEligibilityRows(rows: TargetEligibilityRow[]): TargetEligibilityCounts {
  const activeRows = rows.filter(isTargetRowActive);
  const eligibleRows = activeRows.filter(isTargetRowCanonicallyEligible);
  return {
    total: activeRows.length,
    valid: activeRows.filter((row) => ["valid", "active"].includes(normalizeEligibilityToken(row.status))).length,
    eligible: eligibleRows.length,
    pending: activeRows.filter((row) => {
      const status = normalizeEligibilityToken(row.status);
      const quality = normalizeEligibilityToken(row.quality_status);
      return ["pending", "pending_verification", "review"].includes(status)
        || quality === "unknown"
        || quality.startsWith("review_");
    }).length,
    rejected: activeRows.filter((row) => {
      const status = normalizeEligibilityToken(row.status);
      const quality = normalizeEligibilityToken(row.quality_status);
      return status === "rejected" || quality.startsWith("rejected_");
    }).length,
    archived: rows.length - activeRows.length,
  };
}

export async function loadTargetEligibilityCountsForAccount(
  supabase: TargetEligibilitySupabase,
  accountId: string,
): Promise<TargetEligibilityCounts> {
  const empty: TargetEligibilityCounts = {
    total: 0,
    valid: 0,
    eligible: 0,
    pending: 0,
    rejected: 0,
    archived: 0,
  };
  if (!accountId.trim()) return empty;
  try {
    const result = await supabase
      .from("ig_targets")
      .select(ACCOUNT_TARGET_ELIGIBILITY_SELECT)
      .eq("account_id", accountId)
      .limit(500);
    if (result.error) return empty;
    return summarizeTargetEligibilityRows(result.data ?? []);
  } catch {
    return empty;
  }
}

export async function loadTargetEligibilityCountsByAccount(
  supabase: TargetEligibilitySupabase,
  accountIds: string[],
): Promise<Map<string, TargetEligibilityCounts>> {
  const out = new Map<string, TargetEligibilityCounts>();
  const uniqueIds = [...new Set(accountIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return out;

  try {
    const { data, error } = await supabase
      .from("ig_targets")
      .select(`account_id,${ACCOUNT_TARGET_ELIGIBILITY_SELECT}`)
      .in("account_id", uniqueIds)
      .limit(5000);

    if (error) return out;
    const grouped = new Map<string, TargetEligibilityRow[]>();
    for (const row of data ?? []) {
      const accountId = readString(row.account_id, "");
      if (!accountId) continue;
      grouped.set(accountId, [...(grouped.get(accountId) ?? []), row]);
    }
    for (const accountId of uniqueIds) {
      out.set(accountId, summarizeTargetEligibilityRows(grouped.get(accountId) ?? []));
    }
  } catch {
    // Caller falls back to per-account zeros.
  }
  return out;
}
