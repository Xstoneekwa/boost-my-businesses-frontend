import { businessDayKeyFromIso, normalizeBusinessTimezone } from "./business-timezone.ts";
import {
  isAllowedFollowerSnapshotSource,
  isReliableFollowerCount,
  type FollowerSnapshotRow,
} from "../instagram-client/follower-snapshot-contract.ts";

export type StatsFollowerSnapshotStatus = "available" | "stale" | "no_data";

export function projectStatsFollowerSnapshots(input: {
  rows: FollowerSnapshotRow[];
  timezone?: string | null;
  now?: Date;
  staleAfterHours?: number;
}) {
  const timezone = normalizeBusinessTimezone(input.timezone);
  const now = input.now ?? new Date();
  const staleAfterHours = input.staleAfterHours ?? 36;
  const reliable = input.rows
    .filter((row) => isAllowedFollowerSnapshotSource(row.source))
    .filter((row) => isReliableFollowerCount(row.followers_count))
    .filter((row) => !Number.isNaN(new Date(row.captured_at).getTime()))
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at));

  const latest = reliable.at(-1) ?? null;
  const latestAt = latest ? new Date(latest.captured_at).getTime() : null;
  const stale = latestAt !== null && now.getTime() - latestAt > staleAfterHours * 60 * 60 * 1000;
  const byDay = new Map<string, FollowerSnapshotRow>();
  for (const row of reliable) {
    const date = businessDayKeyFromIso(row.captured_at, timezone);
    if (date) byDay.set(date, row);
  }

  return {
    timezone,
    points: [...byDay.entries()].map(([date, row]) => ({
      date,
      followersCount: row.followers_count,
      capturedAt: row.captured_at,
      source: row.source,
      freshnessStatus: stale && row === latest ? "stale" as const : "available" as const,
    })),
    sourceStatus: {
      status: latest === null ? "no_data" as const : stale ? "stale" as const : "available" as const,
      latestAt: latest?.captured_at ?? null,
      source: latest?.source ?? "ig_account_follower_snapshots",
      staleAfterHours,
    },
  };
}
