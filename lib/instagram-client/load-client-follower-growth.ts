import { createSupabaseClient } from "@/lib/supabase";
import {
  buildClientFollowerGrowthBundle,
  type ClientFollowerGrowthBundle,
} from "./client-follower-growth-projection";
import type { FollowerSnapshotRow } from "./follower-snapshot-contract";
import { readString } from "./guards";

type SupabaseRecord = Record<string, unknown>;

function isMissingSnapshotTableError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("ig_account_follower_snapshots")
    && (normalized.includes("does not exist") || normalized.includes("schema cache"));
}

export type LoadClientFollowerGrowthResult = {
  accountId: string;
  username: string;
  bundle: ClientFollowerGrowthBundle;
  snapshotTableAvailable: boolean;
};

export async function loadClientFollowerGrowthSeries(accountId: string): Promise<LoadClientFollowerGrowthResult | null> {
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
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("ig_account_settings")
      .select("timezone")
      .eq("account_id", accountId)
      .maybeSingle(),
    supabase
      .from("ig_account_follower_snapshots")
      .select("id,account_id,followers_count,captured_at,source,observation_kind,created_at")
      .eq("account_id", accountId)
      .gte("captured_at", since.toISOString())
      .order("captured_at", { ascending: true })
      .limit(5000),
  ]);

  if (accountResult.error || !accountResult.data) return null;

  let snapshotTableAvailable = true;
  let snapshots: FollowerSnapshotRow[] = [];

  if (snapshotsResult.error) {
    if (isMissingSnapshotTableError(snapshotsResult.error.message)) {
      snapshotTableAvailable = false;
    } else {
      throw new Error(snapshotsResult.error.message);
    }
  } else {
    snapshots = ((snapshotsResult.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: readString(row.id),
      account_id: readString(row.account_id, accountId),
      followers_count: Number(row.followers_count),
      captured_at: readString(row.captured_at),
      source: readString(row.source),
      observation_kind: readString(row.observation_kind),
      created_at: readString(row.created_at),
    }));
  }

  const clientLinkedAt = readString((linkResult.data as SupabaseRecord | null)?.created_at, "") || null;
  const businessTimezone = readString((settingsResult.data as SupabaseRecord | null)?.timezone, "");

  const bundle = buildClientFollowerGrowthBundle({
    accountId,
    snapshots,
    clientLinkedAt,
    businessTimezone,
  });

  return {
    accountId,
    username: readString(accountResult.data.username, "Instagram account"),
    bundle,
    snapshotTableAvailable,
  };
}
