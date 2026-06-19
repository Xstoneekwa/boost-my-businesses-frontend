import { mapInteractionEvidenceRow, type InteractionEvidenceRow } from "@/app/instagram-dashboard/activity-log-data";
import { getAccountPackageSummaries } from "@/app/instagram-dashboard/package-summary-data";
import {
  interactionEventCountersByDay,
  reconcileStatsDaySocialCounters,
  socialActionKindFromLog,
  toStatsDaySocialCounters,
} from "@/lib/instagram-dashboard/social-counters";
import { createSupabaseClient } from "@/lib/supabase";
import { computeClientCampaignInteractionOverview, type ClientCampaignInteractionOverview } from "./client-campaign-interaction-stats";
import { resolveClientFollowerEvolutionMetrics, type ClientFollowerEvolutionMetrics } from "./client-follower-evolution-metrics";
import { readString } from "./guards";

type SupabaseRecord = Record<string, unknown>;

export type ClientStatsDay = {
  date: string;
  totalInteractions: number;
  followCount: number;
  likeCount: number;
  dmCount: number;
  watchCount: number;
};

export type ClientActivityFeedItem = {
  id: string;
  labelFr: string;
  labelEn: string;
  count: number;
  timestamp: string | null;
  actionType: string;
};

export type ClientTargetListItem = {
  id: string;
  username: string;
  verificationStatus: string;
  qualityStatus: string;
  followersCount: number | null;
};

export type ClientAccountInsights = {
  accountId: string;
  username: string;
  packageLabel: string;
  packageCode: string;
  campaignActive: boolean;
  statsDays: ClientStatsDay[];
  overview: {
    campaignInteractions: ClientCampaignInteractionOverview;
    followerEvolution: ClientFollowerEvolutionMetrics;
  };
  chartSeries: {
    d7: number[];
    d30: number[];
    d90: number[];
  };
  activity: ClientActivityFeedItem[];
  targets: ClientTargetListItem[];
  whitelist: string[];
  blacklist: string[];
};

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function dayKey(value: unknown) {
  const date = new Date(readString(value, ""));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function socialActionKind(actionType: string) {
  const kind = socialActionKindFromLog(actionType);
  if (!kind) return null;
  if (kind === "follows") return "follow_count";
  if (kind === "unfollows") return "unfollow_count";
  if (kind === "likes") return "like_count";
  if (kind === "comments") return "comment_count";
  if (kind === "dms") return "dm_count";
  return "watch_count";
}

function shouldCountSocialLog(row: SupabaseRecord) {
  const status = readString(row.status, "").toLowerCase();
  if (["failed", "error", "skipped", "blocked", "dry_run"].some((blocked) => status.includes(blocked))) return false;
  return Boolean(socialActionKind(readString(row.action_type, "")));
}

function blankDay(date: string): ClientStatsDay {
  return {
    date,
    totalInteractions: 0,
    followCount: 0,
    likeCount: 0,
    dmCount: 0,
    watchCount: 0,
  };
}

function blankRunTotals() {
  return { follow_count: 0, like_count: 0, dm_count: 0, watch_count: 0, unfollow_count: 0, comment_count: 0 };
}

function mergeRunTotals(target: ReturnType<typeof blankRunTotals>, row: SupabaseRecord) {
  target.follow_count += readNumber(row.total_follow, 0);
  target.like_count += readNumber(row.total_like, 0);
  target.dm_count += readNumber(row.total_dm, 0);
  target.watch_count += readNumber(row.total_story, 0);
}

function buildChartSeries(days: ClientStatsDay[], length: number) {
  // Campaign interaction series — not used by the follower growth chart.
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.slice(-length).map((day) => day.totalInteractions);
  while (values.length < length) values.unshift(0);
  return values;
}

function actionLabels(actionType: string) {
  const normalized = readString(actionType, "").toLowerCase();
  if (normalized.includes("follow")) return { fr: "Abonnements envoyés", en: "Follows sent", type: "fo" as const };
  if (normalized.includes("like")) return { fr: "Likes ciblés", en: "Targeted likes", type: "li" as const };
  if (normalized.includes("dm")) return { fr: "DMs de bienvenue", en: "Welcome DMs", type: "dm" as const };
  if (normalized.includes("story") || normalized.includes("watch")) return { fr: "Vues de stories", en: "Story views", type: "st" as const };
  return { fr: "Activité campagne", en: "Campaign activity", type: "fo" as const };
}

function parseListField(value: unknown) {
  const raw = readString(value, "");
  if (!raw) return [];
  return raw.split(/[\n,;]+/).map((item) => item.trim().replace(/^@+/, "")).filter(Boolean);
}

function isActiveTarget(row: SupabaseRecord) {
  const status = readString(row.status, "").toLowerCase();
  return !status.includes("archived") && !status.includes("deleted");
}

export async function loadClientAccountInsights(accountId: string): Promise<ClientAccountInsights | null> {
  if (!accountId) return null;
  const supabase = createSupabaseClient();
  const days = 90;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days + 1);
  since.setUTCHours(0, 0, 0, 0);

  const [
    accountResult,
    logsResult,
    runsResult,
    interactionEventsResult,
    targetsResult,
    filtersResult,
    activityRpcResult,
    packageSummaries,
    settingsResult,
    overviewEventsResult,
  ] = await Promise.all([
    supabase.from("ig_accounts").select("id,username,status,admin_lifecycle_status,followers_count").eq("id", accountId).maybeSingle(),
    supabase.from("ig_action_logs").select("id,action_type,status,created_at").eq("account_id", accountId).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(5000),
    supabase.from("ig_runs").select("id,status,created_at,started_at,total_follow,total_like,total_dm,total_story").eq("account_id", accountId).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(1000),
    supabase.from("ig_interaction_events").select("id,action_type,status,created_at").eq("account_id", accountId).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(5000),
    supabase.from("ig_targets").select("id,normalized_username,target_username,input_username,status,verification_status,quality_status,followers_count,created_at").eq("account_id", accountId).order("created_at", { ascending: false }).limit(500),
    supabase.from("ig_account_filters").select("whitelist_words,blacklist_accounts").eq("account_id", accountId).maybeSingle(),
    supabase.rpc("get_activity_log_interaction_evidence_admin", {
      p_account_id: accountId,
      p_search: null,
      p_mode: "all",
      p_period: "30d",
      p_limit: 100,
    }),
    getAccountPackageSummaries([accountId]),
    supabase.from("ig_account_settings").select("timezone").eq("account_id", accountId).maybeSingle(),
    supabase
      .from("ig_interaction_events")
      .select("id,event_type,event_status,interaction_type,event_at,created_at")
      .eq("account_id", accountId)
      .gte("event_at", since.toISOString())
      .order("event_at", { ascending: false })
      .limit(10000),
  ]);

  if (accountResult.error || !accountResult.data?.id) return null;

  const byDay = new Map<string, ClientStatsDay>();
  const ensureDay = (date: string) => {
    const existing = byDay.get(date);
    if (existing) return existing;
    const next = blankDay(date);
    byDay.set(date, next);
    return next;
  };

  for (const row of (logsResult.data ?? []) as SupabaseRecord[]) {
    const date = dayKey(row.created_at);
    if (!date || !shouldCountSocialLog(row)) continue;
    const day = ensureDay(date);
    const kind = socialActionKind(readString(row.action_type, ""));
    if (kind === "follow_count") day.followCount += 1;
    if (kind === "like_count") day.likeCount += 1;
    if (kind === "dm_count") day.dmCount += 1;
    if (kind === "watch_count") day.watchCount += 1;
    day.totalInteractions = day.followCount + day.likeCount + day.dmCount + day.watchCount;
  }

  const interactionEventsByDay = interactionEventCountersByDay((interactionEventsResult.data ?? []) as SupabaseRecord[]);
  const runTotalsByDay = new Map<string, ReturnType<typeof blankRunTotals>>();

  for (const row of (runsResult.data ?? []) as SupabaseRecord[]) {
    const date = dayKey(row.started_at ?? row.created_at);
    if (!date) continue;
    const totals = runTotalsByDay.get(date) ?? blankRunTotals();
    mergeRunTotals(totals, row);
    runTotalsByDay.set(date, totals);
    const day = ensureDay(date);
    const eventTotals = toStatsDaySocialCounters(interactionEventsByDay.get(date) ?? {
      follows: 0, unfollows: 0, likes: 0, comments: 0, dms: 0, stories: 0, interactionsTotal: 0,
    });
    const reconciled = reconcileStatsDaySocialCounters(
      { follow_count: day.followCount, unfollow_count: 0, like_count: day.likeCount, comment_count: 0, dm_count: day.dmCount, watch_count: day.watchCount },
      totals,
      eventTotals,
    );
    day.followCount = reconciled.follow_count;
    day.likeCount = reconciled.like_count;
    day.dmCount = reconciled.dm_count;
    day.watchCount = reconciled.watch_count;
    day.totalInteractions = day.followCount + day.likeCount + day.dmCount + day.watchCount;
  }

  const statsDays = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  const campaignInteractions = computeClientCampaignInteractionOverview(
    (overviewEventsResult.data ?? []) as SupabaseRecord[],
    readString((settingsResult.data as SupabaseRecord | null)?.timezone, ""),
  );
  const followerEvolution = resolveClientFollowerEvolutionMetrics({
    currentFollowersCount: accountResult.data.followers_count == null
      ? null
      : readNumber(accountResult.data.followers_count, 0),
    snapshotRows: [],
  });

  const activityRows = !activityRpcResult.error && Array.isArray(activityRpcResult.data)
    ? (activityRpcResult.data as InteractionEvidenceRow[]).map(mapInteractionEvidenceRow)
    : [];
  const activity = activityRows.slice(0, 50).map((item, index) => {
    const labels = actionLabels(item.actionType ?? item.action);
    return {
      id: readString(item.id, `${accountId}-activity-${index}`),
      labelFr: labels.fr,
      labelEn: labels.en,
      count: 1,
      timestamp: item.occurredAt ?? item.timestamp,
      actionType: labels.type,
    } satisfies ClientActivityFeedItem;
  });

  const targets = ((targetsResult.data ?? []) as SupabaseRecord[])
    .filter(isActiveTarget)
    .map((row) => ({
      id: readString(row.id),
      username: readString(row.normalized_username, readString(row.target_username, readString(row.input_username))).replace(/^@+/, ""),
      verificationStatus: readString(row.verification_status, "pending"),
      qualityStatus: readString(row.quality_status, "unknown"),
      followersCount: row.followers_count == null ? null : readNumber(row.followers_count, 0),
    }))
    .filter((row) => Boolean(row.id && row.username));

  const filters = filtersResult.data as SupabaseRecord | null;
  const packageSummary = packageSummaries.get(accountId);
  const packageLabel = packageSummary?.commercialPackageLabel || "Growth";
  const packageCode = packageSummary?.commercialPackageCode || "growth";

  return {
    accountId,
    username: readString(accountResult.data.username, "Instagram account"),
    packageLabel,
    packageCode,
    campaignActive: readString(accountResult.data.admin_lifecycle_status, readString(accountResult.data.status, "active")) === "active",
    statsDays,
    overview: {
      campaignInteractions,
      followerEvolution,
    },
    chartSeries: {
      d7: buildChartSeries(statsDays, 7),
      d30: buildChartSeries(statsDays, 30),
      d90: buildChartSeries(statsDays, 90),
    },
    activity,
    targets,
    whitelist: parseListField(filters?.whitelist_words),
    blacklist: parseListField(filters?.blacklist_accounts),
  };
}
