import assert from "node:assert/strict";
import test from "node:test";
import { assessTargetAvailability } from "../target-lifecycle/availability.ts";
import { projectTargetAvailabilityForOperator } from "./operator-projection.ts";

test("operator projection is complete, serializable and action-free", () => {
  const assessment = assessTargetAvailability({
    tenantId: "tenant-one", accountId: "account-one", targetId: "target-one", normalizedUsername: "target.one",
    stablePlatformUserId: "ig-1", calculatedAt: "2026-07-29T12:00:00.000Z",
    evidence: [{ evidenceId: "e-1", observedAt: "2026-07-29T11:00:00.000Z", source: "synthetic", runId: "run-one", deviceId: "device-one", searchedUsername: "target.one", observedUsername: "target.one", observedStablePlatformUserId: "ig-1", lookupResult: "found", profileFound: true, verifiedBadge: true, followersSurface: "normal", networkHealthy: true, sessionHealthy: true, uiEvidenceQuality: "high", workerVersion: "worker-v2", instagramVersion: "ig-v1" }],
  });
  const projection = projectTargetAvailabilityForOperator({
    assessment,
    utilization: { state: "healthy", utilizationRatio: 0.2 },
    performance: { state: "healthy" },
    lifecycle: { recommendation: "monitor", explanation: "healthy" },
    policyShadow: { action: "monitor" },
    replacementShadow: { preparationRecommended: false, blockers: [] },
    latestEvidence: { deviceId: "device-one", workerVersion: "worker-v2", instagramVersion: "ig-v1", verifiedBadge: true, followersSurface: "normal", stablePlatformUserId: "ig-1" },
  });
  assert.equal(projection.readOnly, true);
  assert.deepEqual(projection.actions, []);
  assert.equal(projection.workerRelease, "worker-v2");
  assert.doesNotThrow(() => JSON.stringify(projection));
});
