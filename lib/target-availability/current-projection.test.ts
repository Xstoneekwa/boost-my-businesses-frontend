import assert from "node:assert/strict";
import test from "node:test";
import { assessAvailability } from "./assessment-engine.ts";
import { projectAvailabilityCurrent, rebuildAvailabilityCurrent } from "./current-projection.ts";
import type { AvailabilityAssessment, AvailabilityObservation, AvailabilityScope } from "./engine-types.ts";
import { resolveTargetIdentity } from "./identity-engine.ts";

const scope: AvailabilityScope = { tenantId: "tenant-a", accountId: "account-a", targetId: "target-a" };
const row = (id: string, observedAt: string): AvailabilityObservation => ({
  ...scope,
  observationId: id,
  idempotencyKey: `current-key-${id}`,
  signal: "profile_available",
  observedAt,
  source: "synthetic",
  expectedUsername: "target.one",
  observedUsername: "target.one",
  runId: `run-${id}`,
  networkHealthy: true,
  sessionHealthy: true,
  uiEvidenceQuality: "high",
});

const assessment = (id: string, observedAt: string, assessedAt: string) => {
  const observations = [row(id, observedAt)];
  const identity = resolveTargetIdentity({ scope, expectedUsername: "target.one", observations, calculatedAt: assessedAt }).current;
  return assessAvailability({ scope, identity, observations, assessedAt }).assessment;
};

test("current inserts and exact retries are idempotent", () => {
  const item = assessment("01", "2026-07-30T10:00:00.000Z", "2026-07-30T11:00:00.000Z");
  const first = projectAvailabilityCurrent({ scope, previous: null, assessment: item });
  const retry = projectAvailabilityCurrent({ scope, previous: first.current, assessment: item });
  assert.equal(first.outcome, "inserted");
  assert.equal(retry.outcome, "unchanged");
  assert.deepEqual(retry.current, first.current);
});

test("older events cannot regress current", () => {
  const newer = assessment("02", "2026-07-30T10:30:00.000Z", "2026-07-30T11:30:00.000Z");
  const older = assessment("03", "2026-07-30T10:00:00.000Z", "2026-07-30T11:45:00.000Z");
  const current = projectAvailabilityCurrent({ scope, previous: null, assessment: newer }).current;
  const result = projectAvailabilityCurrent({ scope, previous: current, assessment: older });
  assert.equal(result.outcome, "skipped_stale_event");
  assert.equal(result.current?.latestAssessmentId, newer.assessmentId);
});

test("engine or policy version regressions fail closed", () => {
  const item = assessment("04", "2026-07-30T10:00:00.000Z", "2026-07-30T11:00:00.000Z");
  const current = projectAvailabilityCurrent({ scope, previous: null, assessment: item }).current;
  const regressed: AvailabilityAssessment = { ...item, assessmentId: "00000000-0000-5000-8000-000000000004", engineRevision: item.engineRevision - 1, assessedAt: "2026-07-30T12:00:00.000Z" };
  assert.equal(projectAvailabilityCurrent({ scope, previous: current, assessment: regressed }).outcome, "skipped_version_regression");
});

test("concurrent assessments converge to a deterministic winner regardless of arrival order", () => {
  const base = assessment("05", "2026-07-30T10:00:00.000Z", "2026-07-30T11:00:00.000Z");
  const low: AvailabilityAssessment = { ...base, assessmentId: "00000000-0000-5000-8000-000000000001" };
  const high: AvailabilityAssessment = { ...base, assessmentId: "ffffffff-ffff-5fff-8fff-ffffffffffff" };
  const firstOrder = projectAvailabilityCurrent({ scope, previous: projectAvailabilityCurrent({ scope, previous: null, assessment: low }).current, assessment: high }).current;
  const secondOrder = projectAvailabilityCurrent({ scope, previous: projectAvailabilityCurrent({ scope, previous: null, assessment: high }).current, assessment: low }).current;
  assert.equal(firstOrder?.latestAssessmentId, high.assessmentId);
  assert.deepEqual(secondOrder, firstOrder);
});

test("full replay reconstruction is deterministic and rejects cross-account current writes", () => {
  const older = assessment("06", "2026-07-30T09:00:00.000Z", "2026-07-30T10:00:00.000Z");
  const newer = assessment("07", "2026-07-30T10:00:00.000Z", "2026-07-30T11:00:00.000Z");
  assert.deepEqual(rebuildAvailabilityCurrent(scope, [older, newer]), rebuildAvailabilityCurrent(scope, [newer, older]));
  const foreign = { ...newer, accountId: "account-b" };
  assert.equal(projectAvailabilityCurrent({ scope, previous: null, assessment: foreign }).outcome, "rejected_scope");
});
