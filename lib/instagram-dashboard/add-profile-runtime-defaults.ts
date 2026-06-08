import type { SupabaseClient } from "@supabase/supabase-js";
import type { AddProfilePackagePreset } from "@/lib/instagram-dashboard/add-profile-packages";

export type ApplyAddProfileRuntimeDefaultsInput = {
  accountId: string;
  username: string;
  appPackageName: string;
  preset: AddProfilePackagePreset;
};

export type ApplyAddProfileRuntimeDefaultsResult =
  | {
    ok: true;
    commercial_package_code: string;
    welcome_enabled: boolean;
    outreach_enabled: boolean;
    follow_enabled: boolean;
    unfollow_enabled: boolean;
  }
  | { ok: false; reason: string };

function packageSnapshot(preset: AddProfilePackagePreset) {
  return {
    package_code: preset.commercialPackageCode,
    package_label: preset.label,
    follow_day_cap: preset.defaultFollowDayCap,
    follow_session_cap: preset.defaultFollowSessionCap,
    unfollow_day_cap: preset.defaultUnfollowDayCap,
    unfollow_session_cap: preset.defaultUnfollowSessionCap,
    welcome_enabled: preset.welcomeEnabled,
    welcome_day_cap: preset.welcomePerDayLimit,
    outreach_enabled: preset.outreachEnabled,
    outreach_day_cap: preset.outreachPerDayLimit,
    source: "add_profile",
  };
}

export async function applyAddProfileRuntimeDefaults(
  supabase: SupabaseClient,
  input: ApplyAddProfileRuntimeDefaultsInput,
): Promise<ApplyAddProfileRuntimeDefaultsResult> {
  const snapshot = packageSnapshot(input.preset);
  const metadataSafe = input.preset.metadataSafe;

  const [settingsResult, followResult, dmResult, unfollowResult] = await Promise.all([
    supabase
      .from("ig_account_settings")
      .update({
        app_package: input.appPackageName || "com.instagram.android",
        follow_enabled: input.preset.followEnabled,
        like_enabled: input.preset.likeEnabled,
        mute_posts_after_follow: input.preset.muteAfterFollowEnabled,
        mute_stories_after_follow: input.preset.muteAfterFollowEnabled,
        welcome_dm_enabled: input.preset.welcomeEnabled,
        cold_dm_enabled: input.preset.outreachEnabled,
        unfollow_enabled: input.preset.unfollowEnabled,
      })
      .eq("account_id", input.accountId),
    supabase
      .from("ig_account_follow_settings")
      .upsert({
        account_id: input.accountId,
        dont_follow_private_accounts: input.preset.followFilters.dontFollowPrivateAccounts,
        min_followers: input.preset.followFilters.minFollowers,
        max_followers: input.preset.followFilters.maxFollowers,
        min_posts: input.preset.followFilters.minPosts,
      }, { onConflict: "account_id" }),
    supabase
      .from("ig_account_dm_settings")
      .upsert({
        account_id: input.accountId,
        welcome_enabled: input.preset.welcomeEnabled,
        outreach_enabled: input.preset.outreachEnabled,
        welcome_per_session_limit: input.preset.welcomePerSessionLimit,
        welcome_per_day_limit: input.preset.welcomePerDayLimit,
        outreach_per_session_limit: input.preset.outreachPerSessionLimit,
        outreach_per_day_limit: input.preset.outreachPerDayLimit,
        total_dm_per_day_limit: input.preset.totalDmPerDayLimit,
      }, { onConflict: "account_id" }),
    supabase
      .from("ig_account_unfollow_settings")
      .upsert({
        account_id: input.accountId,
        unfollow_enabled: input.preset.unfollowEnabled,
        unfollow_after_days: input.preset.unfollowAfterDays,
        unfollow_mode: input.preset.unfollowMode,
        unfollow_per_session_limit: input.preset.defaultUnfollowSessionCap,
        unfollow_per_day_limit: input.preset.defaultUnfollowDayCap,
        package_default_snapshot: snapshot,
      }, { onConflict: "account_id" }),
  ]);

  const firstError = settingsResult.error || followResult.error || dmResult.error || unfollowResult.error;
  if (firstError) {
    return { ok: false, reason: firstError.message || "runtime_defaults_apply_failed" };
  }

  try {
    await supabase.from("add_profile_audit_events").insert({
      account_id: input.accountId,
      username: input.username.toLowerCase().slice(0, 120),
      request_id: `runtime-defaults:${input.accountId}`.slice(0, 120),
      source_surface: "admin_dashboard",
      operation: "add_profile_runtime_defaults",
      result_status: "success",
      actor_type: "system",
      metadata_safe: {
        ...metadataSafe,
        app_package: input.appPackageName || "com.instagram.android",
        follow_enabled: input.preset.followEnabled,
        like_enabled: input.preset.likeEnabled,
        mute_after_follow_enabled: input.preset.muteAfterFollowEnabled,
        welcome_enabled: input.preset.welcomeEnabled,
        outreach_enabled: input.preset.outreachEnabled,
        unfollow_enabled: input.preset.unfollowEnabled,
      },
    });
  } catch {
    // Runtime defaults are already applied; audit insert is best-effort only.
  }

  return {
    ok: true,
    commercial_package_code: input.preset.commercialPackageCode,
    welcome_enabled: input.preset.welcomeEnabled,
    outreach_enabled: input.preset.outreachEnabled,
    follow_enabled: input.preset.followEnabled,
    unfollow_enabled: input.preset.unfollowEnabled,
  };
}
