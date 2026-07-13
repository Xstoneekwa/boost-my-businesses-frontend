import { createSupabaseClient } from "../supabase.ts";
import type { FollowerSnapshotRow } from "../instagram-client/follower-snapshot-contract.ts";
import {
  collectFollowerObservationViaPublicLookup,
  insertFollowerSnapshot,
  listActivePlatformInstagramAccounts,
  type ActivePlatformInstagramAccount,
} from "./follower-snapshot-collector.ts";

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
  dependencies?: DailyFollowerSnapshotDependencies;
}) {
  const dependencies = input.dependencies ?? {};
  const now = input.now ?? new Date();
  const listAccounts = dependencies.listAccounts ?? listActivePlatformInstagramAccounts;
  const loadSnapshots = dependencies.loadSnapshots ?? loadFollowerSnapshots;
  const collect = dependencies.collect ?? collectFollowerObservationViaPublicLookup;
  const insert = dependencies.insert ?? insertFollowerSnapshot;
  const accounts = await listAccounts();
  const snapshots = await loadSnapshots(accounts.map((account) => account.id));
  const plan = planDailyFollowerSnapshots({ accounts, snapshots, now });

  if (input.dryRun) {
    return {
      dryRun: true,
      businessTimezone: FOLLOWER_SNAPSHOT_BUSINESS_TIMEZONE,
      plannedAt: now.toISOString(),
      plan,
      inserted: 0,
      failed: 0,
    };
  }

  const results: Array<Record<string, unknown>> = [];
  for (const item of plan) {
    if (item.action === "skip") {
      results.push({ ...item, status: "skipped" });
      continue;
    }

    const observation = await collect(item.username);
    if (!observation.ok) {
      results.push({ ...item, status: "failed", failureReason: observation.reason });
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
    results.push(inserted.ok
      ? { ...item, status: "inserted", snapshotId: inserted.row.id, capturedAt: inserted.row.captured_at }
      : { ...item, status: "failed", failureReason: inserted.reason });
  }

  return {
    dryRun: false,
    businessTimezone: FOLLOWER_SNAPSHOT_BUSINESS_TIMEZONE,
    plannedAt: now.toISOString(),
    plan,
    results,
    inserted: results.filter((row) => row.status === "inserted").length,
    failed: results.filter((row) => row.status === "failed").length,
  };
}
