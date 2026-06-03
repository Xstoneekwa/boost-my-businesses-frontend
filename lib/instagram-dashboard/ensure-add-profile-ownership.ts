import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commercialPackageCodeForSelection,
  defaultAddProfileCommercialPackage,
  isAddProfileCommercialPackage,
  isAddProfileRuntimeMode,
  subscriptionTypeForRuntimeMode,
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

async function ensureInternalTestCommercialPackage(
  supabase: SupabaseClient,
  commercialPackageCode: string,
) {
  if (commercialPackageCode !== "internal_test") return;

  const { error } = await supabase.from("commercial_packages").upsert(
    {
      code: "internal_test",
      label: "Internal Test",
      default_follow_day_cap: 20,
      default_unfollow_day_cap: 20,
      default_follow_session_cap: 20,
      default_unfollow_session_cap: 20,
      default_welcome_enabled: false,
      default_outreach_enabled: false,
      default_welcome_day_cap: null,
      default_outreach_day_cap: null,
      advanced_ct_enabled: false,
      ai_comment_enabled: false,
      ai_targeting_enabled: false,
      active: true,
    },
    { onConflict: "code" },
  );

  if (error) throw new Error("commercial_package_upsert_failed");
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

    await ensureInternalTestCommercialPackage(supabase, commercialPackageCode);
    await ensureAccountCommercialPackage(supabase, input.accountId, commercialPackageCode, "add_profile");
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

    return {
      ok: true,
      clientId,
      commercialPackageCode,
      subscriptionType,
      clientInstagramAccountId,
      subscriptionId,
      subscriptionAccountId,
      repaired: false,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "ownership_ensure_failed";
    return { ok: false, reason };
  }
}
