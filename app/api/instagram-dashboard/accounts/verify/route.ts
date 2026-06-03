import {
  isPlausibleInstagramPublicUsername,
  lookupInstagramPublicProfile,
  normalizeInstagramPublicUsername,
} from "@/lib/instagram-public-profile-lookup";
import { jsonError, jsonOk, readString, requireInstagramAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

function safeVerificationStatus(status: string) {
  if (status === "found") return "verified";
  if (status === "not_found") return "not_found";
  if (status === "username_invalid") return "invalid_format";
  if (status === "provider_not_configured") return "pending_verification";
  if (status === "rate_limited") return "pending_review";
  return "pending_verification";
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const url = new URL(request.url);
    const username = normalizeInstagramPublicUsername(url.searchParams.get("username") || "");
    if (!username) return jsonError("Instagram username is required.", 400);
    if (!isPlausibleInstagramPublicUsername(username)) {
      return jsonOk({
        username,
        status: "invalid_format",
        canonical_username: null,
        avatar_url: null,
        reason: "invalid_format",
      });
    }

    const lookup = await lookupInstagramPublicProfile(username);
    return jsonOk({
      username,
      status: safeVerificationStatus(lookup.status),
      canonical_username: readString(lookup.canonical_username, "") || username,
      avatar_url: lookup.avatar_url,
      followers_count: lookup.followers_count,
      is_verified: lookup.is_verified,
      reason: lookup.reason || lookup.status,
      checked_at: lookup.checked_at,
    });
  } catch {
    return jsonError("Could not verify Instagram username.", 500);
  }
}
