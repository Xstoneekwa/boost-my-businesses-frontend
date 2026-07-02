import assert from "node:assert/strict";
import test from "node:test";

import {
  autoRestartEnqueueIdempotencyKey,
  autoRestartTickIdempotencyKey,
  resumePlanRuntimeSupported,
} from "./auto-restart-tick-helpers.ts";

test("auto restart tick idempotency keys are stable per bucket", () => {
  const key = autoRestartTickIdempotencyKey("dispatcher-mac-1", "2026-06-25T12:00:00.000Z");
  assert.equal(key, "auto-restart-tick:dispatcher-mac-1:2026-06-25T12:00:00.000Z");
  const enqueue = autoRestartEnqueueIdempotencyKey({
    accountId: "account-1",
    businessSessionId: "run-1",
    tickBucketIso: "2026-06-25T12:00:00.000Z",
  });
  assert.equal(enqueue, "auto-restart:account-1:run-1:2026-06-25T12:00:00.000Z");
});

test("resume plan unsupported when restart not allowed", () => {
  const blocked = resumePlanRuntimeSupported({
    accountId: "a",
    deviceId: "",
    appInstanceId: "",
    username: "u",
    packageLabel: "",
    commercialAddonsLabel: "",
    outreachSourceLabel: "",
    runtimeProfilesLabel: "",
    followFiltersLabel: "",
    enabledServices: [],
    phoneName: "",
    phoneRestStatus: "",
    sessionWindowStatus: "",
    assignmentStatus: "",
    gateStatus: "blocked",
    restartEligible: false,
    blockReason: "worker_plan:no_quota_remaining",
    plannedRunType: "none",
    reliability: {
      restartAllowed: false,
      restartBlockReason: "no_quota_remaining",
      unsafeMarkers: [],
      currentAttempt: "1",
      nextAttempt: "2",
      nextRestartAt: null,
      lastRestartError: "",
      sessionTerminationClass: "partial_resumable",
      lastRunId: "run-1",
      lastRunStatus: "completed",
      sourceLabel: "test",
    },
    quotas: {
      follow: { doneToday: 0, capDay: 80, remaining: 0, plannedNextRunQuota: 0, enabled: true, sourceLabel: "" },
      unfollow: { doneToday: 0, capDay: 80, remaining: 0, plannedNextRunQuota: 0, enabled: true, sourceLabel: "" },
      welcome: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "" },
      outreach: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "" },
    },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "no_quota_remaining");
});
