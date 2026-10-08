import type { SocialProfileSnapshotRow } from "./social-profile-snapshot-contract.ts";

export const FOLLOWER_DELTA_WINDOW_HOURS = 72;
export const FOLLOWER_DELTA_BASELINE_TOLERANCE_HOURS = 24;
export const SOCIAL_PROFILE_FRESH_HOURS = 36;
export const SOCIAL_PROFILE_AGING_HOURS = 72;

export type FollowerDeltaFreshnessStatus =
  | "fresh"
  | "aging"
  | "stale"
  | "insufficient_data"
  | "unavailable";

function timestamp(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function reliableRows(rows: SocialProfileSnapshotRow[]) {
  return rows
    .filter((row) => row.lookup_status === "found")
    .filter((row) => Number.isSafeInteger(row.followers_count) && Number(row.followers_count) >= 0)
    .filter((row) => Number.isFinite(timestamp(row.observed_at)))
    .sort((left, right) => timestamp(left.observed_at) - timestamp(right.observed_at));
}

function freshnessStatus(ageSeconds: number): "fresh" | "aging" | "stale" {
  if (ageSeconds <= SOCIAL_PROFILE_FRESH_HOURS * 3600) return "fresh";
  if (ageSeconds <= SOCIAL_PROFILE_AGING_HOURS * 3600) return "aging";
  return "stale";
}

export function projectSocialProfileFollowerDelta3d(input: {
  rows: SocialProfileSnapshotRow[];
  now: string | Date;
}) {
  const nowMs = input.now instanceof Date ? input.now.getTime() : timestamp(input.now);
  // A projection belongs to one account. Never form a cross-account baseline.
  const accountIds = new Set(input.rows.map(row => row.account_id));
  const rows = accountIds.size === 1 && [...accountIds][0]
    ? reliableRows(input.rows).filter(row => timestamp(row.observed_at) <= nowMs && Boolean(row.source_provider?.trim()))
    : [];
  const toleranceMs = FOLLOWER_DELTA_BASELINE_TOLERANCE_HOURS * 3600_000;
  let current = rows.at(-1) ?? null;
  let baseline: SocialProfileSnapshotRow | null = null;
  // Walk newest observations first. An incomplete observation cannot erase
  // the latest complete business delta. Binary search keeps this O(n log n).
  for (let index = rows.length - 1; index >= 1; index--) {
    const target = timestamp(rows[index].observed_at) - FOLLOWER_DELTA_WINDOW_HOURS * 3600_000;
    let lo = 0;
    let hi = index;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (timestamp(rows[mid].observed_at) < target) lo = mid + 1;
      else hi = mid;
    }
    const candidate = [lo - 1, lo]
      .filter(position => position >= 0 && position < index)
      .map(position => ({ row: rows[position], distance: Math.abs(timestamp(rows[position].observed_at) - target) }))
      .filter(point => point.distance <= toleranceMs)
      .sort((a, b) => a.distance - b.distance || timestamp(b.row.observed_at) - timestamp(a.row.observed_at))[0];
    if (candidate) {
      current = rows[index];
      baseline = candidate.row;
      break;
    }
  }
  if (!current) {
    return {
      value: null,
      baselineValue: null,
      currentValue: null,
      currentFollowers: null,
      currentFollowings: null,
      baselineCapturedAt: null,
      currentCapturedAt: null,
      capturedAt: null,
      ageSeconds: null,
      windowHours: FOLLOWER_DELTA_WINDOW_HOURS,
      windowCoverageHours: null,
      status: "unavailable" as const,
      source: "ig_account_social_profile_snapshots" as const,
      sourceProvider: null,
    };
  }

  const currentMs = timestamp(current.observed_at);
  const ageSeconds = Math.max(0, Math.round((nowMs - currentMs) / 1000));
  const freshness = freshnessStatus(ageSeconds);
  const currentValue = Number(current.followers_count);
  const currentFollowings = Number.isSafeInteger(current.following_count)
    ? Number(current.following_count)
    : null;
  const baselineValue = baseline ? Number(baseline.followers_count) : null;
  const windowCoverageHours = baseline
    ? Math.round(((currentMs - timestamp(baseline.observed_at)) / 3600_000) * 100) / 100
    : null;

  return {
    value: baselineValue === null ? null : currentValue - baselineValue,
    baselineValue,
    currentValue,
    currentFollowers: currentValue,
    currentFollowings,
    baselineCapturedAt: baseline?.observed_at ?? null,
    currentCapturedAt: current.observed_at,
    capturedAt: current.observed_at,
    ageSeconds,
    windowHours: FOLLOWER_DELTA_WINDOW_HOURS,
    windowCoverageHours,
    status: baseline ? freshness : "insufficient_data" as FollowerDeltaFreshnessStatus,
    source: "ig_account_social_profile_snapshots" as const,
    sourceProvider: current.source_provider,
  };
}
