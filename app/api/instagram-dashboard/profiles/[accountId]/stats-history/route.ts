import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readNumber, readString, requireInstagramAdmin, type SupabaseRecord } from "../../../_utils";
import { verifyCompassRelayKey } from "../../../compass/relay-auth";

export const dynamic = "force-dynamic";

type DayCounters = {
  date: string;
  session_time: string | null;
  followers_count: number | null;
  followings_count: number | null;
  follow_count: number;
  unfollow_count: number;
  like_count: number;
  comment_count: number;
  dm_count: number;
  watch_count: number;
  total_interactions: number;
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

function dayKey(value: unknown) {
  const date = new Date(readString(value, ""));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatSessionTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(11, 19)} ${date.toISOString().slice(0, 10)}`;
}

function latestIso(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function socialActionKind(actionType: string) {
  const action = actionType.toLowerCase();
  if (action === "follow_completed") return "follow_count";
  if (action === "unfollow_completed") return "unfollow_count";
  if (action === "like_completed" || action === "post_like_completed") return "like_count";
  if (action === "comment_completed" || action === "post_comment_completed") return "comment_count";
  if (action === "send_dm_sent" || action === "dm_sent" || action === "welcome_dm_sent" || action === "outreach_dm_sent") return "dm_count";
  if (action === "story_viewed" || action === "stories_viewed" || action === "story_reaction_sent" || action === "watch_completed") return "watch_count";
  return null;
}

function shouldCountSocialLog(row: SupabaseRecord) {
  const status = readString(row.status, "").toLowerCase();
  if (["failed", "error", "skipped", "blocked", "dry_run"].some((blocked) => status.includes(blocked))) return false;
  return Boolean(socialActionKind(readString(row.action_type, "")));
}

function blankDay(date: string): DayCounters {
  return {
    date,
    session_time: null,
    followers_count: null,
    followings_count: null,
    follow_count: 0,
    unfollow_count: 0,
    like_count: 0,
    comment_count: 0,
    dm_count: 0,
    watch_count: 0,
    total_interactions: 0,
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
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days + 1);
    since.setUTCHours(0, 0, 0, 0);

    const supabase = createSupabaseClient();
    const [logsResult, runsResult, settingsResult, packageResult] = await Promise.all([
      supabase
        .from("ig_action_logs")
        .select("id,action_type,status,created_at")
        .eq("account_id", normalizedAccountId)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("ig_runs")
        .select("id,status,created_at,started_at,finished_at,total_follow,total_like,total_dm,total_story")
        .eq("account_id", normalizedAccountId)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(500),
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

    const firstError = logsResult.error ?? runsResult.error ?? settingsResult.error ?? packageResult.error;
    if (firstError) return jsonError(firstError.message, 500);

    const byDay = new Map<string, DayCounters>();
    const ensureDay = (date: string) => {
      const existing = byDay.get(date);
      if (existing) return existing;
      const next = blankDay(date);
      byDay.set(date, next);
      return next;
    };

    for (const row of (logsResult.data ?? []) as SupabaseRecord[]) {
      const date = dayKey(row.created_at);
      if (!date) continue;
      const day = ensureDay(date);
      day.session_time = latestIso(day.session_time, readString(row.created_at, ""));
      if (!shouldCountSocialLog(row)) continue;
      const kind = socialActionKind(readString(row.action_type, ""));
      if (kind) day[kind] += 1;
    }

    for (const row of (runsResult.data ?? []) as SupabaseRecord[]) {
      const sessionAt = readString(row.started_at, readString(row.created_at, ""));
      const date = dayKey(sessionAt);
      if (!date) continue;
      const day = ensureDay(date);
      day.session_time = latestIso(day.session_time, sessionAt);
    }

    const caps = effectiveCaps(settingsResult.data ?? null, packageResult.data ?? null);
    const rows = Array.from(byDay.values())
      .map((day) => ({
        ...day,
        ...caps,
        session_time: formatSessionTime(day.session_time),
        total_interactions: day.follow_count + day.unfollow_count + day.like_count + day.comment_count + day.dm_count + day.watch_count,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, days);

    return jsonOk({
      account_id: normalizedAccountId,
      days: rows,
      source: {
        actions: "ig_action_logs",
        runs: "ig_runs",
        caps: "account_package_summary+ig_account_settings",
        followers: "pending_account_follower_snapshots",
        followings: "pending_account_following_snapshots",
      },
      missing_sources: ["account_follower_snapshots", "account_following_snapshots"],
      total_interactions_definition: "follow_count + unfollow_count + like_count + comment_count + dm_count + watch_count",
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
