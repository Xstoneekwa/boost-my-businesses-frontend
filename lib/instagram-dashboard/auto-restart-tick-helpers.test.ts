import assert from "node:assert/strict";
import test from "node:test";
import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";
import { buildAutoRestartResumePlanMetadata } from "./auto-restart-resume-metadata.ts";
import { maxRetriesBlockReason } from "./auto-restart-operational.ts";

import {
  autoRestartEnqueueIdempotencyKey,
  autoRestartTickIdempotencyKey,
  accountRiskTier,
  resumePlanRuntimeSupported,
  sameSastBusinessDay,
} from "./auto-restart-tick-helpers.ts";

test("auto restart request idempotency is stable per business session and retry", () => {
  const key = autoRestartTickIdempotencyKey("dispatcher-mac-1", "2026-06-25T12:00:00.000Z");
  assert.equal(key, "auto-restart-tick:dispatcher-mac-1:2026-06-25T12:00:00.000Z");
  const enqueue = autoRestartEnqueueIdempotencyKey({
    accountId: "account-1",
    businessSessionId: "run-1",
    retryIndex: 1,
  });
  assert.equal(enqueue, "auto-restart:account-1:run-1:retry:1");
  assert.equal(
    autoRestartEnqueueIdempotencyKey({
      accountId: "account-1",
      businessSessionId: "run-1",
      retryIndex: 2,
    }),
    "auto-restart:account-1:run-1:retry:2",
  );
  assert.equal(
    autoRestartEnqueueIdempotencyKey({
      accountId: "account-1",
      businessSessionId: "run-1",
      retryIndex: 1,
      progressSourceRunId: "progress-run-2",
    }),
    "auto-restart:account-1:run-1:source:progress-run-2:retry:1",
  );
});

test("generic failed text is not an unsafe account marker", () => {
  assert.equal(accountRiskTier({
    reliability: {
      restartAllowed: true,
      restartBlockReason: "",
      sessionTerminationClass: "partial_resumable",
      unsafeMarkers: [],
    },
    blockReason: "worker failed on recoverable python error",
    gateStatus: "eligible_preview",
  }), "green");
});

test("both retries stay on the same SAST business day", () => {
  assert.equal(sameSastBusinessDay("2026-07-22", new Date("2026-07-22T20:30:00.000Z")), true);
  assert.equal(sameSastBusinessDay("2026-07-22", new Date("2026-07-22T22:30:00.000Z")), false);
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

function recoverableCandidate(retryIndex: 0 | 1): AutoRestartCandidate {
  const nextRetryIndex = retryIndex + 1;
  return {
    accountId: "account-1",
    deviceId: "device-1",
    appInstanceId: "instance-1",
    username: "mythyl_fitness",
    packageLabel: "clone-2",
    commercialAddonsLabel: "",
    outreachSourceLabel: "",
    runtimeProfilesLabel: "",
    followFiltersLabel: "",
    enabledServices: ["unfollow"],
    phoneName: "A16-02",
    phoneRestStatus: "ready",
    sessionWindowStatus: "open",
    assignmentStatus: "active",
    gateStatus: "eligible_preview",
    accountEligible: true,
    accountEligibilityReason: "eligible",
    restartNeeded: true,
    restartNeedReason: "partial_run_resume_needed",
    exactViewportResumeAvailable: false,
    safeRestartStrategy: "exact_checkpoint_resume",
    safeRestartReason: "non_follow_phase_resume_plan",
    historicalSafeBoundaryFallback: false,
    enqueueAllowed: true,
    sourceRunId: retryIndex === 0 ? "initial-run" : "retry-run-1",
    sourceBusinessSessionId: "business-session-1",
    priorTargetId: null,
    nextTargetId: null,
    nextRetryIndex,
    remainingFollowQuota: 0,
    plannedPhasesToRun: { welcome: false, follow: false, unfollow: true },
    plannedQuotaRemaining: { welcome: 0, follow: 0, unfollow: 120, outreach: 0 },
    decisionOutcome: "eligible",
    restartEligible: true,
    blockReason: "",
    plannedRunType: "account_session",
    reliability: {
      restartAllowed: true,
      restartBlockReason: "",
      unsafeMarkers: [],
      currentAttempt: String(retryIndex + 1),
      nextAttempt: String(nextRetryIndex + 1),
      nextRestartAt: null,
      lastRestartError: "",
      sessionTerminationClass: "partial_resumable",
      businessSessionId: "business-session-1",
      attemptId: String(retryIndex + 1),
      retryIndex: String(retryIndex),
      nextRetryIndex: String(nextRetryIndex),
      previousRunId: retryIndex === 0 ? "" : "initial-run",
      rootFailureCode: "unfollow_runtime_exception",
      failureSignature: "python:unfollow:duplicate_stop_reason",
      failureCategory: "recoverable_python_runtime_failure",
      cleanupCompleted: true,
      lockReleased: true,
      businessDaySast: "2026-07-22",
      phasesToRun: { welcome: false, follow: false, unfollow: true },
      quotaRemaining: { follow: 0, unfollow: 120, total: 120 },
      safeCheckpointAvailable: false,
      targetRotationSafeAfterScrollFailure: false,
      scrollFailureSurfaceAmbiguous: false,
      lastRunId: retryIndex === 0 ? "initial-run" : "retry-run-1",
      lastRunStatus: "failed",
      sourceLabel: "test",
    },
    quotas: {
      follow: { doneToday: 40, capDay: 40, remaining: 0, plannedNextRunQuota: 0, enabled: true, sourceLabel: "test" },
      unfollow: { doneToday: 0, capDay: 120, remaining: 120, plannedNextRunQuota: 120, enabled: true, sourceLabel: "test" },
      welcome: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "test" },
      outreach: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "test" },
    },
  };
}

test("retry request metadata preserves one business session and only remaining unfollow", () => {
  const initial = recoverableCandidate(0);
  assert.deepEqual(resumePlanRuntimeSupported(initial), { ok: true, reason: "" });
  const retryOne = buildAutoRestartResumePlanMetadata(initial, new Date("2026-07-22T20:00:00.000Z"));
  assert.equal(retryOne.business_session_id, "business-session-1");
  assert.equal(retryOne.attempt_id, 2);
  assert.equal(retryOne.retry_index, 1);
  assert.equal(retryOne.previous_run_id, "initial-run");
  assert.deepEqual(retryOne.resume_plan.phases_to_run, {
    welcome: false,
    follow: false,
    unfollow: true,
  });

  const firstRetryFailure = recoverableCandidate(1);
  const retryTwo = buildAutoRestartResumePlanMetadata(firstRetryFailure, new Date("2026-07-22T20:10:00.000Z"));
  assert.equal(retryTwo.business_session_id, retryOne.business_session_id);
  assert.equal(retryTwo.attempt_id, 3);
  assert.equal(retryTwo.retry_index, 2);
  assert.equal(retryTwo.previous_run_id, "retry-run-1");
  assert.equal(maxRetriesBlockReason("2", 2), "auto_restart_retries_exhausted");
});

test("recoverable retry requires proven cleanup and lock release", () => {
  const candidate = recoverableCandidate(0);
  candidate.reliability.cleanupCompleted = false;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), {
    ok: false,
    reason: "resume_plan_invalid",
  });
});

test("explicit platform unsafe marker blocks a retry but generic failure text does not", () => {
  const candidate = recoverableCandidate(1);
  candidate.reliability.unsafeMarkers = ["challenge"];
  assert.equal(accountRiskTier(candidate), "red");
  candidate.reliability.unsafeMarkers = [];
  candidate.blockReason = "python failed with recoverable error";
  assert.equal(accountRiskTier(candidate), "green");
});
