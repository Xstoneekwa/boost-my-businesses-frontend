import { createSupabaseClient } from "../supabase.ts";
import type { FollowerSnapshotRow } from "../instagram-client/follower-snapshot-contract.ts";
import {
  collectFollowerObservationViaPublicLookup,
  insertFollowerSnapshot,
  listActivePlatformInstagramAccounts,
  type ActivePlatformInstagramAccount,
} from "./follower-snapshot-collector.ts";
import {
  createFollowerCollectorTraceWriter,
  followerCollectorRunId,
  followerCollectorScheduledAt,
  sanitizeFollowerCollectorFailureReason,
  type FollowerCollectorTriggerContext,
  type FollowerCollectorTraceWriter,
} from "./follower-snapshot-runtime-trace.ts";

export const FOLLOWER_SNAPSHOT_BUSINESS_TIMEZONE = "Africa/Johannesburg";

export type DailyFollowerSnapshotPlanItem = ActivePlatformInstagramAccount & {
  action: "baseline" | "daily" | "skip";
  reason: "first_snapshot" | "daily_snapshot_due" | "already_collected_today";
  latestCapturedAt: string | null;
};

type DailyFollowerSnapshotDependencies = {
  listAccounts?: () => Promise<ActivePlatformInstagramAccount[]>;
  loadSnapshots?: (accountIds: string[]) => Promise<FollowerSnapshotRow[]>;
  collect?: typeof collectFollowerObservationViaPublicLookup;
  insert?: typeof insertFollowerSnapshot;
  trace?: FollowerCollectorTraceWriter | null;
};

function businessDayKey(value: string | Date, timeZone = FOLLOWER_SNAPSHOT_BUSINESS_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function planDailyFollowerSnapshots(input: {
  accounts: ActivePlatformInstagramAccount[];
  snapshots: FollowerSnapshotRow[];
  now: Date;
  timeZone?: string;
}): DailyFollowerSnapshotPlanItem[] {
  const timeZone = input.timeZone ?? FOLLOWER_SNAPSHOT_BUSINESS_TIMEZONE;
  const currentBusinessDay = businessDayKey(input.now, timeZone);
  const snapshotsByAccount = new Map<string, FollowerSnapshotRow[]>();

  for (const snapshot of input.snapshots) {
    const rows = snapshotsByAccount.get(snapshot.account_id) ?? [];
    rows.push(snapshot);
    snapshotsByAccount.set(snapshot.account_id, rows);
  }

  return input.accounts.map((account) => {
    const snapshots = (snapshotsByAccount.get(account.id) ?? [])
      .filter((row) => !Number.isNaN(new Date(row.captured_at).getTime()))
      .sort((left, right) => right.captured_at.localeCompare(left.captured_at));
    const latest = snapshots[0];
    if (!latest) {
      return { ...account, action: "baseline", reason: "first_snapshot", latestCapturedAt: null };
    }
    if (businessDayKey(latest.captured_at, timeZone) === currentBusinessDay) {
      return {
        ...account,
        action: "skip",
        reason: "already_collected_today",
        latestCapturedAt: latest.captured_at,
      };
    }
    return {
      ...account,
      action: "daily",
      reason: "daily_snapshot_due",
      latestCapturedAt: latest.captured_at,
    };
  });
}

async function loadFollowerSnapshots(accountIds: string[]) {
  if (!accountIds.length) return [];
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_account_follower_snapshots")
    .select("id,account_id,followers_count,captured_at,source,observation_kind,created_at")
    .in("account_id", accountIds)
    .order("captured_at", { ascending: false })
    .limit(10000);
  if (error) throw new Error(error.message);
  return (data ?? []) as FollowerSnapshotRow[];
}

export async function runDailyFollowerSnapshotCollection(input: {
  dryRun?: boolean;
  now?: Date;
  scheduledAt?: string;
  triggerContext?: FollowerCollectorTriggerContext;
  dependencies?: DailyFollowerSnapshotDependencies;
}) {
  const dependencies = input.dependencies ?? {};
  const now = input.now ?? new Date();
  const scheduledAt = input.scheduledAt ?? followerCollectorScheduledAt(now);
  const collectorRunId = followerCollectorRunId(scheduledAt);
  const startedAt = now.toISOString();
  const listAccounts = dependencies.listAccounts ?? listActivePlatformInstagramAccounts;
  const loadSnapshots = dependencies.loadSnapshots ?? loadFollowerSnapshots;
  const collect = dependencies.collect ?? collectFollowerObservationViaPublicLookup;
  const insert = dependencies.insert ?? insertFollowerSnapshot;
  const trace = dependencies.trace === undefined
    ? input.dependencies ? null : createFollowerCollectorTraceWriter(undefined, input.triggerContext)
    : dependencies.trace;

  let accounts: ActivePlatformInstagramAccount[] = [];
  let plan: DailyFollowerSnapshotPlanItem[] = [];

  if (!input.dryRun && trace) {
    await trace.writeRun({
      collectorRunId,
      scheduledAt,
      startedAt,
      completedAt: null,
      status: "running",
      accountsSelected: 0,
      accountsSucceeded: 0,
      accountsFailed: 0,
      accountsSkipped: 0,
      provider: "public_profile_lookup",
      failureReason: null,
    });
  }

  try {
    accounts = await listAccounts();
    const snapshots = await loadSnapshots(accounts.map((account) => account.id));
    plan = planDailyFollowerSnapshots({ accounts, snapshots, now });
  } catch (error) {
    if (!input.dryRun && trace) {
      await trace.writeRun({
        collectorRunId,
        scheduledAt,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        accountsSelected: 0,
        accountsSucceeded: 0,
        accountsFailed: 0,
        accountsSkipped: 0,
        provider: "public_profile_lookup",
        failureReason: sanitizeFollowerCollectorFailureReason(error instanceof Error ? error.message : error),
      });
    }
    throw error;
  }

  if (input.dryRun) {
    return {
      dryRun: true,
      businessTimezone: FOLLOWER_SNAPSHOT_BUSINESS_TIMEZONE,
      plannedAt: now.toISOString(),
      scheduledAt,
      collectorRunId,
      plan,
      inserted: 0,
      failed: 0,
    };
  }

  const results: Array<Record<string, unknown>> = [];
  for (const item of plan) {
    const attemptedAt = new Date().toISOString();
    if (item.action === "skip") {
      const result = { ...item, status: "skipped" };
      results.push(result);
      await trace?.writeAccount(collectorRunId, {
        accountId: item.id,
        accountUsername: item.username,
        attemptedAt,
        status: "skipped",
        followersCount: null,
        provider: null,
        failureReason: item.reason,
        snapshotWritten: false,
        snapshotTimestamp: null,
      });
      continue;
    }

    const observation = await collect(item.username);
    if (!observation.ok) {
      const result = { ...item, status: "failed", failureReason: observation.reason };
      results.push(result);
      await trace?.writeAccount(collectorRunId, {
        accountId: item.id,
        accountUsername: item.username,
        attemptedAt,
        status: "failed",
        followersCount: null,
        provider: observation.sourceAttempted,
        failureReason: observation.reason,
        snapshotWritten: false,
        snapshotTimestamp: null,
      });
      continue;
    }

    const inserted = await insert({
      accountId: item.id,
      followersCount: observation.followersCount,
      capturedAt: observation.capturedAt,
      source: observation.source,
      observationKind: item.action,
      mirrorToIgAccounts: true,
    });
    if (inserted.ok) {
      const created = inserted.created !== false;
      results.push({
        ...item,
        status: created ? "inserted" : "skipped",
        reason: created ? item.reason : "snapshot_already_exists",
        snapshotId: inserted.row.id,
        capturedAt: inserted.row.captured_at,
      });
      await trace?.writeAccount(collectorRunId, {
        accountId: item.id,
        accountUsername: item.username,
        attemptedAt,
        status: created ? "succeeded" : "skipped",
        followersCount: inserted.row.followers_count,
        provider: observation.source,
        failureReason: created ? null : "snapshot_already_exists",
        snapshotWritten: created,
        snapshotTimestamp: inserted.row.captured_at,
      });
    } else {
      results.push({ ...item, status: "failed", failureReason: inserted.reason });
      await trace?.writeAccount(collectorRunId, {
        accountId: item.id,
        accountUsername: item.username,
        attemptedAt,
        status: "failed",
        followersCount: observation.followersCount,
        provider: observation.source,
        failureReason: inserted.reason,
        snapshotWritten: false,
        snapshotTimestamp: observation.capturedAt,
      });
    }
  }

  const insertedCount = results.filter((row) => row.status === "inserted").length;
  const failedCount = results.filter((row) => row.status === "failed").length;
  const skippedCount = results.filter((row) => row.status === "skipped").length;
  const status = failedCount === 0 ? "succeeded" : insertedCount > 0 || skippedCount > 0 ? "partial" : "failed";
  const failureReasons = [...new Set(results
    .filter((row) => row.status === "failed")
    .map((row) => sanitizeFollowerCollectorFailureReason(row.failureReason))
  )];
  await trace?.writeRun({
    collectorRunId,
    scheduledAt,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    accountsSelected: plan.length,
    accountsSucceeded: insertedCount,
    accountsFailed: failedCount,
    accountsSkipped: skippedCount,
    provider: "public_profile_lookup",
    failureReason: failureReasons.join(",") || null,
  });

  return {
    dryRun: false,
    businessTimezone: FOLLOWER_SNAPSHOT_BUSINESS_TIMEZONE,
    plannedAt: now.toISOString(),
    scheduledAt,
    collectorRunId,
    plan,
    results,
    inserted: insertedCount,
    failed: failedCount,
    skipped: skippedCount,
    status,
  };
}
