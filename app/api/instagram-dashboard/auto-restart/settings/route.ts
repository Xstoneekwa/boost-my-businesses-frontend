import { createSupabaseClient } from "@/lib/supabase";
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
  restart_delay_minutes?: unknown;
  max_attempts_per_session?: unknown;
  resume_follow_if_quota_remaining?: unknown;
  resume_unfollow_if_quota_remaining?: unknown;
  block_on_challenge?: unknown;
  block_on_restriction?: unknown;
  block_on_account_mismatch?: unknown;
  block_on_device_offline?: unknown;
  notify_on_blocked_restart?: unknown;
};

function readMode(value: unknown): AutoRestartMode {
  const mode = readString(value, "dry_run");
  return mode === "active" || mode === "disabled" || mode === "dry_run" ? mode : "dry_run";
}

function readPositiveInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(readNumber(value, fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeAutoRestartPatch(body: AutoRestartSettingsPatch) {
  const current = defaultAutoRestartRules();
  return {
    auto_restart_enabled: readBoolean(body.auto_restart_enabled, current.enabled),
    mode: readMode(body.mode ?? current.mode),
    restart_delay_minutes: readPositiveInt(body.restart_delay_minutes, current.restartDelayMinutes, 1, 1440),
    max_attempts_per_session: readPositiveInt(body.max_attempts_per_session, current.maxAttemptsPerSession, 0, 20),
    resume_follow_if_quota_remaining: readBoolean(body.resume_follow_if_quota_remaining, current.resumeFollowIfQuotaRemaining),
    resume_unfollow_if_quota_remaining: readBoolean(body.resume_unfollow_if_quota_remaining, current.resumeUnfollowIfQuotaRemaining),
    block_on_challenge: readBoolean(body.block_on_challenge, current.blockOnChallenge),
    block_on_restriction: readBoolean(body.block_on_restriction, current.blockOnRestriction),
    block_on_account_mismatch: readBoolean(body.block_on_account_mismatch, current.blockOnAccountMismatch),
    block_on_device_offline: readBoolean(body.block_on_device_offline, current.blockOnDeviceOffline),
    notify_on_blocked_restart: readBoolean(body.notify_on_blocked_restart, current.notifyOnBlockedRestart),
  };
}

export function validateAutoRestartPatch(patch: ReturnType<typeof normalizeAutoRestartPatch>) {
  if (patch.mode === "active") {
    return "active_mode_scheduler_not_wired";
  }
  return null;
}

export function patchToRulePreview(row: SupabaseRecord): AutoRestartRulePreview {
  return rulesFromSettingsRow(row);
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Auto Restart settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("auto_restart_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle<SupabaseRecord>();

    if (error) {
      return jsonOk({
        rules: defaultAutoRestartRules(),
        backend_pending: true,
        error: error.message,
      });
    }

    return jsonOk({
      rules: rulesFromSettingsRow(data ?? undefined),
      backend_pending: false,
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
    const patch = normalizeAutoRestartPatch(body);
    const validationError = validateAutoRestartPatch(patch);
    if (validationError) {
      return jsonError("Auto Restart mode active is not wired yet.", 400, { reason: validationError });
    }

    const userContext = await getInstagramAdminUserContext();
    const supabase = createSupabaseClient();
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

    return jsonOk({
      rules: rulesFromSettingsRow(data),
      saved_at: now,
      backend_pending: false,
      log_event: "auto_restart_settings_saved",
    });
  } catch {
    return jsonError("Could not save Auto Restart settings.", 500);
  }
}
