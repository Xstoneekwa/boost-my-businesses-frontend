import { jsonError } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { randomUUID } from "node:crypto";
import { GET as getLegacyProfiles } from "../route";
import { canonicalProfilesMembership, selectCanonicalVisibleProfiles, unwrapJsonOkData } from "./profile-visibility";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
type PhaseTimings = {
  legacyProfilesMs: number;
  identityMs: number;
  serializationMs: number;
};

const PROFILES_LIVE_SCHEMA_VERSION = "profiles_live_v1";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function accountId(row: Row) {
  return text(row.accountId) || text(row.account_id) || text(row.id);
}

function roundedMs(value: number) {
  return Math.max(0, Math.round(value * 100) / 100);
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function logProfilesLiveTelemetry(event: Record<string, unknown>) {
  console.info("PROFILES_LIVE_TELEMETRY", JSON.stringify(event));
}

function liveJsonOk(data: Record<string, unknown>, requestId: string, timings: PhaseTimings, startedAt: number) {
  const serializationStartedAt = performance.now();
  const body = JSON.stringify({ ok: true, data });
  timings.serializationMs = roundedMs(performance.now() - serializationStartedAt);
  const responseSizeBytes = byteLength(body);
  const totalDurationMs = roundedMs(performance.now() - startedAt);
  const response = new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      "Content-Length": String(responseSizeBytes),
      "X-Profiles-Live-Request-Id": requestId,
      "X-Profiles-Live-Response-Size": String(responseSizeBytes),
      "X-Profiles-Live-Schema-Version": PROFILES_LIVE_SCHEMA_VERSION,
      "X-Profiles-Live-Total-Ms": String(totalDurationMs),
    },
  });
  return { response, responseSizeBytes, totalDurationMs };
}

async function responseSize(response: Response) {
  const declaredHeader = response.headers.get("content-length");
  const declared = declaredHeader === null ? Number.NaN : Number(declaredHeader);
  if (Number.isFinite(declared) && declared >= 0) return declared;
  try {
    return (await response.clone().arrayBuffer()).byteLength;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const startedAt = performance.now();
  const generatedAt = new Date().toISOString();
  const url = new URL(request.url);
  const requestId = text(request.headers.get("x-profiles-live-request-id")) || randomUUID();
  const correlationId = text(url.searchParams.get("correlation_id"));
  const refreshGeneration = text(url.searchParams.get("refresh_generation"));
  const refreshMode = text(url.searchParams.get("refresh_mode"));
  const refreshReason = text(url.searchParams.get("refresh_reason"));
  const timings: PhaseTimings = { legacyProfilesMs: 0, identityMs: 0, serializationMs: 0 };
  const common = {
    event: "profiles_live_request",
    request_id: requestId,
    generated_at: generatedAt,
    correlation_id: correlationId || null,
    refresh_generation: refreshGeneration || null,
    refresh_mode: refreshMode || null,
    refresh_reason: refreshReason || null,
    schema_version: PROFILES_LIVE_SCHEMA_VERSION,
  };
  try {
    const legacyStartedAt = performance.now();
    const legacyResponse = await getLegacyProfiles(request);
    timings.legacyProfilesMs = roundedMs(performance.now() - legacyStartedAt);
    if (!legacyResponse.ok) {
      const size = await responseSize(legacyResponse);
      logProfilesLiveTelemetry({
        ...common,
        result: "legacy_profiles_error",
        account_count: null,
        response_http_status: legacyResponse.status,
        response_size_bytes: size,
        projection_revision: null,
        phase_legacy_profiles_ms: timings.legacyProfilesMs,
        phase_identity_ms: 0,
        phase_serialization_ms: 0,
        phase_total_ms: roundedMs(performance.now() - startedAt),
      });
      legacyResponse.headers.set("X-Profiles-Live-Request-Id", requestId);
      return legacyResponse;
    }

    const legacyPayload = unwrapJsonOkData(await legacyResponse.json());
    if (!Array.isArray(legacyPayload.activeAccounts) || !Array.isArray(legacyPayload.profiles)) {
      const response = jsonError("Canonical Profiles membership unavailable.", 503);
      const size = await responseSize(response);
      logProfilesLiveTelemetry({
        ...common,
        result: "canonical_membership_unavailable",
        account_count: null,
        response_http_status: 503,
        response_size_bytes: size,
        projection_revision: null,
        phase_legacy_profiles_ms: timings.legacyProfilesMs,
        phase_identity_ms: 0,
        phase_serialization_ms: 0,
        phase_total_ms: roundedMs(performance.now() - startedAt),
      });
      response.headers.set("X-Profiles-Live-Request-Id", requestId);
      return response;
    }
    // The canonical Profiles endpoint exposes its full snapshot as
    // `activeAccounts`. Reading the retired `profiles` alias makes every
    // authenticated BotApp refresh fail after the response is unwrapped.
    const visibleProfiles = selectCanonicalVisibleProfiles(legacyPayload.activeAccounts);
    const accountIds = visibleProfiles.map(accountId).filter(Boolean);
    // Only the authenticated complete canonical inventory can affirm removals.
    // A sparse Live payload alone never implies deletion on the client.
    const requestedIds = (url.searchParams.get("account_ids") || "").split(",").filter(Boolean).slice(0, 200);
    const membership = canonicalProfilesMembership(legacyPayload, requestedIds);
    const identityByAccount = new Map<string, Row>();
    let identitySource = "not_requested";

    if (accountIds.length) {
      const identityStartedAt = performance.now();
      const identityResult = await createSupabaseClient()
        .from("client_instagram_accounts")
        .select("account_id,login_identity_proof_status,login_identity_profile_opened,login_identity_username_match,login_identity_verified_at,login_state_invalidation_reason")
        .in("account_id", accountIds)
        .limit(200);
      if (identityResult.error) {
        identitySource = "unavailable";
      } else {
        identitySource = "client_instagram_accounts";
        for (const row of (identityResult.data ?? []) as Row[]) {
          const id = text(row.account_id);
          if (id) identityByAccount.set(id, row);
        }
      }
      timings.identityMs = roundedMs(performance.now() - identityStartedAt);
    }

    const profiles = visibleProfiles.map((profile) => {
      const identity = identityByAccount.get(accountId(profile));
      return {
        ...profile,
        loginIdentityProofStatus: identity ? identity.login_identity_proof_status ?? null : null,
        loginIdentityProfileOpened: identity ? identity.login_identity_profile_opened ?? null : null,
        loginIdentityUsernameMatch: identity ? identity.login_identity_username_match ?? null : null,
        loginIdentityVerifiedAt: identity ? identity.login_identity_verified_at ?? null : null,
        loginStateInvalidationReason: identity ? identity.login_state_invalidation_reason ?? null : null,
        identityProjectionSource: identity ? "client_instagram_accounts" : identitySource,
      };
    });

    const data = {
      generated_at: legacyPayload.generated_at,
      projection_generated_at: legacyPayload.projection_generated_at,
      projection_revision: legacyPayload.projection_revision,
      profiles,
      membership,
      removed_account_ids: [],
      archived_account_ids: [],
      query_count: accountIds.length ? 2 : 1,
      schema_version: PROFILES_LIVE_SCHEMA_VERSION,
      source: "profiles_live_all_accounts_visible_v2",
      projection_mode: "full_snapshot",
    };
    const built = liveJsonOk(data, requestId, timings, startedAt);
    logProfilesLiveTelemetry({
      ...common,
      result: "success",
      account_count: accountIds.length,
      response_http_status: 200,
      response_size_bytes: built.responseSizeBytes,
      projection_revision: text(legacyPayload.projection_revision) || null,
      phase_legacy_profiles_ms: timings.legacyProfilesMs,
      phase_identity_ms: timings.identityMs,
      phase_serialization_ms: timings.serializationMs,
      phase_total_ms: built.totalDurationMs,
    });
    return built.response;
  } catch (error) {
    const response = jsonError("Could not load live Profiles projection.", 500);
    const size = await responseSize(response);
    logProfilesLiveTelemetry({
      ...common,
      result: "unhandled_error",
      account_count: null,
      response_http_status: 500,
      response_size_bytes: size,
      projection_revision: null,
      phase_legacy_profiles_ms: timings.legacyProfilesMs,
      phase_identity_ms: timings.identityMs,
      phase_serialization_ms: timings.serializationMs,
      phase_total_ms: roundedMs(performance.now() - startedAt),
      error_type: error instanceof Error ? error.name : typeof error,
    });
    response.headers.set("X-Profiles-Live-Request-Id", requestId);
    return response;
  }
}
