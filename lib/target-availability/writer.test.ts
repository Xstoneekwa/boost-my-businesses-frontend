import assert from "node:assert/strict";
import test from "node:test";
import { assessTargetAvailability } from "../target-lifecycle/availability.ts";
import type { AvailabilityScope, CurrentPointer, TargetAvailabilityPersistencePort } from "./writer.ts";
import { TargetAvailabilityAssessmentWriter } from "./writer.ts";

class MemoryPort implements TargetAvailabilityPersistencePort {
  histories = new Map<string, Readonly<Record<string, unknown>>>();
  assessments = new Map<string, Readonly<Record<string, unknown>>>();
  identityCurrent = new Map<string, CurrentPointer>();
  assessmentCurrent = new Map<string, CurrentPointer>();
  forcedCasMisses = 0;
  private key(scope: AvailabilityScope) { return `${scope.tenantId}:${scope.accountId}:${scope.targetId}`; }
  async insertIdentityHistory(row: Readonly<Record<string, unknown>>) {
    const key = String(row.idempotency_key); const id = `history-${key.slice(-12)}`;
    this.histories.set(key, row); return id;
  }
  async readIdentityCurrent(scope: AvailabilityScope) { return this.identityCurrent.get(this.key(scope)) ?? null; }
  async insertIdentityCurrent(row: Readonly<Record<string, unknown>>) {
    const key = this.key({ tenantId: String(row.tenant_id), accountId: String(row.account_id), targetId: String(row.target_id) });
    if (this.identityCurrent.has(key)) return false;
    this.identityCurrent.set(key, { recordId: String(row.last_history_id), observedAt: String(row.last_observed_at) }); return true;
  }
  async compareAndSwapIdentityCurrent(scope: AvailabilityScope, expected: string, row: Readonly<Record<string, unknown>>) {
    const key = this.key(scope); if (this.identityCurrent.get(key)?.recordId !== expected) return false;
    this.identityCurrent.set(key, { recordId: String(row.last_history_id), observedAt: String(row.last_observed_at) }); return true;
  }
  async insertAssessment(row: Readonly<Record<string, unknown>>) {
    const key = String(row.assessment_key); const id = `assessment-${key.slice(-12)}`;
    this.assessments.set(key, row); return id;
  }
  async readAssessmentCurrent(scope: AvailabilityScope) { return this.assessmentCurrent.get(this.key(scope)) ?? null; }
  async insertAssessmentCurrent(row: Readonly<Record<string, unknown>>) {
    const key = this.key({ tenantId: String(row.tenant_id), accountId: String(row.account_id), targetId: String(row.target_id) });
    if (this.assessmentCurrent.has(key)) return false;
    this.assessmentCurrent.set(key, { recordId: String(row.assessment_id), observedAt: String(row.updated_at) }); return true;
  }
  async compareAndSwapAssessmentCurrent(scope: AvailabilityScope, expected: string, row: Readonly<Record<string, unknown>>) {
    if (this.forcedCasMisses > 0) { this.forcedCasMisses -= 1; return false; }
    const key = this.key(scope); if (this.assessmentCurrent.get(key)?.recordId !== expected) return false;
    this.assessmentCurrent.set(key, { recordId: String(row.assessment_id), observedAt: String(row.updated_at) }); return true;
  }
}

const evidence = (id: string, observedAt = "2026-07-29T10:00:00.000Z") => ({
  evidenceId: id, observedAt, source: "synthetic" as const, runId: `run-${id}`, deviceId: "device-one",
  searchedUsername: "target.one", observedUsername: "target.one", observedStablePlatformUserId: "ig-1",
  lookupResult: "found" as const, profileFound: true, verifiedBadge: false, followersSurface: "normal" as const,
  networkHealthy: true, sessionHealthy: true, uiEvidenceQuality: "high" as const,
});

const assessment = (accountId = "account-one", calculatedAt = "2026-07-29T12:00:00.000Z", observedAt = "2026-07-29T10:00:00.000Z") => assessTargetAvailability({
  tenantId: "tenant-one", accountId, targetId: "target-one", normalizedUsername: "target.one",
  stablePlatformUserId: "ig-1", evidence: [evidence(`${accountId}-${calculatedAt}`, observedAt)], calculatedAt,
});

test("assessment writer is idempotent and touches only the four Availability stores", async () => {
  const port = new MemoryPort(); const writer = new TargetAvailabilityAssessmentWriter(port);
  const first = await writer.persist(assessment()); const second = await writer.persist(assessment());
  assert.equal(first.assessmentId, second.assessmentId);
  assert.equal(port.assessments.size, 1); assert.equal(port.histories.size, 1);
  assert.equal(first.mutationOutsideAvailabilityTables, false);
});

test("current projections use optimistic CAS and ignore stale assessments", async () => {
  const port = new MemoryPort(); const writer = new TargetAvailabilityAssessmentWriter(port);
  await writer.persist(assessment("account-one", "2026-07-29T12:00:00.000Z"));
  port.forcedCasMisses = 1;
  const newer = await writer.persist(assessment("account-one", "2026-07-29T13:00:00.000Z", "2026-07-29T11:00:00.000Z"));
  assert.equal(newer.assessmentProjection, "advanced");
  const older = await writer.persist(assessment("account-one", "2026-07-29T11:00:00.000Z", "2026-07-29T09:00:00.000Z"));
  assert.equal(older.assessmentProjection, "stale_ignored");
});

test("tenant and account projections remain isolated", async () => {
  const port = new MemoryPort(); const writer = new TargetAvailabilityAssessmentWriter(port);
  await Promise.all([writer.persist(assessment("account-one")), writer.persist(assessment("account-two"))]);
  assert.equal(port.assessmentCurrent.size, 2);
  assert.equal(port.identityCurrent.size, 2);
});
