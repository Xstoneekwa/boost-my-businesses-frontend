import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { assessAvailability } from "./assessment-engine.ts";
import { projectAvailabilityCurrent } from "./current-projection.ts";
import {
  TARGET_AVAILABILITY_ENGINE_REVISION,
  TARGET_AVAILABILITY_ENGINE_VERSION,
  TARGET_AVAILABILITY_POLICY_REVISION,
  TARGET_AVAILABILITY_POLICY_VERSION,
  TARGET_AVAILABILITY_RULE_VERSION,
} from "./engine-policy.ts";
import type {
  AvailabilityCurrent,
  AvailabilityObservation,
  AvailabilityScope,
  AvailabilitySignal,
  IdentityCurrent,
} from "./engine-types.ts";
import { normalizeUsername } from "./engine-utils.ts";
import { resolveTargetIdentity } from "./identity-engine.ts";

type QueryResult<T = unknown> = Promise<{ data: T; error: { message?: string } | null }>;
type SupabaseLike = {
  from(table: string): any;
  rpc(name: string, args?: Record<string, unknown>): QueryResult<any>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_SCOPE_MODE = "all_active_accounts";
const MAX_REASON_CODES = 24;
const MAX_EVIDENCE_KEYS = 32;
const MAX_EVIDENCE_VALUE_LENGTH = 160;

export type TargetAvailabilityRuntimeCaps = Readonly<{
  observationsPerRun: number;
  observationsPerAccountDay: number;
  observationsGlobalDay: number;
  identityTransitionsPerRun: number;
  assessmentsPerRun: number;
  currentUpdatesPerRun: number;
  retries: number;
  pipelineDurationMs: number;
  batchSize: number;
  workerConcurrency: number;
  globalConcurrency: number;
}>;

export const DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS: TargetAvailabilityRuntimeCaps = Object.freeze({
  observationsPerRun: 40,
  observationsPerAccountDay: 240,
  observationsGlobalDay: 2_000,
  identityTransitionsPerRun: 20,
  assessmentsPerRun: 40,
  currentUpdatesPerRun: 40,
  retries: 1,
  pipelineDurationMs: 1_500,
  batchSize: 20,
  workerConcurrency: 1,
  globalConcurrency: 4,
});

export type TargetAvailabilityRuntimeState = Readonly<{
  captureEnabled: boolean;
  writerEnabled: boolean;
  identityProducerEnabled: boolean;
  assessmentProducerEnabled: boolean;
  currentProjectorEnabled: boolean;
  shadowEnabled: boolean;
  scopeMode: "off" | "explicit_allowlist" | "all_active_accounts";
  explicitAccountAllowlist: readonly string[];
  autoKilled: boolean;
  humanReenableRequired: boolean;
  caps: TargetAvailabilityRuntimeCaps;
}>;

export type RuntimeObservationRow = Readonly<Record<string, unknown> & {
  tenant_id: string;
  account_id: string;
  target_id: string;
  observed_at: string;
  searched_username: string;
  idempotency_key: string;
}>;

export type TargetAvailabilityBatchContext = Readonly<{
  workerId: string;
  workerRelease: string;
  batchKey: string;
  queueDepth: number;
}>;

export type TargetAvailabilityBatchResult = Readonly<{
  active: boolean;
  autoKilled: boolean;
  scopeMode: string;
  attempted: number;
  accepted: number;
  processed: number;
  rejected: number;
  deduplicated: number;
  capHits: number;
  errors: number;
  retries: number;
  crossTenant: number;
  outOfOrder: number;
  identityTransitions: number;
  assessments: number;
  currentUpdates: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
  reasons: readonly string[];
}>;

const asRows = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : [];

const integer = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
};

const boolean = (value: unknown) => value === true;
const text = (value: unknown) => String(value ?? "").trim();
const uuid = (value: unknown) => UUID_RE.test(text(value)) ? text(value).toLowerCase() : "";
const safeError = (value: unknown) => text(value instanceof Error ? value.message : value)
  .toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 160) || "target_availability_unknown_error";

const percentile = (values: readonly number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0).toFixed(3));
};

const metricKey = (...values: readonly unknown[]) => `target-availability-metric:${createHash("sha256")
  .update(JSON.stringify(values)).digest("hex")}`;

export function parseTargetAvailabilityRuntimeCaps(value: unknown): TargetAvailabilityRuntimeCaps {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.freeze({
    observationsPerRun: integer(row.observations_per_run, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.observationsPerRun, 1, 500),
    observationsPerAccountDay: integer(row.observations_per_account_day, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.observationsPerAccountDay, 1, 5_000),
    observationsGlobalDay: integer(row.observations_global_day, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.observationsGlobalDay, 1, 100_000),
    identityTransitionsPerRun: integer(row.identity_transitions_per_run, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.identityTransitionsPerRun, 1, 500),
    assessmentsPerRun: integer(row.assessments_per_run, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.assessmentsPerRun, 1, 500),
    currentUpdatesPerRun: integer(row.current_updates_per_run, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.currentUpdatesPerRun, 1, 500),
    retries: integer(row.retries, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.retries, 0, 3),
    pipelineDurationMs: integer(row.pipeline_duration_ms, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.pipelineDurationMs, 100, 10_000),
    batchSize: integer(row.batch_size, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.batchSize, 1, 100),
    workerConcurrency: integer(row.worker_concurrency, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.workerConcurrency, 1, 4),
    globalConcurrency: integer(row.global_concurrency, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.globalConcurrency, 1, 64),
  });
}

export function parseTargetAvailabilityRuntimeState(value: unknown): TargetAvailabilityRuntimeState {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawMode = text(row.scope_mode);
  const scopeMode = rawMode === "explicit_allowlist" || rawMode === ACTIVE_SCOPE_MODE ? rawMode : "off";
  const allowlist = Array.isArray(row.explicit_account_allowlist)
    ? [...new Set(row.explicit_account_allowlist.map(uuid).filter(Boolean))]
    : [];
  return Object.freeze({
    captureEnabled: boolean(row.capture_enabled),
    writerEnabled: boolean(row.writer_enabled),
    identityProducerEnabled: boolean(row.identity_producer_enabled),
    assessmentProducerEnabled: boolean(row.assessment_producer_enabled),
    currentProjectorEnabled: boolean(row.current_projector_enabled),
    shadowEnabled: boolean(row.shadow_enabled),
    scopeMode: scopeMode as TargetAvailabilityRuntimeState["scopeMode"],
    explicitAccountAllowlist: Object.freeze(allowlist),
    autoKilled: boolean(row.auto_killed),
    humanReenableRequired: boolean(row.human_reenable_required),
    caps: parseTargetAvailabilityRuntimeCaps(row.caps_safe),
  });
}

export function targetAvailabilityRuntimeActive(state: TargetAvailabilityRuntimeState) {
  return Boolean(
    !state.autoKilled && !state.humanReenableRequired
    && state.captureEnabled && state.writerEnabled && state.identityProducerEnabled
    && state.assessmentProducerEnabled && state.currentProjectorEnabled && state.shadowEnabled
    && state.scopeMode !== "off"
    && (state.scopeMode !== "explicit_allowlist" || state.explicitAccountAllowlist.length > 0)
  );
}

export function signalFromDatabaseObservation(row: Record<string, unknown>): AvailabilitySignal {
  const reasons = new Set(Array.isArray(row.reason_codes) ? row.reason_codes.map(text) : []);
  const expected = normalizeUsername(text(row.searched_username));
  const observed = normalizeUsername(text(row.observed_username));
  const stableId = text(row.observed_stable_platform_user_id);
  if (reasons.has("target_identity_conflict")) return "identity_conflict";
  if (observed && expected && observed !== expected) return stableId ? "username_changed" : "username_change_suspected";
  if (row.verified_badge === true && ["restricted", "terminally_limited"].includes(text(row.followers_surface))) {
    return "verified_followers_restricted";
  }
  if (row.profile_found === true || text(row.lookup_result) === "found") return "profile_available";
  if (row.profile_found === false || ["not_found", "unavailable"].includes(text(row.lookup_result))) return "profile_unavailable";
  if (text(row.network_state) === "unavailable") return "network_error";
  if (row.navigation_timeout === true) return "temporary_instagram_error";
  if (reasons.has("target_ui_ambiguity") || text(row.ui_evidence_quality) === "low") return "ui_inconsistency";
  return "insufficient_evidence";
}

export function databaseObservationToEngine(row: Record<string, unknown>): AvailabilityObservation {
  const scope = {
    tenantId: uuid(row.tenant_id), accountId: uuid(row.account_id), targetId: uuid(row.target_id),
  };
  const reasons = Array.isArray(row.reason_codes) ? row.reason_codes.map(text).filter(Boolean).slice(0, MAX_REASON_CODES) : [];
  return Object.freeze({
    ...scope,
    observationId: uuid(row.id),
    idempotencyKey: text(row.idempotency_key),
    signal: signalFromDatabaseObservation(row),
    observedAt: text(row.observed_at),
    source: ["worker", "provider", "operator", "synthetic"].includes(text(row.source)) ? text(row.source) as AvailabilityObservation["source"] : "worker",
    expectedUsername: normalizeUsername(text(row.searched_username)),
    observedUsername: normalizeUsername(text(row.observed_username)) || null,
    stablePlatformUserId: text(row.observed_stable_platform_user_id) || null,
    runId: uuid(row.source_run_id) || null,
    workerId: text(row.source_worker) || null,
    confidence: ["low", "medium", "high"].includes(text(row.ui_evidence_quality)) ? text(row.ui_evidence_quality) as "low" | "medium" | "high" : "unknown",
    verifiedBadge: typeof row.verified_badge === "boolean" ? row.verified_badge : null,
    followersSurface: ["normal", "restricted", "terminally_limited"].includes(text(row.followers_surface))
      ? text(row.followers_surface) as "normal" | "restricted" | "terminally_limited" : "unknown",
    networkHealthy: text(row.network_state) === "healthy" ? true : text(row.network_state) === "unavailable" ? false : null,
    sessionHealthy: text(row.session_state) === "healthy" ? true : ["restricted", "logged_out"].includes(text(row.session_state)) ? false : null,
    uiEvidenceQuality: ["low", "medium", "high"].includes(text(row.ui_evidence_quality)) ? text(row.ui_evidence_quality) as "low" | "medium" | "high" : "unknown",
    reasonCodes: Object.freeze(reasons),
  });
}

function sanitizeObservationRow(value: unknown): RuntimeObservationRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const tenantId = uuid(source.tenant_id);
  const accountId = uuid(source.account_id);
  const targetId = uuid(source.target_id);
  const username = normalizeUsername(text(source.searched_username));
  const observedAt = text(source.observed_at);
  const idempotencyKey = text(source.idempotency_key);
  if (!tenantId || !accountId || !targetId || !username || !Number.isFinite(Date.parse(observedAt)) || idempotencyKey.length < 8 || idempotencyKey.length > 200) return null;
  const evidenceSource = source.evidence_safe && typeof source.evidence_safe === "object" && !Array.isArray(source.evidence_safe)
    ? source.evidence_safe as Record<string, unknown> : {};
  const evidenceSafe = Object.fromEntries(Object.entries(evidenceSource).slice(0, MAX_EVIDENCE_KEYS).map(([key, item]) => [
    key.slice(0, 80), typeof item === "string" ? item.slice(0, MAX_EVIDENCE_VALUE_LENGTH) : typeof item === "number" || typeof item === "boolean" || item === null ? item : null,
  ]));
  const reasonCodes = Array.isArray(source.reason_codes) ? source.reason_codes.map(text).filter(Boolean).slice(0, MAX_REASON_CODES) : [];
  if (!reasonCodes.length) reasonCodes.push("target_availability_runtime_observation");
  return Object.freeze({
    tenant_id: tenantId, account_id: accountId, target_id: targetId, observed_at: observedAt,
    source: "worker", source_run_id: uuid(source.source_run_id) || null,
    source_worker: text(source.source_worker).slice(0, 120) || "phonefarm-worker",
    worker_version: text(source.worker_version).slice(0, 120) || null,
    source_device_key: text(source.source_device_key).slice(0, 120) || null,
    instagram_version: text(source.instagram_version).slice(0, 120) || null,
    searched_username: username, observed_username: normalizeUsername(text(source.observed_username)) || null,
    observed_stable_platform_user_id: text(source.observed_stable_platform_user_id).slice(0, 200) || null,
    lookup_result: ["found", "not_found", "unavailable", "failed", "unknown"].includes(text(source.lookup_result)) ? text(source.lookup_result) : "unknown",
    profile_found: typeof source.profile_found === "boolean" ? source.profile_found : null,
    verified_badge: typeof source.verified_badge === "boolean" ? source.verified_badge : null,
    followers_surface: ["normal", "restricted", "terminally_limited"].includes(text(source.followers_surface)) ? text(source.followers_surface) : "unknown",
    accessible_profiles_count: Number.isInteger(source.accessible_profiles_count) && Number(source.accessible_profiles_count) >= 0 ? Number(source.accessible_profiles_count) : null,
    terminal_end_detected: source.terminal_end_detected === true,
    repeated_first_profiles_detected: source.repeated_first_profiles_detected === true,
    retry_count: integer(source.retry_count, 0, 0, 100),
    retry_budget_exhausted: source.retry_budget_exhausted === true,
    navigation_timeout: source.navigation_timeout === true,
    recovery_outcome: ["not_attempted", "succeeded", "failed", "ambiguous"].includes(text(source.recovery_outcome)) ? text(source.recovery_outcome) : "not_attempted",
    ui_evidence_quality: ["unknown", "low", "medium", "high"].includes(text(source.ui_evidence_quality)) ? text(source.ui_evidence_quality) : "unknown",
    network_state: ["unknown", "healthy", "degraded", "unavailable"].includes(text(source.network_state)) ? text(source.network_state) : "unknown",
    session_state: ["unknown", "healthy", "restricted", "logged_out"].includes(text(source.session_state)) ? text(source.session_state) : "unknown",
    reason_codes: reasonCodes, idempotency_key: idempotencyKey, evidence_safe: evidenceSafe,
  } as RuntimeObservationRow);
}

function identityCurrentFromDatabase(scope: AvailabilityScope, row: Record<string, unknown> | null): IdentityCurrent | null {
  if (!row) return null;
  const domain = text(row.domain_identity_status);
  const identityStatus = ["identity_confirmed", "identity_probable", "username_change_suspected", "username_change_confirmed", "identity_conflict", "identity_ambiguous", "stable_id_missing", "stale_identity", "insufficient_identity_evidence"].includes(domain)
    ? domain as IdentityCurrent["identityStatus"] : "insufficient_identity_evidence";
  return Object.freeze({
    ...scope,
    canonicalUsername: normalizeUsername(text(row.current_username)),
    observedUsername: normalizeUsername(text(row.observed_username)) || null,
    stablePlatformUserId: text(row.stable_platform_user_id) || null,
    identityStatus,
    confidence: ["unknown", "low", "medium", "high"].includes(text(row.confidence)) ? text(row.confidence) as IdentityCurrent["confidence"] : "unknown",
    evidenceCount: integer(row.evidence_count, 0, 0, 10_000),
    firstSeenAt: text(row.first_seen_at) || null,
    lastSeenAt: text(row.last_seen_at || row.last_observed_at) || null,
    lastConfirmedAt: text(row.last_confirmed_at) || null,
    staleAfter: text(row.stale_after) || null,
    sourceVersion: text(row.source_version),
    lastTransitionId: uuid(row.last_history_id) || null,
    updatedAt: text(row.updated_at),
  });
}

function availabilityCurrentFromDatabase(scope: AvailabilityScope, row: Record<string, unknown> | null): AvailabilityCurrent | null {
  if (!row || !text(row.availability_status) || !uuid(row.assessment_id)) return null;
  return Object.freeze({
    ...scope,
    availabilityStatus: text(row.availability_status) as AvailabilityCurrent["availabilityStatus"],
    confidence: text(row.confidence) as AvailabilityCurrent["confidence"],
    identityStatus: text(row.identity_status) as AvailabilityCurrent["identityStatus"],
    latestAssessmentId: uuid(row.assessment_id),
    latestObservationAt: text(row.latest_observation_at) || null,
    confirmedAt: text(row.confirmed_at) || null,
    validUntil: text(row.valid_until),
    staleAfter: text(row.stale_after),
    reasonCodes: Object.freeze(Array.isArray(row.reason_codes) ? row.reason_codes.map(text).filter(Boolean) : []),
    engineVersion: text(row.engine_version),
    policyVersion: text(row.policy_version),
    engineRevision: integer(row.engine_revision, 1, 1, 1_000),
    policyRevision: integer(row.policy_revision, 1, 1, 1_000),
    updatedAt: text(row.updated_at),
  });
}

const errorMessage = (error: { message?: string } | null, fallback: string) => error?.message || fallback;

async function triggerAutoKill(supabase: SupabaseLike, reason: string, metrics: Record<string, unknown>) {
  await supabase.rpc("trigger_target_availability_auto_kill_v1", {
    p_reason: reason, p_source_component: "backend_runtime_pipeline", p_metrics_safe: metrics,
  });
}

async function activeScope(supabase: SupabaseLike, state: TargetAvailabilityRuntimeState, row: RuntimeObservationRow) {
  if (state.scopeMode === "explicit_allowlist" && !state.explicitAccountAllowlist.includes(row.account_id)) return "outside_explicit_allowlist";
  const ownership = await supabase.from("client_instagram_accounts")
    .select("client_id,account_id,active,onboarding_status,provisioning_status,login_status")
    .eq("account_id", row.account_id).eq("active", true).limit(2);
  if (ownership.error) throw new Error(errorMessage(ownership.error, "target_availability_ownership_read_failed"));
  const links = asRows(ownership.data);
  if (links.some((link) => uuid(link.client_id) !== row.tenant_id)) return "cross_tenant";
  const link = links.find((candidate) => uuid(candidate.client_id) === row.tenant_id);
  if (!link || text(link.onboarding_status) !== "ready" || text(link.provisioning_status) !== "ready" || text(link.login_status) !== "connected") return "account_not_technically_exploitable";
  const account = await supabase.from("ig_accounts").select("id,archived_at,trashed_at,admin_lifecycle_status")
    .eq("id", row.account_id).maybeSingle();
  if (account.error) throw new Error(errorMessage(account.error, "target_availability_account_read_failed"));
  const accountRow = account.data as Record<string, unknown> | null;
  if (!accountRow || accountRow.archived_at || accountRow.trashed_at || !["", "active"].includes(text(accountRow.admin_lifecycle_status))) return "account_not_active";
  const target = await supabase.from("ig_targets").select("id,account_id,archived_at,deleted_at")
    .eq("id", row.target_id).eq("account_id", row.account_id).maybeSingle();
  if (target.error) throw new Error(errorMessage(target.error, "target_availability_target_read_failed"));
  const targetRow = target.data as Record<string, unknown> | null;
  if (!targetRow || targetRow.archived_at || targetRow.deleted_at) return "target_not_active";
  return "active";
}

async function readRuntimeState(supabase: SupabaseLike) {
  const result = await supabase.from("ct_target_availability_runtime_state").select("*").eq("id", "global").maybeSingle();
  if (result.error) throw new Error(errorMessage(result.error, "target_availability_runtime_state_unavailable"));
  return parseTargetAvailabilityRuntimeState(result.data);
}

async function upsertObservation(supabase: SupabaseLike, row: RuntimeObservationRow) {
  const inserted = await supabase.from("ct_target_availability_observations")
    .upsert(row, { onConflict: "tenant_id,account_id,idempotency_key", ignoreDuplicates: true })
    .select("*").maybeSingle();
  if (inserted.error) throw new Error(errorMessage(inserted.error, "target_availability_observation_insert_failed"));
  if (inserted.data) return { row: inserted.data as Record<string, unknown>, deduplicated: false };
  const found = await supabase.from("ct_target_availability_observations").select("*")
    .eq("tenant_id", row.tenant_id).eq("account_id", row.account_id).eq("idempotency_key", row.idempotency_key).maybeSingle();
  if (found.error || !found.data) throw new Error(errorMessage(found.error, "target_availability_observation_dedup_read_failed"));
  return { row: found.data as Record<string, unknown>, deduplicated: true };
}

async function processObservation(
  supabase: SupabaseLike,
  state: TargetAvailabilityRuntimeState,
  row: RuntimeObservationRow,
  context: TargetAvailabilityBatchContext,
) {
  const itemStart = performance.now();
  const cpuStart = process.cpuUsage();
  const memoryBefore = process.memoryUsage().rss;
  const scopeReason = await activeScope(supabase, state, row);
  if (scopeReason !== "active") return { outcome: "rejected", reason: scopeReason, latencyMs: performance.now() - itemStart } as const;
  const capacity = await supabase.rpc("claim_target_availability_observation_capacity_v1", {
    p_account_id: row.account_id,
    p_run_id: row.source_run_id,
    p_global_limit: state.caps.observationsGlobalDay,
    p_account_limit: state.caps.observationsPerAccountDay,
    p_run_limit: state.caps.observationsPerRun,
  });
  if (capacity.error) throw new Error(errorMessage(capacity.error, "target_availability_capacity_claim_failed"));
  if (capacity.data !== true) return { outcome: "cap_hit", reason: "observation_capacity_reached", latencyMs: performance.now() - itemStart } as const;

  const persistedObservation = await upsertObservation(supabase, row);
  const observation = persistedObservation.row;
  const scope: AvailabilityScope = Object.freeze({ tenantId: row.tenant_id, accountId: row.account_id, targetId: row.target_id });
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const historyResult = await supabase.from("ct_target_availability_observations").select("*")
    .eq("tenant_id", row.tenant_id).eq("account_id", row.account_id).eq("target_id", row.target_id)
    .gte("observed_at", since).order("observed_at", { ascending: true }).limit(200);
  if (historyResult.error) throw new Error(errorMessage(historyResult.error, "target_availability_history_read_failed"));
  const observations = asRows(historyResult.data).map(databaseObservationToEngine);
  const identityResult = await supabase.from("ct_target_identity_current").select("*")
    .eq("tenant_id", row.tenant_id).eq("account_id", row.account_id).eq("target_id", row.target_id).maybeSingle();
  if (identityResult.error) throw new Error(errorMessage(identityResult.error, "target_availability_identity_current_read_failed"));
  const calculatedAt = new Date().toISOString();
  const identity = resolveTargetIdentity({
    scope,
    expectedUsername: row.searched_username,
    stablePlatformUserId: text(row.observed_stable_platform_user_id) || null,
    previousCurrent: identityCurrentFromDatabase(scope, identityResult.data as Record<string, unknown> | null),
    observations,
    calculatedAt,
  });
  const assessed = assessAvailability({ scope, identity: identity.current, observations, assessedAt: calculatedAt });
  const currentResult = await supabase.from("ct_target_availability_current").select("*")
    .eq("tenant_id", row.tenant_id).eq("account_id", row.account_id).eq("target_id", row.target_id).maybeSingle();
  if (currentResult.error) throw new Error(errorMessage(currentResult.error, "target_availability_current_read_failed"));
  const projected = projectAvailabilityCurrent({
    scope,
    previous: availabilityCurrentFromDatabase(scope, currentResult.data as Record<string, unknown> | null),
    assessment: assessed.assessment,
  });
  if (projected.outcome === "rejected_scope" || projected.outcome === "skipped_version_regression" || !projected.current) {
    throw new Error(projected.outcome === "skipped_version_regression" ? "target_availability_version_regression" : "target_availability_projection_invariant_violation");
  }
  const transitionCount = identity.history.length;
  const assessmentCount = 1;
  const currentUpdateCount = ["inserted", "updated"].includes(projected.outcome) ? 1 : 0;
  const projectionCapacity = await supabase.rpc("claim_target_availability_projection_capacity_v1", {
    p_account_id: row.account_id,
    p_run_id: row.source_run_id,
    p_identity_count: transitionCount,
    p_assessment_count: assessmentCount,
    p_current_count: currentUpdateCount,
    p_identity_run_limit: state.caps.identityTransitionsPerRun,
    p_assessment_run_limit: state.caps.assessmentsPerRun,
    p_current_run_limit: state.caps.currentUpdatesPerRun,
  });
  if (projectionCapacity.error) throw new Error(errorMessage(projectionCapacity.error, "target_availability_projection_capacity_claim_failed"));
  if (projectionCapacity.data !== true) {
    return { outcome: "cap_hit", reason: "projection_capacity_reached", latencyMs: performance.now() - itemStart } as const;
  }
  const memoryAfter = process.memoryUsage().rss;
  const cpu = process.cpuUsage(cpuStart);
  const latencyMs = performance.now() - itemStart;
  const bundle = {
    transition: identity.history.at(-1) ?? null,
    identity: identity.current,
    assessment: assessed.assessment,
    current: projected.current,
    metric: {
      metricKey: metricKey(uuid(observation.id), TARGET_AVAILABILITY_ENGINE_VERSION),
      component: "pipeline",
      scopeMode: state.scopeMode,
      countersSafe: {
        observations_attempted: 1,
        observations_accepted: 1,
        observations_deduplicated: persistedObservation.deduplicated ? 1 : 0,
        identity_transitions: transitionCount,
        identity_conflicts: identity.current.identityStatus === "identity_conflict" ? 1 : 0,
        assessments_created: 1,
        assessments_rejected: assessed.rejectedObservationIds.length,
        current_updates: currentUpdateCount,
        stale_events_skipped: projected.outcome === "skipped_stale_event" ? 1 : 0,
        retries: integer(row.retry_count, 0, 0, 100),
        db_errors: 0,
        cross_tenant_attempts: 0,
      },
      latencyMs,
      cpuMs: Number(((cpu.user + cpu.system) / 1_000).toFixed(3)),
      memoryBeforeBytes: memoryBefore,
      memoryPeakBytes: Math.max(memoryBefore, memoryAfter),
      memoryAfterBytes: memoryAfter,
      retainedPayloadCount: 0,
      queueDepth: Math.max(0, Math.min(context.queueDepth, 2_000)),
    },
  };
  const persisted = await supabase.rpc("persist_target_availability_pipeline_v1", {
    p_observation_id: uuid(observation.id), p_bundle: bundle, p_processor_release: context.workerRelease,
  });
  if (persisted.error) throw new Error(errorMessage(persisted.error, "target_availability_pipeline_persist_failed"));
  if (text(persisted.data?.outcome) === "failed") {
    throw new Error(`target_availability_pipeline_persist_failed:${safeError(persisted.data?.error_code)}`);
  }
  return {
    outcome: text(persisted.data?.outcome) === "deduplicated" ? "deduplicated" : "processed",
    reason: "ok",
    latencyMs,
    identityTransitions: transitionCount,
    assessments: assessmentCount,
    currentUpdates: currentUpdateCount,
  } as const;
}

async function recordBatchMetric(
  supabase: SupabaseLike,
  state: TargetAvailabilityRuntimeState,
  context: TargetAvailabilityBatchContext,
  rows: readonly (RuntimeObservationRow | null)[],
  counters: Record<string, number>,
  latencies: readonly number[],
  cpuMs: number,
  memoryBefore: number,
  memoryAfter: number,
) {
  const first = rows.find((row): row is RuntimeObservationRow => row !== null);
  const result = await supabase.from("ct_target_availability_pipeline_metrics").upsert({
    metric_key: metricKey("batch", context.batchKey, context.workerRelease),
    tenant_id: first?.tenant_id ?? null,
    account_id: first?.account_id ?? null,
    run_id: uuid(first?.source_run_id) || null,
    component: "pipeline",
    scope_mode: state.scopeMode,
    counters_safe: counters,
    latency_ms: percentile(latencies, 0.95),
    cpu_ms: Number(cpuMs.toFixed(3)),
    memory_before_bytes: memoryBefore,
    memory_peak_bytes: Math.max(memoryBefore, memoryAfter),
    memory_after_bytes: memoryAfter,
    retained_payload_count: 0,
    queue_depth: Math.max(0, Math.min(context.queueDepth, 2_000)),
  }, { onConflict: "metric_key", ignoreDuplicates: true });
  if (result.error) throw new Error(errorMessage(result.error, "target_availability_batch_metric_persist_failed"));
}

export async function processTargetAvailabilityBatch(
  supabase: SupabaseLike,
  values: unknown,
  context: TargetAvailabilityBatchContext,
): Promise<TargetAvailabilityBatchResult> {
  const batchCpuStart = process.cpuUsage();
  const batchMemoryBefore = process.memoryUsage().rss;
  const state = await readRuntimeState(supabase);
  const reasons: string[] = [];
  if (!targetAvailabilityRuntimeActive(state)) {
    return Object.freeze({
      active: false, autoKilled: state.autoKilled, scopeMode: state.scopeMode,
      attempted: 0, accepted: 0, processed: 0, rejected: 0, deduplicated: 0, capHits: 0,
      errors: 0, retries: 0, crossTenant: 0, outOfOrder: 0, identityTransitions: 0,
      assessments: 0, currentUpdates: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyMaxMs: 0,
      reasons: Object.freeze([state.autoKilled ? "global_auto_kill_active" : "global_shadow_inactive"]),
    });
  }
  const sourceRows = Array.isArray(values) ? values.slice(0, state.caps.batchSize) : [];
  const rows = sourceRows.map(sanitizeObservationRow);
  const invalidCount = rows.filter((row) => row === null).length;
  const batchKey = text(context.batchKey).slice(0, 200);
  const lease = await supabase.rpc("claim_target_availability_pipeline_lease_v1", {
    p_worker_id: text(context.workerId).slice(0, 120), p_batch_key: batchKey,
    p_global_limit: state.caps.globalConcurrency, p_ttl_seconds: Math.min(300, Math.max(5, Math.ceil(state.caps.pipelineDurationMs / 1000) * state.caps.batchSize)),
  });
  if (lease.error) throw new Error(errorMessage(lease.error, "target_availability_pipeline_lease_failed"));
  const leaseId = uuid(lease.data);
  if (!leaseId) {
    return Object.freeze({
      active: true, autoKilled: false, scopeMode: state.scopeMode, attempted: sourceRows.length,
      accepted: 0, processed: 0, rejected: invalidCount, deduplicated: 0, capHits: sourceRows.length - invalidCount,
      errors: 0, retries: 0, crossTenant: 0, outOfOrder: 0, identityTransitions: 0, assessments: 0,
      currentUpdates: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyMaxMs: 0,
      reasons: Object.freeze(["global_concurrency_cap_reached"]),
    });
  }
  let accepted = 0, processed = 0, rejected = invalidCount, deduplicated = 0, capHits = 0, errors = 0;
  let retries = 0, crossTenant = 0, outOfOrder = 0, identityTransitions = 0, assessments = 0, currentUpdates = 0;
  const latencies: number[] = [];
  if (invalidCount) reasons.push("partial_or_invalid_observation");
  try {
    for (const row of rows) {
      if (!row) continue;
      accepted += 1;
      try {
        let result;
        for (let attempt = 0; ; attempt += 1) {
          try {
            result = await processObservation(supabase, state, row, context);
            break;
          } catch (error) {
            const retryReason = safeError(error);
            const transient = /(?:read_failed|insert_failed|persist_failed|capacity_claim_failed|dedup_read_failed)/.test(retryReason);
            if (!transient || attempt >= state.caps.retries) throw error;
            retries += 1;
          }
        }
        latencies.push(result.latencyMs);
        if (result.outcome === "rejected") {
          rejected += 1;
          reasons.push(result.reason);
          if (result.reason === "cross_tenant") crossTenant += 1;
        } else if (result.outcome === "cap_hit") {
          capHits += 1;
          reasons.push(result.reason);
        } else {
          processed += 1;
          if (result.outcome === "deduplicated") deduplicated += 1;
          identityTransitions += result.identityTransitions;
          assessments += result.assessments;
          currentUpdates += result.currentUpdates;
        }
      } catch (error) {
        errors += 1;
        const reason = safeError(error);
        reasons.push(reason);
        if (reason.includes("version_regression") || reason.includes("older_event")) outOfOrder += 1;
        if (reason.includes("cross_tenant") || reason.includes("scope_mismatch")) crossTenant += 1;
      }
    }
    const latencyMax = latencies.length ? Math.max(...latencies) : 0;
    const criticalReason = crossTenant > 0 ? "cross_tenant_attempt_confirmed"
      : outOfOrder > 0 ? "projection_version_divergence"
      : invalidCount >= 3 ? "abnormal_partial_row_volume"
      : sourceRows.length >= 10 && deduplicated / Math.max(1, sourceRows.length) >= 0.8 ? "uncontrolled_duplicate_ratio"
      : errors >= 3 ? "critical_pipeline_error_rate"
      : latencyMax > state.caps.pipelineDurationMs * 3 ? "critical_pipeline_latency"
      : "";
    if (criticalReason) {
      await triggerAutoKill(supabase, criticalReason, {
        attempted: sourceRows.length, errors, cross_tenant: crossTenant, out_of_order: outOfOrder,
        duplicates: deduplicated, invalid_rows: invalidCount, latency_max_ms: Number(latencyMax.toFixed(3)),
      });
      reasons.push(criticalReason);
    }
    const batchCpu = process.cpuUsage(batchCpuStart);
    const batchMemoryAfter = process.memoryUsage().rss;
    await recordBatchMetric(
      supabase,
      state,
      context,
      rows,
      {
        observations_attempted: sourceRows.length,
        observations_accepted: accepted,
        observations_processed: processed,
        observations_rejected: rejected,
        observations_deduplicated: deduplicated,
        cap_hits: capHits,
        identity_transitions: identityTransitions,
        assessments_created: assessments,
        current_updates: currentUpdates,
        retries,
        db_errors: errors,
        cross_tenant_attempts: crossTenant,
        out_of_order_events: outOfOrder,
      },
      latencies,
      (batchCpu.user + batchCpu.system) / 1_000,
      batchMemoryBefore,
      batchMemoryAfter,
    );
    return Object.freeze({
      active: !criticalReason,
      autoKilled: Boolean(criticalReason),
      scopeMode: state.scopeMode,
      attempted: sourceRows.length,
      accepted,
      processed,
      rejected,
      deduplicated,
      capHits,
      errors,
      retries,
      crossTenant,
      outOfOrder,
      identityTransitions,
      assessments,
      currentUpdates,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
      latencyMaxMs: Number(latencyMax.toFixed(3)),
      reasons: Object.freeze([...new Set(reasons)].slice(0, 32)),
    });
  } finally {
    await supabase.rpc("release_target_availability_pipeline_lease_v1", { p_lease_id: leaseId });
  }
}

export const TARGET_AVAILABILITY_RUNTIME_VERSIONS = Object.freeze({
  engineVersion: TARGET_AVAILABILITY_ENGINE_VERSION,
  ruleVersion: TARGET_AVAILABILITY_RULE_VERSION,
  policyVersion: TARGET_AVAILABILITY_POLICY_VERSION,
  engineRevision: TARGET_AVAILABILITY_ENGINE_REVISION,
  policyRevision: TARGET_AVAILABILITY_POLICY_REVISION,
});
