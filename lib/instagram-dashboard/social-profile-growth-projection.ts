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
  const rows = reliableRows(input.rows);
  const current = rows.at(-1) ?? null;
  const nowMs = input.now instanceof Date ? input.now.getTime() : timestamp(input.now);
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
  const targetMs = currentMs - FOLLOWER_DELTA_WINDOW_HOURS * 3600_000;
  const toleranceMs = FOLLOWER_DELTA_BASELINE_TOLERANCE_HOURS * 3600_000;
  const baseline = rows
    .filter((row) => row !== current)
    .map((row) => ({ row, distance: Math.abs(timestamp(row.observed_at) - targetMs) }))
    .filter(({ distance }) => distance <= toleranceMs)
    .sort((left, right) => left.distance - right.distance
      || timestamp(right.row.observed_at) - timestamp(left.row.observed_at))[0]?.row ?? null;
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
