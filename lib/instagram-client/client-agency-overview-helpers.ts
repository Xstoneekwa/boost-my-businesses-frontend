export type AgencyAccountFilter = "all" | "connected" | "preparing" | "action_required";

export type ClientAgencyOverviewSummary = {
  linkedCount: number;
  connectedCount: number;
  preparingCount: number;
  actionRequiredCount: number;
  campaignActiveCount: number;
};

export type ClientAgencyPackageSummaryRow = {
  label: string;
  count: number;
};

export type ClientAgencyOverviewAccountRow = {
  accountId: string;
  username: string;
  packageLabel: string;
  connectionLabelFr: string;
  connectionLabelEn: string;
  preparationLabelFr: string;
  preparationLabelEn: string;
  campaignActive: boolean;
  campaignLabelFr: string;
  campaignLabelEn: string;
  needsTargets: boolean;
  needsTargetsLabelFr: string | null;
  needsTargetsLabelEn: string | null;
  lastActivityAt: string | null;
  lastActivityLabelFr: string | null;
  lastActivityLabelEn: string | null;
  actionRequired: boolean;
};

export function isAgencyModeActive(linkedAccountCount: number) {
  return linkedAccountCount >= 2;
}

export function matchesAgencyAccountSearch(username: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase().replace(/^@+/, "");
  if (!normalizedQuery) return true;
  return username.trim().toLowerCase().replace(/^@+/, "").includes(normalizedQuery);
}

export function buildAgencyPackageSummary(
  accounts: Array<{ packageLabel?: string }>,
): ClientAgencyPackageSummaryRow[] {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    const key = account.packageLabel || "Growth";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function buildAgencyOverviewSummary(
  accounts: ClientAgencyOverviewAccountRow[],
  connectedFlags?: Map<string, boolean>,
): ClientAgencyOverviewSummary {
  return {
    linkedCount: accounts.length,
    connectedCount: connectedFlags
      ? [...connectedFlags.values()].filter(Boolean).length
      : accounts.filter((row) => row.connectionLabelEn === "Connected").length,
    preparingCount: accounts.filter((row) => (
      row.preparationLabelFr === "Préparation en cours"
      || row.preparationLabelFr === "Compte ajouté"
      || row.preparationLabelEn === "Setup in progress"
      || row.preparationLabelEn === "Account added"
    )).length,
    actionRequiredCount: accounts.filter((row) => row.actionRequired).length,
    campaignActiveCount: accounts.filter((row) => row.campaignActive).length,
  };
}

export function filterAgencyOverviewAccounts(
  accounts: ClientAgencyOverviewAccountRow[],
  filter: AgencyAccountFilter,
): ClientAgencyOverviewAccountRow[] {
  if (filter === "all") return accounts;
  if (filter === "connected") {
    return accounts.filter((row) => row.connectionLabelEn === "Connected");
  }
  if (filter === "preparing") {
    return accounts.filter((row) => (
      row.preparationLabelEn === "Setup in progress"
      || row.preparationLabelEn === "Account added"
    ));
  }
  return accounts.filter((row) => row.actionRequired);
}

export function paginateAgencyOverviewAccounts<T>(
  accounts: T[],
  page: number,
  pageSize: number,
): { items: T[]; total: number; page: number; pageSize: number } {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(Math.max(pageSize, 1), 50);
  const start = (safePage - 1) * safeSize;
  return {
    items: accounts.slice(start, start + safeSize),
    total: accounts.length,
    page: safePage,
    pageSize: safeSize,
  };
}
