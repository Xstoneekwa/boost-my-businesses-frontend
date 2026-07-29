import { createHash } from "node:crypto";
import type { TargetAvailabilityAssessment } from "../target-lifecycle/types.ts";

export type AvailabilityScope = Readonly<{ tenantId: string; accountId: string; targetId: string }>;
export type CurrentPointer = Readonly<{ recordId: string; observedAt: string }>;

export interface TargetAvailabilityPersistencePort {
  insertIdentityHistory(row: Readonly<Record<string, unknown>>): Promise<string>;
  readIdentityCurrent(scope: AvailabilityScope): Promise<CurrentPointer | null>;
  insertIdentityCurrent(row: Readonly<Record<string, unknown>>): Promise<boolean>;
  compareAndSwapIdentityCurrent(scope: AvailabilityScope, expectedHistoryId: string, row: Readonly<Record<string, unknown>>): Promise<boolean>;
  insertAssessment(row: Readonly<Record<string, unknown>>): Promise<string>;
  readAssessmentCurrent(scope: AvailabilityScope): Promise<CurrentPointer | null>;
  insertAssessmentCurrent(row: Readonly<Record<string, unknown>>): Promise<boolean>;
  compareAndSwapAssessmentCurrent(scope: AvailabilityScope, expectedAssessmentId: string, row: Readonly<Record<string, unknown>>): Promise<boolean>;
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const before = (left: string, right: string) => Date.parse(left) < Date.parse(right);

async function advanceCurrent(input: Readonly<{
  scope: AvailabilityScope;
  recordId: string;
  observedAt: string;
  read: (scope: AvailabilityScope) => Promise<CurrentPointer | null>;
  insert: () => Promise<boolean>;
  swap: (expectedId: string) => Promise<boolean>;
  maxAttempts: number;
}>) {
  for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
    const current = await input.read(input.scope);
    if (current && !before(current.observedAt, input.observedAt)) return "stale_ignored" as const;
    if (!current && await input.insert()) return "inserted" as const;
    if (current && await input.swap(current.recordId)) return "advanced" as const;
  }
  throw new Error("target_availability_current_cas_exhausted");
}

export class TargetAvailabilityAssessmentWriter {
  private readonly port: TargetAvailabilityPersistencePort;
  private readonly maxAttempts: number;

  constructor(port: TargetAvailabilityPersistencePort, maxAttempts = 4) {
    this.port = port;
    this.maxAttempts = maxAttempts;
  }

  async persist(assessment: TargetAvailabilityAssessment) {
    const scope = { tenantId: assessment.scope.tenantId, accountId: assessment.scope.accountId, targetId: assessment.scope.targetId };
    const reasonCodes = assessment.reasons.length ? [...assessment.reasons] : ["target_availability_unknown"];
    const assessmentKey = `target-availability-assessment:${hash({ scope, model: "target-availability-v2", calculatedAt: assessment.calculatedAt, latestObservedAt: assessment.latestObservedAt, status: assessment.status, reasons: reasonCodes })}`;
    const historyKey = `target-identity-history:${hash({ scope, assessmentKey, identity: assessment.identityResolution })}`;
    const historyId = await this.port.insertIdentityHistory({
      tenant_id: scope.tenantId,
      account_id: scope.accountId,
      target_id: scope.targetId,
      observation_id: null,
      previous_username: assessment.usernameChange.previousUsername,
      observed_username: assessment.usernameChange.observedUsername,
      stable_platform_user_id: assessment.identityResolution.stablePlatformUserId,
      resolution: assessment.identityResolution.status,
      confidence: assessment.confidence,
      reason_codes: assessment.identityResolution.reasons.length ? [...assessment.identityResolution.reasons] : ["target_availability_recheck_required"],
      idempotency_key: historyKey,
      observed_at: assessment.latestObservedAt ?? assessment.calculatedAt,
    });
    const assessmentId = await this.port.insertAssessment({
      tenant_id: scope.tenantId,
      account_id: scope.accountId,
      target_id: scope.targetId,
      assessment_key: assessmentKey,
      normalized_username: assessment.scope.normalizedUsername,
      stable_platform_user_id: assessment.scope.stablePlatformUserId,
      status: assessment.status,
      confidence: assessment.confidence,
      identity_resolution: assessment.identityResolution.status,
      reason_codes: reasonCodes,
      evidence_count: assessment.evidenceCount,
      distinct_run_count: assessment.distinctRunCount,
      distinct_device_count: assessment.distinctDeviceCount,
      latest_observed_at: assessment.latestObservedAt,
      recheck_required: assessment.recheckRequired,
      next_recheck_at: assessment.recheckRequired ? new Date(Date.parse(assessment.calculatedAt) + 86_400_000).toISOString() : null,
      quarantine_recommended: assessment.quarantineRecommended,
      quarantine_until: assessment.quarantineRecommended ? new Date(Date.parse(assessment.calculatedAt) + 86_400_000).toISOString() : null,
      terminal_proof: assessment.terminalProof,
      assessed_at: assessment.calculatedAt,
      model_version: "target-availability-v2",
    });
    const observedAt = assessment.latestObservedAt ?? assessment.calculatedAt;
    const identityCurrent = {
      tenant_id: scope.tenantId,
      account_id: scope.accountId,
      target_id: scope.targetId,
      current_username: assessment.identityResolution.resolvedUsername ?? assessment.scope.normalizedUsername,
      stable_platform_user_id: assessment.identityResolution.stablePlatformUserId,
      identity_status: assessment.identityResolution.status,
      confidence: assessment.confidence,
      last_history_id: historyId,
      last_observed_at: observedAt,
      updated_at: assessment.calculatedAt,
    };
    const assessmentCurrent = {
      tenant_id: scope.tenantId,
      account_id: scope.accountId,
      target_id: scope.targetId,
      assessment_id: assessmentId,
      updated_at: assessment.calculatedAt,
    };
    const identityProjection = await advanceCurrent({
      scope, recordId: historyId, observedAt,
      read: (value) => this.port.readIdentityCurrent(value),
      insert: () => this.port.insertIdentityCurrent(identityCurrent),
      swap: (expected) => this.port.compareAndSwapIdentityCurrent(scope, expected, identityCurrent),
      maxAttempts: this.maxAttempts,
    });
    const assessmentProjection = await advanceCurrent({
      scope, recordId: assessmentId, observedAt: assessment.calculatedAt,
      read: (value) => this.port.readAssessmentCurrent(value),
      insert: () => this.port.insertAssessmentCurrent(assessmentCurrent),
      swap: (expected) => this.port.compareAndSwapAssessmentCurrent(scope, expected, assessmentCurrent),
      maxAttempts: this.maxAttempts,
    });
    return Object.freeze({ assessmentId, historyId, assessmentKey, historyKey, identityProjection, assessmentProjection, mutationOutsideAvailabilityTables: false as const });
  }
}
