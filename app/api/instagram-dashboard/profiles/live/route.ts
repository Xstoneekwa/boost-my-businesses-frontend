import { jsonError } from "@/app/api/instagram-dashboard/_utils";
import { getManageData } from "@/app/instagram-dashboard/manage-data";
import { randomUUID } from "node:crypto";
import { withProfilesLiveTrace, traceStep, traceMetric, traceFallback } from "@/lib/instagram-dashboard/profiles-live-causal";
import { enrichAccountsWithRuntime, requireProfilesReadAccess } from "../route";
import {
  canonicalRuntimeFallbackProfiles,
  mergeCanonicalProfilesWithRuntime,
  missingRuntimeAccountIds,
  profileAccountId,
  replaceRuntimeProfiles,
} from "./profile-core";
import { canonicalProfilesMembership, selectCanonicalVisibleProfiles } from "./profile-visibility";
import {
  PROFILES_LIVE_CONTRACT,
  PROFILES_LIVE_POLICY,
  buildProfilesFreshness,
  isProfilesLiveDeadlineError,
  observeProfilesLiveRead,
  profilesLiveFieldFamilySummary,
  type ProfilesLiveHelperObservation,
  type ProfilesLiveReason,
  wantsProfilesLiveFreshness,
  withProfilesLiveResilience,
} from "@/lib/instagram-dashboard/profiles-live-resilience";

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

function degradedHelperTelemetry(requestId: string, observations: ProfilesLiveHelperObservation[]) {
  return observations
    .filter(observation => observation.result_class !== "SUCCESS")
    .map(observation => ({ request_id: requestId, ...observation }));
}

function liveJsonOk(data: Record<string, unknown>, requestId: string, timings: PhaseTimings, startedAt: number, status = 200) {
  const serializationStartedAt = performance.now();
  const body = JSON.stringify({ ok: true, data });
  timings.serializationMs = roundedMs(performance.now() - serializationStartedAt);
  const responseSizeBytes = byteLength(body);
  const totalDurationMs = roundedMs(performance.now() - startedAt);
  const response = new Response(body, {
    status,
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
  const helperObservations: ProfilesLiveHelperObservation[] = [];
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
  return withProfilesLiveTrace(request, requestId, correlationId, async () => {
  const freshnessContract = wantsProfilesLiveFreshness(request);
  const execute = async () => {
  traceMetric("requested_account_count", requestedIds.length);
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
    const freshnessManagePromise = freshnessContract
      ? observeProfilesLiveRead("shared_core", 2_200, (signal) => traceStep("shared", () => getManageData({ requireCanonicalComplete: true, timeoutMs: 2_200, signal })))
      : null;
    const legacyManagePromise = freshnessContract
      ? null
      : traceStep("shared", () => getManageData({ requireCanonicalComplete: true }));
    const runtimeStartedAt = performance.now();
    let runtimeBatchCount = requestedIds.length ? 1 : 0;
    const runtimeWork = () => traceStep("runtime.requested", () => enrichAccountsWithRuntime(requestedIds.map((accountId) => ({ accountId })), generatedAt)).then((profiles) => {
          timings.runtimeProjectionMs = roundedMs(performance.now() - runtimeStartedAt);
          return profiles;
        });
    const freshnessRuntimePromise = freshnessContract
      ? (requestedIds.length
        ? observeProfilesLiveRead("runtime_projection", 1_800, runtimeWork)
        : Promise.resolve({
          envelope: { state: "SUCCESS" as const, value: [] as Row[], observedAt: generatedAt },
          observation: { helper: "runtime_projection", started_at: generatedAt, finished_at: generatedAt, elapsed_ms: 0, budget_ms: 1_800, result_class: "SUCCESS" as const, reason: null },
        }))
      : null;
    const legacyRuntimePromise = freshnessContract
      ? null
      : (requestedIds.length ? runtimeWork() : Promise.resolve([] as Row[]));

    let manage: Awaited<ReturnType<typeof getManageData>>;
    let runtimeReason: ProfilesLiveReason | null = null;
    let runtimeProfiles: Row[] = [];
    if (freshnessContract) {
      const manageObserved = await freshnessManagePromise!;
      helperObservations.push(manageObserved.observation);
      const manageResult = manageObserved.envelope;
      timings.sharedCoreMs = roundedMs(performance.now() - sharedCoreStartedAt);
      if (manageResult.state !== "SUCCESS") {
        const unavailable = liveJsonOk({
          generated_at: generatedAt,
          projection_state: "UNAVAILABLE",
          schema_version: PROFILES_LIVE_SCHEMA_VERSION,
          contract: PROFILES_LIVE_CONTRACT,
          provider_degraded: true,
          freshness: {
            schema: "profiles_live_freshness_v1", policy: PROFILES_LIVE_POLICY,
            membership: { data_state: "UNKNOWN", observed_at: null, age_ms: null, source: "canonical_membership", revision: null, reason: manageResult.reason },
            profiles: {},
          },
        }, requestId, timings, startedAt, 503);
        const { known_field_families, unknown_field_families } = profilesLiveFieldFamilySummary("UNAVAILABLE", {}, "UNKNOWN");
        const degraded = degradedHelperTelemetry(requestId, helperObservations);
        logProfilesLiveTelemetry({ ...common, result: "unavailable", projection_state: "UNAVAILABLE", response_http_status: 503,
          known_field_families, unknown_field_families, degraded_helper_envelopes: degraded, first_degraded_helper: degraded[0]?.helper ?? null,
          first_degraded_reason: degraded[0]?.reason ?? null, phase_total_ms: unavailable.totalDurationMs });
        return unavailable.response;
      }
      manage = manageResult.value;
      const runtimeObserved = await freshnessRuntimePromise!;
      helperObservations.push(runtimeObserved.observation);
      const runtimeResult = runtimeObserved.envelope;
      timings.runtimeProjectionMs = roundedMs(performance.now() - runtimeStartedAt);
      if (runtimeResult.state === "SUCCESS") runtimeProfiles = runtimeResult.value;
      else runtimeReason = runtimeResult.reason;
    } else {
      manage = await legacyManagePromise!;
      timings.sharedCoreMs = roundedMs(performance.now() - sharedCoreStartedAt);
      runtimeProfiles = await legacyRuntimePromise!;
      timings.runtimeProjectionMs = roundedMs(performance.now() - runtimeStartedAt);
    }
    traceMetric("canonical_account_count", manage.allAccounts.length);
    const visibleBaseProfiles = selectCanonicalVisibleProfiles(manage.activeAccounts);

    const missingIds = missingRuntimeAccountIds(visibleBaseProfiles, runtimeProfiles);
    if (missingIds.length && !freshnessContract) {
      runtimeBatchCount += 1;
      const missingStartedAt = performance.now();
      const missingIdSet = new Set(missingIds);
      runtimeProfiles = [
        ...runtimeProfiles,
        ...await traceStep("runtime.missing", () => enrichAccountsWithRuntime(
          visibleBaseProfiles.filter((profile) => missingIdSet.has(profileAccountId(profile))),
          generatedAt,
        ), { account_count: missingIds.length }),
      ];
      timings.runtimeProjectionMs = roundedMs(timings.runtimeProjectionMs + performance.now() - missingStartedAt);
    }

    const fallbackProfiles = canonicalRuntimeFallbackProfiles(visibleBaseProfiles, runtimeProfiles);
    if (fallbackProfiles.length && !freshnessContract) {
      runtimeBatchCount += 1;
      const fallbackStartedAt = performance.now();
      runtimeProfiles = replaceRuntimeProfiles(
        runtimeProfiles,
        await traceStep("runtime.package_fallback", () => {
          traceFallback("package_summary_missing");
          return enrichAccountsWithRuntime(fallbackProfiles, generatedAt);
        }, { account_count: fallbackProfiles.length }),
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
    if (freshnessContract && !membership) {
      const unavailable = liveJsonOk({
        generated_at: generatedAt, projection_state: "UNAVAILABLE", schema_version: PROFILES_LIVE_SCHEMA_VERSION,
        contract: PROFILES_LIVE_CONTRACT, provider_degraded: true,
        freshness: { schema: "profiles_live_freshness_v1", policy: PROFILES_LIVE_POLICY,
          membership: { data_state: "UNKNOWN", observed_at: null, age_ms: null, source: "canonical_membership", revision: null, reason: "INCOMPLETE_READ" }, profiles: {} },
      }, requestId, timings, startedAt, 503);
      const { known_field_families, unknown_field_families } = profilesLiveFieldFamilySummary("UNAVAILABLE", {}, "UNKNOWN");
      logProfilesLiveTelemetry({ ...common, result: "unavailable", projection_state: "UNAVAILABLE", response_http_status: 503,
        known_field_families, unknown_field_families, degraded_helper_envelopes: [], first_degraded_helper: null, first_degraded_reason: "INCOMPLETE_READ",
        phase_total_ms: unavailable.totalDurationMs });
      return unavailable.response;
    }
    const profileIds = profiles.map(profileAccountId);
    const runtimeObservedAccountIds = new Set(runtimeProfiles.map(profileAccountId).filter(Boolean));
    const completeRuntimeCoverage = profileIds.every(accountId => runtimeObservedAccountIds.has(accountId));
    const projectionState = runtimeReason || !completeRuntimeCoverage ? "PARTIAL" : "COMPLETE";
    const profilesFreshness = freshnessContract
      ? buildProfilesFreshness(profiles, generatedAt, runtimeObservedAccountIds, runtimeReason)
      : {};
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
      ...(freshnessContract ? {
        contract: PROFILES_LIVE_CONTRACT,
        projection_state: projectionState,
        provider_degraded: Boolean(runtimeReason),
        freshness: {
          schema: "profiles_live_freshness_v1",
          policy: PROFILES_LIVE_POLICY,
          membership: { data_state: "FRESH", observed_at: generatedAt, age_ms: 0, source: "canonical_membership", revision: membership?.revision ?? null, reason: null },
          read_coverage: {
            shared_account_ids: [...profileIds].sort(),
            runtime_account_ids: [...runtimeObservedAccountIds].sort(),
          },
          profiles: profilesFreshness,
        },
      } : {}),
    };
    traceMetric("profile_count", profiles.length);
    traceMetric("runtime_batch_count", runtimeBatchCount);
    const built = liveJsonOk(data, requestId, timings, startedAt);
    traceMetric("response_bytes", built.responseSizeBytes);
    traceMetric("response_serialization_ms", timings.serializationMs);
    const { known_field_families, unknown_field_families } = profilesLiveFieldFamilySummary(projectionState, profilesFreshness, "FRESH");
    const degraded = degradedHelperTelemetry(requestId, helperObservations);
    logProfilesLiveTelemetry({
      ...common,
      result: freshnessContract ? projectionState.toLowerCase() : "success",
      account_count: profiles.length,
      response_http_status: 200,
      response_size_bytes: built.responseSizeBytes,
      projection_revision: generatedAt,
      ...(freshnessContract ? {
        projection_state: projectionState,
        known_field_families,
        unknown_field_families,
        degraded_helper_envelopes: degraded,
        first_degraded_helper: degraded[0]?.helper ?? null,
        first_degraded_reason: degraded[0]?.reason ?? null,
      } : {}),
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
  };
  if (!freshnessContract) return execute();
  try {
    return await withProfilesLiveResilience(request, execute);
  } catch (error) {
    if (!isProfilesLiveDeadlineError(error)) throw error;
    const unavailable = liveJsonOk({
      generated_at: generatedAt,
      projection_state: "UNAVAILABLE",
      schema_version: PROFILES_LIVE_SCHEMA_VERSION,
      contract: PROFILES_LIVE_CONTRACT,
      provider_degraded: true,
      freshness: {
        schema: "profiles_live_freshness_v1",
        policy: PROFILES_LIVE_POLICY,
        membership: { data_state: "UNKNOWN", observed_at: null, age_ms: null, source: "canonical_membership", revision: null, reason: "READ_DEADLINE" },
        read_coverage: { shared_account_ids: [], runtime_account_ids: [] },
        profiles: {},
      },
    }, requestId, timings, startedAt, 503);
    const { known_field_families, unknown_field_families } = profilesLiveFieldFamilySummary("UNAVAILABLE", {}, "UNKNOWN");
    const degraded = [{ request_id: requestId, helper: "global_read", started_at: generatedAt, finished_at: new Date().toISOString(),
      elapsed_ms: unavailable.totalDurationMs, budget_ms: 4_000, result_class: "DEADLINE", reason: "READ_DEADLINE" }];
    logProfilesLiveTelemetry({ ...common, result: "global_deadline", projection_state: "UNAVAILABLE", response_http_status: 503,
      known_field_families, unknown_field_families, degraded_helper_envelopes: degraded, first_degraded_helper: "global_read", first_degraded_reason: "READ_DEADLINE",
      phase_total_ms: unavailable.totalDurationMs });
    return unavailable.response;
  }
  });
}
