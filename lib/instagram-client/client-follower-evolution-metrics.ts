export type ClientFollowerEvolutionMetrics = {
  status: "ready" | "stale" | "insufficient" | "pending" | "unavailable" | "error";
  netChange: number | null;
  dailyAverage: number | null;
  coveredDays: number | null;
  subtitleFr: string;
  subtitleEn: string;
  missingSource: string;
  futureCollectionProposal: string;
  source: "ig_account_social_profile_snapshots";
  capturedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  periodDays: 30;
};

export const CLIENT_FOLLOWER_SNAPSHOT_SOURCE = "ig_account_social_profile_snapshots";

export function buildPendingClientFollowerEvolutionMetrics(): ClientFollowerEvolutionMetrics {
  return {
    status: "pending",
    netChange: null,
    dailyAverage: null,
    coveredDays: null,
    subtitleFr: "Historique des abonnés en cours de collecte",
    subtitleEn: "Follower history collection in progress",
    missingSource: CLIENT_FOLLOWER_SNAPSHOT_SOURCE,
    futureCollectionProposal:
      "Continue the canonical daily social-profile snapshot collector until at least two reliable observations cover one full day.",
    source: CLIENT_FOLLOWER_SNAPSHOT_SOURCE,
    capturedAt: null,
    ageSeconds: null,
    stale: false,
    periodDays: 30,
  };
}

export function buildUnavailableClientFollowerEvolutionMetrics(
  status: "unavailable" | "error",
): ClientFollowerEvolutionMetrics {
  const error = status === "error";
  return {
    ...buildPendingClientFollowerEvolutionMetrics(),
    status,
    subtitleFr: error ? "Erreur de lecture des abonnés" : "Données abonnés indisponibles",
    subtitleEn: error ? "Follower data read error" : "Follower data unavailable",
    futureCollectionProposal: error
      ? "Restore access to the canonical social-profile snapshot source, then retry."
      : "Provision the canonical social-profile snapshot source before collecting history.",
  };
}

function validSnapshots(rows: Array<{ captured_at?: string; observed_at?: string; followers_count: number | null; lookup_status?: string }>) {
  return rows
    .filter((row) => !row.lookup_status || row.lookup_status === "found")
    .map((row) => ({
      capturedAt: row.observed_at || row.captured_at || "",
      followersCount: Number(row.followers_count),
    }))
    .filter((row) => Number.isSafeInteger(row.followersCount) && row.followersCount >= 0 && Number.isFinite(Date.parse(row.capturedAt)))
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
}

export function resolveClientFollowerEvolutionMetrics(input: {
  currentFollowersCount: number | null;
  snapshotRows: Array<{ captured_at?: string; observed_at?: string; followers_count: number | null; lookup_status?: string }>;
  now?: Date;
  sourceStatus?: "ready" | "unavailable" | "error";
}): ClientFollowerEvolutionMetrics {
  if (input.sourceStatus === "unavailable" || input.sourceStatus === "error") {
    return buildUnavailableClientFollowerEvolutionMetrics(input.sourceStatus);
  }
  const now = input.now ?? new Date();
  const all = validSnapshots(input.snapshotRows);
  if (!all.length) return buildPendingClientFollowerEvolutionMetrics();

  const latest = all.at(-1)!;
  const ageSeconds = Math.max(0, Math.round((now.getTime() - Date.parse(latest.capturedAt)) / 1000));
  const stale = ageSeconds > 36 * 60 * 60;
  const windowStart = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const inWindow = all.filter((row) => Date.parse(row.capturedAt) >= windowStart);
  const first = inWindow[0] ?? null;
  const coveredDays = first ? (Date.parse(latest.capturedAt) - Date.parse(first.capturedAt)) / (24 * 60 * 60 * 1000) : 0;
  const enoughHistory = Boolean(first && inWindow.length >= 2 && coveredDays >= 1);
  const status = stale ? "stale" : enoughHistory ? "ready" : "insufficient";
  const subtitleFr = stale
    ? `Données anciennes — dernier relevé le ${new Date(latest.capturedAt).toLocaleDateString("fr-FR")}`
    : enoughHistory
      ? "Sur les 30 derniers jours"
      : "Historique insuffisant — collecte en cours";
  const subtitleEn = stale
    ? `Stale data — last captured on ${new Date(latest.capturedAt).toLocaleDateString("en-US")}`
    : enoughHistory
      ? "Over the last 30 days"
      : "Insufficient history — collection in progress";
  const netChange = enoughHistory && first ? latest.followersCount - first.followersCount : null;

  return {
    status,
    netChange,
    dailyAverage: netChange === null ? null : netChange / coveredDays,
    coveredDays: enoughHistory ? coveredDays : null,
    subtitleFr,
    subtitleEn,
    missingSource: enoughHistory ? "" : CLIENT_FOLLOWER_SNAPSHOT_SOURCE,
    futureCollectionProposal: enoughHistory ? "" : "Continue daily snapshots until at least two reliable observations cover one full day.",
    source: CLIENT_FOLLOWER_SNAPSHOT_SOURCE,
    capturedAt: latest.capturedAt,
    ageSeconds,
    stale,
    periodDays: 30,
  };
}
