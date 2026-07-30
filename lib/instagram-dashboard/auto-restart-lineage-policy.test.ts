import assert from "node:assert/strict";
import test from "node:test";
import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";
import {
  authoritativeDelayRemainingSeconds,
  buildUnfollowResumeNotificationPayload,
  canonicalResumePlanForLatestRun,
  resumeLineageBudgetKey,
  validateResumeAuthorizationLineage,
} from "./auto-restart-lineage-policy.ts";

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
