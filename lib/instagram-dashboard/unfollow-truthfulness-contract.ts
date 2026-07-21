type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function projectUnfollowTruthfulness(
  unfollowDoneToday: number,
  unfollowDailyCap: number,
  runs: Row[],
) {
  const latestRun = runs[0];
  const performance = record(latestRun?.performance_summary);
  return {
    unfollowDoneToday,
    unfollowDailyCap,
    unfollowEffectiveLimit: number(performance?.unfollow_effective_limit),
    lastRunEligibleAtStart: number(performance?.last_run_eligible_at_start),
    lastRunAttempted: number(performance?.last_run_attempted),
    lastRunVerified: number(performance?.last_run_verified)
      ?? number(performance?.unfollow_actions_verified),
    lastRunRemainingEligible: number(performance?.last_run_remaining_eligible),
    lastRunCoverageStatus: text(performance?.last_run_coverage_status),
    lastRunStopReason: text(performance?.last_run_stop_reason),
    metricsAsOf: latestRun
      ? text(latestRun.finished_at) ?? text(latestRun.started_at) ?? text(latestRun.created_at)
      : null,
    source: latestRun ? "ig_runs.performance_summary" : "unavailable",
  };
}
