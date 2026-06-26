import type { InstagramPublicProfileLookupResult } from "@/lib/instagram-public-profile-lookup";

export type ProfileVerificationPayloadContext = {
  operation: string;
  sourceSurface: string;
};

export type IgAccountProfileVerificationPayload = {
  username_verification_status: string;
  username_verified_at: string | null;
  username_verification_reason: string;
  instagram_user_id: string | null;
  external_profile_id: string | null;
  is_private: boolean | null;
  is_verified: boolean | null;
  followers_count: number | null;
  avatar_url: string | null;
  avatar_checked_at: string | null;
  public_profile_metadata: Record<string, string | number | boolean | null>;
};

export function verificationStatusForLookup(lookup: InstagramPublicProfileLookupResult) {
  if (lookup.status === "found") return "verified";
  if (lookup.status === "username_invalid") return "invalid_format";
  if (lookup.status === "provider_error" || lookup.status === "rate_limited") return "provider_error";
  return "verification_unavailable";
}

export function verificationReasonForLookup(lookup: InstagramPublicProfileLookupResult) {
  if (lookup.status === "found") return "found";
  if (lookup.status === "provider_not_configured") return "provider_not_configured";
  if (lookup.status === "rate_limited") return "rate_limited";
  return lookup.reason || lookup.status;
}

export function publicProfileMetadataForLookup(
  lookup: InstagramPublicProfileLookupResult,
  context: ProfileVerificationPayloadContext,
) {
  const metadata: Record<string, string | number | boolean | null> = {
    source: context.operation,
    source_surface: context.sourceSurface,
    provider_status: lookup.status,
    reason: verificationReasonForLookup(lookup),
    input_username: lookup.input_username,
  };
  if (lookup.canonical_username) metadata.canonical_username = lookup.canonical_username;
  for (const [key, value] of Object.entries(lookup.metadata)) {
    metadata[`provider_${key}`] = value;
  }
  return metadata;
}

export function profileVerificationPayloadForInsert(
  lookup: InstagramPublicProfileLookupResult,
  context: ProfileVerificationPayloadContext,
): IgAccountProfileVerificationPayload {
  const verified = lookup.status === "found";
  return {
    username_verification_status: verificationStatusForLookup(lookup),
    username_verified_at: verified ? lookup.checked_at : null,
    username_verification_reason: verificationReasonForLookup(lookup),
    instagram_user_id: lookup.instagram_user_id,
    external_profile_id: lookup.external_profile_id,
    is_private: lookup.is_private,
    is_verified: lookup.is_verified,
    followers_count: lookup.followers_count,
    avatar_url: lookup.avatar_url,
    avatar_checked_at: lookup.avatar_url ? lookup.checked_at : null,
    public_profile_metadata: publicProfileMetadataForLookup(lookup, context),
  };
}
