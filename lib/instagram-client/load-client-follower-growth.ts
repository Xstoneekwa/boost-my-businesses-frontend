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
  socialProfile: {
    current: { followersCount: number | null; followingCount: number | null; postsCount: number | null; observedAt: string | null };
    history: Array<{ date: string; followersCount: number | null; followingCount: number | null; postsCount: number | null; observedAt: string }>;
  };
};

export async function loadClientFollowerGrowthSeries(accountId: string): Promise<LoadClientFollowerGrowthResult | null> {
  if (!accountId) return null;

  const supabase = createSupabaseClient();
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - 2);

  const [accountResult, linkResult, snapshotsResult, socialSnapshotsResult] = await Promise.all([
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
      .from("ig_account_follower_snapshots")
      .select("id,account_id,followers_count,captured_at,source,observation_kind,created_at")
      .eq("account_id", accountId)
      .gte("captured_at", since.toISOString())
      .order("captured_at", { ascending: true })
      .limit(5000),
    supabase
      .from("ig_account_social_profile_snapshots")
      .select("id,account_id,followers_count,following_count,posts_count,observed_at,snapshot_local_date,source_provider,source_trigger,created_at,account_timezone")
      .eq("account_id", accountId)
      .gte("observed_at", since.toISOString())
      .order("observed_at", { ascending: true })
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

  const socialRows = socialSnapshotsResult.error ? [] : ((socialSnapshotsResult.data ?? []) as SupabaseRecord[]);
  snapshots.push(...socialRows.filter((row) => row.followers_count !== null).map((row) => ({
    id: readString(row.id),
    account_id: readString(row.account_id, accountId),
    followers_count: Number(row.followers_count),
    captured_at: readString(row.observed_at),
    source: "public_profile_lookup",
    observation_kind: readString(row.source_trigger, "daily") === "onboarding_lookup" ? "baseline" : "daily",
    created_at: readString(row.created_at),
  })));
  snapshots.sort((left, right) => left.captured_at.localeCompare(right.captured_at));

  const clientLinkedAt = readString((linkResult.data as SupabaseRecord | null)?.created_at, "") || null;
  const businessTimezone = readString(socialRows.at(-1)?.account_timezone, "");

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
    socialProfile: {
      current: socialRows.length ? {
        followersCount: socialRows.at(-1)?.followers_count == null ? null : Number(socialRows.at(-1)?.followers_count),
        followingCount: socialRows.at(-1)?.following_count == null ? null : Number(socialRows.at(-1)?.following_count),
        postsCount: socialRows.at(-1)?.posts_count == null ? null : Number(socialRows.at(-1)?.posts_count),
        observedAt: readString(socialRows.at(-1)?.observed_at, "") || null,
      } : { followersCount: null, followingCount: null, postsCount: null, observedAt: null },
      history: socialRows.map((row) => ({
        date: readString(row.snapshot_local_date, readString(row.observed_at, "").slice(0, 10)),
        followersCount: row.followers_count == null ? null : Number(row.followers_count),
        followingCount: row.following_count == null ? null : Number(row.following_count),
        postsCount: row.posts_count == null ? null : Number(row.posts_count),
        observedAt: readString(row.observed_at),
      })),
    },
  };
}
