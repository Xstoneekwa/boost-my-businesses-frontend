import {
  rulesFromSettingsRow,
  type AutoRestartRulePreview,
} from "@/app/instagram-dashboard/auto-restart-data";
import {
  probeAutoRestartFoundation,
  validateActiveModePrerequisites,
} from "@/lib/instagram-dashboard/auto-restart-foundation";
import {
  readBoolean,
  readNumber,
  type SupabaseRecord,
} from "../../_utils";

export type AutoRestartSettingsPatch = {
  auto_restart_enabled?: unknown;
  mode?: unknown;
  check_every_minutes?: unknown;
  restart_delay_minutes?: unknown;
  max_attempts_per_session?: unknown;
  max_retries_after_initial_failure?: unknown;
  max_restarts_per_day_per_account?: unknown;
  max_restarts_per_window_per_account?: unknown;
  restart_yellow_accounts?: unknown;
  restart_red_accounts?: unknown;
  respect_blackout_windows?: unknown;
  respect_six_hour_window?: unknown;
  resume_follow_if_quota_remaining?: unknown;
  resume_unfollow_if_quota_remaining?: unknown;
  block_on_challenge?: unknown;
  block_on_restriction?: unknown;
  block_on_account_mismatch?: unknown;
  block_on_device_offline?: unknown;
  notify_on_blocked_restart?: unknown;
  phone_rest_enabled?: unknown;
  phone_rest_max_session_minutes?: unknown;
  phone_rest_min_rest_minutes?: unknown;
};

function readPositiveInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(readNumber(value, fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeAutoRestartPatch(
  body: AutoRestartSettingsPatch,
  existingRow?: SupabaseRecord | null,
) {
  const current = rulesFromSettingsRow(existingRow ?? undefined);
  const enabled = readBoolean(body.auto_restart_enabled, current.enabled);
  return {
    auto_restart_enabled: enabled,
    mode: "production" as const,
    check_every_minutes: readPositiveInt(body.check_every_minutes, current.checkEveryMinutes, 1, 1440),
    restart_delay_minutes: readPositiveInt(body.restart_delay_minutes, current.restartDelayMinutes, 1, 1440),
    max_attempts_per_session: readPositiveInt(body.max_attempts_per_session, current.maxAttemptsPerSession, 0, 20),
    max_retries_after_initial_failure: readPositiveInt(
      body.max_retries_after_initial_failure,
      current.maxRetriesAfterInitialFailure,
      0,
      20,
    ),
    max_restarts_per_day_per_account: readPositiveInt(body.max_restarts_per_day_per_account, 3, 0, 50),
    max_restarts_per_window_per_account: readPositiveInt(body.max_restarts_per_window_per_account, 2, 0, 50),
    restart_yellow_accounts: readBoolean(body.restart_yellow_accounts, false),
    restart_red_accounts: readBoolean(body.restart_red_accounts, false),
    respect_blackout_windows: readBoolean(body.respect_blackout_windows, current.respectPhoneRest),
    respect_six_hour_window: readBoolean(body.respect_six_hour_window, current.respectSixHourWindow),
    resume_follow_if_quota_remaining: readBoolean(body.resume_follow_if_quota_remaining, current.resumeFollowIfQuotaRemaining),
    resume_unfollow_if_quota_remaining: readBoolean(body.resume_unfollow_if_quota_remaining, current.resumeUnfollowIfQuotaRemaining),
    block_on_challenge: readBoolean(body.block_on_challenge, current.blockOnChallenge),
    block_on_restriction: readBoolean(body.block_on_restriction, current.blockOnRestriction),
    block_on_account_mismatch: readBoolean(body.block_on_account_mismatch, current.blockOnAccountMismatch),
    block_on_device_offline: readBoolean(body.block_on_device_offline, current.blockOnDeviceOffline),
    notify_on_blocked_restart: readBoolean(body.notify_on_blocked_restart, current.notifyOnBlockedRestart),
    phone_rest_enabled: readBoolean(body.phone_rest_enabled, false),
    phone_rest_max_session_minutes: body.phone_rest_max_session_minutes == null
      ? null
      : readPositiveInt(body.phone_rest_max_session_minutes, 0, 0, 1440),
    phone_rest_min_rest_minutes: body.phone_rest_min_rest_minutes == null
      ? null
      : readPositiveInt(body.phone_rest_min_rest_minutes, 0, 0, 1440),
  };
}

export function validateAutoRestartPatch(
  patch: ReturnType<typeof normalizeAutoRestartPatch>,
  foundation: Awaited<ReturnType<typeof probeAutoRestartFoundation>>,
) {
  return validateActiveModePrerequisites({
    patch,
    foundation,
    tickTokenConfigured: Boolean(process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN),
  });
}

export function patchToRulePreview(row: SupabaseRecord): AutoRestartRulePreview {
  return rulesFromSettingsRow(row);
}
