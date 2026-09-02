import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { assessTargetLifecycleGlobalShadow } from "./global-shadow-engine.ts";
import { assessTargetUtilizationShadow } from "./utilization-shadow.ts";

type QueryResult<T = unknown> = Promise<{ data: T; error: { message?: string } | null }>;
type SupabaseTableQuery = {
  select(columns?: string): SupabaseTableQuery;
  eq(column: string, value: unknown): SupabaseTableQuery;
  maybeSingle(): QueryResult<unknown>;
};
type SupabaseLike = {
  from(table: string): SupabaseTableQuery;
  rpc(name: string, args?: Record<string, unknown>): QueryResult<unknown>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_SCOPE_MODE = "all_active_accounts";

export type TargetLifecycleRuntimeCaps = Readonly<{
  batchSize: number;
  retries: number;
  pipelineDurationMs: number;
  assessmentsGlobalDay: number;
  assessmentsAccountDay: number;
  globalConcurrency: number;
}>;

export const DEFAULT_TARGET_LIFECYCLE_RUNTIME_CAPS: TargetLifecycleRuntimeCaps = Object.freeze({
  batchSize: 25,
  retries: 1,
  pipelineDurationMs: 3_000,
  assessmentsGlobalDay: 1_000,
  assessmentsAccountDay: 250,
  globalConcurrency: 1,
});

export type TargetLifecycleRuntimeState = Readonly<{
  producerEnabled: boolean;
  currentProjectorEnabled: boolean;
  shadowEnabled: boolean;
  scopeMode: "off" | "all_active_accounts";
  autoKilled: boolean;
  humanReenableRequired: boolean;
  configVersion: number;
  cursorTargetId: string | null;
  caps: TargetLifecycleRuntimeCaps;
  businessActionsDisabled: boolean;
}>;

export type TargetLifecycleBatchResult = Readonly<{
  active: boolean;
  autoKilled: boolean;
  attempted: number;
  processed: number;
  deduplicated: number;
  outOfOrderSkipped: number;
  versionRegressionSkipped: number;
  rejected: number;
  errors: number;
  retries: number;
  crossTenant: number;
  capHits: number;
  wrapped: boolean;
  nextCursor: string | null;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
  reasons: readonly string[];
}>;

type WorkRow = Readonly<{
  tenantId: string;
  accountId: string;
  targetId: string;
  normalizedUsername: string;
  targetUpdatedAt: string;
  followersCount: number | null;
  denominatorObservedAt: string | null;
  follows: number;
  followbacks: number;
  performanceSkips: number;
  performanceErrors: number;
  followbackRatio: number | null;
  metricsObservedAt: string | null;
  performanceReliableAt: string | null;
  performanceEventObservedAt: string | null;
  uniqueProfilesEvaluated: number;
  lastEvaluatedAt: string | null;
  terminalProof: boolean;
  availabilityAssessmentId: string | null;
  availabilityStatus: string | null;
  availabilityConfidence: "unknown" | "low" | "medium" | "high";
  availabilityIdentityStatus: string | null;
  availabilityLatestObservationAt: string | null;
  availabilityValidUntil: string | null;
  availabilityReasons: readonly string[];
  identityStatus: string | null;
  lifecycleStatus: string | null;
}>;

const text = (value: unknown) => String(value ?? "").trim();
const boolean = (value: unknown) => value === true;
const uuid = (value: unknown) => UUID_RE.test(text(value)) ? text(value).toLowerCase() : "";
const finiteInteger = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};
const finiteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const validTimestamp = (value: unknown) => Number.isFinite(Date.parse(text(value))) ? text(value) : null;
const latestTimestamp = (...values: readonly (string | null)[]) => values
  .filter((value): value is string => value !== null)
  .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
const integer = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
};
const safeError = (value: unknown) => text(value instanceof Error ? value.message : value)
  .toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 160) || "target_lifecycle_unknown_error";
const hash = (...values: readonly unknown[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");
const percentile = (values: readonly number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0).toFixed(3));
};

export function parseTargetLifecycleRuntimeCaps(value: unknown): TargetLifecycleRuntimeCaps {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.freeze({
    batchSize: integer(row.batch_size, DEFAULT_TARGET_LIFECYCLE_RUNTIME_CAPS.batchSize, 1, 100),
    retries: integer(row.retries, DEFAULT_TARGET_LIFECYCLE_RUNTIME_CAPS.retries, 0, 3),
    pipelineDurationMs: integer(row.pipeline_duration_ms, DEFAULT_TARGET_LIFECYCLE_RUNTIME_CAPS.pipelineDurationMs, 250, 30_000),
    assessmentsGlobalDay: integer(row.assessments_global_day, DEFAULT_TARGET_LIFECYCLE_RUNTIME_CAPS.assessmentsGlobalDay, 1, 100_000),
    assessmentsAccountDay: integer(row.assessments_account_day, DEFAULT_TARGET_LIFECYCLE_RUNTIME_CAPS.assessmentsAccountDay, 1, 10_000),
    globalConcurrency: integer(row.global_concurrency, DEFAULT_TARGET_LIFECYCLE_RUNTIME_CAPS.globalConcurrency, 1, 8),
  });
}

export function parseTargetLifecycleRuntimeState(value: unknown): TargetLifecycleRuntimeState {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const scopeMode = text(row.scope_mode) === ACTIVE_SCOPE_MODE ? ACTIVE_SCOPE_MODE : "off";
  const businessActionsDisabled = [
    row.enforce_enabled,
    row.business_actions_enabled,
    row.lifecycle_actions_enabled,
    row.replacement_enabled,
    row.notifications_enabled,
    row.archiving_enabled,
    row.premium_replacement_enabled,
  ].every((value) => value === false || value == null);
  return Object.freeze({
    producerEnabled: boolean(row.producer_enabled),
    currentProjectorEnabled: boolean(row.current_projector_enabled),
    shadowEnabled: boolean(row.shadow_enabled),
    scopeMode,
    autoKilled: boolean(row.auto_killed),
    humanReenableRequired: boolean(row.human_reenable_required),
    configVersion: integer(row.config_version, 0, 0, Number.MAX_SAFE_INTEGER),
    cursorTargetId: uuid(row.cursor_target_id) || null,
    caps: parseTargetLifecycleRuntimeCaps(row.caps_safe),
    businessActionsDisabled,
  });
}

export function targetLifecycleRuntimeActive(state: TargetLifecycleRuntimeState) {
  return Boolean(
    state.producerEnabled && state.currentProjectorEnabled && state.shadowEnabled
    && state.scopeMode === ACTIVE_SCOPE_MODE && !state.autoKilled && !state.humanReenableRequired
    && state.businessActionsDisabled,
  );
}

function sanitizeWorkRow(value: unknown): WorkRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const tenantId = uuid(row.tenant_id);
  const accountId = uuid(row.account_id);
  const targetId = uuid(row.target_id);
  const normalizedUsername = text(row.normalized_username).replace(/^@+/, "").toLowerCase();
  const targetUpdatedAt = validTimestamp(row.target_updated_at);
  if (!tenantId || !accountId || !targetId || !normalizedUsername || !targetUpdatedAt) return null;
  const rawConfidence = text(row.availability_confidence);
  return Object.freeze({
    tenantId,
    accountId,
    targetId,
    normalizedUsername,
    targetUpdatedAt,
    followersCount: finiteNumber(row.followers_count),
    denominatorObservedAt: validTimestamp(row.denominator_observed_at),
    follows: finiteInteger(row.follows_sent_count),
    followbacks: finiteInteger(row.followbacks_count),
    performanceSkips: finiteInteger(row.performance_skips),
    performanceErrors: finiteInteger(row.performance_errors),
    followbackRatio: finiteNumber(row.followback_ratio),
    metricsObservedAt: validTimestamp(row.metrics_observed_at),
    performanceReliableAt: validTimestamp(row.performance_reliable_at),
    performanceEventObservedAt: validTimestamp(row.performance_event_observed_at),
    uniqueProfilesEvaluated: finiteInteger(row.unique_profiles_evaluated),
    lastEvaluatedAt: validTimestamp(row.last_evaluated_at),
    terminalProof: Boolean(row.terminal_proof),
    availabilityAssessmentId: uuid(row.availability_assessment_id) || null,
    availabilityStatus: text(row.availability_status) || null,
    availabilityConfidence: (["low", "medium", "high"].includes(rawConfidence) ? rawConfidence : "unknown") as WorkRow["availabilityConfidence"],
    availabilityIdentityStatus: text(row.availability_identity_status) || null,
    availabilityLatestObservationAt: validTimestamp(row.availability_latest_observation_at),
    availabilityValidUntil: validTimestamp(row.availability_valid_until),
    availabilityReasons: Object.freeze(Array.isArray(row.availability_reason_codes)
      ? row.availability_reason_codes.map(text).filter(Boolean).slice(0, 24) : []),
    identityStatus: text(row.identity_status) || null,
    lifecycleStatus: text(row.lifecycle_status) || null,
  });
}

function assessmentBundle(row: WorkRow, calculatedAt: string) {
  const denominatorObservedAt = row.denominatorObservedAt ?? row.targetUpdatedAt;
  const utilization = assessTargetUtilizationShadow({
    tenantId: row.tenantId,
    accountId: row.accountId,
    targetId: row.targetId,
    normalizedUsername: row.normalizedUsername,
    uniqueProfilesEvaluated: row.uniqueProfilesEvaluated,
    observedFollowerCount: row.followersCount,
    denominatorObservedAt,
    denominatorVersion: "ig-target-followers-v1",
    denominatorSource: "ig_targets.followers_count",
    denominatorReliability: row.followersCount == null ? 0 : 0.75,
    historicalCoverage: row.uniqueProfilesEvaluated > 0 ? 1 : 0,
    uniqueEvaluationCoverage: row.uniqueProfilesEvaluated > 0 ? 1 : 0,
    sourceAttributionReliability: row.lastEvaluatedAt ? 1 : 0,
    workerVersionCoverage: row.lastEvaluatedAt ? 1 : 0,
    terminalProof: row.terminalProof,
    calculatedAt,
  });
  const performanceObservedAt = latestTimestamp(
    row.metricsObservedAt,
    row.performanceEventObservedAt,
  ) ?? row.targetUpdatedAt;
  const performance = {
    sourceObservationId: null,
    follows: row.follows,
    followbacks: row.followbacks,
    skips: row.performanceSkips,
    errors: row.performanceErrors,
    fbrPercent: row.followbackRatio,
    reliability: row.performanceReliableAt ? "strong" as const : "unknown" as const,
    observedAt: performanceObservedAt,
  };
  const availability = row.availabilityAssessmentId && row.availabilityStatus
    ? {
      assessmentId: row.availabilityAssessmentId,
      status: row.availabilityStatus,
      identityStatus: row.identityStatus ?? row.availabilityIdentityStatus ?? "insufficient_identity_evidence",
      confidence: row.availabilityConfidence,
      latestObservationAt: row.availabilityLatestObservationAt,
      validUntil: row.availabilityValidUntil,
      terminalProof: row.availabilityReasons.some((reason) => /terminal|permanent|deleted|suspended/.test(reason)),
      reasonCodes: row.availabilityReasons,
    }
    : null;
  const sourceFingerprint = hash({
    scope: [row.tenantId, row.accountId, row.targetId],
    targetUpdatedAt: row.targetUpdatedAt,
    availabilityAssessmentId: row.availabilityAssessmentId,
    availabilityLatestObservationAt: row.availabilityLatestObservationAt,
    identityStatus: row.identityStatus,
    follows: row.follows,
    followbacks: row.followbacks,
    performanceSkips: row.performanceSkips,
    performanceErrors: row.performanceErrors,
    performanceObservedAt,
    uniqueProfilesEvaluated: row.uniqueProfilesEvaluated,
    lastEvaluatedAt: row.lastEvaluatedAt,
    followersCount: row.followersCount,
    denominatorObservedAt,
    terminalProof: row.terminalProof,
  });
  const assessment = assessTargetLifecycleGlobalShadow({
    scope: {
      tenantId: row.tenantId,
      accountId: row.accountId,
      targetId: row.targetId,
      normalizedUsername: row.normalizedUsername,
    },
    archived: false,
    replacementPending: row.lifecycleStatus === "replacement_pending",
    availability,
    performance,
    utilization: {
      state: utilization.state,
      uniqueProfilesEvaluated: row.uniqueProfilesEvaluated,
      estimatedExploitableAudience: utilization.estimatedExploitableAudience,
      utilizationRatio: utilization.utilizationRatio,
      observedAt: row.lastEvaluatedAt ?? denominatorObservedAt,
      terminalProof: row.terminalProof,
      reasonCodes: utilization.reasons,
    },
    calculatedAt,
  });
  return Object.freeze({
    sourceFingerprint,
    assessmentKey: `target-lifecycle-v1:${hash(row.tenantId, row.accountId, row.targetId, sourceFingerprint, assessment.engineVersion, assessment.engineRevision)}`,
    performanceSourceKey: `target-lifecycle-performance-v1:${hash(row.tenantId, row.accountId, row.targetId, row.follows, row.followbacks, row.performanceSkips, row.performanceErrors, performanceObservedAt, performance.reliability)}`,
    assessment,
    performance,
    utilization,
    sourceAvailabilityAssessmentId: row.availabilityAssessmentId,
    sourceMaxObservedAt: assessment.sourceMaxObservedAt,
  });
}

async function readRuntimeState(supabase: SupabaseLike) {
  const result = await supabase.from("ct_target_lifecycle_runtime_state").select("*").eq("id", "global").maybeSingle();
  if (result.error) throw new Error(result.error.message || "target_lifecycle_runtime_state_unavailable");
  return parseTargetLifecycleRuntimeState(result.data);
}

async function triggerAutoKill(supabase: SupabaseLike, reason: string, metrics: Record<string, unknown>) {
  await supabase.rpc("trigger_target_lifecycle_auto_kill_v1", {
    p_reason: reason,
    p_source_component: "backend_target_lifecycle_pipeline",
    p_metrics_safe: metrics,
  });
}

export async function processTargetLifecycleBatch(
  supabase: SupabaseLike,
  context: Readonly<{ workerId: string; batchKey: string; processorRelease: string; calculatedAt?: string }>,
): Promise<TargetLifecycleBatchResult> {
  const batchStarted = performance.now();
  const cpuStarted = process.cpuUsage();
  const memoryBefore = process.memoryUsage().rss;
  const state = await readRuntimeState(supabase);
  if (!targetLifecycleRuntimeActive(state)) {
    return Object.freeze({
      active: false,
      autoKilled: state.autoKilled,
      attempted: 0,
      processed: 0,
      deduplicated: 0,
      outOfOrderSkipped: 0,
      versionRegressionSkipped: 0,
      rejected: 0,
      errors: 0,
      retries: 0,
      crossTenant: 0,
      capHits: 0,
      wrapped: false,
      nextCursor: state.cursorTargetId,
      latencyP50Ms: 0,
      latencyP95Ms: 0,
      latencyMaxMs: 0,
      reasons: Object.freeze([state.autoKilled ? "target_lifecycle_auto_kill_active" : "target_lifecycle_shadow_inactive"]),
    });
  }
  const lease = await supabase.rpc("claim_target_lifecycle_pipeline_lease_v1", {
    p_worker_id: text(context.workerId).slice(0, 120),
    p_batch_key: text(context.batchKey).slice(0, 200),
    p_global_limit: state.caps.globalConcurrency,
    p_ttl_seconds: Math.min(300, Math.max(15, Math.ceil(state.caps.pipelineDurationMs / 1_000) + 5)),
  });
  if (lease.error) throw new Error(lease.error.message || "target_lifecycle_pipeline_lease_failed");
  const leaseId = uuid(lease.data);
  if (!leaseId) {
    return Object.freeze({
      active: true, autoKilled: false, attempted: 0, processed: 0, deduplicated: 0,
      outOfOrderSkipped: 0, versionRegressionSkipped: 0,
      rejected: 0, errors: 0, retries: 0, crossTenant: 0, capHits: 1, wrapped: false,
      nextCursor: state.cursorTargetId, latencyP50Ms: 0, latencyP95Ms: 0, latencyMaxMs: 0,
      reasons: Object.freeze(["target_lifecycle_concurrency_cap_reached"]),
    });
  }

  let attempted = 0;
  let processed = 0;
  let deduplicated = 0;
  let outOfOrderSkipped = 0;
  let versionRegressionSkipped = 0;
  let rejected = 0;
  let errors = 0;
  let retries = 0;
  let crossTenant = 0;
  let businessActionViolations = 0;
  let capHits = 0;
  const reasons: string[] = [];
  const latencies: number[] = [];
  let wrapped = false;
  let nextCursor = state.cursorTargetId;
  let lastHandledCursor = state.cursorTargetId;
  let partialBatch = false;
  try {
    const work = await supabase.rpc("list_target_lifecycle_work_v1", {
      p_after_target_id: state.cursorTargetId,
      p_limit: state.caps.batchSize,
    });
    if (work.error) throw new Error(work.error.message || "target_lifecycle_work_read_failed");
    const payload = work.data && typeof work.data === "object" ? work.data as Record<string, unknown> : {};
    const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];
    wrapped = payload.wrapped === true;
    const fetchedNextCursor = uuid(payload.next_cursor) || null;
    nextCursor = fetchedNextCursor;
    const rows = sourceRows.map(sanitizeWorkRow);
    attempted = sourceRows.length;
    const invalidRows = rows.filter((row) => row === null).length;
    rejected += invalidRows;
    if (invalidRows) reasons.push("partial_or_invalid_lifecycle_work_row");
    const calculatedAt = validTimestamp(context.calculatedAt) ?? new Date().toISOString();
    let cursorBlocked = false;

    for (const row of rows) {
      if (!row) {
        partialBatch = true;
        cursorBlocked = true;
        reasons.push("target_lifecycle_cursor_retained_for_invalid_row");
        continue;
      }
      if (performance.now() - batchStarted >= state.caps.pipelineDurationMs) {
        capHits += 1;
        partialBatch = true;
        reasons.push("target_lifecycle_pipeline_duration_cap_reached");
        break;
      }
      const itemStarted = performance.now();
      let cursorSafe = false;
      const bundle = assessmentBundle(row, calculatedAt);
      const capacity = await supabase.rpc("claim_target_lifecycle_assessment_capacity_v1", {
        p_account_id: row.accountId,
        p_target_id: row.targetId,
        p_global_limit: state.caps.assessmentsGlobalDay,
        p_account_limit: state.caps.assessmentsAccountDay,
        p_idempotency_key: bundle.assessmentKey,
      });
      if (capacity.error) {
        errors += 1;
        partialBatch = true;
        cursorBlocked = true;
        reasons.push("target_lifecycle_capacity_claim_failed");
      } else if (capacity.data !== true) {
        capHits += 1;
        cursorSafe = true;
        reasons.push("target_lifecycle_assessment_capacity_reached");
      } else {
        try {
          let persisted: { data: unknown; error: { message?: string } | null } | null = null;
          for (let attempt = 0; attempt <= state.caps.retries; attempt += 1) {
            persisted = await supabase.rpc("persist_target_lifecycle_shadow_v1", {
            p_bundle: {
              tenant_id: row.tenantId,
              account_id: row.accountId,
              target_id: row.targetId,
              normalized_username: row.normalizedUsername,
              assessment_key: bundle.assessmentKey,
              source_fingerprint: bundle.sourceFingerprint,
              source_availability_assessment_id: bundle.sourceAvailabilityAssessmentId,
              source_max_observed_at: bundle.sourceMaxObservedAt,
              status: bundle.assessment.status,
              availability_status: bundle.assessment.availabilityStatus,
              performance_status: bundle.assessment.performanceStatus,
              utilization_status: bundle.assessment.utilizationStatus,
              utilization_ratio: bundle.assessment.utilizationStatus === "insufficient_data" ? null : bundle.utilization.utilizationRatio,
              unique_profiles_evaluated: row.uniqueProfilesEvaluated,
              estimated_exploitable_audience: bundle.utilization.estimatedExploitableAudience,
              denominator_source: "ig_targets.followers_count",
              denominator_version: "ig-target-followers-v1",
              confidence: bundle.assessment.confidence,
              identity_status: row.identityStatus ?? row.availabilityIdentityStatus ?? "insufficient_identity_evidence",
              reason_codes: bundle.assessment.reasonCodes,
              missing_evidence: bundle.assessment.missingEvidence,
              replacement_state: bundle.assessment.status === "replacement_pending" ? "pending"
                : ["replacement_recommended", "exhausted"].includes(bundle.assessment.status) ? "recommended" : "none",
              recommended_action: bundle.assessment.recommendedAction,
              assessed_at: bundle.assessment.calculatedAt,
              valid_until: bundle.assessment.validUntil,
              engine_version: bundle.assessment.engineVersion,
              rule_version: bundle.assessment.ruleVersion,
              policy_version: bundle.assessment.policyVersion,
              engine_revision: bundle.assessment.engineRevision,
              policy_revision: bundle.assessment.policyRevision,
              explanation_safe: {
                mode: bundle.assessment.mode,
                availability: bundle.assessment.availabilityStatus,
                performance: bundle.assessment.performanceStatus,
                performance_skips: bundle.performance.skips,
                performance_errors: bundle.performance.errors,
                utilization: bundle.assessment.utilizationStatus,
                source_fingerprint: bundle.sourceFingerprint,
              },
              enforcement_allowed: false,
              business_action_allowed: false,
              mutation_executed: false,
              performance_observation: {
                source_event_key: bundle.performanceSourceKey,
                follows: bundle.performance.follows,
                followbacks: bundle.performance.followbacks,
                reliability: bundle.performance.reliability,
                observed_at: bundle.performance.observedAt,
                reason: "legacy_counter",
                metadata_safe: {
                  source: "target_lifecycle_global_shadow",
                  source_fingerprint: bundle.sourceFingerprint,
                  skips: bundle.performance.skips,
                  errors: bundle.performance.errors,
                },
              },
            },
            p_processor_release: text(context.processorRelease).slice(0, 120),
            });
            if (!persisted.error || attempt >= state.caps.retries) break;
            retries += 1;
          }
          if (!persisted || persisted.error) throw new Error(persisted?.error?.message || "target_lifecycle_persist_failed");
          const persistedPayload = persisted.data && typeof persisted.data === "object" && !Array.isArray(persisted.data)
            ? persisted.data as Record<string, unknown> : {};
          const outcome = text(persistedPayload.outcome);
          const businessActions = finiteInteger(persistedPayload.business_actions, 1);
          if (businessActions !== 0) {
            businessActionViolations += 1;
            errors += 1;
            cursorSafe = true;
            reasons.push("target_lifecycle_unexpected_business_action");
          } else if (outcome === "cross_tenant_rejected") {
            crossTenant += 1;
            rejected += 1;
            cursorSafe = true;
          } else if (outcome === "out_of_order_skipped") {
            outOfOrderSkipped += 1;
            cursorSafe = true;
          } else if (outcome === "version_regression_skipped") {
            versionRegressionSkipped += 1;
            cursorSafe = true;
          } else if (outcome === "deduplicated") {
            deduplicated += 1;
            cursorSafe = true;
          } else if (outcome === "processed") {
            processed += 1;
            cursorSafe = true;
          } else {
            partialBatch = true;
            cursorBlocked = true;
            errors += 1;
            reasons.push(`target_lifecycle_unexpected_persist_outcome:${safeError(outcome)}`);
          }
        } catch (error) {
          partialBatch = true;
          cursorBlocked = true;
          errors += 1;
          const reason = safeError(error);
          reasons.push(reason);
          if (reason.includes("cross_tenant") || reason.includes("scope_mismatch")) crossTenant += 1;
        } finally {
          latencies.push(performance.now() - itemStarted);
        }
      }
      if (cursorSafe && !cursorBlocked) lastHandledCursor = row.targetId;
    }

    if (partialBatch) {
      nextCursor = lastHandledCursor;
    }

    const advance = await supabase.rpc("advance_target_lifecycle_scan_cursor_v1", {
      p_expected_config_version: state.configVersion,
      p_next_cursor: nextCursor,
      p_wrapped: wrapped,
    });
    if (advance.error) {
      errors += 1;
      reasons.push("target_lifecycle_cursor_advance_failed");
    }
    const latencyMaxMs = latencies.length ? Math.max(...latencies) : 0;
    const cycleLatencyMs = performance.now() - batchStarted;
    const volumeViolation = sourceRows.length > state.caps.batchSize;
    if (invalidRows >= 3) reasons.push("target_lifecycle_abnormal_partial_rows");
    if (errors >= 3) reasons.push("target_lifecycle_error_rate_exceeded");
    if (cycleLatencyMs > state.caps.pipelineDurationMs * 3) {
      reasons.push("target_lifecycle_cycle_latency_exceeded");
    }
    const criticalReason = businessActionViolations > 0 ? "target_lifecycle_business_action_detected"
      : crossTenant > 0 ? "target_lifecycle_cross_tenant_attempt"
      : versionRegressionSkipped > 0 ? "target_lifecycle_version_divergence"
      : volumeViolation ? "target_lifecycle_unbounded_volume"
      : "";
    if (criticalReason) {
      await triggerAutoKill(supabase, criticalReason, {
        attempted,
        processed,
        deduplicated,
        invalid_rows: invalidRows,
        errors,
        cross_tenant: crossTenant,
        business_action_violations: businessActionViolations,
        version_regression_skipped: versionRegressionSkipped,
        volume_violation: volumeViolation,
        cycle_latency_ms: Number(cycleLatencyMs.toFixed(3)),
        latency_max_ms: Number(latencyMaxMs.toFixed(3)),
      });
      reasons.push(criticalReason);
    }
    const cpu = process.cpuUsage(cpuStarted);
    const memoryAfter = process.memoryUsage().rss;
    const metric = await supabase.rpc("record_target_lifecycle_pipeline_metric_v1", {
      p_metric_key: `target-lifecycle-batch:${hash(context.batchKey, context.processorRelease)}`,
      p_counters_safe: {
        attempted, processed, deduplicated, out_of_order_skipped: outOfOrderSkipped,
        version_regression_skipped: versionRegressionSkipped,
        rejected, errors, retries, cross_tenant: crossTenant, cap_hits: capHits,
        wrapped: wrapped ? 1 : 0, business_actions: 0, notifications: 0, archives: 0, replacements: 0,
      },
      p_latency_ms: Number((performance.now() - batchStarted).toFixed(3)),
      p_latency_p50_ms: percentile(latencies, 0.5),
      p_latency_p95_ms: percentile(latencies, 0.95),
      p_cpu_ms: Number(((cpu.user + cpu.system) / 1_000).toFixed(3)),
      p_memory_before_bytes: memoryBefore,
      p_memory_after_bytes: memoryAfter,
    });
    if (metric.error) reasons.push("target_lifecycle_metric_persist_failed");
    return Object.freeze({
      active: !criticalReason,
      autoKilled: Boolean(criticalReason),
      attempted,
      processed,
      deduplicated,
      outOfOrderSkipped,
      versionRegressionSkipped,
      rejected,
      errors,
      retries,
      crossTenant,
      capHits,
      wrapped,
      nextCursor,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
      latencyMaxMs: Number(latencyMaxMs.toFixed(3)),
      reasons: Object.freeze([...new Set(reasons)].slice(0, 32)),
    });
  } finally {
    await supabase.rpc("release_target_lifecycle_pipeline_lease_v1", { p_lease_id: leaseId });
  }
}
