import { createSupabaseClient } from "@/lib/supabase";
import { getActivityLogData } from "@/app/instagram-dashboard/activity-log-data";
import { getManageData } from "@/app/instagram-dashboard/manage-data";
import type { SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import { safeInstagramPublicAvatarUrl } from "@/lib/instagram-public-profile-lookup";
import { runReadinessNow } from "@/lib/instagram-dashboard/readiness-now";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

const sensitiveKeyPattern = new RegExp(["password", "token", "secret", "authorization", ["service", "role"].join("_"), "webhook_secret", "api_key"].join("|"), "i");

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
  const id = readString(row.id, "");
  const rawAvatarUrl = readString(row.avatar_url, readString(row.profile_picture_url, readString(row.profile_image_url, "")));
  const avatarUrl = id && safeInstagramPublicAvatarUrl(rawAvatarUrl)
    ? `/api/instagram-dashboard/avatar?kind=target&id=${encodeURIComponent(id)}`
    : null;
  return {
    id,
    account_id: readString(row.account_id, ""),
    target_username: readString(row.target_username, readString(row.normalized_username, "")),
    normalized_username: readString(row.normalized_username, ""),
    display_name: readString(row.display_name, ""),
    avatar_url: avatarUrl || null,
    avatar_source: avatarUrl ? "dashboard_avatar_proxy" : "not_available",
    avatar_last_checked_at: readString(row.provider_checked_at, readString(row.avatar_last_checked_at, "")) || null,
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
  const [accountResult, settingsResult, filtersResult, targetsResult, runsResult, logsResult, packageResult, activityResult, readinessResult] = await Promise.all([
    supabase.from("ig_accounts").select("id,status,admin_lifecycle_status,archived_at,trashed_at,scheduled_trash_at,scheduled_delete_at,restored_at").eq("id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_account_settings").select("*").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_account_filters").select("*").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_targets").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(200),
    supabase.from("ig_runs").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(50),
    supabase.from("ig_action_logs").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(200),
    supabase.from("account_package_summary").select("*").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    getActivityLogData().catch(() => null),
    runReadinessNow(supabase, { accountId, audience: "admin", dryRun: true }).catch((error) => ({
      audience: "admin" as const,
      readiness_status: "retry_later" as const,
      client_status: "try_again_later" as const,
      client_message: "Readiness unavailable.",
      preflight_request_created: false,
      idempotent: false,
      next_action: "review_account",
      reason: error instanceof Error ? error.message : "readiness_unavailable",
      assignment_status: "blocked" as const,
      phone_available: null,
      app_instance_available: null,
      request_id: null,
      run_request_status: null,
    })),
  ]);

  const activityItems = activityResult?.items?.filter((item) => item.accountId === accountId || item.username === account.username) ?? [];
  const lifecycleRow = accountResult.data ?? null;
  const lifecycleAccount = lifecycleRow
    ? {
        ...account,
        adminStatus: readString(lifecycleRow.admin_lifecycle_status, account.adminStatus),
        lifecycleStatus: readString(lifecycleRow.status, account.adminStatus),
        archivedAt: readString(lifecycleRow.archived_at, "") || null,
        trashedAt: readString(lifecycleRow.trashed_at, "") || null,
        scheduledTrashAt: readString(lifecycleRow.scheduled_trash_at, "") || null,
        scheduledDeleteAt: readString(lifecycleRow.scheduled_delete_at, "") || null,
        restoredAt: readString(lifecycleRow.restored_at, "") || null,
      }
    : account;

  return {
    ok: true as const,
    account: lifecycleAccount,
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
    packageSummary: {
      data: packageResult.data ? redactRecord(packageResult.data) : { account_id: accountId, status: "not_available" },
      status: packageResult.error ? "backend_pending" : packageResult.data ? "connected" : "not_available",
      error: packageResult.error?.message ?? null,
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
    readinessSafe: {
      ...readinessResult,
      request_id: null,
      preflight_request_created: false,
    },
    source: {
      account: accountResult.error ? "manage_overview" : "manage_overview+ig_accounts_lifecycle",
      stats: runsResult.error ? "backend_pending" : "ig_runs+ig_action_logs",
      logs: logsResult.error ? "backend_pending" : "ig_action_logs+activity_log",
      targets: targetsResult.error ? "backend_pending" : "ig_targets",
      settings: settingsResult.error ? "backend_pending" : "ig_account_settings",
      packageSummary: packageResult.error ? "backend_pending" : "account_package_summary",
      filters: filtersResult.error ? "backend_pending" : "ig_account_filters",
      readiness: "readiness_now_dry_run",
    },
  };
}
