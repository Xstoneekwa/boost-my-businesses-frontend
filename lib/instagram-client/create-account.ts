import { createSupabaseClient } from "@/lib/supabase";
import { defaultInstagramFilters, defaultInstagramSettings } from "@/lib/instagram-dashboard/defaults";
import {
  isPlausibleInstagramPublicUsername,
  lookupInstagramPublicProfile,
  normalizeInstagramPublicUsername,
} from "@/lib/instagram-public-profile-lookup";
import {
  defaultAddProfileCommercialPackage,
  resolveAddProfilePackagePreset,
} from "@/lib/instagram-dashboard/add-profile-packages";
import { applyAddProfileRuntimeDefaults } from "@/lib/instagram-dashboard/add-profile-runtime-defaults";
import { ensureAddProfileOwnership } from "@/lib/instagram-dashboard/ensure-add-profile-ownership";
import { tryAutoAssignOnboardingSchedule } from "@/lib/instagram-dashboard/onboarding-schedule";
import { clientMaxAccountsLimit, projectClientAccountRow, readBoolean, readString } from "./guards";

type SupabaseRecord = Record<string, unknown>;

export type ClientCreateAccountInput = {
  clientId: string;
  userId: string;
  username: string;
  password: string;
  email?: string;
  notes?: string;
  dryRun?: boolean;
};

export type ClientCreateAccountResult =
  | { ok: true; dryRun?: boolean; account: ReturnType<typeof projectClientAccountRow>; assignment: { status: string; reason: string } }
  | { ok: false; status: number; error: string; code?: string };

const credentialsTimeoutMs = 9000;

function credentialsConfig() {
  const url = process.env.INSTAGRAM_CREDENTIALS_API_URL?.trim();
  const token = process.env.INSTAGRAM_CREDENTIALS_API_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

function profileVerificationPayload(lookup: Awaited<ReturnType<typeof lookupInstagramPublicProfile>>) {
  if (lookup.status !== "found") return {};
  return {
    instagram_verification_status: "verified",
    instagram_verified_at: lookup.checked_at,
    is_private: lookup.is_private,
    is_verified: lookup.is_verified,
    followers_count: lookup.followers_count,
    avatar_url: lookup.avatar_url,
    avatar_checked_at: lookup.avatar_url ? lookup.checked_at : null,
  };
}

async function submitClientCredentials(input: {
  accountId: string;
  expectedUsername: string;
  password: string;
  externalRequestId: string;
}) {
  const config = credentialsConfig();
  if (!config) throw new Error("credentials_api_not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), credentialsTimeoutMs);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "submit_add_profile_credentials",
        account_id: input.accountId,
        expected_username: input.expectedUsername,
        password: input.password,
        actor_type: "client",
        metadata_safe: {
          flow: "client_add_account",
          external_request_id: input.externalRequestId,
          source_surface: "instagram_client",
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("credentials_ingestion_failed");
    const payload = await response.json() as { ok?: unknown };
    if (payload.ok !== true) throw new Error("credentials_ingestion_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function countClientAccounts(supabase: ReturnType<typeof createSupabaseClient>, clientId: string) {
  const { count, error } = await supabase
    .from("client_instagram_accounts")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (error) throw new Error("client_account_count_failed");
  return count ?? 0;
}

async function clientHasActiveSubscription(supabase: ReturnType<typeof createSupabaseClient>, clientId: string) {
  const { data, error } = await supabase
    .from("client_subscriptions")
    .select("id,status,subscription_type")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (error) throw new Error("client_subscription_lookup_failed");
  return Boolean(data?.id);
}

async function usernameLinkedToClient(
  supabase: ReturnType<typeof createSupabaseClient>,
  clientId: string,
  username: string,
) {
  const { data: links, error } = await supabase
    .from("client_instagram_accounts")
    .select("account_id")
    .eq("client_id", clientId);
  if (error) throw new Error("client_account_lookup_failed");
  const accountIds = (Array.isArray(links) ? links : [])
    .map((row) => readString((row as SupabaseRecord).account_id))
    .filter(Boolean);
  if (!accountIds.length) return false;

  const { data: accounts } = await supabase
    .from("ig_accounts")
    .select("id,username")
    .in("id", accountIds)
    .ilike("username", username);
  return Array.isArray(accounts) && accounts.length > 0;
}

export async function createClientInstagramAccount(input: ClientCreateAccountInput): Promise<ClientCreateAccountResult> {
  const username = normalizeInstagramPublicUsername(readString(input.username));
  const password = readString(input.password);
  const email = readString(input.email);
  const notes = readString(input.notes);
  const dryRun = input.dryRun === true;

  if (!username) return { ok: false, status: 400, error: "Instagram username is required.", code: "username_required" };
  if (!isPlausibleInstagramPublicUsername(username)) {
    return { ok: false, status: 400, error: "Instagram username is invalid.", code: "username_invalid" };
  }
  if (!dryRun && !password) {
    return { ok: false, status: 400, error: "Instagram password is required.", code: "password_required" };
  }
  if (!dryRun && !credentialsConfig()) {
    return { ok: false, status: 503, error: "Credential setup is temporarily unavailable.", code: "credentials_unavailable" };
  }

  const supabase = createSupabaseClient();
  const subscriptionActive = await clientHasActiveSubscription(supabase, input.clientId);
  if (!subscriptionActive) {
    return { ok: false, status: 403, error: "Your subscription is not active.", code: "subscription_inactive" };
  }

  const linkedCount = await countClientAccounts(supabase, input.clientId);
  const maxAccounts = clientMaxAccountsLimit();
  if (linkedCount >= maxAccounts) {
    return { ok: false, status: 409, error: "Maximum number of Instagram accounts reached for your plan.", code: "max_accounts_reached" };
  }

  const profileLookup = await lookupInstagramPublicProfile(username);
  if (profileLookup.status === "username_invalid") {
    return { ok: false, status: 400, error: "Instagram username could not be verified.", code: "username_verification_failed" };
  }
  if (profileLookup.status === "not_found") {
    return { ok: false, status: 404, error: "Instagram username was not found.", code: "username_not_found" };
  }

  const accountUsername = profileLookup.status === "found" &&
    profileLookup.canonical_username &&
    isPlausibleInstagramPublicUsername(profileLookup.canonical_username)
    ? profileLookup.canonical_username
    : username;

  if (await usernameLinkedToClient(supabase, input.clientId, accountUsername)) {
    return { ok: false, status: 409, error: "This Instagram account is already linked to your workspace.", code: "username_already_linked" };
  }

  const commercialPackage = defaultAddProfileCommercialPackage();
  const packagePreset = resolveAddProfilePackagePreset({ commercialPackage, runtimeMode: "safe_setup", addons: [] });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      account: projectClientAccountRow({
        accountId: "dry-run-account",
        username: accountUsername,
        packageLabel: packagePreset.label,
        accountStatus: "active",
        onboardingStatus: "pending",
        provisioningStatus: "not_started",
        loginStatus: "unknown",
        assignmentStatus: "pending_assignment",
      }),
      assignment: { status: "pending_assignment", reason: "dry_run" },
    };
  }

  const externalRequestId = crypto.randomUUID();
  const accountPayload = {
    username: accountUsername,
    display_name: "",
    status: "active",
    device_id: null,
    device_name: "",
    device_udid: "",
    clone_mode: "off",
    login_method: "credentials",
    internal_label: null,
    notes: notes || null,
    ...profileVerificationPayload(profileLookup),
  };

  const { data: insertedAccount, error: accountError } = await supabase
    .from("ig_accounts")
    .insert(accountPayload)
    .select("*")
    .single<SupabaseRecord>();

  if (accountError || !insertedAccount?.id) {
    return { ok: false, status: 500, error: "Could not create Instagram account.", code: "account_create_failed" };
  }

  const accountId = readString(insertedAccount.id);
  const settings = {
    ...defaultInstagramSettings,
    account_id: accountId,
    username: accountUsername,
    display_name: "",
    device_name: "",
    device_udid: "",
    email,
    password: "",
    account_status: "active",
    cloned_app_mode: false,
    dry_run_enabled: true,
  };
  const filters = { ...defaultInstagramFilters, account_id: accountId };

  const [{ error: settingsError }, { error: filtersError }, { error: dmError }] = await Promise.all([
    supabase.from("ig_account_settings").insert(settings),
    supabase.from("ig_account_filters").insert(filters),
    supabase.from("ig_account_dm_settings").insert({
      account_id: accountId,
      welcome_enabled: false,
      outreach_enabled: false,
      welcome_per_session_limit: 10,
      welcome_per_day_limit: 10,
      outreach_per_session_limit: 5,
      outreach_per_day_limit: 30,
      total_dm_per_day_limit: 40,
    }),
  ]);

  if (settingsError || filtersError || dmError) {
    await supabase.from("ig_accounts").delete().eq("id", accountId);
    return { ok: false, status: 500, error: "Could not finish account setup.", code: "profile_setup_failed" };
  }

  try {
    await submitClientCredentials({ accountId, expectedUsername: accountUsername, password, externalRequestId });
  } catch {
    await supabase.from("ig_accounts").delete().eq("id", accountId);
    return { ok: false, status: 502, error: "Could not save Instagram credentials securely.", code: "credentials_ingestion_failed" };
  }

  const ownership = await ensureAddProfileOwnership(supabase, {
    accountId,
    accountUsername,
    clientId: input.clientId,
    commercialPackage,
    runtimeMode: "safe_setup",
    addons: [],
  });
  if (!ownership.ok) {
    return { ok: false, status: 500, error: "Could not link account to your client workspace.", code: ownership.reason };
  }

  await applyAddProfileRuntimeDefaults(supabase, {
    accountId,
    username: accountUsername,
    appPackageName: "com.instagram.android",
    preset: packagePreset,
  });

  const assignment = await tryAutoAssignOnboardingSchedule(accountId);
  const assignmentStatus = assignment.assigned ? "assigned" : "pending_assignment";

  const { data: clientLink } = await supabase
    .from("client_instagram_accounts")
    .select("onboarding_status,provisioning_status,login_status")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();

  return {
    ok: true,
    account: projectClientAccountRow({
      accountId,
      username: accountUsername,
      packageLabel: packagePreset.label,
      accountStatus: "active",
      onboardingStatus: readString(clientLink?.onboarding_status, "pending"),
      provisioningStatus: readString(clientLink?.provisioning_status, "not_started"),
      loginStatus: readString(clientLink?.login_status, "unknown"),
      assignmentStatus,
    }),
    assignment: {
      status: assignmentStatus,
      reason: assignment.assigned ? "auto_assigned" : readString(assignment.reason, "pending_setup"),
    },
  };
}
