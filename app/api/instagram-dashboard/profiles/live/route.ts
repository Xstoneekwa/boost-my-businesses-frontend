import { jsonError } from "@/app/api/instagram-dashboard/_utils";
import { getManageData } from "@/app/instagram-dashboard/manage-data";
import { randomUUID } from "node:crypto";
import { enrichAccountsWithRuntime, requireProfilesReadAccess } from "../route";
import {
  canonicalRuntimeFallbackProfiles,
  mergeCanonicalProfilesWithRuntime,
  missingRuntimeAccountIds,
  profileAccountId,
  replaceRuntimeProfiles,
} from "./profile-core";
import { canonicalProfilesMembership, selectCanonicalVisibleProfiles } from "./profile-visibility";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
type PhaseTimings = {
  legacyProfilesMs: number;
  sharedCoreMs: number;
  runtimeProjectionMs: number;
  identityMs: number;
  blockerProjectionMs: number;
  packageFallbackMs: number;
  serializationMs: number;
};

const PROFILES_LIVE_SCHEMA_VERSION = "profiles_live_v1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function requestedAccountIds(url: URL) {
  return [...new Set((url.searchParams.get("account_ids") || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => uuidPattern.test(value)))]
    .slice(0, 200);
}

function withCanonicalIdentity(profile: Row) {
  return {
    ...profile,
    loginIdentityProofStatus: profile.loginIdentityProofStatus ?? null,
    loginIdentityProfileOpened: profile.loginIdentityProfileOpened ?? null,
    loginIdentityUsernameMatch: profile.loginIdentityUsernameMatch ?? null,
    loginIdentityVerifiedAt: profile.loginIdentityVerifiedAt ?? null,
    loginStateInvalidationReason: profile.loginStateInvalidationReason ?? null,
    identityProjectionSource: "shared_profile_core",
  };
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
  const requestedIds = requestedAccountIds(url);
  const timings: PhaseTimings = {
    legacyProfilesMs: 0,
    sharedCoreMs: 0,
    runtimeProjectionMs: 0,
    identityMs: 0,
    blockerProjectionMs: 0,
    packageFallbackMs: 0,
    serializationMs: 0,
  };
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
    const unauthorized = await requireProfilesReadAccess(request);
    if (unauthorized) {
      const size = await responseSize(unauthorized);
      logProfilesLiveTelemetry({
        ...common,
        result: "profiles_auth_error",
        account_count: null,
        response_http_status: unauthorized.status,
        response_size_bytes: size,
        projection_revision: null,
        phase_legacy_profiles_ms: 0,
        phase_shared_core_ms: 0,
        phase_runtime_projection_ms: 0,
        phase_identity_ms: 0,
        phase_blocker_projection_ms: 0,
        phase_package_fallback_ms: 0,
        phase_serialization_ms: 0,
        phase_total_ms: roundedMs(performance.now() - startedAt),
      });
      unauthorized.headers.set("X-Profiles-Live-Request-Id", requestId);
      return unauthorized;
    }

    const sharedCoreStartedAt = performance.now();
    const managePromise = getManageData({ requireCanonicalComplete: true })
      .then((manage) => {
        timings.sharedCoreMs = roundedMs(performance.now() - sharedCoreStartedAt);
        return manage;
      });
    const runtimeStartedAt = performance.now();
    let runtimeBatchCount = requestedIds.length ? 1 : 0;
    const requestedRuntimePromise = requestedIds.length
      ? enrichAccountsWithRuntime(requestedIds.map((accountId) => ({ accountId })), generatedAt).then((profiles) => {
          timings.runtimeProjectionMs = roundedMs(performance.now() - runtimeStartedAt);
          return profiles;
        })
      : Promise.resolve([] as Row[]);

    const manage = await managePromise;
    const visibleBaseProfiles = selectCanonicalVisibleProfiles(manage.activeAccounts);
    let runtimeProfiles = await requestedRuntimePromise;

    const missingIds = missingRuntimeAccountIds(visibleBaseProfiles, runtimeProfiles);
    if (missingIds.length) {
      runtimeBatchCount += 1;
      const missingStartedAt = performance.now();
      const missingIdSet = new Set(missingIds);
      runtimeProfiles = [
        ...runtimeProfiles,
        ...await enrichAccountsWithRuntime(
          visibleBaseProfiles.filter((profile) => missingIdSet.has(profileAccountId(profile))),
          generatedAt,
        ),
      ];
      timings.runtimeProjectionMs = roundedMs(timings.runtimeProjectionMs + performance.now() - missingStartedAt);
    }

    const fallbackProfiles = canonicalRuntimeFallbackProfiles(visibleBaseProfiles, runtimeProfiles);
    if (fallbackProfiles.length) {
      runtimeBatchCount += 1;
      const fallbackStartedAt = performance.now();
      runtimeProfiles = replaceRuntimeProfiles(
        runtimeProfiles,
        await enrichAccountsWithRuntime(fallbackProfiles, generatedAt),
      );
      timings.packageFallbackMs = roundedMs(performance.now() - fallbackStartedAt);
      timings.runtimeProjectionMs = roundedMs(timings.runtimeProjectionMs + timings.packageFallbackMs);
    }

    const profiles = mergeCanonicalProfilesWithRuntime(visibleBaseProfiles, runtimeProfiles)
      .map(withCanonicalIdentity);
    const projectionPayload = {
      profiles: manage.allAccounts,
      activeAccounts: manage.activeAccounts,
      errors: manage.errors,
      projection_revision: generatedAt,
    };
    const membership = canonicalProfilesMembership(projectionPayload, requestedIds);
    const data = {
      generated_at: generatedAt,
      projection_generated_at: generatedAt,
      projection_revision: generatedAt,
      profiles,
      membership,
      removed_account_ids: [],
      archived_account_ids: [],
      query_count: 1 + runtimeBatchCount,
      schema_version: PROFILES_LIVE_SCHEMA_VERSION,
      source: "profiles_live_shared_core_v3",
      projection_mode: "full_snapshot",
    };
    const built = liveJsonOk(data, requestId, timings, startedAt);
    logProfilesLiveTelemetry({
      ...common,
      result: "success",
      account_count: profiles.length,
      response_http_status: 200,
      response_size_bytes: built.responseSizeBytes,
      projection_revision: generatedAt,
      phase_legacy_profiles_ms: timings.legacyProfilesMs,
      phase_shared_core_ms: timings.sharedCoreMs,
      phase_runtime_projection_ms: timings.runtimeProjectionMs,
      // Identity and blocker reads are reused from the shared core. These
      // values intentionally measure additional live-only work.
      phase_identity_ms: timings.identityMs,
      phase_blocker_projection_ms: timings.blockerProjectionMs,
      phase_package_fallback_ms: timings.packageFallbackMs,
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
      phase_shared_core_ms: timings.sharedCoreMs,
      phase_runtime_projection_ms: timings.runtimeProjectionMs,
      phase_identity_ms: timings.identityMs,
      phase_blocker_projection_ms: timings.blockerProjectionMs,
      phase_package_fallback_ms: timings.packageFallbackMs,
      phase_serialization_ms: timings.serializationMs,
      phase_total_ms: roundedMs(performance.now() - startedAt),
      error_type: error instanceof Error ? error.name : typeof error,
    });
    response.headers.set("X-Profiles-Live-Request-Id", requestId);
    return response;
  }
}
