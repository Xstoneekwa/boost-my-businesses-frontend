import assert from "node:assert/strict";
import test from "node:test";
import type { AvailabilityObservation, AvailabilityScope } from "./engine-types.ts";
import { resolveTargetIdentity } from "./identity-engine.ts";

const scope: AvailabilityScope = { tenantId: "tenant-a", accountId: "account-a", targetId: "target-a" };
const at = (minute: number) => `2026-07-30T10:${String(minute).padStart(2, "0")}:00.000Z`;
const row = (id: string, patch: Partial<AvailabilityObservation> = {}): AvailabilityObservation => ({
  ...scope,
  observationId: id,
  idempotencyKey: `identity-key-${id}`,
  signal: "profile_available",
  observedAt: at(Number(id.replace(/\D/g, "")) || 1),
  source: "synthetic",
  expectedUsername: "old.name",
  observedUsername: "old.name",
  runId: `run-${id}`,
  uiEvidenceQuality: "high",
  ...patch,
});

test("identity confirms an unchanged username and may adopt a stable id only on the same username", () => {
  const result = resolveTargetIdentity({ scope, expectedUsername: "old.name", observations: [row("01", { stablePlatformUserId: "ig-100" })], calculatedAt: at(20) });
  assert.equal(result.current.identityStatus, "identity_confirmed");
  assert.equal(result.current.stablePlatformUserId, "ig-100");
  assert.equal(result.current.canonicalUsername, "old.name");
  assert.equal(result.history.length, 1);
});

test("stable id match confirms a username change without mutating the input target id", () => {
  const result = resolveTargetIdentity({
    scope,
    expectedUsername: "old.name",
    stablePlatformUserId: "ig-100",
    observations: [row("02", { signal: "username_changed", observedUsername: "new.name", stablePlatformUserId: "ig-100" })],
    calculatedAt: at(20),
  });
  assert.equal(result.current.identityStatus, "username_change_confirmed");
  assert.equal(result.current.canonicalUsername, "new.name");
  assert.equal(result.current.targetId, scope.targetId);
});

test("repeated rename without stable id remains suspected and fail-closed", () => {
  const result = resolveTargetIdentity({
    scope,
    expectedUsername: "old.name",
    observations: [
      row("03", { signal: "username_change_suspected", observedUsername: "new.name", stablePlatformUserId: null }),
      row("04", { signal: "username_change_suspected", observedUsername: "new.name", stablePlatformUserId: null }),
    ],
    calculatedAt: at(20),
  });
  assert.equal(result.current.identityStatus, "username_change_suspected");
  assert.equal(result.current.canonicalUsername, "old.name");
  assert.equal(result.current.observedUsername, "new.name");
});

test("a different stable id creates a conflict and never merges targets", () => {
  const result = resolveTargetIdentity({
    scope,
    expectedUsername: "old.name",
    stablePlatformUserId: "ig-100",
    observations: [row("05", { stablePlatformUserId: "ig-200" })],
    calculatedAt: at(20),
  });
  assert.equal(result.current.identityStatus, "identity_conflict");
  assert.equal(result.current.stablePlatformUserId, "ig-100");
  assert.equal(result.current.canonicalUsername, "old.name");
});

test("scope mismatch, duplicate and partial observations are rejected deterministically", () => {
  const duplicate = row("06");
  const result = resolveTargetIdentity({
    scope,
    expectedUsername: "old.name",
    observations: [duplicate, { ...duplicate, observationId: "07" }, row("08", { tenantId: "tenant-b" }), row("09", { observedAt: "bad" })],
    calculatedAt: at(20),
  });
  assert.equal(result.acceptedObservations.length, 1);
  assert.deepEqual(result.deduplicatedObservationIds, ["07"]);
  assert.deepEqual(result.rejectedObservations.map((item) => item.reason), ["scope_mismatch", "partial_or_invalid_observation"]);
});

test("same username in distinct tenant/account scopes never aggregates", () => {
  const tenantB = { tenantId: "tenant-b", accountId: "account-b", targetId: "target-b" };
  const first = resolveTargetIdentity({ scope, expectedUsername: "shared.name", observations: [{ ...row("10"), expectedUsername: "shared.name", observedUsername: "shared.name" }], calculatedAt: at(20) });
  const second = resolveTargetIdentity({ scope: tenantB, expectedUsername: "shared.name", observations: [{ ...row("11"), ...tenantB, expectedUsername: "shared.name", observedUsername: "shared.name" }], calculatedAt: at(20) });
  assert.notEqual(first.current.targetId, second.current.targetId);
  assert.equal(first.acceptedObservations.length, 1);
  assert.equal(second.acceptedObservations.length, 1);
});
