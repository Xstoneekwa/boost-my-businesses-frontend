import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { getAccountId, readBoolean, readJsonBody, readNumber, readString, requireInstagramAdmin, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

type SettingsValue = string | number | boolean;
type SettingsPayload = Record<string, SettingsValue> & { account_id: string };
type SettingsRecord = Partial<SettingsPayload> & SupabaseRecord;
type SettingsResponse = {
  ok: true;
  data: SettingsPayload;
};

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
} satisfies Record<string, string>;

const booleanDefaults = {
  two_fa_enabled: false,
  cloned_app_mode: false,
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
} satisfies Record<string, number>;

const DEFAULT_SETTINGS: SettingsPayload = {
  account_id: "",
  ...stringDefaults,
  ...booleanDefaults,
  ...numberDefaults,
};

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

async function fetchAccount(accountId: string, supabase = createSupabaseClient()) {
  const { data } = await supabase.from("ig_accounts").select("*").eq("id", accountId).maybeSingle<SupabaseRecord>();
  return data;
}

function jsonSuccess(settings: SettingsPayload, status = 200) {
  return NextResponse.json({ ok: true, data: settings } satisfies SettingsResponse, { status });
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
      return jsonSuccess(withAccountDefaults(normalizeSettings(data, accountId), account));
    }

    const defaultSettings = withAccountDefaults({ ...DEFAULT_SETTINGS, account_id: accountId }, account);
    const { data: inserted, error: insertError } = await supabase
      .from("ig_account_settings")
      .insert(defaultSettings)
      .select("*")
      .single<SettingsRecord>();

    if (insertError) return migrationError(insertError.message);

    return jsonSuccess(withAccountDefaults(normalizeSettings(inserted, accountId), account), 201);
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

    const settings = normalizeSettings(body, accountId);
    const supabase = createSupabaseClient();
    const dryRunColumnError = await ensureDryRunColumn(supabase);
    if (dryRunColumnError) return dryRunColumnError;

    const { data, error } = await supabase
      .from("ig_account_settings")
      .update(settings)
      .eq("account_id", accountId)
      .select("*")
      .maybeSingle<SettingsRecord>();

    if (error) return migrationError(error.message);

    if (!data) {
      const { data: inserted, error: insertError } = await supabase
        .from("ig_account_settings")
        .insert(settings)
        .select("*")
        .single<SettingsRecord>();

      if (insertError) return migrationError(insertError.message);

      return jsonSuccess(normalizeSettings(inserted, accountId), 201);
    }

    return jsonSuccess(normalizeSettings(data, accountId));
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
