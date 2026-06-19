export type ClientFollowerEvolutionMetrics = {
  status: "pending" | "available";
  netChange: number | null;
  dailyAverage: number | null;
  coveredDays: number | null;
  subtitleFr: string;
  subtitleEn: string;
  missingSource: string;
  futureCollectionProposal: string;
};

export const CLIENT_FOLLOWER_SNAPSHOT_SOURCE = "account_follower_snapshots";

export function buildPendingClientFollowerEvolutionMetrics(): ClientFollowerEvolutionMetrics {
  return {
    status: "pending",
    netChange: null,
    dailyAverage: null,
    coveredDays: null,
    subtitleFr: "Sur les 30 derniers jours",
    subtitleEn: "Over the last 30 days",
    missingSource: CLIENT_FOLLOWER_SNAPSHOT_SOURCE,
    futureCollectionProposal:
      "Add daily ig_account_follower_snapshots(account_id, captured_at, followers_count) and backfill from provider reads to compute net follower evolution.",
  };
}

export function resolveClientFollowerEvolutionMetrics(_input: {
  currentFollowersCount: number | null;
  snapshotRows: Array<{ captured_at: string; followers_count: number }>;
}): ClientFollowerEvolutionMetrics {
  // No reliable historical follower snapshots are available in the platform yet.
  return buildPendingClientFollowerEvolutionMetrics();
}
