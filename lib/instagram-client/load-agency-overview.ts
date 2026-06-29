import { createSupabaseClient } from "@/lib/supabase";
import { loadClientInstagramAccounts } from "./load-client-instagram-accounts";
import { loadClientAccountNotificationsForClient } from "./client-account-notifications";
import {
  buildAgencyOverviewSummary,
  buildAgencyPackageSummary,
  filterAgencyOverviewAccounts,
  paginateAgencyOverviewAccounts,
  projectAgencyOverviewAccountRow,
  type AgencyAccountFilter,
  type ClientAgencyOverviewProjection,
} from "./client-agency-overview-projection";
import {
  buildClientOverviewRecentFeed,
} from "./client-overview-recent-feed-projection";
import type { ClientAgencyRecentFeedItem } from "./client-agency-overview-projection";
import { loadTargetEligibilityCountsByAccount } from "../instagram-dashboard/account-target-eligibility";
import { readString } from "./guards";

type SupabaseRecord = Record<string, unknown>;

function readNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadPasswordActionAccountIds(clientId: string, accountIds: string[]) {
  if (!accountIds.length) return new Set<string>();
  const supabase = createSupabaseClient();
  const { data } = await supabase
    .from("account_dashboard_actions")
    .select("account_id")
    .in("account_id", accountIds)
    .eq("action_type", "update_instagram_password")
    .eq("audience", "client")
    .in("status", ["pending", "acknowledged", "pending_verification"])
    .limit(100);
  return new Set((Array.isArray(data) ? data as SupabaseRecord[] : [])
    .map((row) => readString(row.account_id))
    .filter(Boolean));
}

async function loadRecentInteractionEvents(accountIds: string[]) {
  if (!accountIds.length) return [] as SupabaseRecord[];
  const supabase = createSupabaseClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 14);
  const { data, error } = await supabase
    .from("ig_interaction_events")
    .select("id,account_id,run_id,request_id,session_id,event_type,event_status,interaction_type,event_at,created_at,username,source_target_username")
    .in("account_id", accountIds)
    .gte("event_at", since.toISOString())
    .order("event_at", { ascending: false })
    .limit(400);
  if (error || !Array.isArray(data)) return [];
  return data as SupabaseRecord[];
}

function buildLastActivityByAccount(rows: SupabaseRecord[]) {
  const map = new Map<string, string>();
  for (const row of rows) {
    const accountId = readString(row.account_id);
    const eventAt = readString(row.event_at, readString(row.created_at));
    if (!accountId || !eventAt) continue;
    if (!map.has(accountId) || eventAt > (map.get(accountId) ?? "")) {
      map.set(accountId, eventAt);
    }
  }
  return map;
}

function buildAgencyRecentFeed(
  rows: SupabaseRecord[],
  usernamesByAccountId: Map<string, string>,
  limit = 8,
): ClientAgencyRecentFeedItem[] {
  const merged: ClientAgencyRecentFeedItem[] = [];
  const seen = new Set<string>();

  for (const accountId of usernamesByAccountId.keys()) {
    const accountRows = rows.filter((row) => readString(row.account_id) === accountId);
    const username = usernamesByAccountId.get(accountId) ?? "Instagram account";
    const feed = buildClientOverviewRecentFeed(accountRows, {
      accountId,
      accountUsername: username,
      limit: 3,
    });
    for (const item of feed) {
      const key = `${accountId}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...item,
        accountId,
        accountUsername: username,
      });
    }
  }

  return merged
    .sort((left, right) => right.latestAt.localeCompare(left.latestAt))
    .slice(0, limit);
}

export async function loadClientAgencyOverview(input: {
  clientId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: AgencyAccountFilter;
}): Promise<ClientAgencyOverviewProjection | null> {
  const clientId = readString(input.clientId);
  if (!clientId) return null;

  const accounts = await loadClientInstagramAccounts(clientId);
  if (accounts.length < 2) return null;

  const accountIds = accounts.map((row) => row.accountId);
  const usernamesByAccountId = new Map(accounts.map((row) => [row.accountId, row.username]));

  const supabase = createSupabaseClient();
  const [notifications, passwordActionAccountIds, recentEvents, eligibilityByAccount] = await Promise.all([
    loadClientAccountNotificationsForClient(supabase, clientId),
    loadPasswordActionAccountIds(clientId, accountIds),
    loadRecentInteractionEvents(accountIds),
    loadTargetEligibilityCountsByAccount(supabase, accountIds),
  ]);

  const notificationsByAccount = new Map<string, typeof notifications.active>();
  for (const row of notifications.active) {
    const list = notificationsByAccount.get(row.accountId) ?? [];
    list.push(row);
    notificationsByAccount.set(row.accountId, list);
  }

  const lastActivityByAccount = buildLastActivityByAccount(recentEvents);

  let projected = accounts.map((account) => {
    const counts = eligibilityByAccount.get(account.accountId);
    const eligibleCount = counts?.eligible ?? 0;
    const row = projectAgencyOverviewAccountRow({
      account,
      notificationsByAccount,
      passwordActionAccountIds,
      lastActivityAt: lastActivityByAccount.get(account.accountId) ?? null,
      eligibleTargetCount: eligibleCount,
    });
    return row;
  });

  const search = readString(input.search).toLowerCase().replace(/^@+/, "");
  if (search) {
    projected = projected.filter((row) => row.username.toLowerCase().replace(/^@+/, "").includes(search));
  }

  projected = filterAgencyOverviewAccounts(projected, input.filter ?? "all");

  const summarySource = accounts.map((account) => projectAgencyOverviewAccountRow({
    account,
    notificationsByAccount,
    passwordActionAccountIds,
    lastActivityAt: lastActivityByAccount.get(account.accountId) ?? null,
    eligibleTargetCount: eligibilityByAccount.get(account.accountId)?.eligible ?? 0,
  }));

  const paginated = paginateAgencyOverviewAccounts(
    projected,
    readNumber(input.page, 1),
    readNumber(input.pageSize, 20),
  );

  return {
    summary: buildAgencyOverviewSummary(
      summarySource,
      new Map(accounts.map((row) => [row.accountId, row.connected])),
    ),
    packageSummary: buildAgencyPackageSummary(accounts),
    recentFeed: buildAgencyRecentFeed(recentEvents, usernamesByAccountId),
    accounts: paginated.items,
    accountsTotal: paginated.total,
    page: paginated.page,
    pageSize: paginated.pageSize,
  };
}
