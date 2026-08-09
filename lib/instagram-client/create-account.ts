import { createSupabaseClient } from "@/lib/supabase";
import {
  isPlausibleInstagramPublicUsername,
  lookupInstagramPublicProfile,
  normalizeInstagramPublicUsername,
  type InstagramPublicProfileLookupResult,
} from "@/lib/instagram-public-profile-lookup";
import {
  isAddProfileCommercialPackage,
  resolveAddProfilePackagePreset,
  type AddProfileCommercialPackage,
} from "@/lib/instagram-dashboard/add-profile-packages";
import {
  entitlementToAddProfileInput,
  peekReservedEntitlementForClient,
} from "@/lib/commercial/entitlements";
import { parseLoginEmailInput } from "@/lib/instagram-dashboard/persist-account-login-email";
import { projectClientAccountRow, readString } from "./guards";

type SupabaseRecord = Record<string, unknown>;

export type ClientCreateAccountInput = {
  clientId: string;
  userId: string;
  username: string;
  password: string;
  email?: string;
  notes?: string;
  dryRun?: boolean;
  flowMode?: "legacy_auto_assign" | "targeting_setup";
};

export type ClientPublicProfileProjection = {
  lookupStatus: string;
  providerProfileId: string | null;
  username: string;
  displayName: string | null;
  biography: string | null;
  avatarUrl: string | null;
  avatarHdUrl: string | null;
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  isPrivate: boolean | null;
  isVerified: boolean | null;
  isBusiness: boolean | null;
  officialCategory: string | null;
  externalUrl: string | null;
  bioLinks: Array<{ title: string | null; url: string }>;
  recentCaptionSamples: string[];
  checkedAt: string;
};

export type ClientCreateAccountResult =
  | {
    ok: true;
    dryRun: true;
    account: ReturnType<typeof projectClientAccountRow>;
    assignment: { status: string; reason: string };
    commercialPackage: AddProfileCommercialPackage;
    publicProfile: ClientPublicProfileProjection;
  }
  | { ok: false; status: number; error: string; code?: string };

export function projectClientPublicProfileLookup(
  profileLookup: InstagramPublicProfileLookupResult,
  accountUsername: string,
): ClientPublicProfileProjection {
  return {
    lookupStatus: profileLookup.status,
    providerProfileId: profileLookup.provider_profile_id ?? null,
    username: accountUsername,
    displayName: readString(profileLookup.metadata.profile_name) || null,
    biography: readString(profileLookup.metadata.biography) || null,
    avatarUrl: profileLookup.avatar_url,
    avatarHdUrl: profileLookup.avatar_hd_url ?? null,
    followersCount: profileLookup.followers_count,
    followingCount: profileLookup.following_count ?? null,
    postsCount: profileLookup.posts_count ?? null,
    isPrivate: profileLookup.is_private,
    isVerified: profileLookup.is_verified,
    isBusiness: profileLookup.is_business ?? null,
    officialCategory: profileLookup.official_category ?? null,
    externalUrl: profileLookup.external_url ?? null,
    bioLinks: profileLookup.bio_links ?? [],
    recentCaptionSamples: profileLookup.recent_post_captions ?? [],
    checkedAt: profileLookup.checked_at,
  };
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
    .eq("client_id", clientId)
    .eq("active", true);
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

/**
 * Validation-only compatibility helper. Account creation was intentionally
 * removed from this module; all writes now belong to the canonical PostgreSQL
 * onboarding transaction exposed by canonical-account-onboarding.ts.
 */
export async function createClientInstagramAccount(input: ClientCreateAccountInput): Promise<ClientCreateAccountResult> {
  if (input.dryRun !== true) {
    return {
      ok: false,
      status: 410,
      error: "Direct account creation is retired. Use canonical onboarding.",
      code: "legacy_direct_create_disabled",
    };
  }

  const username = normalizeInstagramPublicUsername(readString(input.username));
  const emailParsed = parseLoginEmailInput(input.email);
  if (!username) return { ok: false, status: 400, error: "Instagram username is required.", code: "username_required" };
  if (emailParsed.present && emailParsed.invalid) return { ok: false, status: 400, error: "Instagram login email is invalid.", code: "email_invalid" };
  if (!isPlausibleInstagramPublicUsername(username)) return { ok: false, status: 400, error: "Instagram username is invalid.", code: "username_invalid" };

  const supabase = createSupabaseClient();
  if (!await clientHasActiveSubscription(supabase, input.clientId)) {
    return { ok: false, status: 403, error: "Your subscription is not active.", code: "subscription_inactive" };
  }

  const profileLookup = await lookupInstagramPublicProfile(username);
  if (profileLookup.status === "username_invalid") return { ok: false, status: 400, error: "Instagram username could not be verified.", code: "username_verification_failed" };
  if (profileLookup.status === "not_found") return { ok: false, status: 404, error: "Instagram username was not found.", code: "username_not_found" };
  const accountUsername = profileLookup.status === "found" && profileLookup.canonical_username && isPlausibleInstagramPublicUsername(profileLookup.canonical_username)
    ? profileLookup.canonical_username
    : username;
  if (await usernameLinkedToClient(supabase, input.clientId, accountUsername)) {
    return { ok: false, status: 409, error: "This Instagram account is already linked to your workspace.", code: "username_already_linked" };
  }

  const entitlement = await peekReservedEntitlementForClient(supabase, input.clientId);
  if (!entitlement?.id) return { ok: false, status: 403, error: "Choose and activate a plan before adding an Instagram account.", code: "entitlement_required" };
  const selection = entitlementToAddProfileInput(entitlement);
  if (!isAddProfileCommercialPackage(selection.commercialPackage)) {
    return { ok: false, status: 409, error: "Your selected plan cannot be applied to this account.", code: "entitlement_package_invalid" };
  }
  const preset = resolveAddProfilePackagePreset({
    commercialPackage: selection.commercialPackage,
    runtimeMode: "safe_setup",
    addons: selection.addons,
  });
  const publicProfile = projectClientPublicProfileLookup(profileLookup, accountUsername);
  return {
    ok: true,
    dryRun: true,
    account: projectClientAccountRow({
      accountId: "dry-run-account",
      username: accountUsername,
      packageLabel: preset.label,
      accountStatus: "inactive",
      onboardingStatus: "pending",
      provisioningStatus: "not_started",
      loginStatus: "unknown",
      assignmentStatus: "onboarding_targeting_pending",
    }),
    assignment: { status: "onboarding_targeting_pending", reason: "dry_run" },
    commercialPackage: selection.commercialPackage,
    publicProfile,
  };
}
