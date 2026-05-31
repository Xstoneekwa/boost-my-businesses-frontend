import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import {
  evaluateUnfollowAnyStartGate,
  isUnfollowAnyMode,
  resolveFollowToUnfollowHandoffEnabled,
  resolveUnfollowRuntimeCap,
  runControlLegacyDmSenderRealSendEnabled,
  runControlOutreachRealSendEnabled,
  runControlUnfollowAnyH3RealSupported,
  runControlUnfollowAnySafeStrategyProven,
  runControlWelcomeRealSendEnabled,
  type RunStartBlockReason,
} from "@/lib/instagram-dashboard/run-control";
import {
  DEFAULT_OUTREACH_DM_DAY_CAP,
  DEFAULT_WELCOME_DM_DAY_CAP,
  readProductDefaultDayCap,
} from "./dm/route";
import { dmTemplateStatusLabel, fetchActiveDmTemplate } from "@/lib/instagram-dashboard/dm-template-store";
import { getAccountId, readBoolean, readJsonBody, readNumber, readString, requireInstagramAdmin, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

type SettingsValue = string | number | boolean;
type SettingsPayload = Record<string, SettingsValue> & { account_id: string };
type SettingsRecord = Partial<SettingsPayload> & SupabaseRecord;
type SettingsResponse = {
  ok: true;
  data: Record<string, SettingsValue>;
};

const protectedSettingsKeys = ["password", "email", "device_udid", "app_package", "cloned_app_mode"] as const;

const stringDefaults = {
  username: "",
  display_name: "",
  device_name: "",
  device_udid: "",
  email: "",
  password: "",
  app_package: "com.instagram.android",
  account_status: "active",
  campaign_name: "Default campaign",
  timeslot_start: "09:00",
  timeslot_end: "18:00",
  pause_account_until: "",
  welcome_dm_message: "",
  cold_dm_message: "",
  sort_followers_mode: "recent",
  source_accounts: "",
  last_error: "",
  last_successful_action: "",
  current_run_status: "idle",
  welcome_dm_real_send_status: "Disabled",
  welcome_dm_template_status: "Missing",
  welcome_entitlement_status: "Missing",
  outreach_dm_real_send_status: "Disabled",
  outreach_dm_template_status: "Missing",
  outreach_entitlement_status: "Missing",
  dm_legacy_gate_status: "Not configured",
  max_dm_per_run_legacy_status: "Legacy shared cap; use domain caps",
  unfollow_runtime_mode: "unfollow",
  unfollow_any_runtime_state: "Disabled",
  unfollow_any_runtime_block_reason: "",
  unfollow_mode: "unfollow",
  follow_entitlement_status: "Unknown",
  unfollow_entitlement_status: "Unknown",
  current_runtime_mode: "unfollow",
  handoff_real_status: "Unknown",
  safe_candidate_strategy_status: "Unknown",
  limiting_reason: "Unknown",
  runtime_cap_mode: "prod_normal",
  runtime_cap_source: "supabase_domain_caps",
  commercial_package_label: "Package pending",
  warmup_status: "pending_package_start",
  warmup_profile_code: "follow_default_v1",
  package_started_at: "",
  follow_limiting_reason: "Unknown",
} satisfies Record<string, string>;

const booleanDefaults = {
  two_fa_enabled: false,
  cloned_app_mode: false,
  unfollow_any_runtime_configured: false,
  do_unfollow_first: false,
  randomize_start_enabled: true,
  follow_enabled: false,
  unfollow_enabled: false,
  like_enabled: false,
  story_watch_enabled: true,
  welcome_dm_enabled: true,
  cold_dm_enabled: false,
  check_chat_before_welcoming: true,
  send_enabled: false,
  safe_review_mode: true,
  welcome_dm_runtime_enabled: false,
  outreach_dm_runtime_enabled: false,
  warmup_enabled: true,
  followback_on_followers: false,
  unfollow_non_followers: false,
  unfollow_any: false,
  mute_posts_after_follow: false,
  mute_stories_after_follow: false,
  do_follows_first: true,
  delete_interacted_users: false,
  change_source_if_crash: true,
  fling_when_skipped: true,
  end_if_follow_limit_reached: true,
  end_if_dm_limit_reached: true,
  end_if_likes_limit_reached: true,
  warmup_mode: true,
  stop_on_suspicious_screen: true,
  stop_on_login_challenge: true,
  stop_on_checkpoint: true,
  stop_on_repeated_navigation_failure: true,
  disable_block_detection: false,
  relog_after_block: true,
  rotate_ip: false,
  restart_uiautomator2: true,
  close_apps: true,
  close_apps_device: false,
  log_out_all_before_session: false,
  screen_sleep: false,
  screen_record: false,
  debug_mode: false,
  dry_run_enabled: true,
  manual_stop_requested: false,
} satisfies Record<string, boolean>;

const numberDefaults = {
  total_sessions: 1,
  stop_interactions_after_minutes: 45,
  timeout_startup_seconds: 120,
  pause_account_days: 0,
  speed_multiplier: 1,
  follow_limit: 20,
  total_follows_limit: 100,
  manual_follow_day_cap: 120,
  manual_follow_session_cap: 20,
  package_follow_day_cap: 0,
  effective_follow_cap_today: 0,
  effective_warmup_cap_today: 0,
  follow_day_remaining: 0,
  warmup_day: 0,
  day_1_follow_cap: 10,
  day_2_follow_cap: 20,
  day_3_follow_cap: 40,
  day_4_plus_follow_cap: 120,
  follow_percentage: 100,
  total_unfollows_limit: 0,
  unfollow_delay_days: 7,
  total_likes_limit: 100,
  likes_per_follow_min: 0,
  likes_per_follow_max: 2,
  likes_percentage: 100,
  watch_photo_time_min: 3,
  watch_photo_time_max: 8,
  watch_video_time_min: 5,
  watch_video_time_max: 18,
  max_dm_per_run: 2,
  welcome_dm_effective_cap: 0,
  outreach_dm_effective_session_cap: 0,
  outreach_dm_effective_day_cap: 0,
  max_consecutive_dms: 3,
  max_followback_skips: 50,
  max_followback_ignore: 200,
  unfollow_skip_limit: 50,
  truncate_sources_min: 20,
  truncate_sources_max: 80,
  skipped_posts_limit: 20,
  total_interactions_limit: 120,
  total_successful_interactions_limit: 80,
  interactions_count: 0,
  interact_percentage: 100,
  max_actions_per_hour: 30,
  max_actions_per_day: 120,
  random_delay_min_seconds: 8,
  random_delay_max_seconds: 20,
  random_pause_every_actions: 15,
  long_break_after_interactions: 45,
  long_break_min_minutes: 8,
  long_break_max_minutes: 18,
  max_repeated_errors: 5,
  relog_delay_seconds: 120,
  total_crashes_limit: 3,
  unfollow_runtime_session_cap: 0,
  unfollow_per_session_limit: 50,
  unfollow_per_day_limit: 200,
  unfollow_after_days: 3,
  effective_unfollow_cap: 50,
  runtime_safety_cap: 1,
  runtime_hard_cap: 3,
  unfollow_day_remaining: 200,
} satisfies Record<string, number>;

const DEFAULT_SETTINGS: SettingsPayload = {
  account_id: "",
  ...stringDefaults,
  ...booleanDefaults,
  ...numberDefaults,
};

const runtimeProjectionKeys = [
  "welcome_dm_runtime_enabled",
  "welcome_dm_real_send_status",
  "welcome_dm_template_status",
  "welcome_entitlement_status",
  "welcome_dm_effective_cap",
  "outreach_dm_runtime_enabled",
  "outreach_dm_real_send_status",
  "outreach_dm_template_status",
  "outreach_dm_effective_session_cap",
  "outreach_dm_effective_day_cap",
  "outreach_entitlement_status",
  "dm_legacy_gate_status",
  "max_dm_per_run_legacy_status",
  "unfollow_runtime_mode",
  "unfollow_any_runtime_configured",
  "unfollow_any_runtime_state",
  "unfollow_any_runtime_block_reason",
  "unfollow_runtime_session_cap",
  "unfollow_mode",
  "unfollow_per_session_limit",
  "unfollow_per_day_limit",
  "unfollow_after_days",
  "effective_unfollow_cap",
  "follow_entitlement_status",
  "unfollow_entitlement_status",
  "current_runtime_mode",
  "handoff_real_status",
  "safe_candidate_strategy_status",
  "limiting_reason",
  "runtime_cap_mode",
  "runtime_cap_source",
  "runtime_safety_cap",
  "runtime_hard_cap",
  "unfollow_day_remaining",
  "do_unfollow_first",
  "commercial_package_label",
  "package_follow_day_cap",
  "manual_follow_day_cap",
  "manual_follow_session_cap",
  "effective_follow_cap_today",
  "effective_warmup_cap_today",
  "follow_day_remaining",
  "follow_limiting_reason",
  "warmup_enabled",
  "warmup_status",
  "warmup_day",
  "warmup_profile_code",
  "package_started_at",
  "day_1_follow_cap",
  "day_2_follow_cap",
  "day_3_follow_cap",
  "day_4_plus_follow_cap",
] as const;

function persistableSettings(settings: SettingsPayload): SettingsPayload {
  const payload: Record<string, SettingsValue> & { account_id: string } = { ...settings };
  for (const key of runtimeProjectionKeys) {
    delete payload[key];
  }
  return payload as SettingsPayload;
}

function normalizeSettings(row: SettingsRecord | null | undefined, accountId: string): SettingsPayload {
  const settings: SettingsPayload = { ...DEFAULT_SETTINGS, account_id: accountId };

  for (const [key, fallback] of Object.entries(stringDefaults)) {
    settings[key] = readString(row?.[key], fallback);
  }

  for (const [key, fallback] of Object.entries(booleanDefaults)) {
    settings[key] = readBoolean(row?.[key], fallback);
  }

  for (const [key, fallback] of Object.entries(numberDefaults)) {
    settings[key] = readNumber(row?.[key], fallback);
  }

  return settings;
}

function withAccountDefaults(settings: SettingsPayload, account: SupabaseRecord | null | undefined) {
  if (!account) return settings;

  return {
    ...settings,
    username: settings.username || readString(account.username, readString(account.ig_username, readString(account.handle, ""))),
    display_name: settings.display_name || readString(account.display_name, readString(account.name, readString(account.full_name, ""))),
    device_name: settings.device_name || readString(account.device_name, readString(account.device, "")),
    device_udid: settings.device_udid || readString(account.device_udid, readString(account.udid, "")),
    account_status: settings.account_status || readString(account.status, "active"),
    campaign_name: settings.campaign_name || readString(account.campaign_name, readString(account.campaign, "Default campaign")),
  };
}

function maskEmail(value: string) {
  const [name, domain] = value.split("@");
  if (!name || !domain) return value ? "configured" : "missing";
  return `${name.slice(0, 2)}***@${domain}`;
}

function safeSettingsForClient(settings: SettingsPayload): Record<string, SettingsValue> {
  const safeSettings: Record<string, SettingsValue> = { ...settings };
  const password = readString(settings.password, "");
  const email = readString(settings.email, "");

  for (const key of protectedSettingsKeys) {
    delete safeSettings[key];
  }

  safeSettings.password_status = password ? "configured" : "missing";
  safeSettings.email_display = maskEmail(email);
  safeSettings.device_assignment = settings.device_name || "pending source";
  safeSettings.app_package_status = "hidden";
  safeSettings.clone_assignment_status = settings.cloned_app_mode ? "clone assigned" : "standard app";

  return safeSettings;
}

function readPositiveInteger(value: unknown) {
  const parsed = readNumber(value, Number.NaN);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function countSuccessfulUnfollowsToday(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { count, error } = await supabase
    .from("ig_interacted_users")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("unfollow_result", "success")
    .gte("unfollowed_at", since);
  if (error) return null;
  return count ?? 0;
}

async function countSuccessfulFollowsToday(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { count, error } = await supabase
    .from("ig_interacted_users")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("followed_at", since);
  if (error) return null;
  return count ?? 0;
}

function runtimeBlockLabel(reason: RunStartBlockReason | null) {
  return reason ?? "";
}

function boolStatus(enabled: boolean) {
  return enabled ? "Enabled" : "Disabled";
}

async function hasOutreachEntitlement(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const { data, error } = await supabase.rpc("client_account_has_outreach_entitlement", {
    p_account_id: accountId,
  });
  if (error) return null;
  return data === true;
}

function entitlementCurrentlyActive(row: SupabaseRecord) {
  if (row.active !== true) return false;
  const validUntil = readString(row.valid_until, "").trim();
  if (!validUntil) return true;
  const validUntilTime = new Date(validUntil).getTime();
  return Number.isFinite(validUntilTime) && validUntilTime > Date.now();
}

async function hasClientFeatureEntitlement(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  featureCode: "welcome" | "follow" | "unfollow",
) {
  const { data: accountEntitlements, error: accountError } = await supabase
    .from("client_entitlements")
    .select("active,valid_until")
    .eq("account_id", accountId)
    .eq("feature_code", featureCode)
    .eq("active", true)
    .limit(5);

  if (accountError) return null;
  if ((accountEntitlements ?? []).some(entitlementCurrentlyActive)) return true;

  const { data: accountLinks, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("client_id")
    .eq("account_id", accountId)
    .limit(10);

  if (linkError) return null;

  const clientIds = Array.from(
    new Set(
      (accountLinks ?? [])
        .map((row) => readString(row.client_id, "").trim())
        .filter(Boolean),
    ),
  );
  if (!clientIds.length) return false;

  const { data: clientEntitlements, error: clientError } = await supabase
    .from("client_entitlements")
    .select("active,valid_until")
    .in("client_id", clientIds)
    .is("account_id", null)
    .eq("feature_code", featureCode)
    .eq("active", true)
    .limit(10);

  if (clientError) return null;
  return (clientEntitlements ?? []).some(entitlementCurrentlyActive);
}

async function withDmRuntimeStatus(
  settings: SettingsPayload,
  supabase: ReturnType<typeof createSupabaseClient>,
) {
  const { data, error } = await supabase
    .from("ig_account_dm_settings")
    .select("welcome_enabled,outreach_enabled,welcome_template_id,default_outreach_template_id,welcome_per_session_limit,welcome_per_day_limit,outreach_per_session_limit,outreach_per_day_limit")
    .eq("account_id", settings.account_id)
    .limit(1)
    .maybeSingle<SupabaseRecord>();

  if (error) {
    return {
      ...settings,
      welcome_dm_real_send_status: "Unknown",
      welcome_dm_template_status: "Unknown",
      welcome_entitlement_status: "Unknown",
      outreach_dm_real_send_status: "Unknown",
      outreach_dm_template_status: "Unknown",
      outreach_entitlement_status: "Unknown",
    };
  }

  const welcomeEnabled = data?.welcome_enabled === true;
  const outreachEnabled = data?.outreach_enabled === true;
  let welcomeTemplate: SupabaseRecord | null = null;
  let outreachTemplate: SupabaseRecord | null = null;
  try {
    [welcomeTemplate, outreachTemplate] = await Promise.all([
      fetchActiveDmTemplate(supabase, settings.account_id, "welcome", data?.welcome_template_id),
      fetchActiveDmTemplate(supabase, settings.account_id, "outreach", data?.default_outreach_template_id),
    ]);
  } catch {
    welcomeTemplate = null;
    outreachTemplate = null;
  }
  const welcomeMessage = readString(welcomeTemplate?.body, "");
  const outreachMessage = readString(outreachTemplate?.body, "");
  const welcomeEntitlementActive = await hasClientFeatureEntitlement(supabase, settings.account_id, "welcome");
  const outreachEntitlementActive = await hasOutreachEntitlement(supabase, settings.account_id);
  const legacyGate = runControlLegacyDmSenderRealSendEnabled();

  return {
    ...settings,
    welcome_dm_message: welcomeMessage,
    cold_dm_message: outreachMessage,
    welcome_dm_runtime_enabled: welcomeEnabled,
    welcome_dm_enabled: welcomeEnabled,
    welcome_dm_real_send_status: boolStatus(runControlWelcomeRealSendEnabled()),
    welcome_dm_template_status: welcomeTemplate ? dmTemplateStatusLabel(welcomeMessage) : "Unknown",
    welcome_entitlement_status:
      welcomeEntitlementActive === null ? "Unknown" : welcomeEntitlementActive ? "Active" : "Missing",
    welcome_dm_effective_cap: readPositiveInteger(data?.welcome_per_session_limit) ?? 0,
    welcome_dm_effective_day_cap: readProductDefaultDayCap(data?.welcome_per_day_limit, DEFAULT_WELCOME_DM_DAY_CAP),
    outreach_dm_runtime_enabled: outreachEnabled,
    cold_dm_enabled: outreachEnabled,
    outreach_dm_real_send_status: boolStatus(runControlOutreachRealSendEnabled()),
    outreach_dm_template_status: outreachTemplate ? dmTemplateStatusLabel(outreachMessage) : "Unknown",
    outreach_dm_effective_session_cap: readPositiveInteger(data?.outreach_per_session_limit) ?? 0,
    outreach_dm_effective_day_cap: readProductDefaultDayCap(data?.outreach_per_day_limit, DEFAULT_OUTREACH_DM_DAY_CAP),
    outreach_entitlement_status:
      outreachEntitlementActive === null ? "Unknown" : outreachEntitlementActive ? "Active" : "Missing",
    dm_legacy_gate_status: legacyGate === null ? "Not configured" : `Legacy global ${boolStatus(legacyGate).toLowerCase()} (read-only)`,
    max_dm_per_run_legacy_status: "Legacy shared cap; Welcome/Outreach use split domain caps.",
  };
}

async function withUnfollowRuntimeStatus(
  settings: SettingsPayload,
  supabase: ReturnType<typeof createSupabaseClient>,
) {
  const { data, error } = await supabase
    .from("ig_account_unfollow_settings")
    .select("unfollow_enabled,unfollow_mode,unfollow_per_session_limit,unfollow_per_day_limit,unfollow_after_days,runtime_cap_mode,runtime_safety_cap")
    .eq("account_id", settings.account_id)
    .limit(1)
    .maybeSingle<SupabaseRecord>();

  if (error) {
    return {
      ...settings,
      unfollow_any_runtime_state: "Configured but blocked by runtime gate",
      unfollow_any_runtime_block_reason: "support_required",
    };
  }

  const mode = readString(data?.unfollow_mode, "unfollow").trim().toLowerCase() || "unfollow";
  const configured = data?.unfollow_enabled === true && isUnfollowAnyMode(mode);
  const sessionCap = readPositiveInteger(data?.unfollow_per_session_limit) ?? 0;
  const dayCap = readPositiveInteger(data?.unfollow_per_day_limit) ?? 0;
  const afterDays = readPositiveInteger(data?.unfollow_after_days) ?? 3;
  const runtimeSafetyOverride = readPositiveInteger(data?.runtime_safety_cap);
  const runtimeCap = resolveUnfollowRuntimeCap({
    unfollowPerSessionLimit: sessionCap,
    runtimeCapMode: data?.runtime_cap_mode,
    runtimeSafetyCap: runtimeSafetyOverride,
  });
  const handoffEnabled = resolveFollowToUnfollowHandoffEnabled({
    unfollowEnabled: data?.unfollow_enabled === true,
    unfollowMode: mode,
    runtimeCapMode: runtimeCap.mode,
  });
  const unfollowsDoneToday = await countSuccessfulUnfollowsToday(supabase, settings.account_id);
  const unfollowDayRemaining = unfollowsDoneToday === null ? dayCap : Math.max(0, dayCap - unfollowsDoneToday);
  const followEntitlementActive = await hasClientFeatureEntitlement(supabase, settings.account_id, "follow");
  const unfollowEntitlementActive = await hasClientFeatureEntitlement(supabase, settings.account_id, "unfollow");
  const blockReason = configured
    ? evaluateUnfollowAnyStartGate({
        requestedRunType: "account_session",
        unfollowEnabled: data?.unfollow_enabled === true,
        unfollowMode: mode,
        unfollowPerSessionLimit: sessionCap,
        realHandoffEnabled: handoffEnabled,
        realMaxActions: runtimeCap.cap,
        realHardMax: runtimeCap.hardCap,
        h3RealSupported: runControlUnfollowAnyH3RealSupported(),
        safeCandidateStrategyProven: runControlUnfollowAnySafeStrategyProven(),
      })
    : null;
  const rawEffectiveCap = Math.min(sessionCap, dayCap, runtimeCap.cap ?? sessionCap, unfollowDayRemaining);
  const effectiveCap = blockReason ? 0 : Math.max(0, rawEffectiveCap);

  return {
    ...settings,
    unfollow_enabled: data?.unfollow_enabled === true,
    unfollow_mode: mode,
    unfollow_per_session_limit: sessionCap,
    unfollow_per_day_limit: dayCap,
    unfollow_after_days: afterDays,
    effective_unfollow_cap: effectiveCap,
    runtime_safety_cap: runtimeCap.mode === "prod_normal" ? 0 : runtimeSafetyOverride ?? 0,
    runtime_hard_cap: runtimeCap.hardCap ?? 0,
    unfollow_day_remaining: unfollowDayRemaining,
    limiting_reason:
      blockReason
        ? blockReason === "unfollow_entitlement_missing"
          ? "limited_by_entitlement"
          : blockReason === "unfollow_handoff_disabled"
            ? "limited_by_handoff_disabled"
          : blockReason === "unfollow_no_safe_candidate_strategy"
            ? "limited_by_no_safe_candidate"
            : "limited_by_runtime_gate"
        : unfollowDayRemaining < sessionCap && unfollowDayRemaining <= effectiveCap
          ? "limited_by_daily_remaining"
          : runtimeCap.limitedByRuntimeCap && runtimeCap.cap !== null && runtimeCap.cap <= effectiveCap
          ? runtimeCap.mode === "mini_run"
            ? "limited_by_mini_run_mode"
            : "limited_by_safety_cap"
          : "ready",
    runtime_cap_mode: runtimeCap.mode,
    runtime_cap_source: runtimeCap.source,
    follow_entitlement_status:
      followEntitlementActive === null ? "Unknown" : followEntitlementActive ? "Active" : "Missing",
    unfollow_entitlement_status:
      unfollowEntitlementActive === null ? "Unknown" : unfollowEntitlementActive ? "Active" : "Missing",
    unfollow_runtime_mode: mode,
    unfollow_any_runtime_configured: configured,
    unfollow_runtime_session_cap: sessionCap,
    current_runtime_mode: mode,
    handoff_real_status: handoffEnabled ? "Enabled" : "Disabled",
    safe_candidate_strategy_status: runControlUnfollowAnySafeStrategyProven() ? "Ready" : "Unknown",
    do_unfollow_first: false,
    unfollow_any_runtime_state: configured
      ? blockReason
        ? "Configured but blocked by runtime gate"
        : "Ready"
      : "Disabled",
    unfollow_any_runtime_block_reason: runtimeBlockLabel(blockReason),
  };
}

function readJsonNumber(row: SupabaseRecord | null | undefined, key: string, fallback = 0) {
  if (!row || typeof row !== "object") return fallback;
  return readNumber(row[key], fallback);
}

function readJsonBoolean(row: SupabaseRecord | null | undefined, key: string, fallback = false) {
  if (!row || typeof row !== "object") return fallback;
  return readBoolean(row[key], fallback);
}

function resolveWarmupFollowCap({
  warmupEnabled,
  warmupDay,
  day1,
  day2,
  day3,
  day4Plus,
  packageCap,
}: {
  warmupEnabled: boolean;
  warmupDay: number | null;
  day1: number;
  day2: number;
  day3: number;
  day4Plus: number;
  packageCap: number;
}) {
  if (!warmupEnabled) return packageCap;
  if (warmupDay === null) return packageCap;
  if (warmupDay <= 1) return day1;
  if (warmupDay === 2) return day2;
  if (warmupDay === 3) return day3;
  return Math.min(day4Plus, packageCap);
}

function followLimitingReason({
  effective,
  packageCap,
  manualDayCap,
  warmupCap,
  remaining,
  warmupStatus,
}: {
  effective: number;
  packageCap: number;
  manualDayCap: number;
  warmupCap: number;
  remaining: number;
  warmupStatus: string;
}) {
  if (effective <= 0 && remaining <= 0) return "limited_by_daily_remaining";
  if (warmupStatus === "pending_package_start") return "warmup_pending_package_start";
  if (effective === remaining && remaining < Math.min(packageCap, manualDayCap, warmupCap)) return "limited_by_daily_remaining";
  if (effective === warmupCap && warmupCap < Math.min(packageCap, manualDayCap)) return "limited_by_warmup";
  if (effective === manualDayCap && manualDayCap < Math.min(packageCap, warmupCap)) return "limited_by_manual_cap";
  if (effective === packageCap && packageCap < Math.min(manualDayCap, warmupCap)) return "limited_by_package_cap";
  return "ready";
}

async function withFollowRuntimeStatus(
  settings: SettingsPayload,
  supabase: ReturnType<typeof createSupabaseClient>,
) {
  const { data: summary } = await supabase
    .from("account_package_summary")
    .select("commercial_package_label,warmup_status,warmup_day,package_started_at,package_caps,effective_caps_preview")
    .eq("account_id", settings.account_id)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  const packageCaps = (summary?.package_caps && typeof summary.package_caps === "object" && !Array.isArray(summary.package_caps))
    ? summary.package_caps as SupabaseRecord
    : null;
  const preview = (summary?.effective_caps_preview && typeof summary.effective_caps_preview === "object" && !Array.isArray(summary.effective_caps_preview))
    ? summary.effective_caps_preview as SupabaseRecord
    : null;
  const packageFollowCap = readJsonNumber(packageCaps, "follow_day", 0);
  const manualDayCap = readNumber(settings.max_actions_per_day, packageFollowCap);
  const manualSessionCap = readNumber(settings.follow_limit, Math.min(packageFollowCap || 20, 20));
  const warmupEnabled = readJsonBoolean(preview, "warmup_enabled", readBoolean(settings.warmup_mode, true));
  const day1 = readJsonNumber(preview, "day_1_follow_cap", 10);
  const day2 = readJsonNumber(preview, "day_2_follow_cap", 20);
  const day3 = readJsonNumber(preview, "day_3_follow_cap", 40);
  const day4Plus = readJsonNumber(preview, "day_4_plus_follow_cap", packageFollowCap);
  const rawWarmupDay = readNumber(summary?.warmup_day, 0);
  const warmupDay = rawWarmupDay > 0 ? rawWarmupDay : null;
  const warmupCap = resolveWarmupFollowCap({
    warmupEnabled,
    warmupDay,
    day1,
    day2,
    day3,
    day4Plus,
    packageCap: packageFollowCap,
  });
  const followsDoneToday = await countSuccessfulFollowsToday(supabase, settings.account_id);
  const remaining = followsDoneToday === null ? manualDayCap : Math.max(0, manualDayCap - followsDoneToday);
  const effective = Math.max(0, Math.min(
    packageFollowCap || manualDayCap,
    manualDayCap,
    manualSessionCap,
    warmupCap || manualDayCap,
    remaining,
  ));
  const warmupStatus = readString(summary?.warmup_status, "pending_package_start");

  return {
    ...settings,
    commercial_package_label: readString(summary?.commercial_package_label, "Package pending"),
    package_follow_day_cap: packageFollowCap,
    manual_follow_day_cap: manualDayCap,
    manual_follow_session_cap: manualSessionCap,
    effective_follow_cap_today: effective,
    follow_day_remaining: remaining,
    follow_limiting_reason: followLimitingReason({
      effective,
      packageCap: packageFollowCap || manualDayCap,
      manualDayCap,
      warmupCap: warmupCap || manualDayCap,
      remaining,
      warmupStatus,
    }),
    warmup_enabled: warmupEnabled,
    warmup_status: warmupStatus,
    warmup_day: warmupDay ?? 0,
    warmup_profile_code: "follow_default_v1",
    package_started_at: readString(summary?.package_started_at, ""),
    day_1_follow_cap: day1,
    day_2_follow_cap: day2,
    day_3_follow_cap: day3,
    day_4_plus_follow_cap: day4Plus || packageFollowCap,
  };
}

function preserveProtectedSettings(settings: SettingsPayload, existing: SettingsRecord | null | undefined) {
  if (!existing) return settings;
  const existingSettings = normalizeSettings(existing, settings.account_id);

  return {
    ...settings,
    password: existingSettings.password,
    email: existingSettings.email,
    device_udid: existingSettings.device_udid,
    app_package: existingSettings.app_package,
    cloned_app_mode: existingSettings.cloned_app_mode,
  };
}

function withFollowManualAliases(settings: SettingsPayload) {
  return {
    ...settings,
    max_actions_per_day: readNumber(settings.manual_follow_day_cap, readNumber(settings.max_actions_per_day, 120)),
    follow_limit: readNumber(settings.manual_follow_session_cap, readNumber(settings.follow_limit, 20)),
  };
}

function warmupAuditSummary(row: SupabaseRecord | null | undefined) {
  if (!row) return {};
  return {
    warmup_enabled: readBoolean(row.warmup_enabled, true),
    package_started_at: readString(row.package_started_at, ""),
    warmup_profile_code: readString(row.warmup_profile_code, "follow_default_v1"),
    day_1_follow_cap: readNumber(row.day_1_follow_cap, 10),
    day_2_follow_cap: readNumber(row.day_2_follow_cap, 20),
    day_3_follow_cap: readNumber(row.day_3_follow_cap, 40),
    day_4_plus_follow_cap: readNumber(row.day_4_plus_follow_cap, 0),
    status: readString(row.status, "pending_package_start"),
  };
}

function changedWarmupFields(oldSummary: Record<string, unknown>, newSummary: Record<string, unknown>) {
  return Object.keys(newSummary).filter((key) => oldSummary[key] !== newSummary[key]);
}

async function recordFollowWarmupAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    fieldsChanged: string[];
    oldSummary: Record<string, unknown>;
    newSummary: Record<string, unknown>;
  },
) {
  await supabase.from("ig_action_logs").insert({
    account_id: input.accountId,
    run_id: null,
    target_username: null,
    action_type: "follow_warmup_settings_saved",
    status: "success",
    message: "Follow warmup settings saved from admin dashboard.",
    payload: {
      actor_type: "admin",
      source_surface: "admin_dashboard",
      domain: "follow_warmup",
      fields_changed: input.fieldsChanged,
      old_summary: input.oldSummary,
      new_summary: input.newSummary,
    },
    created_at: new Date().toISOString(),
  });
}

async function packageFollowCapForAccount(supabase: ReturnType<typeof createSupabaseClient>, accountId: string) {
  const { data, error } = await supabase
    .from("account_package_summary")
    .select("package_caps")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (error) return null;
  const caps = data?.package_caps;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) return null;
  return readNumber((caps as SupabaseRecord).follow_day, Number.NaN);
}

async function saveWarmupSettings(
  supabase: ReturnType<typeof createSupabaseClient>,
  settings: SettingsPayload,
) {
  const packageFollowCap = await packageFollowCapForAccount(supabase, settings.account_id);
  if (packageFollowCap === null || !Number.isFinite(packageFollowCap) || packageFollowCap < 1) {
    return "Cannot save Follow warmup: commercial package Follow cap is unavailable.";
  }
  const packageCap = Number(packageFollowCap);

  const day1 = readNumber(settings.day_1_follow_cap, 10);
  const day2 = readNumber(settings.day_2_follow_cap, 20);
  const day3 = readNumber(settings.day_3_follow_cap, 40);
  const day4 = readNumber(settings.day_4_plus_follow_cap, packageCap);
  if (!Number.isInteger(day1) || day1 < 0 || day1 > 10) return "Day 1 Follow warmup cap must be between 0 and 10.";
  if (!Number.isInteger(day2) || day2 < 0 || day2 > 20) return "Day 2 Follow warmup cap must be between 0 and 20.";
  if (!Number.isInteger(day3) || day3 < 0 || day3 > 40) return "Day 3 Follow warmup cap must be between 0 and 40.";
  if (!Number.isInteger(day4) || day4 < 0 || day4 > packageCap) {
    return `Day 4+ Follow warmup cap cannot exceed the package Follow cap (${packageCap}).`;
  }

  const { data: existing } = await supabase
    .from("account_warmup_settings")
    .select("warmup_enabled,package_started_at,warmup_profile_code,day_1_follow_cap,day_2_follow_cap,day_3_follow_cap,day_4_plus_follow_cap,status")
    .eq("account_id", settings.account_id)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  const status = existing?.package_started_at ? "active" : "pending_package_start";
  const newSummary = {
    warmup_enabled: readBoolean(settings.warmup_enabled, true),
    package_started_at: readString(existing?.package_started_at, ""),
    warmup_profile_code: "follow_default_v1",
    day_1_follow_cap: day1,
    day_2_follow_cap: day2,
    day_3_follow_cap: day3,
    day_4_plus_follow_cap: day4,
    status,
  };
  const { error } = await supabase
    .from("account_warmup_settings")
    .upsert({
      account_id: settings.account_id,
      warmup_enabled: readBoolean(settings.warmup_enabled, true),
      warmup_profile_code: "follow_default_v1",
      day_1_follow_cap: day1,
      day_2_follow_cap: day2,
      day_3_follow_cap: day3,
      day_4_plus_follow_cap: day4,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_id" });
  if (error) return `Could not save Follow warmup settings: ${error.message}`;
  const oldSummary = warmupAuditSummary(existing);
  const fieldsChanged = changedWarmupFields(oldSummary, newSummary);
  if (fieldsChanged.length) {
    await recordFollowWarmupAudit(supabase, {
      accountId: settings.account_id,
      fieldsChanged,
      oldSummary,
      newSummary,
    }).catch(() => undefined);
  }
  return null;
}

async function withRuntimeStatuses(
  settings: SettingsPayload,
  supabase: ReturnType<typeof createSupabaseClient>,
) {
  return await withUnfollowRuntimeStatus(
    await withFollowRuntimeStatus(
      await withDmRuntimeStatus(settings, supabase),
      supabase,
    ),
    supabase,
  );
}

async function fetchAccount(accountId: string, supabase = createSupabaseClient()) {
  const { data } = await supabase.from("ig_accounts").select("*").eq("id", accountId).maybeSingle<SupabaseRecord>();
  return data;
}

function jsonSuccess(settings: SettingsPayload, status = 200) {
  return NextResponse.json({ ok: true, data: safeSettingsForClient(settings) } satisfies SettingsResponse, { status });
}

function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isMissingDryRunColumn(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("dry_run_enabled") && normalized.includes("column");
}

function migrationError(message: string) {
  if (isMissingDryRunColumn(message)) {
    return jsonError("Missing column dry_run_enabled. Apply ig-account-settings.sql migration.", 500);
  }

  return jsonError(`${message} Apply lib/instagram-dashboard/ig-account-settings.sql, then retry.`, 500);
}

async function ensureDryRunColumn(supabase: ReturnType<typeof createSupabaseClient>) {
  const { error } = await supabase.from("ig_account_settings").select("dry_run_enabled").limit(1);

  if (error) {
    return migrationError(error.message);
  }

  return null;
}

function validateSettingsAccountId(accountId: string) {
  return accountId ? null : jsonError("Missing account_id.", 400);
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateSettingsAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const dryRunColumnError = await ensureDryRunColumn(supabase);
    if (dryRunColumnError) return dryRunColumnError;

    const { data, error } = await supabase
      .from("ig_account_settings")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle<SettingsRecord>();

    if (error) return migrationError(error.message);

    const account = await fetchAccount(accountId, supabase);

    if (data) {
      const settings = await withRuntimeStatuses(withAccountDefaults(normalizeSettings(data, accountId), account), supabase);
      return jsonSuccess(settings);
    }

    const defaultSettings = withAccountDefaults({ ...DEFAULT_SETTINGS, account_id: accountId }, account);
    const { data: inserted, error: insertError } = await supabase
      .from("ig_account_settings")
      .insert(persistableSettings(defaultSettings))
      .select("*")
      .single<SettingsRecord>();

    if (insertError) return migrationError(insertError.message);

    const settings = await withRuntimeStatuses(withAccountDefaults(normalizeSettings(inserted, accountId), account), supabase);
    return jsonSuccess(settings, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load account settings.";
    return jsonError(message, 500);
  }
}

async function saveSettings(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<Partial<SettingsPayload>>(request);
    if (!body) {
      return jsonError("Invalid settings payload.", 400);
    }

    const accountId = typeof body.account_id === "string" ? body.account_id.trim() : "";
    const accountIdError = validateSettingsAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const dryRunColumnError = await ensureDryRunColumn(supabase);
    if (dryRunColumnError) return dryRunColumnError;
    const { data: existing, error: existingError } = await supabase
      .from("ig_account_settings")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle<SettingsRecord>();

    if (existingError) return migrationError(existingError.message);

    const settings = withFollowManualAliases(preserveProtectedSettings(normalizeSettings(body, accountId), existing));
    const warmupError = await saveWarmupSettings(supabase, settings);
    if (warmupError) return jsonError(warmupError, 400);

    const persistable = persistableSettings(settings);
    const { data, error } = await supabase
      .from("ig_account_settings")
      .update(persistable)
      .eq("account_id", accountId)
      .select("*")
      .maybeSingle<SettingsRecord>();

    if (error) return migrationError(error.message);

    if (!data) {
      const { data: inserted, error: insertError } = await supabase
        .from("ig_account_settings")
        .insert(persistable)
        .select("*")
        .single<SettingsRecord>();

      if (insertError) return migrationError(insertError.message);

      const account = await fetchAccount(accountId, supabase);
      const responseSettings = await withRuntimeStatuses(withAccountDefaults(normalizeSettings(inserted, accountId), account), supabase);
      return jsonSuccess(responseSettings, 201);
    }

    const account = await fetchAccount(accountId, supabase);
    const responseSettings = await withRuntimeStatuses(withAccountDefaults(normalizeSettings(data, accountId), account), supabase);
    return jsonSuccess(responseSettings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save account settings.";
    return jsonError(message, 500);
  }
}

export async function PUT(request: Request) {
  return saveSettings(request);
}

export async function PATCH(request: Request) {
  return saveSettings(request);
}

export async function POST(request: Request) {
  return saveSettings(request);
}
