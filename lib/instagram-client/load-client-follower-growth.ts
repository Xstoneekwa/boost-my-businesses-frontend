import { createSupabaseClient } from "@/lib/supabase";
import {
  buildClientFollowerGrowthBundle,
  type ClientFollowerGrowthBundle,
  type ClientFollowerHistoryRow,
} from "./client-follower-growth-projection";
import { readString } from "./guards";

type SupabaseRecord = Record<string, unknown>;

export function isMissingSnapshotTableError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("ig_account_social_profile_snapshots")
    && (normalized.includes("does not exist") || normalized.includes("schema cache"));
}

export type LoadClientFollowerGrowthResult = {
  accountId: string;
  username: string;
  bundle: ClientFollowerGrowthBundle;
  snapshotTableAvailable: boolean;
  dataStatus: "ready" | "stale" | "insufficient" | "pending" | "unavailable" | "error";
};

function withFollowerSourceStatus(
  bundle: ClientFollowerGrowthBundle,
  status: "unavailable" | "error",
): ClientFollowerGrowthBundle {
  return {
    all: { ...bundle.all, freshnessStatus: status },
    d30: { ...bundle.d30, freshnessStatus: status },
    daily: { ...bundle.daily, freshnessStatus: status },
  };
}

export async function loadClientFollowerGrowthSeries(
  accountId: string,
  clientId?: string,
): Promise<LoadClientFollowerGrowthResult | null> {
  if (!accountId) return null;

  const supabase = createSupabaseClient();
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - 2);

  const [accountResult, linkResult, settingsResult, snapshotsResult] = await Promise.all([
    supabase
      .from("ig_accounts")
      .select("id,username")
      .eq("id", accountId)
      .maybeSingle(),
    supabase
      .from("client_instagram_accounts")
      .select("created_at")
      .eq("account_id", accountId)
      .eq("active", true)
      .match(clientId ? { client_id: clientId } : {})
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("ig_account_social_profile_snapshots")
      .select("account_timezone")
      .eq("account_id", accountId)
      .eq("lookup_status", "found")
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("ig_account_social_profile_snapshots")
      .select("id,account_id,followers_count,observed_at,source_provider,source_trigger,lookup_status,created_at")
      .eq("account_id", accountId)
      .eq("lookup_status", "found")
      .gte("observed_at", since.toISOString())
      .order("observed_at", { ascending: true })
      .limit(5000),
  ]);

  if (accountResult.error || !accountResult.data) return null;

  let snapshotTableAvailable = true;
  let sourceStatus: "ready" | "unavailable" | "error" = "ready";
  let snapshots: ClientFollowerHistoryRow[] = [];

  const sourceErrors = [settingsResult.error, snapshotsResult.error].filter(Boolean);
  if (sourceErrors.some((error) => isMissingSnapshotTableError(error?.message ?? ""))) {
    snapshotTableAvailable = false;
    sourceStatus = "unavailable";
  } else if (sourceErrors.length || linkResult.error || (clientId && !linkResult.data)) {
    sourceStatus = "error";
  }

  if (snapshotsResult.error) {
    if (isMissingSnapshotTableError(snapshotsResult.error.message)) {
      snapshotTableAvailable = false;
      sourceStatus = "unavailable";
    }
  } else {
    snapshots = ((snapshotsResult.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: readString(row.id),
      account_id: readString(row.account_id, accountId),
      followers_count: Number(row.followers_count),
      captured_at: readString(row.observed_at),
      source: "ig_account_social_profile_snapshots",
      observation_kind: readString(row.source_trigger, "daily_fallback") === "baseline_one_shot" ? "baseline" : "daily",
      lookup_status: readString(row.lookup_status),
      created_at: readString(row.created_at),
    }));
  }

  const clientLinkedAt = readString((linkResult.data as SupabaseRecord | null)?.created_at, "") || null;
  const businessTimezone = readString((settingsResult.data as SupabaseRecord | null)?.account_timezone, "");

  const projectedBundle = buildClientFollowerGrowthBundle({
    accountId,
    snapshots,
    clientLinkedAt,
    businessTimezone,
  });
  const bundle = sourceStatus === "ready"
    ? projectedBundle
    : withFollowerSourceStatus(projectedBundle, sourceStatus);

  return {
    accountId,
    username: readString(accountResult.data.username, "Instagram account"),
    bundle,
    snapshotTableAvailable,
    dataStatus: bundle.all.freshnessStatus,
  };
}
