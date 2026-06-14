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

function safeSettingsRecord(row: SupabaseRecord | null, accountId: string, domain: SupabaseRecord = {}) {
  const base = row ? redactRecord(row) : { account_id: accountId, status: "not_available" };
  return { ...base, ...domain, account_id: accountId };
}

function safeTargetRow(row: SupabaseRecord, job: SupabaseRecord | null = null) {
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
    verification_status: readString(row.verification_status, "pending"),
    verification_reason: readString(row.verification_reason, "") || null,
    source: readString(row.source, "unknown"),
    followers_count: row.followers_count ?? null,
    is_private: typeof row.is_private === "boolean" ? row.is_private : null,
    is_verified: typeof row.is_verified === "boolean" ? row.is_verified : null,
    followbacks_count: row.followbacks_count ?? null,
    follows_sent_count: row.follows_sent_count ?? null,
    followback_ratio: row.followback_ratio ?? null,
    performance_status: readString(row.performance_status, "") || null,
    archived_at: readString(row.archived_at, "") || null,
    deleted_at: readString(row.deleted_at, "") || null,
    last_used_at: readString(row.last_used_at, "") || null,
    last_selected_at: readString(row.last_selected_at, "") || null,
    last_successful_candidate_at: readString(row.last_successful_candidate_at, "") || null,
    last_exhausted_at: readString(row.last_exhausted_at, "") || null,
    exhaustion_reason: readString(row.exhaustion_reason, "") || null,
    cooldown_until: readString(row.cooldown_until, "") || null,
    metrics_updated_at: readString(row.metrics_updated_at, "") || null,
    rejected_reason: readString(row.rejected_reason, "") || null,
    rejection_reason: readString(row.rejected_reason, "") || null,
    batch_id: readString(row.batch_id, "") || null,
    provider_checked_at: readString(row.provider_checked_at, "") || null,
    last_verified_at: readString(row.provider_checked_at, "") || null,
    job_status: readString(job?.status, "") || null,
    job_provider_status: readString(job?.provider_status, "") || null,
    job_attempt_count: job?.attempt_count ?? null,
    job_next_attempt_at: readString(job?.next_attempt_at, "") || null,
    job_last_error_code: readString(job?.last_error_code, "") || null,
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
  const [accountResult, settingsResult, filtersResult, dmSettingsResult, dmTemplatesResult, unfollowSettingsResult, sourceSettingsResult, targetsResult, targetJobsResult, runsResult, logsResult, packageResult, activityResult, readinessResult] = await Promise.all([
    supabase.from("ig_accounts").select("id,status,admin_lifecycle_status,archived_at,trashed_at,scheduled_trash_at,scheduled_delete_at,restored_at").eq("id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_account_settings").select("*").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_account_follow_settings").select("account_id,dont_follow_private_accounts,min_followers,max_followers,min_posts").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_account_dm_settings").select("account_id,welcome_enabled,outreach_enabled,welcome_template_id,default_outreach_template_id,welcome_per_session_limit,welcome_per_day_limit,outreach_per_session_limit,outreach_per_day_limit,total_dm_per_day_limit").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_dm_templates").select("id,template_type,body,active,is_default").eq("account_id", accountId).eq("active", true).limit(20),
    supabase.from("ig_account_unfollow_settings").select("account_id,unfollow_enabled,unfollow_mode,unfollow_per_session_limit,unfollow_per_day_limit,unfollow_after_days,runtime_cap_mode,runtime_safety_cap").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("account_follow_source_settings").select("account_id,max_follows_per_target_per_run,max_targets_per_run").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_targets").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(200),
    supabase.from("ct_target_verification_jobs").select("target_id,status,provider_status,attempt_count,next_attempt_at,last_error_code,updated_at").eq("account_id", accountId).limit(500),
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
  const targetJobs = new Map(((targetJobsResult.data ?? []) as SupabaseRecord[]).map((row) => [readString(row.target_id, ""), row]));
  const templates = (dmTemplatesResult.data ?? []) as SupabaseRecord[];
  const welcomeTemplate = templates.find((row) => readString(row.id, "") === readString(dmSettingsResult.data?.welcome_template_id, ""))
    ?? templates.find((row) => readString(row.template_type, "") === "welcome" && row.is_default === true)
    ?? templates.find((row) => readString(row.template_type, "") === "welcome")
    ?? null;
  const outreachTemplate = templates.find((row) => readString(row.id, "") === readString(dmSettingsResult.data?.default_outreach_template_id, ""))
    ?? templates.find((row) => readString(row.template_type, "") === "outreach" && row.is_default === true)
    ?? templates.find((row) => readString(row.template_type, "") === "outreach")
    ?? null;
  const domainSettings: SupabaseRecord = {
    dm_settings_status: dmSettingsResult.error ? "backend_pending" : "connected",
    welcome_enabled: dmSettingsResult.data?.welcome_enabled === true,
    welcome_dm_enabled: dmSettingsResult.data?.welcome_enabled === true,
    outreach_enabled: dmSettingsResult.data?.outreach_enabled === true,
    cold_dm_enabled: dmSettingsResult.data?.outreach_enabled === true,
    welcome_message: readString(welcomeTemplate?.body, ""),
    welcome_dm_body: readString(welcomeTemplate?.body, ""),
    outreach_message: readString(outreachTemplate?.body, ""),
    cold_dm_body: readString(outreachTemplate?.body, ""),
    welcome_session_cap: dmSettingsResult.data?.welcome_per_session_limit ?? 0,
    welcome_day_cap: dmSettingsResult.data?.welcome_per_day_limit ?? 10,
    outreach_session_cap: dmSettingsResult.data?.outreach_per_session_limit ?? 0,
    outreach_day_cap: dmSettingsResult.data?.outreach_per_day_limit ?? 30,
    welcome_template_status: welcomeTemplate ? "Configured" : "Missing",
    outreach_template_status: outreachTemplate ? "Configured" : "Missing",
    unfollow_settings_status: unfollowSettingsResult.error ? "backend_pending" : "connected",
    unfollow_enabled: unfollowSettingsResult.data?.unfollow_enabled === true,
    unfollow_mode: readString(unfollowSettingsResult.data?.unfollow_mode, "unfollow"),
    unfollow_per_session_limit: unfollowSettingsResult.data?.unfollow_per_session_limit ?? null,
    unfollow_per_day_limit: unfollowSettingsResult.data?.unfollow_per_day_limit ?? null,
    unfollow_after_days: unfollowSettingsResult.data?.unfollow_after_days ?? 3,
    runtime_cap_mode: readString(unfollowSettingsResult.data?.runtime_cap_mode, "prod_normal"),
    runtime_safety_cap: unfollowSettingsResult.data?.runtime_safety_cap ?? null,
    follow_source_settings_status: sourceSettingsResult.error ? "backend_pending" : sourceSettingsResult.data ? "connected" : "default",
    max_follows_per_target_per_run: sourceSettingsResult.data?.max_follows_per_target_per_run ?? null,
    max_targets_per_run: sourceSettingsResult.data?.max_targets_per_run ?? null,
  };
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
      items: ((targetsResult.data ?? []) as SupabaseRecord[]).map((row) => safeTargetRow(row, targetJobs.get(readString(row.id, "")) ?? null)),
      status: targetsResult.error ? "backend_pending" : "connected",
      error: targetsResult.error?.message ?? targetJobsResult.error?.message ?? null,
    },
    settings: {
      data: safeSettingsRecord(settingsResult.data ?? null, accountId, domainSettings),
      status: settingsResult.error || dmSettingsResult.error || unfollowSettingsResult.error || sourceSettingsResult.error ? "backend_pending" : settingsResult.data ? "connected" : "not_available",
      error: settingsResult.error?.message ?? dmSettingsResult.error?.message ?? unfollowSettingsResult.error?.message ?? sourceSettingsResult.error?.message ?? null,
    },
    packageSummary: {
      data: packageResult.data ? redactRecord(packageResult.data) : { account_id: accountId, status: "not_available" },
      status: packageResult.error ? "backend_pending" : packageResult.data ? "connected" : "not_available",
      error: packageResult.error?.message ?? null,
    },
    filters: {
      data: filtersResult.data
        ? {
            account_id: accountId,
            skip_private_profiles: filtersResult.data.dont_follow_private_accounts === true,
            dont_follow_private_accounts: filtersResult.data.dont_follow_private_accounts === true,
            min_followers: filtersResult.data.min_followers ?? null,
            max_followers: filtersResult.data.max_followers ?? null,
            min_posts: filtersResult.data.min_posts ?? null,
          }
        : {
            account_id: accountId,
            skip_private_profiles: true,
            dont_follow_private_accounts: true,
            min_followers: null,
            max_followers: null,
            min_posts: null,
            status: "default",
          },
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
      settings: settingsResult.error ? "backend_pending" : "ig_account_settings+domain_settings",
      packageSummary: packageResult.error ? "backend_pending" : "account_package_summary",
      filters: filtersResult.error ? "backend_pending" : "ig_account_follow_settings",
      readiness: "readiness_now_dry_run",
    },
  };
}
