import { createSupabaseClient } from "@/lib/supabase";
import { getActivityLogData } from "@/app/instagram-dashboard/activity-log-data";
import { getManageData } from "@/app/instagram-dashboard/manage-data";
import type { SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

const sensitiveKeyPattern = /password|token|secret|authorization|service_role|webhook_secret|api_key/i;

function redactRecord(record: SupabaseRecord) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (sensitiveKeyPattern.test(key)) return [key, "[REDACTED]"];
      return [key, value];
    }),
  );
}

function safeSettingsRecord(row: SupabaseRecord | null, accountId: string) {
  if (!row) return { account_id: accountId, status: "not_available" };
  return redactRecord(row);
}

function safeTargetRow(row: SupabaseRecord) {
  return {
    id: readString(row.id, ""),
    account_id: readString(row.account_id, ""),
    target_username: readString(row.target_username, readString(row.normalized_username, "")),
    normalized_username: readString(row.normalized_username, ""),
    status: readString(row.status, "unknown"),
    quality_status: readString(row.quality_status, "unknown"),
    source: readString(row.source, "unknown"),
    followers_count: row.followers_count ?? null,
    followbacks_count: row.followbacks_count ?? null,
    follows_sent_count: row.follows_sent_count ?? null,
    archived_at: readString(row.archived_at, "") || null,
    deleted_at: readString(row.deleted_at, "") || null,
    last_used_at: readString(row.last_used_at, "") || null,
    last_selected_at: readString(row.last_selected_at, "") || null,
    rejection_reason: readString(row.rejection_reason, "") || null,
    updated_at: readString(row.updated_at, "") || null,
  };
}

function safeLogRow(row: SupabaseRecord) {
  return {
    id: readString(row.id, ""),
    account_id: readString(row.account_id, ""),
    run_id: readString(row.run_id, readString(row.ig_run_id, "")) || null,
    action_type: readString(row.action_type, readString(row.action, readString(row.event_type, "event"))),
    status: readString(row.status, readString(row.result, "unknown")),
    message: readString(row.message, readString(row.error_message, "")),
    created_at: readString(row.created_at, ""),
    source: readString(row.source, "dashboard"),
    level: readString(row.level, "info"),
  };
}

function safeStatsSummary(runs: SupabaseRecord[], logs: SupabaseRecord[]) {
  const latestRun = runs[0] ?? null;
  return {
    runs_count: runs.length,
    logs_count: logs.length,
    latest_run_id: latestRun ? readString(latestRun.id, readString(latestRun.run_id, "")) : null,
    latest_run_status: latestRun ? readString(latestRun.status, "unknown") : null,
    latest_run_started_at: latestRun ? readString(latestRun.started_at, readString(latestRun.created_at, "")) : null,
    follows_today: logs.filter((row) => /follow/i.test(readString(row.action_type, ""))).length,
    unfollows_today: logs.filter((row) => /unfollow/i.test(readString(row.action_type, ""))).length,
    likes_today: logs.filter((row) => /like/i.test(readString(row.action_type, ""))).length,
  };
}

export async function getProfileDetailsData(accountId: string) {
  const manage = await getManageData();
  const account = manage.allAccounts.find((row) => row.accountId === accountId) ?? null;
  if (!account) {
    return {
      ok: false as const,
      error: "Account not found in Manage overview.",
      accountId,
    };
  }

  const supabase = createSupabaseClient();
  const [settingsResult, filtersResult, targetsResult, runsResult, logsResult, activityResult] = await Promise.all([
    supabase.from("ig_account_settings").select("*").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_account_filters").select("*").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_targets").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(200),
    supabase.from("ig_runs").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(50),
    supabase.from("ig_action_logs").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(200),
    getActivityLogData().catch(() => null),
  ]);

  const activityItems = activityResult?.items?.filter((item) => item.accountId === accountId || item.username === account.username) ?? [];

  return {
    ok: true as const,
    account,
    stats: {
      summary: safeStatsSummary((runsResult.data ?? []) as SupabaseRecord[], (logsResult.data ?? []) as SupabaseRecord[]),
      runs: ((runsResult.data ?? []) as SupabaseRecord[]).map(redactRecord),
      status: runsResult.error ? "backend_pending" : "connected",
      error: runsResult.error?.message ?? null,
    },
    logs: {
      items: [
        ...((logsResult.data ?? []) as SupabaseRecord[]).map(safeLogRow),
        ...activityItems.map((item) => ({
          id: item.id,
          account_id: accountId,
          run_id: item.runId ?? null,
          action_type: item.actionType ?? item.action,
          status: item.actionStatus ?? item.result,
          message: item.safeSummary,
          created_at: item.occurredAt ?? item.timestamp,
          source: item.sourceLabel,
          level: item.result === "failed" ? "error" : "info",
        })),
      ],
      status: logsResult.error ? "backend_pending" : "connected",
      error: logsResult.error?.message ?? null,
    },
    targets: {
      items: ((targetsResult.data ?? []) as SupabaseRecord[]).map(safeTargetRow),
      status: targetsResult.error ? "backend_pending" : "connected",
      error: targetsResult.error?.message ?? null,
    },
    settings: {
      data: safeSettingsRecord(settingsResult.data ?? null, accountId),
      status: settingsResult.error ? "backend_pending" : settingsResult.data ? "connected" : "not_available",
      error: settingsResult.error?.message ?? null,
    },
    filters: {
      data: filtersResult.data ? redactRecord(filtersResult.data) : { account_id: accountId, status: "not_available" },
      status: filtersResult.error ? "backend_pending" : filtersResult.data ? "connected" : "not_available",
      error: filtersResult.error?.message ?? null,
    },
    credentialsSafe: {
      credentialStatus: account.credentialsStatus,
      loginStatus: account.loginStatus,
      passwordDisplay: account.passwordDisplay,
      twoFactorDisplay: account.twoFactorDisplay,
      credentialsConfigured: account.credentialsConfigured,
      reauthRequired: account.reauthRequired,
    },
    source: {
      account: "manage_overview",
      stats: runsResult.error ? "backend_pending" : "ig_runs+ig_action_logs",
      logs: logsResult.error ? "backend_pending" : "ig_action_logs+activity_log",
      targets: targetsResult.error ? "backend_pending" : "ig_targets",
      settings: settingsResult.error ? "backend_pending" : "ig_account_settings",
      filters: filtersResult.error ? "backend_pending" : "ig_account_filters",
    },
  };
}
