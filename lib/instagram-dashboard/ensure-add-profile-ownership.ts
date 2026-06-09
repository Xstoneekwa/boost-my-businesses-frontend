import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commercialPackageCodeForSelection,
  defaultAddProfileCommercialPackage,
  isAddProfileAddonCode,
  isAddProfileCommercialPackage,
  isAddProfileRuntimeMode,
  resolveAddProfilePackagePreset,
  subscriptionTypeForRuntimeMode,
  type AddProfileAddonCode,
  type AddProfileCommercialPackage,
  type AddProfileRuntimeMode,
} from "@/lib/instagram-dashboard/add-profile-packages";

const defaultTestClientId = "00000000-0000-4000-8000-000000002e2a";

type OwnershipRow = {
  id?: string;
  account_id?: string;
  status?: string;
  subscription_id?: string;
  client_id?: string;
};

export type EnsureAddProfileOwnershipInput = {
  accountId: string;
  accountUsername: string;
  commercialPackage?: string;
  addons?: string[];
  runtimeMode: AddProfileRuntimeMode | string;
  clientId?: string;
};

export type EnsureAddProfileOwnershipResult =
  | {
    ok: true;
    clientId: string;
    commercialPackageCode: string;
    subscriptionType: "full_cycle" | "outreach_only";
    clientInstagramAccountId: string;
    subscriptionId: string;
    subscriptionAccountId: string;
    addonCodes: string[];
    repaired: boolean;
  }
  | { ok: false; reason: string };

function readClientId(override?: string) {
  const fromEnv = process.env.INSTAGRAM_ADD_PROFILE_DEFAULT_CLIENT_ID?.trim();
  const candidate = override || fromEnv || defaultTestClientId;
  return candidate || "";
}

function normalizeCommercialPackage(value: string | undefined): AddProfileCommercialPackage {
  const normalized = (value || defaultAddProfileCommercialPackage()).trim();
  if (isAddProfileCommercialPackage(normalized)) return normalized;
  return defaultAddProfileCommercialPackage();
}

async function ensureCommercialPackagePreset(
  supabase: SupabaseClient,
  preset: ReturnType<typeof resolveAddProfilePackagePreset>,
) {
  const { error } = await supabase.from("commercial_packages").upsert(
    {
      code: preset.commercialPackageCode,
      label: preset.label,
      default_follow_day_cap: preset.defaultFollowDayCap,
      default_unfollow_day_cap: preset.defaultUnfollowDayCap,
      default_follow_session_cap: preset.defaultFollowSessionCap,
      default_unfollow_session_cap: preset.defaultUnfollowSessionCap,
      default_welcome_enabled: preset.defaultWelcomeEnabled,
      default_outreach_enabled: preset.defaultOutreachEnabled,
      default_welcome_day_cap: preset.defaultWelcomeDayCap,
      default_outreach_day_cap: preset.defaultOutreachDayCap,
      advanced_ct_enabled: preset.advancedCtEnabled,
      ai_comment_enabled: preset.aiCommentEnabled,
      ai_targeting_enabled: preset.aiTargetingEnabled,
      active: true,
    },
    { onConflict: "code" },
  );

  if (error) throw new Error("commercial_package_upsert_failed");
}

function normalizeAddonCodes(addons: string[] | undefined): AddProfileAddonCode[] {
  return [...new Set((addons ?? []).filter((addon): addon is AddProfileAddonCode => isAddProfileAddonCode(addon)))];
}

async function ensureAccountCommercialPackage(
  supabase: SupabaseClient,
  accountId: string,
  commercialPackageCode: string,
  source: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from("account_commercial_packages")
    .select("id,package_code,status")
    .eq("account_id", accountId)
    .eq("status", "active")
    .is("ends_at", null)
    .limit(1)
    .maybeSingle<OwnershipRow & { package_code?: string }>();

  if (existingError) throw new Error("commercial_package_lookup_failed");
  if (existing?.package_code === commercialPackageCode) return;

  if (existing?.id) {
    await supabase
      .from("account_commercial_packages")
      .update({ ends_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  }

  const { error } = await supabase.from("account_commercial_packages").insert({
    account_id: accountId,
    package_code: commercialPackageCode,
    status: "active",
    source,
    metadata_safe: {
      source: "add_profile",
      source_surface: "admin_dashboard",
    },
  });

  if (error) throw new Error("commercial_package_assign_failed");
}

async function ensureAccountCommercialAddons(
  supabase: SupabaseClient,
  accountId: string,
  addonCodes: AddProfileAddonCode[],
) {
  for (const addonCode of addonCodes) {
    const { data: existing, error: existingError } = await supabase
      .from("account_commercial_addons")
      .select("id")
      .eq("account_id", accountId)
      .eq("addon_code", addonCode)
      .eq("status", "active")
      .is("ends_at", null)
      .limit(1)
      .maybeSingle<OwnershipRow>();

    if (existingError) throw new Error("commercial_addon_lookup_failed");
    if (existing?.id) continue;

    const { error } = await supabase.from("account_commercial_addons").insert({
      account_id: accountId,
      addon_code: addonCode,
      status: "active",
      source: "add_profile",
      source_type: "admin_dashboard",
      metadata_safe: {
        source: "add_profile",
        source_surface: "admin_dashboard",
      },
    });
    if (error) throw new Error("commercial_addon_assign_failed");
  }
}

async function ensureClientInstagramAccount(
  supabase: SupabaseClient,
  accountId: string,
  clientId: string,
  label: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from("client_instagram_accounts")
    .select("id,client_id,account_id,onboarding_status,provisioning_status,login_status")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<OwnershipRow & { onboarding_status?: string; provisioning_status?: string; login_status?: string }>();

  if (existingError) throw new Error("client_instagram_account_lookup_failed");
  if (existing?.id) return readString(existing.id);

  const { data: created, error } = await supabase
    .from("client_instagram_accounts")
    .insert({
      client_id: clientId,
      account_id: accountId,
      label,
      onboarding_status: "pending",
      provisioning_status: "not_started",
      login_status: "unknown",
    })
    .select("id")
    .single<OwnershipRow>();

  if (error || !created?.id) throw new Error("client_instagram_account_create_failed");
  return readString(created.id);
}

async function ensureClientSubscription(
  supabase: SupabaseClient,
  clientId: string,
  subscriptionType: "full_cycle" | "outreach_only",
) {
  const { data: existing, error: existingError } = await supabase
    .from("client_subscriptions")
    .select("id,status,subscription_type")
    .eq("client_id", clientId)
    .eq("subscription_type", subscriptionType)
    .eq("status", "active")
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle<OwnershipRow & { subscription_type?: string }>();

  if (existingError) throw new Error("client_subscription_lookup_failed");
  if (existing?.id) return readString(existing.id);

  const { data: created, error } = await supabase
    .from("client_subscriptions")
    .insert({
      client_id: clientId,
      subscription_type: subscriptionType,
      status: "active",
      metadata: {
        source: "add_profile",
        source_surface: "admin_dashboard",
      },
    })
    .select("id")
    .single<OwnershipRow>();

  if (error || !created?.id) throw new Error("client_subscription_create_failed");
  return readString(created.id);
}

async function ensureClientSubscriptionAccount(
  supabase: SupabaseClient,
  input: {
    subscriptionId: string;
    clientInstagramAccountId: string;
    accountId: string;
  },
) {
  const { data: existing, error: existingError } = await supabase
    .from("client_subscription_accounts")
    .select("id,status,subscription_id")
    .eq("account_id", input.accountId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle<OwnershipRow>();

  if (existingError) throw new Error("client_subscription_account_lookup_failed");
  if (existing?.id) return readString(existing.id);

  const { data: created, error } = await supabase
    .from("client_subscription_accounts")
    .insert({
      subscription_id: input.subscriptionId,
      client_instagram_account_id: input.clientInstagramAccountId,
      account_id: input.accountId,
      status: "active",
    })
    .select("id")
    .single<OwnershipRow>();

  if (error || !created?.id) throw new Error("client_subscription_account_create_failed");
  return readString(created.id);
}

async function ensureClientSubscriptionModules(
  supabase: SupabaseClient,
  subscriptionId: string,
  preset: ReturnType<typeof resolveAddProfilePackagePreset>,
) {
  const modules = [
    { feature_code: "follow", enabled: preset.followEnabled, entitlement_type: "included" },
    { feature_code: "unfollow", enabled: preset.unfollowEnabled, entitlement_type: "included" },
    { feature_code: "welcome", enabled: preset.welcomeEnabled, entitlement_type: "included" },
    { feature_code: "outreach", enabled: preset.outreachEnabled, entitlement_type: "addon" },
  ];

  const { error } = await supabase.from("client_subscription_modules").upsert(
    modules.map((module) => ({
      subscription_id: subscriptionId,
      ...module,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "subscription_id,feature_code" },
  );
  if (error) throw new Error("client_subscription_modules_upsert_failed");

  await supabase.rpc("sync_client_subscription_entitlements", {
    p_subscription_id: subscriptionId,
  });
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function ensureAddProfileOwnership(
  supabase: SupabaseClient,
  input: EnsureAddProfileOwnershipInput,
): Promise<EnsureAddProfileOwnershipResult> {
  const clientId = readClientId(input.clientId);
  if (!clientId) {
    return { ok: false, reason: "add_profile_client_unconfigured" };
  }

  const commercialPackage = normalizeCommercialPackage(input.commercialPackage);
  const commercialPackageCode = commercialPackageCodeForSelection(commercialPackage);
  const runtimeMode = isAddProfileRuntimeMode(input.runtimeMode) ? input.runtimeMode : "safe_setup";
  const subscriptionType = subscriptionTypeForRuntimeMode(runtimeMode);
  const addonCodes = normalizeAddonCodes(input.addons);
  const preset = resolveAddProfilePackagePreset({ commercialPackage, runtimeMode, addons: addonCodes });

  try {
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id,status")
      .eq("id", clientId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle<OwnershipRow>();

    if (clientError || !client?.id) {
      return { ok: false, reason: "add_profile_client_unavailable" };
    }

    await ensureCommercialPackagePreset(supabase, preset);
    await ensureAccountCommercialPackage(supabase, input.accountId, commercialPackageCode, "add_profile");
    await ensureAccountCommercialAddons(supabase, input.accountId, addonCodes);
    const clientInstagramAccountId = await ensureClientInstagramAccount(
      supabase,
      input.accountId,
      clientId,
      `Add Profile · ${input.accountUsername}`,
    );
    const subscriptionId = await ensureClientSubscription(supabase, clientId, subscriptionType);
    const subscriptionAccountId = await ensureClientSubscriptionAccount(supabase, {
      subscriptionId,
      clientInstagramAccountId,
      accountId: input.accountId,
    });
    await ensureClientSubscriptionModules(supabase, subscriptionId, preset);

    return {
      ok: true,
      clientId,
      commercialPackageCode,
      subscriptionType,
      clientInstagramAccountId,
      subscriptionId,
      subscriptionAccountId,
      addonCodes,
      repaired: false,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "ownership_ensure_failed";
    return { ok: false, reason };
  }
}
