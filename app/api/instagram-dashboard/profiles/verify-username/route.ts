import {
  isPlausibleInstagramPublicUsername,
  lookupInstagramPublicProfile,
  normalizeInstagramPublicUsername,
} from "@/lib/instagram-public-profile-lookup";
import {
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type VerifyUsernameBody = {
  username?: unknown;
  platform?: unknown;
  source?: unknown;
};

function verificationStatus(status: string) {
  if (status === "found") return "verified";
  if (status === "not_found") return "not_found";
  if (status === "provider_not_configured") return "provider_not_configured";
  if (status === "rate_limited") return "rate_limited";
  if (status === "unavailable") return "provider_unavailable";
  return "error";
}

function safeProvider(metadata: Record<string, unknown>) {
  return readString(metadata.provider_mode, "disabled").toLowerCase() || "disabled";
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Username verification relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<VerifyUsernameBody>(request);
    const platform = readString(body?.platform, "instagram").toLowerCase();
    if (platform !== "instagram") return jsonError("Unsupported platform.", 400);

    const username = normalizeInstagramPublicUsername(readString(body?.username, ""));
    if (!username) return jsonError("Instagram username is required.", 400);
    if (!isPlausibleInstagramPublicUsername(username)) {
      return jsonOk({
        username,
        normalized_username: username,
        status: "error",
        verification_status: "invalid_format",
        provider: "not_used",
        avatar_url: null,
        reason: "invalid_format",
      });
    }

    const lookup = await lookupInstagramPublicProfile(username);
    return jsonOk({
      username,
      normalized_username: lookup.canonical_username || username,
      status: lookup.status === "username_invalid" ? "error" : lookup.status,
      verification_status: verificationStatus(lookup.status),
      provider: safeProvider(lookup.metadata),
      display_name: null,
      followers_count: lookup.followers_count,
      avatar_url: null,
      is_private: lookup.is_private,
      is_verified: lookup.is_verified,
      reason: lookup.reason || lookup.status,
      checked_at: lookup.checked_at,
      source: readString(body?.source, "botapp_add_profile").slice(0, 80) || "botapp_add_profile",
    });
  } catch {
    return jsonError("Could not verify Instagram username.", 500);
  }
}
