import { createSupabaseClient } from "@/lib/supabase";
import {
  probeAutoRestartFoundation,
  validateActiveModePrerequisites,
} from "@/lib/instagram-dashboard/auto-restart-foundation";
import {
  normalizePilotAccountId,
  validatePilotAccountForSettings,
} from "@/lib/instagram-dashboard/auto-restart-pilot";
import {
  defaultAutoRestartRules,
  rulesFromSettingsRow,
  type AutoRestartMode,
  type AutoRestartRulePreview,
} from "@/app/instagram-dashboard/auto-restart-data";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readNumber,
  readString,
  requireRelayOrAdmin,
  type SupabaseRecord,
} from "../../_utils";

export const dynamic = "force-dynamic";

export type AutoRestartSettingsPatch = {
  auto_restart_enabled?: unknown;
  mode?: unknown;
  check_every_minutes?: unknown;
  restart_delay_minutes?: unknown;
  max_attempts_per_session?: unknown;
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
  pilot_account_id?: unknown;
};

function readMode(value: unknown): AutoRestartMode {
  const mode = readString(value, "disabled");
  return mode === "active" || mode === "disabled" || mode === "dry_run" ? mode : "disabled";
}

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
  const existingPilot = readString(existingRow?.pilot_account_id) || current.pilotAccountId || null;
  return {
    auto_restart_enabled: readBoolean(body.auto_restart_enabled, current.enabled),
    mode: readMode(body.mode ?? current.mode),
    check_every_minutes: readPositiveInt(body.check_every_minutes, current.checkEveryMinutes, 1, 1440),
    restart_delay_minutes: readPositiveInt(body.restart_delay_minutes, current.restartDelayMinutes, 1, 1440),
    max_attempts_per_session: readPositiveInt(body.max_attempts_per_session, current.maxAttemptsPerSession, 0, 20),
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
    pilot_account_id: "pilot_account_id" in body
      ? normalizePilotAccountId(body.pilot_account_id)
      : existingPilot,
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

async function auditSettingsMutation(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    actorId: string | null;
    patch: ReturnType<typeof normalizeAutoRestartPatch>;
    requestId: string;
  },
) {
  const now = new Date().toISOString();
  await supabase.from("auto_restart_decisions").insert({
    request_id: input.requestId,
    idempotency_key: `settings:${now}:${input.patch.mode}:${input.patch.auto_restart_enabled}`,
    actor: input.actorId ? `admin:${input.actorId}` : "admin",
    action: "auto_restart_settings_updated",
    decision: input.patch.auto_restart_enabled ? input.patch.mode : "disabled",
    reason: "settings_patch",
    mode: input.patch.mode,
    metadata_safe: {
      auto_restart_enabled: input.patch.auto_restart_enabled,
      check_every_minutes: input.patch.check_every_minutes,
      pilot_account_id: input.patch.pilot_account_id,
    },
  });
}

export function patchToRulePreview(row: SupabaseRecord): AutoRestartRulePreview {
  return rulesFromSettingsRow(row);
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Auto Restart settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const supabase = createSupabaseClient();
    const foundation = await probeAutoRestartFoundation(supabase);
    const { data, error } = await supabase
      .from("auto_restart_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle<SupabaseRecord>();

    if (error) {
      return jsonOk({
        rules: defaultAutoRestartRules(),
        backend_pending: true,
        writable: false,
        foundation,
        error: error.message,
      });
    }

    return jsonOk({
      rules: rulesFromSettingsRow(data ?? undefined),
      backend_pending: !foundation.settingsWritable,
      writable: foundation.settingsWritable,
      foundation,
      updated_at: readString(data?.updated_at) || null,
    });
  } catch {
    return jsonError("Could not load Auto Restart settings.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Auto Restart settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = (await readJsonBody<AutoRestartSettingsPatch>(request)) ?? {};
    const userContext = await getInstagramAdminUserContext();
    const supabase = createSupabaseClient();
    const foundation = await probeAutoRestartFoundation(supabase);
    const { data: existingRow } = await supabase
      .from("auto_restart_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle<SupabaseRecord>();
    const patch = normalizeAutoRestartPatch(body, existingRow);
    if (patch.pilot_account_id) {
      const pilotReason = await validatePilotAccountForSettings(supabase, patch.pilot_account_id);
      if (pilotReason) {
        return jsonError("Pilot account validation failed.", 400, { reason: pilotReason, foundation });
      }
    }
    const validationError = validateAutoRestartPatch(patch, foundation);
    if (validationError) {
      return jsonError("Auto Restart settings validation failed.", 400, { reason: validationError, foundation });
    }
    if (!foundation.settingsWritable) {
      return jsonError("Auto Restart settings table is not deployed.", 503, {
        reason: "auto_restart_foundation_not_deployed",
        foundation,
      });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("auto_restart_settings")
      .upsert({
        id: "global",
        ...patch,
        updated_at: now,
        updated_by: userContext?.userId ?? null,
      })
      .select("*")
      .single<SupabaseRecord>();

    if (error) {
      return jsonError("Could not save Auto Restart settings.", 500, {
        reason: error.message,
        backend_pending: error.message.toLowerCase().includes("auto_restart_settings"),
      });
    }

    const requestId = `auto-restart-settings-${Date.now().toString(36)}`;
    try {
      await auditSettingsMutation(supabase, {
        actorId: userContext?.userId ?? null,
        patch,
        requestId,
      });
    } catch {
      // Audit is best-effort; settings row is canonical.
    }

    return jsonOk({
      rules: rulesFromSettingsRow(data),
      saved_at: now,
      backend_pending: false,
      writable: true,
      foundation,
      request_id: requestId,
      log_event: "auto_restart_settings_updated",
    });
  } catch {
    return jsonError("Could not save Auto Restart settings.", 500);
  }
}
