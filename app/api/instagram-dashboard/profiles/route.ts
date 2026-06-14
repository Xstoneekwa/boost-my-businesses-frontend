import { getManageData } from "@/app/instagram-dashboard/manage-data";
import {
  actionCountersFromLogs,
  interactionEventCounters,
  reconcileSocialCounters,
  runTotalsCounters,
  TOTAL_INTERACTIONS_DEFINITION,
} from "@/lib/instagram-dashboard/social-counters";
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

function fallbackPackageCaps(packageLabel: string) {
  const normalized = packageLabel.toLowerCase();
  if (normalized.includes("premium")) return { followDay: 180, followSession: 180, unfollowDay: 240, unfollowSession: 240, likeDay: 500, dmDay: 100 };
  if (normalized.includes("pro")) return { followDay: 120, followSession: 120, unfollowDay: 120, unfollowSession: 120, likeDay: 500, dmDay: 10 };
  return { followDay: 80, followSession: 80, unfollowDay: 80, unfollowSession: 80, likeDay: 100, dmDay: 0 };
}

function activeRunControlProjection(
  activeRequest: RecordValue | undefined,
  activeRun: RecordValue | undefined,
) {
  if (!activeRequest && !activeRun) return {};
  const reason = activeRun ? "already_running" : "already_requested";
  return {
    runStatus: "running",
    currentRunStatus: "running",
    eligibility: "blocked_now",
    eligibility_status: "blocked_now",
    eligibilityReason: reason,
    eligibility_reason: reason,
    primary_block_reason: reason,
    primaryBlockReason: reason,
    activeRunRequestId: activeRequest ? readString(activeRequest.id, "") : null,
    activeRunRequestStatus: activeRequest ? readString(activeRequest.status, "") : null,
    activeRunId: activeRun
      ? readString(activeRun.id, "")
      : activeRequest
        ? readString(activeRequest.run_id, "")
        : null,
    activeRunStatus: activeRun ? readString(activeRun.status, "") : null,
  };
}

function safeSettingsSummary(
  account: RecordValue,
  settings: RecordValue | undefined,
  packageSummary: RecordValue | undefined,
  logs: RecordValue[],
  accountRow: RecordValue | undefined,
  runs: RecordValue[] = [],
  interactionEvents: RecordValue[] = [],
) {
  const counters = reconcileSocialCounters(
    actionCountersFromLogs(logs),
    runTotalsCounters(runs),
    interactionEventCounters(interactionEvents),
  );
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
      follow: { used: counters.follows, max: effectiveFollowCap, source: "ig_action_logs+ig_runs+ig_interaction_events" },
      unfollow: { used: counters.unfollows, max: effectiveUnfollowCap, source: "ig_action_logs+ig_runs+ig_interaction_events" },
      like: { used: counters.likes, max: likeCap, source: "ig_action_logs+ig_runs+ig_interaction_events" },
      comment: { used: counters.comments, max: 0, source: "ig_action_logs+ig_runs+ig_interaction_events" },
      dm: { used: counters.dms, max: dmCap, source: "ig_action_logs+ig_runs+ig_interaction_events" },
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
    capsSource: packageSummary
      ? "account_package_summary+ig_account_settings+ig_action_logs+ig_runs+ig_interaction_events"
      : settings
        ? "ig_account_settings+ig_action_logs+ig_runs+ig_interaction_events"
        : "ig_action_logs+ig_runs+ig_interaction_events",
    totalInteractionsDefinition: TOTAL_INTERACTIONS_DEFINITION,
  };
}

async function enrichAccountsWithRuntime(accounts: RecordValue[]) {
  const ids = accounts.map(accountId).filter(Boolean);
  if (!ids.length) return accounts;
  try {
    const supabase = createSupabaseClient();
    const since = dayStartIso();
    const [settingsResult, logsResult, packageResult, accountResult, requestsResult, runsResult, sessionRunsResult, interactionEventsResult] = await Promise.all([
      supabase.from("ig_account_settings").select("*").in("account_id", ids),
      supabase.from("ig_action_logs").select("account_id,action_type,status,created_at").in("account_id", ids).gte("created_at", since).limit(10000),
      supabase.from("account_package_summary").select("account_id,commercial_package_label,package_caps,effective_caps_preview,warmup_status,warmup_day,package_started_at").in("account_id", ids),
      supabase.from("ig_accounts").select("id,followers_count").in("id", ids),
      supabase.from("account_run_requests").select("id,account_id,status,run_id,source_surface").in("account_id", ids).in("status", ["pending", "queued", "claimed", "starting", "running", "stopping", "canceling"]),
      supabase.from("ig_runs").select("id,account_id,status").in("account_id", ids).in("status", ["pending", "running", "stopping"]),
      supabase.from("ig_runs").select("account_id,total_follow,total_like,total_dm,total_story,created_at,started_at").in("account_id", ids).gte("created_at", since).limit(10000),
      supabase.from("ig_interaction_events").select("account_id,event_type,event_status,interaction_type,event_at,payload").in("account_id", ids).gte("event_at", since).limit(10000),
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
    const activeRequestByAccount = new Map<string, RecordValue>();
    for (const row of (requestsResult.data ?? []) as RecordValue[]) {
      const id = readString(row.account_id, "");
      if (!id || activeRequestByAccount.has(id)) continue;
      activeRequestByAccount.set(id, row);
    }
    const activeRunByAccount = new Map<string, RecordValue>();
    for (const row of (runsResult.data ?? []) as RecordValue[]) {
      const id = readString(row.account_id, "");
      if (!id || activeRunByAccount.has(id)) continue;
      activeRunByAccount.set(id, row);
    }
    const sessionRunsByAccount = new Map<string, RecordValue[]>();
    for (const row of (sessionRunsResult.data ?? []) as RecordValue[]) {
      const id = readString(row.account_id, "");
      if (!id) continue;
      sessionRunsByAccount.set(id, [...(sessionRunsByAccount.get(id) ?? []), row]);
    }
    const interactionEventsByAccount = new Map<string, RecordValue[]>();
    for (const row of (interactionEventsResult.data ?? []) as RecordValue[]) {
      const id = readString(row.account_id, "");
      if (!id) continue;
      interactionEventsByAccount.set(id, [...(interactionEventsByAccount.get(id) ?? []), row]);
    }
    return accounts.map((account) => {
      const id = accountId(account);
      const runtimeSummary = safeSettingsSummary(
        account,
        settingsByAccount.get(id),
        packageByAccount.get(id),
        logsByAccount.get(id) ?? [],
        accountById.get(id),
        sessionRunsByAccount.get(id) ?? [],
        interactionEventsByAccount.get(id) ?? [],
      );
      return {
        ...account,
        ...runtimeSummary,
        ...activeRunControlProjection(activeRequestByAccount.get(id), activeRunByAccount.get(id)),
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
