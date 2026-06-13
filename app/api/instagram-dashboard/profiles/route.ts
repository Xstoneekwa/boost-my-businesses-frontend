import { getManageData } from "@/app/instagram-dashboard/manage-data";
import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, requireInstagramAdmin } from "../_utils";
import { relayAuthStatus, verifyCompassRelayKey } from "../compass/relay-auth";

export const dynamic = "force-dynamic";

type RecordValue = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readNumber(row: RecordValue | undefined, keys: string[], fallback: number | null = null) {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return fallback;
}

function readJsonNumber(row: RecordValue | null, key: string, fallback: number | null = null) {
  if (!row) return fallback;
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function readJsonBoolean(row: RecordValue | null, key: string, fallback = false) {
  if (!row) return fallback;
  const value = row[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) return /^(true|1|yes|enabled|active)$/i.test(value);
  if (typeof value === "number") return value > 0;
  return fallback;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function accountId(row: RecordValue) {
  return readString(row.accountId, readString(row.account_id, readString(row.id, "")));
}

function dayStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function socialActionKind(actionType: string) {
  const action = actionType.toLowerCase();
  if (action === "follow_completed") return "follows";
  if (action === "unfollow_completed") return "unfollows";
  if (action === "like_completed" || action === "post_like_completed") return "likes";
  if (action === "comment_completed" || action === "post_comment_completed") return "comments";
  if (action === "send_dm_sent" || action === "dm_sent" || action === "welcome_dm_sent") return "dms";
  if (action === "story_viewed" || action === "stories_viewed" || action === "story_reaction_sent") return "stories";
  return null;
}

function actionCounters(logRows: RecordValue[]) {
  const counters = { follows: 0, unfollows: 0, likes: 0, comments: 0, dms: 0, stories: 0 };
  for (const row of logRows) {
    const kind = socialActionKind(readString(row.action_type, ""));
    if (kind) counters[kind] += 1;
  }
  return {
    ...counters,
    interactionsTotal: counters.follows + counters.unfollows + counters.likes + counters.comments + counters.dms + counters.stories,
  };
}

function fallbackPackageCaps(packageLabel: string) {
  const normalized = packageLabel.toLowerCase();
  if (normalized.includes("premium")) return { followDay: 180, followSession: 180, unfollowDay: 240, unfollowSession: 240, likeDay: 500, dmDay: 100 };
  if (normalized.includes("pro")) return { followDay: 120, followSession: 120, unfollowDay: 120, unfollowSession: 120, likeDay: 500, dmDay: 10 };
  return { followDay: 80, followSession: 80, unfollowDay: 80, unfollowSession: 80, likeDay: 100, dmDay: 0 };
}

function safeSettingsSummary(
  account: RecordValue,
  settings: RecordValue | undefined,
  packageSummary: RecordValue | undefined,
  logs: RecordValue[],
  accountRow: RecordValue | undefined,
) {
  const counters = actionCounters(logs);
  const packageLabel = readString(packageSummary?.commercial_package_label, readString(account.packageLabel, readString(account.package_label, "Growth")));
  const fallback = fallbackPackageCaps(packageLabel);
  const packageCaps = readRecord(packageSummary?.package_caps);
  const preview = readRecord(packageSummary?.effective_caps_preview);
  const packageFollowCap = readJsonNumber(packageCaps, "follow_day", readJsonNumber(preview, "follow_day", fallback.followDay)) ?? fallback.followDay;
  const packageFollowSessionCap = readJsonNumber(packageCaps, "follow_session", fallback.followSession) ?? fallback.followSession;
  const packageUnfollowCap = readJsonNumber(packageCaps, "unfollow_day", fallback.unfollowDay) ?? fallback.unfollowDay;
  const packageUnfollowSessionCap = readJsonNumber(packageCaps, "unfollow_session", fallback.unfollowSession) ?? fallback.unfollowSession;
  const manualFollowDayCap = readNumber(settings, ["manual_follow_day_cap"], null);
  const manualFollowSessionCap = readNumber(settings, ["manual_follow_session_cap"], null);
  const warmupApplied = readJsonBoolean(preview, "warmup_applied", false);
  const warmupFollowCap = readJsonNumber(preview, "warmup_follow_day_cap", null);
  const effectiveFollowCap = Math.max(0, Math.min(
    packageFollowCap,
    manualFollowDayCap ?? packageFollowCap,
    warmupApplied && warmupFollowCap !== null ? warmupFollowCap : packageFollowCap,
  ));
  const effectiveUnfollowCap = Math.max(0, Math.min(packageUnfollowCap, readNumber(settings, ["manual_unfollow_day_cap"], packageUnfollowCap) ?? packageUnfollowCap));
  const likeCap = readNumber(settings, ["total_likes_limit", "like_per_day"], fallback.likeDay);
  const dmCap = readNumber(settings, ["max_dm_per_run", "dm_cap", "welcome_day_cap"], null);
  const capsToday = {
    follows: effectiveFollowCap,
    unfollows: effectiveUnfollowCap,
    likes: likeCap,
    comments: 0,
    dms: dmCap,
    stories: null,
  };
  return {
    timezone: readString(settings?.timezone, ""),
    currentRunStatus: readString(settings?.current_run_status, ""),
    countersToday: counters,
    capsToday,
    followerDelta3d: {
      value: null,
      currentFollowers: readNumber(accountRow, ["followers_count"], null),
      previousFollowers: null,
      from: null,
      to: new Date().toISOString(),
      source: "pending_account_follower_snapshots",
      freshness: "no_snapshot_table",
    },
    quotas: {
      follow: { used: counters.follows, max: effectiveFollowCap, source: "ig_action_logs" },
      unfollow: { used: counters.unfollows, max: effectiveUnfollowCap, source: "ig_action_logs" },
      like: { used: counters.likes, max: likeCap, source: "ig_action_logs" },
      comment: { used: counters.comments, max: 0, source: "ig_action_logs" },
      dm: { used: counters.dms, max: dmCap, source: "ig_action_logs" },
    },
    capSummary: {
      packageLabel,
      package: {
        followDay: packageFollowCap,
        followSession: packageFollowSessionCap,
        unfollowDay: packageUnfollowCap,
        unfollowSession: packageUnfollowSessionCap,
      },
      adminOverride: {
        followDay: manualFollowDayCap,
        followSession: manualFollowSessionCap,
        active: manualFollowDayCap !== null || manualFollowSessionCap !== null,
      },
      legacyRuntime: {
        followLimit: readNumber(settings, ["follow_limit"], null),
        maxFollowPerRun: readNumber(settings, ["max_follow_per_run"], null),
        maxActionsPerDay: readNumber(settings, ["max_actions_per_day"], null),
      },
      warmup: {
        enabled: readJsonBoolean(preview, "warmup_enabled", false),
        applied: warmupApplied,
        status: readString(packageSummary?.warmup_status, "not_available"),
        day: readNumber(packageSummary, ["warmup_day"], null),
        packageStartedAt: readString(packageSummary?.package_started_at, ""),
        followDayCap: warmupFollowCap,
      },
      effective: {
        followDay: effectiveFollowCap,
        followSession: manualFollowSessionCap ?? packageFollowSessionCap,
        source: manualFollowDayCap !== null ? "admin_override" : warmupApplied ? "warmup" : "package_default",
      },
    },
    capsSource: packageSummary ? "account_package_summary+ig_account_settings+ig_action_logs" : settings ? "ig_account_settings+ig_action_logs" : "ig_action_logs",
  };
}

async function enrichAccountsWithRuntime(accounts: RecordValue[]) {
  const ids = accounts.map(accountId).filter(Boolean);
  if (!ids.length) return accounts;
  try {
    const supabase = createSupabaseClient();
    const since = dayStartIso();
    const [settingsResult, logsResult, packageResult, accountResult] = await Promise.all([
      supabase.from("ig_account_settings").select("*").in("account_id", ids),
      supabase.from("ig_action_logs").select("account_id,action_type,status,created_at").in("account_id", ids).gte("created_at", since).limit(10000),
      supabase.from("account_package_summary").select("account_id,commercial_package_label,package_caps,effective_caps_preview,warmup_status,warmup_day,package_started_at").in("account_id", ids),
      supabase.from("ig_accounts").select("id,followers_count").in("id", ids),
    ]);
    const settingsByAccount = new Map(
      ((settingsResult.data ?? []) as RecordValue[]).map((row) => [readString(row.account_id, ""), row]),
    );
    const logsByAccount = new Map<string, RecordValue[]>();
    for (const row of (logsResult.data ?? []) as RecordValue[]) {
      const id = readString(row.account_id, "");
      if (!id) continue;
      logsByAccount.set(id, [...(logsByAccount.get(id) ?? []), row]);
    }
    const packageByAccount = new Map(
      ((packageResult.data ?? []) as RecordValue[]).map((row) => [readString(row.account_id, ""), row]),
    );
    const accountById = new Map(
      ((accountResult.data ?? []) as RecordValue[]).map((row) => [readString(row.id, ""), row]),
    );
    return accounts.map((account) => {
      const id = accountId(account);
      const runtimeSummary = safeSettingsSummary(
        account,
        settingsByAccount.get(id),
        packageByAccount.get(id),
        logsByAccount.get(id) ?? [],
        accountById.get(id),
      );
      return {
        ...account,
        ...runtimeSummary,
      };
    });
  } catch {
    return accounts;
  }
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Profiles relay authentication failed.", relayAuthStatus(relayAuth.reason), { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const manage = await getManageData();
    const profiles = await enrichAccountsWithRuntime(manage.allAccounts as RecordValue[]);
    const byId = new Map(profiles.map((row) => [accountId(row as RecordValue), row]));
    const enrichLifecycle = (rows: unknown[]) => rows.map((row) => byId.get(accountId(row as RecordValue)) ?? row);
    return jsonOk({
      generated_at: new Date().toISOString(),
      profiles,
      activeAccounts: enrichLifecycle(manage.activeAccounts as unknown[]),
      archivedAccounts: enrichLifecycle(manage.archivedAccounts as unknown[]),
      trashedAccounts: enrichLifecycle(manage.trashedAccounts as unknown[]),
      summary: manage.summary,
      errors: manage.errors,
      source: "manage_overview",
    });
  } catch {
    return jsonError("Could not load BotApp profiles.", 500);
  }
}
