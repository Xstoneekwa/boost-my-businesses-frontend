import assert from "node:assert/strict";
import test from "node:test";
import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";
import { buildAutoRestartResumePlanMetadata } from "./auto-restart-resume-metadata.ts";
import { maxRetriesBlockReason, restartDelayBlockReason } from "./auto-restart-operational.ts";
import { resolveCanonicalAttemptIdentity } from "./auto-restart-lineage-policy.ts";
import {
  resolvePartialUnfollowLiveResume,
  resolvePlannedAccountSession,
} from "./auto-restart-phase-plan.ts";

import {
  autoRestartEnqueueIdempotencyKey,
  autoRestartTickIdempotencyKey,
  autoRestartTickLockBucketStart,
  accountRiskTier,
  resumePlanRuntimeSupported,
  sameSastBusinessDay,
  unfollowDecisionNextEvaluationAt,
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

test("tick lock advances every minute even when account checks use a longer interval", () => {
  assert.equal(
    autoRestartTickLockBucketStart(new Date("2026-07-27T19:30:59.999Z")),
    "2026-07-27T19:30:00.000Z",
  );
  assert.equal(
    autoRestartTickLockBucketStart(new Date("2026-07-27T19:31:00.000Z")),
    "2026-07-27T19:31:00.000Z",
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
    sourceLineageValid: true,
    canonicalAttemptId: retryIndex + 1,
    priorTargetId: null,
    nextTargetId: null,
    nextRetryIndex,
    remainingFollowQuota: 0,
    eligibleUnfollowCandidateCount: 120,
    unavailableUnfollowCandidateCount: 0,
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
      unfollowCheckpoint: {
        schema: "UNFOLLOW_CHECKPOINT_V1",
        daily_plan: {
          schema: "UNFOLLOW_DAILY_PLAN_V1",
          plan_id: "udp1_existing_frozen_plan",
          remaining_candidates: ["candidate_a", "candidate_b"],
        },
      },
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
  assert.equal(retryOne.root_business_session_id, "business-session-1");
  assert.equal(retryOne.attempt_id, 2);
  assert.equal(retryOne.retry_index, 1);
  assert.equal(retryOne.resume_plan.attempt_id, 2);
  assert.equal(retryOne.resume_plan.retry_index, 1);
  assert.equal(retryOne.resume_plan.root_business_session_id, "business-session-1");
  assert.equal(retryOne.previous_run_id, "initial-run");
  assert.deepEqual(retryOne.resume_plan.phases_to_run, {
    welcome: false,
    follow: false,
    unfollow: true,
  });
  assert.strictEqual(
    retryOne.resume_plan.unfollow_checkpoint,
    initial.reliability.unfollowCheckpoint,
    "the opaque Worker checkpoint must not be rebuilt or normalized",
  );
  assert.equal(
    (retryOne.resume_plan.unfollow_checkpoint as Record<string, unknown>)?.schema,
    "UNFOLLOW_CHECKPOINT_V1",
  );

  const firstRetryFailure = recoverableCandidate(1);
  const retryTwo = buildAutoRestartResumePlanMetadata(firstRetryFailure, new Date("2026-07-22T20:10:00.000Z"));
  assert.equal(retryTwo.business_session_id, retryOne.business_session_id);
  assert.equal(retryTwo.root_business_session_id, "business-session-1");
  assert.equal(retryTwo.attempt_id, 3);
  assert.equal(retryTwo.retry_index, 2);
  assert.equal(retryTwo.resume_plan.attempt_id, 3);
  assert.equal(retryTwo.resume_plan.retry_index, 2);
  assert.equal(retryTwo.resume_plan.root_business_session_id, "business-session-1");
  assert.equal(retryTwo.previous_run_id, "retry-run-1");
  assert.equal(maxRetriesBlockReason("2", 2), "auto_restart_retries_exhausted");
});

test("Loriele two-tick lineage rebuilds an exact request only after circuit and holds clear", () => {
  const identity = resolveCanonicalAttemptIdentity({
    sourceRunId: "56ca1317-6164-4f8f-8c67-90eb1d526452",
    sourceAccountId: "dfe78a92-3a51-435e-8911-ed10c93a4d82",
    sourceRequest: {
      id: "45d5f78d-03a8-4772-8e57-3396ac35afc4",
      account_id: "dfe78a92-3a51-435e-8911-ed10c93a4d82",
      run_id: "56ca1317-6164-4f8f-8c67-90eb1d526452",
      metadata_safe: {
        source: "schedule_session_cron",
        trigger: "scheduler",
        worker_id: "schedule_session_cron",
        assignment_id: "fd07e592-19cc-4738-adc9-90fd3c3cd407",
        device_timezone: "Africa/Johannesburg",
        scheduled_session_at: "2026-07-30T16:00:00+00:00",
        scheduled_session_ends_at: "2026-07-30T22:00:00+00:00",
      },
    },
    runProjectionAttemptId: 1,
  });
  assert.equal(identity.lineageValid, true);
  assert.equal(identity.canonicalAttemptId, 1);
  assert.equal(identity.divergence, false);

  const common = {
    sessionTerminationClass: "partial_resumable",
    unfollowPhaseStatus: "partial_resumable",
    lineageValid: identity.lineageValid,
    autoRestartEnabled: true,
    unfollowEnabled: true,
    dailyQuotaRemaining: 79,
    sessionQuotaRemaining: 50,
    terminalTotal: 0,
  };
  const firstTick = resolvePartialUnfollowLiveResume({
    ...common,
    actionableNow: 3,
    technicalHoldTotal: 3,
    nextCandidateRetryAt: "2026-07-30T18:03:55.000Z",
    phaseCircuitOpen: true,
    phaseCircuitNextRetryAt: "2026-07-30T18:04:34.000Z",
  });
  assert.equal(firstTick.authorized, false);
  assert.equal(firstTick.reason, "unfollow_phase_circuit_open");
  assert.equal(firstTick.nextEvaluationAt, "2026-07-30T18:04:34.000Z");
  assert.equal(
    restartDelayBlockReason(
      firstTick.nextEvaluationAt,
      new Date("2026-07-30T18:04:33.000Z"),
    ),
    "restart_delay_not_elapsed",
  );

  const secondTick = resolvePartialUnfollowLiveResume({
    ...common,
    actionableNow: 6,
    technicalHoldTotal: 0,
    nextCandidateRetryAt: null,
    phaseCircuitOpen: false,
    phaseCircuitNextRetryAt: null,
  });
  assert.equal(secondTick.authorized, true);
  assert.equal(secondTick.plannedQuota, 6);

  const plan = resolvePlannedAccountSession({
    persistedPhases: { welcome: false, follow: false, unfollow: true },
    persistedQuotaRemaining: { welcome: 0, follow: 0, unfollow: secondTick.plannedQuota },
    quotas: {
      welcome: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false },
      follow: { doneToday: 50, capDay: 120, remaining: 70, plannedNextRunQuota: 50, enabled: true },
      unfollow: { doneToday: 41, capDay: 120, remaining: 79, plannedNextRunQuota: 50, enabled: true },
    },
    eligibleWorkRemaining: { unfollow: secondTick.actionableNow },
  });
  assert.deepEqual(plan, {
    phases: { welcome: false, follow: false, unfollow: true },
    remaining: { welcome: 0, follow: 0, unfollow: 6 },
    totalRemaining: 6,
  });

  const candidate = recoverableCandidate(1);
  candidate.sourceRunId = "56ca1317-6164-4f8f-8c67-90eb1d526452";
  candidate.sourceRequestId = identity.sourceRequestId;
  candidate.canonicalAttemptId = identity.canonicalAttemptId;
  candidate.sourceLineageValid = identity.lineageValid;
  candidate.canonicalLiveUnfollowResumeAuthorized = true;
  candidate.reliability.restartAllowed = false;
  candidate.reliability.restartBlockReason = "restart_not_needed";
  candidate.reliability.unfollowPhaseStatus = "partial_resumable";
  candidate.reliability.attemptProjectionDivergence = identity.divergence;
  candidate.eligibleUnfollowCandidateCount = 6;
  candidate.technicalHoldUnfollowCandidateCount = 0;
  candidate.unavailableUnfollowCandidateCount = 0;
  candidate.unfollowBacklogTotal = 6;
  candidate.unfollowPhaseCircuitOpen = false;
  candidate.unfollowNextCandidateRetryAt = null;
  candidate.unfollowNextEvaluationAt = null;
  candidate.plannedPhasesToRun = plan.phases;
  candidate.plannedQuotaRemaining = { ...plan.remaining, outreach: 0 };
  candidate.quotas.unfollow.doneToday = 41;
  candidate.quotas.unfollow.remaining = 79;
  candidate.quotas.unfollow.plannedNextRunQuota = 50;
  candidate.nextRetryIndex = identity.canonicalAttemptId!;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
  assert.equal(unfollowDecisionNextEvaluationAt(candidate), null);

  const request = buildAutoRestartResumePlanMetadata(
    candidate,
    new Date("2026-07-30T18:04:35.000Z"),
  );
  assert.equal(request.source_request_id, "45d5f78d-03a8-4772-8e57-3396ac35afc4");
  assert.equal(request.source_canonical_attempt_id, 1);
  assert.equal(request.attempt_id, 2);
  assert.equal(request.restart_block_reason, null);
  assert.equal(request.resume_plan.restart_block_reason, "");
  assert.deepEqual(request.resume_plan.phases_to_run, {
    welcome: false,
    follow: false,
    unfollow: true,
  });
  assert.deepEqual(request.resume_plan.quota_remaining, {
    follow: 0,
    unfollow: 6,
    welcome: 0,
    outreach: 0,
  });
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

function operatorStopCandidate() {
  const candidate = recoverableCandidate(0);
  candidate.operatorStopContinuation = true;
  candidate.operatorStopReason = "botapp_manual_stop";
  candidate.freshBoundaryOnly = true;
  candidate.sourceRunId = "operator-stopped-run";
  candidate.sourceRequestId = "operator-stop-request";
  candidate.canonicalAttemptId = 1;
  candidate.sourceLineageValid = true;
  candidate.sourceBusinessSessionId = "operator-stop:operator-stopped-run";
  candidate.nextRetryIndex = 0;
  candidate.exactViewportResumeAvailable = false;
  candidate.safeRestartStrategy = "rebuilt_safe_target_plan";
  candidate.safeRestartReason = "operator_stop_live_phase_plan_rebuilt";
  candidate.reliability.restartAllowed = false;
  candidate.reliability.restartBlockReason = "operator_canceled";
  candidate.reliability.sessionTerminationClass = "completed";
  candidate.reliability.lastRunStatus = "stopped";
  candidate.reliability.lastRunId = "operator-stopped-run";
  candidate.reliability.operatorStopContinuation = true;
  candidate.reliability.operatorStopReason = "botapp_manual_stop";
  candidate.reliability.failureCategory = "";
  candidate.plannedPhasesToRun = { welcome: false, follow: false, unfollow: true };
  candidate.plannedQuotaRemaining = { welcome: 0, follow: 0, unfollow: 5, outreach: 0 };
  candidate.eligibleUnfollowCandidateCount = 5;
  return candidate;
}

test("canonical BotApp stop is supported only as a fresh-boundary continuation", () => {
  const candidate = operatorStopCandidate();
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
  const metadata = buildAutoRestartResumePlanMetadata(candidate);
  assert.equal(metadata.operator_stop_continuation, true);
  assert.equal(metadata.operator_stop_source_reason, "botapp_manual_stop");
  assert.equal(metadata.fresh_boundary_only, true);
  assert.equal(metadata.attempt_id, 1);
  assert.equal(metadata.resume_plan.safe_restart_strategy, "rebuilt_safe_target_plan");
});

test("canonical BotApp stop does not require the legacy termination-class projection", () => {
  const candidate = operatorStopCandidate();
  candidate.reliability.sessionTerminationClass = "";
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
  candidate.reliability.sessionTerminationClass = "unknown";
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
});

test("operator-stop continuation fails closed for a non-BotApp reason", () => {
  const candidate = operatorStopCandidate();
  candidate.operatorStopReason = "operator_stop_hotfix";
  assert.deepEqual(resumePlanRuntimeSupported(candidate), {
    ok: false,
    reason: "operator_stop_continuation_invalid",
  });
});

test("operator-stop continuation fails closed if exact viewport reuse is attempted", () => {
  const candidate = operatorStopCandidate();
  candidate.exactViewportResumeAvailable = true;
  candidate.safeRestartStrategy = "exact_checkpoint_resume";
  assert.deepEqual(resumePlanRuntimeSupported(candidate), {
    ok: false,
    reason: "operator_stop_continuation_invalid",
  });
});

test("operator-stop continuation fails closed without canonical source lineage", () => {
  const candidate = operatorStopCandidate();
  candidate.sourceLineageValid = false;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), {
    ok: false,
    reason: "operator_stop_continuation_invalid",
  });
});
