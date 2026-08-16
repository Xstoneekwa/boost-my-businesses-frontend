import assert from "node:assert/strict";
import test from "node:test";
import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";
import {
  authoritativeDelayRemainingSeconds,
  buildUnfollowResumeNotificationPayload,
  canonicalResumePlanForLatestRun,
  resolveCanonicalAttemptIdentity,
  resolveCanonicalNextRetryIndex,
  resumeLineageBudgetKey,
  validateResumeAuthorizationLineage,
  isZeroBusinessInfrastructureRetry,
} from "./auto-restart-lineage-policy.ts";

test("the linked request is canonical when the run projection has a stale attempt", () => {
  assert.deepEqual(resolveCanonicalAttemptIdentity({
    sourceRunId: "run-mythyl",
    sourceRequest: {
      id: "request-mythyl",
      run_id: "run-mythyl",
      metadata_safe: { attempt_id: 2 },
    },
    runProjectionAttemptId: 1,
  }), {
    sourceRequestId: "request-mythyl",
    canonicalAttemptId: 2,
    requestAttemptId: 2,
    runProjectionAttemptId: 1,
    attemptSource: "account_run_requests.metadata_safe.attempt_id",
    divergence: true,
    attemptContractMissing: false,
    lineageValid: true,
  });
  assert.equal(resolveCanonicalNextRetryIndex({
    canonicalAttemptId: 2,
    retryIndex: "0",
    nextRetryIndex: "1",
  }), 2);
});

test("a request bound to an older run fails closed", () => {
  const identity = resolveCanonicalAttemptIdentity({
    sourceRunId: "run-new",
    sourceRequest: {
      id: "request-old",
      run_id: "run-old",
      metadata_safe: { attempt_id: 2 },
    },
    runProjectionAttemptId: 1,
  });
  assert.equal(identity.lineageValid, false);
  assert.equal(identity.canonicalAttemptId, null);
});

test("legacy initial requests without attempt metadata use an explicit run fallback", () => {
  const identity = resolveCanonicalAttemptIdentity({
    sourceRunId: "run-loriele",
    sourceRequest: {
      id: "request-loriele",
      run_id: "run-loriele",
      metadata_safe: {},
    },
    runProjectionAttemptId: 1,
  });
  assert.equal(identity.canonicalAttemptId, 1);
  assert.equal(identity.attemptSource, "ig_runs.performance_summary.attempt_id_fallback");
  assert.equal(identity.divergence, false);
  assert.equal(identity.attemptContractMissing, false);
  assert.equal(identity.lineageValid, true);
});

test("a source request with no request or run attempt cannot authorize continuation", () => {
  const identity = resolveCanonicalAttemptIdentity({
    sourceRunId: "run-loriele",
    sourceRequest: {
      id: "request-loriele",
      run_id: "run-loriele",
      metadata_safe: {},
    },
  });
  assert.equal(identity.canonicalAttemptId, null);
  assert.equal(identity.attemptSource, "missing");
  assert.equal(identity.lineageValid, false);
});

test("resume_plan.current_attempt_id is accepted as the request-linked canonical attempt", () => {
  const identity = resolveCanonicalAttemptIdentity({
    sourceRunId: "run-retry",
    sourceAccountId: "account-1",
    sourceRequest: {
      id: "request-retry",
      account_id: "account-1",
      run_id: "run-retry",
      metadata_safe: {
        resume_plan_version: 2,
        resume_plan: { current_attempt_id: 2 },
      },
    },
    runProjectionAttemptId: 1,
  });
  assert.equal(identity.canonicalAttemptId, 2);
  assert.equal(identity.divergence, true);
  assert.equal(identity.lineageValid, true);
});

test("a retry request missing its canonical attempt fails closed instead of falling back to run attempt 1", () => {
  const identity = resolveCanonicalAttemptIdentity({
    sourceRunId: "run-retry",
    sourceAccountId: "account-1",
    sourceRequest: {
      id: "request-retry",
      account_id: "account-1",
      run_id: "run-retry",
      metadata_safe: { resume_plan_version: 2, resume_plan: {} },
    },
    runProjectionAttemptId: 1,
  });
  assert.equal(identity.canonicalAttemptId, null);
  assert.equal(identity.attemptContractMissing, true);
  assert.equal(identity.lineageValid, false);
  assert.equal(identity.attemptSource, "account_run_requests.retry_attempt_missing_fail_closed");
});

test("missing or cross-account source requests cannot authorize a live continuation", () => {
  assert.equal(resolveCanonicalAttemptIdentity({
    sourceRunId: "run-1",
    sourceAccountId: "account-1",
    runProjectionAttemptId: 1,
  }).lineageValid, false);
  assert.equal(resolveCanonicalAttemptIdentity({
    sourceRunId: "run-1",
    sourceAccountId: "account-1",
    sourceRequest: {
      id: "request-1",
      account_id: "account-other",
      run_id: "run-1",
      metadata_safe: {},
    },
    runProjectionAttemptId: 1,
  }).lineageValid, false);
});

test("a resume plan is authoritative only for the latest canonical run", () => {
  const latest = { id: "run-new" };
  const stale = { run_id: "run-old", plan: { restart_allowed: true } };
  const aligned = { run_id: "run-new", plan: { restart_allowed: true } };
  assert.equal(canonicalResumePlanForLatestRun(latest, stale), undefined);
  assert.equal(canonicalResumePlanForLatestRun(latest, aligned), aligned);
});

test("stale and mismatched human resume lineages fail closed", () => {
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-old",
    incidentRunId: "run-old",
    storedPlanRunId: "run-old",
    latestCanonicalRunId: "run-new",
    latestTerminationClass: "partial_resumable",
  }), { ok: false, reason: "resume_source_run_superseded" });
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-new",
    incidentRunId: "run-other",
    storedPlanRunId: "run-new",
    latestCanonicalRunId: "run-new",
    latestTerminationClass: "partial_resumable",
  }), { ok: false, reason: "resume_lineage_mismatch" });
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-new",
    incidentRunId: "run-new",
    storedPlanRunId: "run-new",
    latestCanonicalRunId: "run-new",
    latestTerminationClass: "completed",
    resolvedIncidentAuthorized: true,
  }), { ok: false, reason: "resume_authorization_stale" });
});

test("only an aligned latest partial lineage is accepted", () => {
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-new",
    incidentRunId: "run-new",
    storedPlanRunId: "run-new",
    latestCanonicalRunId: "run-new",
    latestTerminationClass: "partial_resumable",
  }), { ok: true, reason: "" });
});

test("resolved incident repairs only a completed session with canonical failed Unfollow backlog", () => {
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-1",
    incidentRunId: "run-1",
    storedPlanRunId: "run-1",
    latestCanonicalRunId: "run-1",
    latestTerminationClass: "completed",
    resolvedIncidentAuthorized: true,
    canonicalLiveUnfollowResumeAuthorized: true,
  }), { ok: true, reason: "" });

  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-1",
    incidentRunId: "run-1",
    storedPlanRunId: "run-1",
    latestCanonicalRunId: "run-1",
    latestTerminationClass: "completed",
    resolvedIncidentAuthorized: true,
    canonicalLiveUnfollowResumeAuthorized: false,
  }), { ok: false, reason: "resume_authorization_stale" });
});

test("a resolved exact incident authorizes one new boundary after a non-recoverable stop", () => {
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-mythyl",
    incidentRunId: "run-mythyl",
    storedPlanRunId: "run-mythyl",
    latestCanonicalRunId: "run-mythyl",
    latestTerminationClass: "non_recoverable_failure",
    resolvedIncidentAuthorized: true,
  }), { ok: true, reason: "" });
});

test("an explicitly proven pre-run incident may use its request-bound source run", () => {
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-1",
    incidentRunId: "",
    storedPlanRunId: "run-1",
    latestCanonicalRunId: "run-1",
    latestTerminationClass: "non_recoverable_failure",
    resolvedIncidentAuthorized: true,
    preRunIncidentLineageProven: true,
  }), { ok: true, reason: "" });
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-1",
    incidentRunId: "",
    storedPlanRunId: "run-1",
    latestCanonicalRunId: "run-1",
    latestTerminationClass: "non_recoverable_failure",
    resolvedIncidentAuthorized: true,
  }), { ok: false, reason: "resume_lineage_mismatch" });
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-1",
    incidentRunId: "",
    storedPlanRunId: "run-2",
    latestCanonicalRunId: "run-1",
    latestTerminationClass: "non_recoverable_failure",
    resolvedIncidentAuthorized: true,
    preRunIncidentLineageProven: true,
  }), { ok: false, reason: "resume_lineage_mismatch" });
});

test("a non-recoverable stop without resolved-incident authorization remains blocked", () => {
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-mythyl",
    incidentRunId: "run-mythyl",
    storedPlanRunId: "run-mythyl",
    latestCanonicalRunId: "run-mythyl",
    latestTerminationClass: "non_recoverable_failure",
    resolvedIncidentAuthorized: false,
  }), { ok: false, reason: "resume_authorization_stale" });
});

test("resolved review never bypasses exact latest-run lineage", () => {
  assert.deepEqual(validateResumeAuthorizationLineage({
    authorizationRunId: "run-old",
    incidentRunId: "run-old",
    storedPlanRunId: "run-old",
    latestCanonicalRunId: "run-new",
    latestTerminationClass: "non_recoverable_failure",
    resolvedIncidentAuthorized: true,
  }), { ok: false, reason: "resume_source_run_superseded" });
});

test("an exact SIGTERM child with zero business actions preserves the authorized lineage", () => {
  const base = {
    authorizationId: "auth-1",
    authorizationRunId: "run-source",
    accountId: "account-1",
    latestRun: {
      id: "run-child",
      account_id: "account-1",
      status: "failed",
      total_follow: 0,
      total_like: 0,
      total_dm: 0,
      total_story: 0,
      totals: { total_follow: 0, total_like: 0, total_dm: 0, total_story: 0 },
      performance_summary: { exit_code: 143 },
    },
    latestRequest: {
      id: "request-child",
      account_id: "account-1",
      run_id: "run-child",
      status: "failed",
      error_code: "worker_exit_nonzero",
      metadata_safe: {
        authorization_id: "auth-1",
        recovery_mode: "human_confirmed_resume",
        source_run_id: "run-source",
      },
    },
    successfulBusinessActionObserved: false,
  };
  assert.equal(isZeroBusinessInfrastructureRetry(base), true);
  assert.equal(isZeroBusinessInfrastructureRetry({ ...base, successfulBusinessActionObserved: true }), false);
  assert.equal(isZeroBusinessInfrastructureRetry({
    ...base,
    latestRun: { ...base.latestRun, total_follow: 1 },
  }), false);
  assert.equal(isZeroBusinessInfrastructureRetry({
    ...base,
    latestRequest: { ...base.latestRequest, metadata_safe: { ...base.latestRequest.metadata_safe, authorization_id: "auth-other" } },
  }), false);
  assert.equal(isZeroBusinessInfrastructureRetry({
    ...base,
    latestRun: { ...base.latestRun, performance_summary: { exit_code: 1 } },
  }), false);
});

test("configured delay reports exact authoritative remaining seconds", () => {
  const now = new Date("2026-07-30T10:00:00.000Z");
  assert.equal(authoritativeDelayRemainingSeconds("2026-07-30T10:10:00.000Z", now), 600);
  assert.equal(authoritativeDelayRemainingSeconds("2026-07-30T10:00:20.000Z", now), 20);
  assert.equal(authoritativeDelayRemainingSeconds("2026-07-30T09:59:59.000Z", now), 0);
  assert.equal(authoritativeDelayRemainingSeconds(
    "2026-07-30T10:10:00.000Z",
    new Date("2026-07-30T10:09:59.000Z"),
  ), 1);
  assert.equal(authoritativeDelayRemainingSeconds(
    "2026-07-30T10:10:00.000Z",
    new Date("2026-07-30T10:10:00.000Z"),
  ), 0);
});

function candidate(): AutoRestartCandidate {
  return {
    accountId: "account-1",
    deviceId: "device-1",
    appInstanceId: "instance-1",
    username: "j_automatise_pour_toi",
    packageLabel: "Growth",
    configuredRestartDelayMinutes: 10,
    eligibleUnfollowCandidateCount: 38,
    technicalHoldUnfollowCandidateCount: 1,
    terminalUnfollowCandidateCount: 2,
    unfollowPhaseCircuitOpen: false,
    unfollowPhaseCircuitReason: null,
    commercialAddonsLabel: "",
    outreachSourceLabel: "",
    runtimeProfilesLabel: "",
    followFiltersLabel: "",
    enabledServices: ["Unfollow"],
    phoneName: "A16-01",
    phoneRestStatus: "clear",
    sessionWindowStatus: "in_window",
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
    sourceRunId: "run-new",
    sourceBusinessSessionId: "business-session-1",
    priorTargetId: null,
    nextTargetId: null,
    nextRetryIndex: 1,
    remainingFollowQuota: 0,
    plannedPhasesToRun: { welcome: false, follow: false, unfollow: true },
    plannedQuotaRemaining: { welcome: 0, follow: 0, unfollow: 38, outreach: 0 },
    decisionOutcome: "eligible",
    restartEligible: true,
    blockReason: "",
    plannedRunType: "account_session",
    reliability: {
      restartAllowed: true,
      restartBlockReason: "",
      unsafeMarkers: [],
      currentAttempt: "1",
      nextAttempt: "2",
      nextRestartAt: "2026-07-30T10:10:00.000Z",
      lastRestartError: "",
      sessionTerminationClass: "partial_resumable",
      businessSessionId: "business-session-1",
      attemptId: "1",
      retryIndex: "0",
      nextRetryIndex: "1",
      previousRunId: "run-parent",
      rootFailureCode: "ui_repeated_viewport_limit_after_recovery",
      failureSignature: "",
      failureCategory: "",
      cleanupCompleted: true,
      lockReleased: true,
      businessDaySast: "2026-07-30",
      phasesToRun: { welcome: false, follow: false, unfollow: true },
      quotaRemaining: { unfollow: 38 },
      safeCheckpointAvailable: true,
      targetRotationSafeAfterScrollFailure: false,
      scrollFailureSurfaceAmbiguous: false,
      businessProgressMade: true,
      lastRunId: "run-new",
      lastRunStatus: "completed",
      sourceLabel: "test",
    },
    quotas: {
      follow: { doneToday: 50, capDay: 80, remaining: 30, plannedNextRunQuota: 0, enabled: true, sourceLabel: "test" },
      unfollow: { doneToday: 58, capDay: 80, remaining: 22, plannedNextRunQuota: 22, enabled: true, sourceLabel: "test" },
      welcome: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "test" },
      outreach: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "test" },
    },
  };
}

test("bounded lineage key includes account, source run, phase and reason", () => {
  assert.equal(
    resumeLineageBudgetKey(candidate()),
    "account-1:run-new:unfollow:ui_repeated_viewport_limit_after_recovery",
  );
});

test("notification payload contains the operational restart facts", () => {
  const payload = buildUnfollowResumeNotificationPayload({
    candidate: candidate(),
    reason: "restart_delay_not_elapsed",
    evaluatedAt: "2026-07-30T10:00:00.000Z",
    authorizationSource: "incident_resume_authorizations",
  });
  assert.equal(payload.event_code, "UNFOLLOW_RESUME_WAITING_AUTHORITATIVE_DELAY");
  assert.equal(payload.run_source, "run-new");
  assert.equal(payload.run_parent, "run-parent");
  assert.equal(payload.configured_delay_minutes, 10);
  assert.equal(payload.delay_remaining_seconds, 600);
  assert.equal(payload.phase_requested, "unfollow");
  assert.equal(payload.unfollow_actionable, 38);
  assert.equal(payload.unfollow_holds, 1);
  assert.equal(payload.unfollow_terminal_unavailable, 2);
  assert.equal(payload.next_action, "wait_next_natural_tick_after_delay");
});
