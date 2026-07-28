import { assessTargetAvailability } from "./availability.ts";
import type {
  TargetAvailabilityAssessment,
  TargetAvailabilityEvidence,
  TargetAvailabilityReason,
  TargetFollowersSurfaceState,
  TargetLifecycleScope,
  TargetLookupResult,
} from "./types.ts";

export type WorkerTargetAvailabilityObservation = Readonly<{
  schema_version: "target-availability-observation-v1";
  observation_id: string;
  idempotency_key: string;
  event_key: string;
  observed_at: string;
  tenant_id: string;
  account_id: string;
  target_id: string;
  searched_username: string;
  observed_username: string | null;
  observed_stable_platform_user_id: string | null;
  run_id: string | null;
  device_key: string | null;
  worker_version: string | null;
  instagram_version: string | null;
  lookup_result: TargetLookupResult;
  profile_found: boolean | null;
  verified_badge: boolean | null;
  followers_surface: TargetFollowersSurfaceState;
  accessible_profiles_count: number | null;
  terminal_end_detected: boolean;
  repeated_first_profiles_detected: boolean;
  retry_count: number;
  retry_budget_exhausted: boolean;
  navigation_timeout: boolean;
  recovery_outcome: "not_attempted" | "succeeded" | "failed" | "ambiguous";
  ui_evidence_quality: "unknown" | "low" | "medium" | "high";
  network_state: "unknown" | "healthy" | "degraded" | "unavailable";
  session_state: "unknown" | "healthy" | "restricted" | "logged_out";
  reason_codes: readonly string[];
  evidence_safe: Readonly<Record<string, unknown>>;
}>;

export type TargetAvailabilityLocalShadowReport = Readonly<{
  mode: "local_shadow";
  mutationExecuted: false;
  acceptedObservationCount: number;
  duplicateObservationCount: number;
  assessment: TargetAvailabilityAssessment;
}>;

const normalizeUsername = (value: string) => value.trim().replace(/^@+/, "").toLowerCase();

function triState(value: "unknown" | "healthy" | "degraded" | "unavailable") {
  if (value === "healthy") return true;
  if (value === "degraded" || value === "unavailable") return false;
  return null;
}

function sessionHealthy(value: "unknown" | "healthy" | "restricted" | "logged_out") {
  if (value === "healthy") return true;
  if (value === "restricted" || value === "logged_out") return false;
  return null;
}

function assertObservationScope(
  scope: TargetLifecycleScope,
  observation: WorkerTargetAvailabilityObservation,
) {
  if (observation.schema_version !== "target-availability-observation-v1") {
    throw new Error("availability_shadow_schema_version_mismatch");
  }
  if (observation.tenant_id !== scope.tenantId
    || observation.account_id !== scope.accountId
    || observation.target_id !== scope.targetId) {
    throw new Error("availability_shadow_scope_mismatch");
  }
  if (normalizeUsername(observation.searched_username) !== normalizeUsername(scope.normalizedUsername)) {
    throw new Error("availability_shadow_username_scope_mismatch");
  }
}

function toEvidence(observation: WorkerTargetAvailabilityObservation): TargetAvailabilityEvidence {
  return Object.freeze({
    evidenceId: observation.observation_id,
    observedAt: observation.observed_at,
    source: "worker",
    runId: observation.run_id,
    deviceId: observation.device_key,
    searchedUsername: observation.searched_username,
    observedUsername: observation.observed_username,
    observedStablePlatformUserId: observation.observed_stable_platform_user_id,
    lookupResult: observation.lookup_result,
    profileFound: observation.profile_found,
    verifiedBadge: observation.verified_badge,
    followersSurface: observation.followers_surface,
    accessibleProfilesCount: observation.accessible_profiles_count,
    terminalEndDetected: observation.terminal_end_detected,
    repeatedProfilesDetected: observation.repeated_first_profiles_detected,
    networkHealthy: triState(observation.network_state),
    sessionHealthy: sessionHealthy(observation.session_state),
    uiEvidenceQuality: observation.ui_evidence_quality,
    instagramVersion: observation.instagram_version,
    workerVersion: observation.worker_version,
  });
}

export function runTargetAvailabilityLocalShadow(input: Readonly<{
  scope: TargetLifecycleScope;
  stablePlatformUserId?: string | null;
  observations: readonly WorkerTargetAvailabilityObservation[];
  calculatedAt: string;
}>): TargetAvailabilityLocalShadowReport {
  const unique = new Map<string, WorkerTargetAvailabilityObservation>();
  for (const observation of input.observations) {
    assertObservationScope(input.scope, observation);
    const previous = unique.get(observation.idempotency_key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(observation)) {
      throw new Error("availability_shadow_idempotency_conflict");
    }
    unique.set(observation.idempotency_key, observation);
  }
  const observations = [...unique.values()];
  const assessment = assessTargetAvailability({
    ...input.scope,
    stablePlatformUserId: input.stablePlatformUserId,
    evidence: observations.map(toEvidence),
    calculatedAt: input.calculatedAt,
  });
  return Object.freeze({
    mode: "local_shadow",
    mutationExecuted: false,
    acceptedObservationCount: observations.length,
    duplicateObservationCount: input.observations.length - observations.length,
    assessment,
  });
}

export const WORKER_AVAILABILITY_REASON_CODES: ReadonlySet<TargetAvailabilityReason | string> = new Set([
  "target_username_lookup_started",
  "target_profile_found",
  "target_profile_not_found",
  "target_stable_identity_observed",
  "target_verified_status_detected",
  "target_followers_surface_normal",
  "target_followers_entry_failed",
  "target_followers_surface_restricted",
  "target_followers_surface_terminally_limited",
  "target_repeated_first_profiles_detected",
  "target_navigation_retry_budget_exhausted",
  "target_navigation_timeout",
  "target_recovery_succeeded",
  "target_recovery_failed",
  "target_ui_ambiguity",
  "target_network_ambiguity",
]);
