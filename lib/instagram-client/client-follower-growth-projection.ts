import {
  businessDayKeyFromIso,
  normalizeBusinessTimezone,
  zonedLocalDateTimeToUtc,
  zonedDateParts,
} from "../instagram-dashboard/business-timezone.ts";
import {
  isAllowedFollowerSnapshotSource,
  isReliableFollowerCount,
  type FollowerSnapshotRow,
} from "./follower-snapshot-contract.ts";

export type FollowerGrowthPeriod = "all" | "30d" | "daily";

export type FollowerCoverageStatus = "none" | "baseline_only" | "partial" | "complete";

export type FollowerDeltaStatus = "unknown" | "zero" | "positive" | "negative";

export type FollowerGrowthPoint = {
  capturedAt: string;
  followersCount: number;
  businessDayKey: string;
};

export type ClientFollowerGrowthSeries = {
  period: FollowerGrowthPeriod;
  businessTimezone: string;
  clientLinkedAt: string | null;
  currentFollowers: number | null;
  currentCapturedAt: string | null;
  periodStartFollowers: number | null;
  periodStartCapturedAt: string | null;
  delta: number | null;
  deltaStatus: FollowerDeltaStatus;
  historyStartDate: string | null;
  points: FollowerGrowthPoint[];
  coverageStatus: FollowerCoverageStatus;
};

export type ProjectFollowerGrowthInput = {
  accountId: string;
  snapshots: FollowerSnapshotRow[];
  clientLinkedAt: string | null;
  businessTimezone?: string | null;
  period: FollowerGrowthPeriod;
  now?: Date;
};

function readSnapshotTime(row: FollowerSnapshotRow) {
  const date = new Date(row.captured_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function filterReliableFollowerSnapshots(rows: FollowerSnapshotRow[]) {
  return rows
    .filter((row) => isAllowedFollowerSnapshotSource(row.source))
    .filter((row) => isReliableFollowerCount(row.followers_count))
    .map((row) => ({ ...row, captured_at: new Date(row.captured_at).toISOString() }))
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at));
}

function subtractCalendarDays(dayKey: string, days: number) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day - days, 0, 0, 0, 0));
  return utc.toISOString().slice(0, 10);
}

function businessDayStartIso(dayKey: string, timezone: string) {
  return zonedLocalDateTimeToUtc(dayKey, "00:00", timezone).toISOString();
}

function resolveDeltaStatus(delta: number | null): FollowerDeltaStatus {
  if (delta === null) return "unknown";
  if (delta === 0) return "zero";
  return delta > 0 ? "positive" : "negative";
}

function snapshotAtOrBefore(sorted: FollowerSnapshotRow[], instantIso: string) {
  const target = new Date(instantIso).getTime();
  let match: FollowerSnapshotRow | null = null;
  for (const row of sorted) {
    const time = readSnapshotTime(row);
    if (!time || time.getTime() > target) break;
    match = row;
  }
  return match;
}

function snapshotsAfterClientLink(sorted: FollowerSnapshotRow[], clientLinkedAt: string | null) {
  if (!clientLinkedAt) return sorted;
  const linkedAt = new Date(clientLinkedAt).getTime();
  if (Number.isNaN(linkedAt)) return sorted;
  return sorted.filter((row) => {
    const time = readSnapshotTime(row);
    return time !== null && time.getTime() >= linkedAt;
  });
}

function lastSnapshotPerBusinessDay(sorted: FollowerSnapshotRow[], timezone: string) {
  const byDay = new Map<string, FollowerSnapshotRow>();
  for (const row of sorted) {
    const dayKey = businessDayKeyFromIso(row.captured_at, timezone);
    if (!dayKey) continue;
    byDay.set(dayKey, row);
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => ({
      capturedAt: row.captured_at,
      followersCount: row.followers_count,
      businessDayKey: businessDayKeyFromIso(row.captured_at, timezone),
    }));
}

function intradayPointsForToday(sorted: FollowerSnapshotRow[], timezone: string, now: Date) {
  const todayKey = businessDayKeyFromIso(now.toISOString(), timezone);
  return sorted
    .filter((row) => businessDayKeyFromIso(row.captured_at, timezone) === todayKey)
    .map((row) => ({
      capturedAt: row.captured_at,
      followersCount: row.followers_count,
      businessDayKey: todayKey,
    }));
}

function resolveCoverageStatus(pointCount: number, delta: number | null, period: FollowerGrowthPeriod): FollowerCoverageStatus {
  if (pointCount <= 0) return "none";
  if (pointCount === 1) return "baseline_only";
  if (period === "daily" && pointCount < 2) return "baseline_only";
  if (delta === null) return "partial";
  return "complete";
}

export function projectClientFollowerGrowthSeries(input: ProjectFollowerGrowthInput): ClientFollowerGrowthSeries {
  const timezone = normalizeBusinessTimezone(input.businessTimezone);
  const now = input.now ?? new Date();
  const reliable = filterReliableFollowerSnapshots(input.snapshots);
  const linked = snapshotsAfterClientLink(reliable, input.clientLinkedAt);

  const latest = linked.length ? linked[linked.length - 1] : null;
  const base: ClientFollowerGrowthSeries = {
    period: input.period,
    businessTimezone: timezone,
    clientLinkedAt: input.clientLinkedAt,
    currentFollowers: latest?.followers_count ?? null,
    currentCapturedAt: latest?.captured_at ?? null,
    periodStartFollowers: null,
    periodStartCapturedAt: null,
    delta: null,
    deltaStatus: "unknown",
    historyStartDate: linked[0]?.captured_at ?? null,
    points: [],
    coverageStatus: linked.length === 0 ? "none" : linked.length === 1 ? "baseline_only" : "partial",
  };

  if (!linked.length) return base;

  if (input.period === "daily") {
    const todayKey = businessDayKeyFromIso(now.toISOString(), timezone);
    const dayStartIso = businessDayStartIso(todayKey, timezone);
    const todaySnapshots = linked.filter((row) => businessDayKeyFromIso(row.captured_at, timezone) === todayKey);
    const reference = snapshotAtOrBefore(linked, dayStartIso);
    const points = intradayPointsForToday(linked, timezone, now);
    const latestForDelta = todaySnapshots.length ? todaySnapshots[todaySnapshots.length - 1] : latest;
    const delta = reference && latestForDelta && reference.captured_at < latestForDelta.captured_at
      ? latestForDelta.followers_count - reference.followers_count
      : null;

    return {
      ...base,
      periodStartFollowers: reference?.followers_count ?? null,
      periodStartCapturedAt: reference?.captured_at ?? null,
      delta,
      deltaStatus: resolveDeltaStatus(delta),
      points: points.length >= 2 ? points : [],
      coverageStatus: points.length >= 2
        ? resolveCoverageStatus(points.length, delta, "daily")
        : linked.length <= 1
          ? linked.length === 0 ? "none" : "baseline_only"
          : "partial",
    };
  }

  if (input.period === "30d") {
    const todayKey = businessDayKeyFromIso(now.toISOString(), timezone);
    const periodStartDayKey = subtractCalendarDays(todayKey, 30);
    const periodStartIso = businessDayStartIso(periodStartDayKey, timezone);
    const inWindow = linked.filter((row) => row.captured_at >= periodStartIso);
    const reference = snapshotAtOrBefore(linked, periodStartIso);
    const points = lastSnapshotPerBusinessDay(inWindow, timezone);
    const delta = reference && latest ? latest.followers_count - reference.followers_count : null;

    return {
      ...base,
      periodStartFollowers: reference?.followers_count ?? null,
      periodStartCapturedAt: reference?.captured_at ?? null,
      delta: reference ? delta : null,
      deltaStatus: resolveDeltaStatus(reference ? delta : null),
      historyStartDate: inWindow[0]?.captured_at ?? null,
      points: points.length >= 2 ? points : [],
      coverageStatus: linked.length === 1
        ? "baseline_only"
        : resolveCoverageStatus(points.length, reference ? delta : null, "30d"),
    };
  }

  const reference = linked[0] ?? null;
  const points = lastSnapshotPerBusinessDay(linked, timezone);
  const delta = linked.length >= 2 && latest && reference
    ? latest.followers_count - reference.followers_count
    : null;

  return {
    ...base,
    periodStartFollowers: reference?.followers_count ?? null,
    periodStartCapturedAt: reference?.captured_at ?? null,
    delta,
    deltaStatus: resolveDeltaStatus(delta),
    historyStartDate: reference?.captured_at ?? null,
    points: points.length >= 2 ? points : [],
    coverageStatus: linked.length === 1
      ? "baseline_only"
      : resolveCoverageStatus(points.length, delta, "all"),
  };
}

export function buildClientFollowerGrowthBundle(input: Omit<ProjectFollowerGrowthInput, "period">) {
  return {
    all: projectClientFollowerGrowthSeries({ ...input, period: "all" }),
    d30: projectClientFollowerGrowthSeries({ ...input, period: "30d" }),
    daily: projectClientFollowerGrowthSeries({ ...input, period: "daily" }),
  };
}

export type ClientFollowerGrowthBundle = ReturnType<typeof buildClientFollowerGrowthBundle>;

export function businessNowParts(now: Date, timezone: string) {
  return zonedDateParts(now, timezone);
}
