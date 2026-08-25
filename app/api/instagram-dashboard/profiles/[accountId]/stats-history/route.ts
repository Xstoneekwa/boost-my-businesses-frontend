import {
  interactionEventCountersByDay,
  isCountableSocialActionLog,
  mergeCanonicalInteractionEventsWithUnfollowFallback,
  reconcileStatsDaySocialCounters,
  socialActionKindFromLog,
  toStatsDaySocialCounters,
  TOTAL_INTERACTIONS_DEFINITION,
  STATS_TOTAL_INTERACTIONS_DEFINITION,
} from "@/lib/instagram-dashboard/social-counters";
import {
  businessDayKeyFromIso,
  businessDayRangeStartIso,
  DEFAULT_BUSINESS_TIMEZONE,
  formatBusinessTimestamp,
} from "@/lib/instagram-dashboard/business-timezone";
import {
  projectSocialProfileSnapshots,
  type SocialProfileSnapshotRow,
} from "@/lib/instagram-dashboard/social-profile-snapshot-contract";
import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readNumber, readString, requireInstagramAdmin, type SupabaseRecord } from "../../../_utils";
import { verifyCompassRelayKey } from "../../../compass/relay-auth";

export const dynamic = "force-dynamic";

type DayCounters = {
  date: string;
  session_time: string | null;
  followers_count: number | null;
  followers_snapshot_at: string | null;
  followers_snapshot_source: string | null;
  followers_freshness_status: "available" | "stale" | "no_data";
  followings_count: number | null;
  followings_snapshot_at: string | null;
  followings_snapshot_source: string | null;
  followings_freshness_status: "available" | "stale" | "no_data";
  posts_count: number | null;
  posts_snapshot_at: string | null;
  posts_snapshot_source: string | null;
  posts_freshness_status: "available" | "stale" | "no_data";
  follow_count: number;
  unfollow_count: number;
  like_count: number;
  comment_count: number;
  dm_count: number;
  watch_count: number;
  total_interactions: number;
};

type SocialCounters = {
  follow_count: number;
  unfollow_count: number;
  like_count: number;
  comment_count: number;
  dm_count: number;
  watch_count: number;
};

function isRecord(value: unknown): value is SupabaseRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonNumber(row: SupabaseRecord | null, key: string, fallback: number | null = null) {
  if (!row) return fallback;
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function readJsonBoolean(row: SupabaseRecord | null, key: string, fallback = false) {
  if (!row) return fallback;
  const value = row[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) return /^(true|1|yes|enabled|active)$/i.test(value);
  if (typeof value === "number") return value > 0;
  return fallback;
}

function readRecord(value: unknown) {
  return isRecord(value) ? value : null;
}

function dayKey(value: unknown, timezone: string) {
  return businessDayKeyFromIso(readString(value, ""), timezone);
}

function formatSessionTime(value: string | null, timezone: string) {
  if (!value) return null;
  return formatBusinessTimestamp(value, timezone);
}

function latestIso(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
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

function blankDay(date: string): DayCounters {
  return {
    date,
    session_time: null,
    followers_count: null,
    followers_snapshot_at: null,
    followers_snapshot_source: null,
    followers_freshness_status: "no_data",
    followings_count: null,
    followings_snapshot_at: null,
    followings_snapshot_source: null,
    followings_freshness_status: "no_data",
    posts_count: null,
    posts_snapshot_at: null,
    posts_snapshot_source: null,
    posts_freshness_status: "no_data",
    follow_count: 0,
    unfollow_count: 0,
    like_count: 0,
    comment_count: 0,
    dm_count: 0,
    watch_count: 0,
    total_interactions: 0,
  };
}

function blankSocialCounters(): SocialCounters {
  return {
    follow_count: 0,
    unfollow_count: 0,
    like_count: 0,
    comment_count: 0,
    dm_count: 0,
    watch_count: 0,
  };
}

function mergeRunTotals(target: SocialCounters, row: SupabaseRecord) {
  target.follow_count += readNumber(row.total_follow, 0);
  target.like_count += readNumber(row.total_like, 0);
  target.dm_count += readNumber(row.total_dm, 0);
  target.watch_count += readNumber(row.total_story, 0);
}

function reconcileDayWithSources(
  day: DayCounters,
  runTotals: SocialCounters | undefined,
  eventTotals: SocialCounters | undefined,
) {
  const reconciled = reconcileStatsDaySocialCounters(
    {
      follow_count: day.follow_count,
      unfollow_count: day.unfollow_count,
      like_count: day.like_count,
      comment_count: day.comment_count,
      dm_count: day.dm_count,
      watch_count: day.watch_count,
    },
    runTotals ?? blankSocialCounters(),
    eventTotals ?? blankSocialCounters(),
  );
  return {
    ...day,
    ...reconciled,
  };
}

function fallbackPackageCaps(packageLabel: string) {
  const normalized = packageLabel.toLowerCase();
  if (normalized.includes("premium")) return { followDay: 180, unfollowDay: 240, likeDay: 500, dmDay: 100 };
  if (normalized.includes("pro")) return { followDay: 120, unfollowDay: 120, likeDay: 500, dmDay: 10 };
  return { followDay: 80, unfollowDay: 80, likeDay: 100, dmDay: 0 };
}

function effectiveCaps(settings: SupabaseRecord | null, packageSummary: SupabaseRecord | null) {
  const packageLabel = readString(packageSummary?.commercial_package_label, "Growth");
  const fallback = fallbackPackageCaps(packageLabel);
  const packageCaps = readRecord(packageSummary?.package_caps);
  const preview = readRecord(packageSummary?.effective_caps_preview);
  const packageFollowCap = readJsonNumber(packageCaps, "follow_day", readJsonNumber(preview, "follow_day", fallback.followDay)) ?? fallback.followDay;
  const packageUnfollowCap = readJsonNumber(packageCaps, "unfollow_day", fallback.unfollowDay) ?? fallback.unfollowDay;
  const manualFollowDayCap = readNumber(settings?.manual_follow_day_cap, Number.NaN);
  const manualUnfollowDayCap = readNumber(settings?.manual_unfollow_day_cap, Number.NaN);
  const warmupApplied = readJsonBoolean(preview, "warmup_applied", false);
  const warmupFollowCap = readJsonNumber(preview, "warmup_follow_day_cap", null);
  const followCap = Math.max(0, Math.min(
    packageFollowCap,
    Number.isFinite(manualFollowDayCap) ? manualFollowDayCap : packageFollowCap,
    warmupApplied && warmupFollowCap !== null ? warmupFollowCap : packageFollowCap,
  ));
  return {
    follow_cap: followCap,
    unfollow_cap: Math.max(0, Math.min(packageUnfollowCap, Number.isFinite(manualUnfollowDayCap) ? manualUnfollowDayCap : packageUnfollowCap)),
    like_cap: readNumber(settings?.total_likes_limit, fallback.likeDay),
    comment_cap: 0,
    dm_cap: readNumber(settings?.max_dm_per_run, fallback.dmDay),
  };
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Stats history relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const { accountId } = await context.params;
    const normalizedAccountId = accountId?.trim() ?? "";
    if (!normalizedAccountId) return jsonError("Missing account id.", 400);

    const url = new URL(request.url);
    const days = Math.max(1, Math.min(30, readNumber(url.searchParams.get("days"), 30)));
    const now = new Date();
    const since = businessDayRangeStartIso(now, days, DEFAULT_BUSINESS_TIMEZONE);

    const supabase = createSupabaseClient();
    const [logsResult, runsResult, interactionEventsResult, unfollowsResult, socialSnapshotsResult, settingsResult, packageResult] = await Promise.all([
      supabase
        .from("ig_action_logs")
        .select("id,action_type,status,created_at,payload")
        .eq("account_id", normalizedAccountId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("ig_runs")
        .select("id,status,created_at,started_at,finished_at,total_follow,total_like,total_dm,total_story")
        .eq("account_id", normalizedAccountId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("ig_interaction_events")
        .select("id,account_id,run_id,event_type,event_status,interaction_type,event_at,payload")
        .eq("account_id", normalizedAccountId)
        .gte("event_at", since)
        .order("event_at", { ascending: false })
        .limit(5000),
      supabase
        .from("ig_interacted_users")
        .select("id,account_id,run_id,last_run_id,username,unfollowed_at,unfollow_result,interaction_status,evidence_confidence")
        .eq("account_id", normalizedAccountId)
        .eq("unfollow_result", "success")
        .gte("unfollowed_at", since)
        .order("unfollowed_at", { ascending: false })
        .limit(10000),
      supabase
        .from("ig_account_social_profile_snapshots")
        .select("account_id,username_normalized,followers_count,following_count,posts_count,observed_at,snapshot_local_date,account_timezone,timezone_source,source_provider,source_trigger,source_event_id,source_run_id,source_business_session_id,lookup_status,freshness_status,idempotency_key")
        .eq("account_id", normalizedAccountId)
        .eq("lookup_status", "found")
        .gte("observed_at", since)
        .order("observed_at", { ascending: true })
        .limit(5000),
      supabase
        .from("ig_account_settings")
        .select("total_likes_limit,max_dm_per_run")
        .eq("account_id", normalizedAccountId)
        .limit(1)
        .maybeSingle<SupabaseRecord>(),
      supabase
        .from("account_package_summary")
        .select("commercial_package_label,package_caps,effective_caps_preview")
        .eq("account_id", normalizedAccountId)
        .limit(1)
        .maybeSingle<SupabaseRecord>(),
    ]);

    const firstError = logsResult.error ?? runsResult.error ?? interactionEventsResult.error ?? unfollowsResult.error ?? socialSnapshotsResult.error ?? settingsResult.error ?? packageResult.error;
    if (firstError) return jsonError(firstError.message, 500);

    const byDay = new Map<string, DayCounters>();
    const socialSnapshots = projectSocialProfileSnapshots({
      rows: (socialSnapshotsResult.data ?? []) as SocialProfileSnapshotRow[],
    });
    const ensureDay = (date: string) => {
      const existing = byDay.get(date);
      if (existing) return existing;
      const next = blankDay(date);
      byDay.set(date, next);
      return next;
    };

    for (const row of (logsResult.data ?? []) as SupabaseRecord[]) {
      const date = dayKey(row.created_at, socialSnapshots.timezone);
      if (!date) continue;
      const day = ensureDay(date);
      day.session_time = latestIso(day.session_time, readString(row.created_at, ""));
      if (!isCountableSocialActionLog(row)) continue;
      const kind = socialActionKind(readString(row.action_type, ""));
      if (kind) day[kind] += 1;
    }

    const runTotalsByDay = new Map<string, SocialCounters>();
    for (const row of (runsResult.data ?? []) as SupabaseRecord[]) {
      const sessionAt = readString(row.started_at, readString(row.created_at, ""));
      const date = dayKey(sessionAt, socialSnapshots.timezone);
      if (!date) continue;
      const day = ensureDay(date);
      day.session_time = latestIso(day.session_time, sessionAt);
      const totals = runTotalsByDay.get(date) ?? blankSocialCounters();
      mergeRunTotals(totals, row);
      runTotalsByDay.set(date, totals);
    }

    const canonicalInteractionEvents = mergeCanonicalInteractionEventsWithUnfollowFallback(
      (interactionEventsResult.data ?? []) as SupabaseRecord[],
      (unfollowsResult.data ?? []) as SupabaseRecord[],
    );
    const interactionEventsByDay = interactionEventCountersByDay(
      canonicalInteractionEvents,
      socialSnapshots.timezone,
    );
    const eventTotalsByDay = new Map<string, SocialCounters>();
    for (const [date, counters] of interactionEventsByDay.entries()) {
      eventTotalsByDay.set(date, toStatsDaySocialCounters(counters));
    }
    for (const date of new Set([...runTotalsByDay.keys(), ...eventTotalsByDay.keys()])) {
      ensureDay(date);
    }
    for (const point of socialSnapshots.points) {
      const day = ensureDay(point.date);
      const isLatest = point.row === socialSnapshots.points.at(-1)?.row;
      const status = isLatest
        ? socialSnapshots.sourceStatus.followers.status
        : "available";
      if (point.row.followers_count !== null) {
        day.followers_count = point.row.followers_count;
        day.followers_snapshot_at = point.row.observed_at;
        day.followers_snapshot_source = point.row.source_provider;
        day.followers_freshness_status = status;
      }
      if (point.row.following_count !== null) {
        day.followings_count = point.row.following_count;
        day.followings_snapshot_at = point.row.observed_at;
        day.followings_snapshot_source = point.row.source_provider;
        day.followings_freshness_status = isLatest
          ? socialSnapshots.sourceStatus.followings.status
          : "available";
      }
      if (point.row.posts_count !== null) {
        day.posts_count = point.row.posts_count;
        day.posts_snapshot_at = point.row.observed_at;
        day.posts_snapshot_source = point.row.source_provider;
        day.posts_freshness_status = isLatest
          ? socialSnapshots.sourceStatus.posts.status
          : "available";
      }
    }

    const caps = effectiveCaps(settingsResult.data ?? null, packageResult.data ?? null);
    const rows = Array.from(byDay.values())
      .map((day) => {
        const reconciled = reconcileDayWithSources(
          day,
          runTotalsByDay.get(day.date),
          eventTotalsByDay.get(day.date),
        );
        return {
          ...reconciled,
          ...caps,
          session_at: day.session_time,
          session_time: formatSessionTime(day.session_time, socialSnapshots.timezone),
          session_timezone: socialSnapshots.timezone,
          total_interactions: reconciled.follow_count + reconciled.unfollow_count + reconciled.like_count + reconciled.comment_count + reconciled.dm_count + reconciled.watch_count,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, days);

    return jsonOk({
      account_id: normalizedAccountId,
      days: rows,
      source: {
        actions: "ig_action_logs",
        runs: "ig_runs.total_* reconciliation for post-follow likes",
        interaction_events: "ig_interaction_events post_like_success for live post-follow likes",
        unfollows: "ig_interacted_users.unfollowed_at where unfollow_result=success",
        caps: "account_package_summary+ig_account_settings",
        followers: "ig_account_social_profile_snapshots",
        followings: "ig_account_social_profile_snapshots",
        posts: "ig_account_social_profile_snapshots",
      },
      source_status: socialSnapshots.sourceStatus,
      missing_sources: [
        ...(socialSnapshots.sourceStatus.followers.status === "no_data" ? ["followers_snapshot"] : []),
        ...(socialSnapshots.sourceStatus.followings.status === "no_data" ? ["followings_snapshot"] : []),
        ...(socialSnapshots.sourceStatus.posts.status === "no_data" ? ["posts_snapshot"] : []),
      ],
      business_timezone: socialSnapshots.timezone,
      generated_at: new Date().toISOString(),
      total_interactions_definition: STATS_TOTAL_INTERACTIONS_DEFINITION,
      thresholds: {
        low: "< 40",
        medium: "40-99",
        good: ">= 100",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load stats history.";
    return jsonError(message, 500);
  }
}
