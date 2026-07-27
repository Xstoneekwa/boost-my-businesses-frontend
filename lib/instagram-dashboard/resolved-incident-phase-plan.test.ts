import assert from "node:assert/strict";
import test from "node:test";
import { buildAutoRestartResumePlanMetadata, validateCanonicalResumePlan } from "./auto-restart-resume-metadata.ts";

const candidate = {
  accountId: "00000000-0000-4000-8000-000000000001",
  assignmentId: "00000000-0000-4000-8000-000000000002",
  deviceId: "00000000-0000-4000-8000-000000000003",
  appInstanceId: "00000000-0000-4000-8000-000000000004",
  username: "generic_account",
  packageLabel: "Premium",
  packageCode: "premium",
  packageCaps: { follow_day: 120 },
  followSessionOverride: 50,
  maxFollowsPerTargetPerRun: 30,
  maxTargetsPerRun: 4,
  warmupDay: 1,
  warmupStatus: "active",
  scheduledWindowStart: "2026-07-27T20:00:00.000Z",
  scheduledWindowEnd: "2026-07-28T02:00:00.000Z",
  eligibleFollowTargetCount: 13,
  commercialAddonsLabel: "",
  outreachSourceLabel: "",
  runtimeProfilesLabel: "",
  followFiltersLabel: "",
  enabledServices: ["Follow"],
  phoneName: "phone",
  phoneRestStatus: "clear",
  sessionWindowStatus: "in_window",
  assignmentStatus: "active",
  gateStatus: "eligible_preview",
  accountEligible: true,
  accountEligibilityReason: "eligible",
  restartNeeded: true,
  restartNeedReason: "partial_resumable",
  exactViewportResumeAvailable: false,
  safeRestartStrategy: "next_target" as const,
  safeRestartReason: "next_target_available",
  historicalSafeBoundaryFallback: false,
  enqueueAllowed: true,
  sourceRunId: "00000000-0000-4000-8000-000000000005",
  sourceBusinessSessionId: "session-1",
  priorTargetId: null,
  nextTargetId: "00000000-0000-4000-8000-000000000006",
  nextRetryIndex: 1,
  remainingFollowQuota: 10,
  decisionOutcome: "eligible" as const,
  restartEligible: true,
  blockReason: "",
  plannedRunType: "account_session" as const,
  reliability: {
    restartAllowed: true, restartBlockReason: "", unsafeMarkers: [], currentAttempt: "1",
    nextAttempt: "2", nextRestartAt: null, lastRestartError: "", sessionTerminationClass: "partial_resumable",
    businessSessionId: "session-1", attemptId: "1", retryIndex: "0", nextRetryIndex: "1",
    previousRunId: "", rootFailureCode: "", failureSignature: "", failureCategory: "",
    cleanupCompleted: true, lockReleased: true, businessDaySast: "2026-07-27",
    phasesToRun: { welcome: false, follow: true, unfollow: false }, quotaRemaining: {},
    safeCheckpointAvailable: true, targetRotationSafeAfterScrollFailure: true,
    scrollFailureSurfaceAmbiguous: false, lastRunId: "00000000-0000-4000-8000-000000000005",
    lastRunStatus: "failed", sourceLabel: "test",
  },
  quotas: {
    follow: { doneToday: 0, capDay: 10, remaining: 10, plannedNextRunQuota: 10, enabled: true, sourceLabel: "test" },
    unfollow: { doneToday: 0, capDay: 50, remaining: 50, plannedNextRunQuota: 0, enabled: false, sourceLabel: "test" },
    welcome: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "test" },
    outreach: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "test" },
  },
};

test("V2 freezes one explicit actionable phase plan", () => {
  const metadata = buildAutoRestartResumePlanMetadata(candidate);
  assert.equal(metadata.resume_plan.schema, "AUTO_RESTART_RESUME_PLAN_V2");
  assert.deepEqual(metadata.resume_plan.phases_to_run, { welcome: false, follow: true, unfollow: false });
  assert.equal(metadata.resume_plan.quota_remaining.follow, 10);
  assert.equal(metadata.resume_plan.candidate_counts.follow_targets, 13);
  assert.equal(metadata.resume_plan.follow_session_override, 50);
  assert.equal(metadata.resume_plan.max_follows_per_target_per_run, 30);
  assert.equal(metadata.resume_plan.max_targets_per_run, 4);
  assert.equal(validateCanonicalResumePlan(metadata.resume_plan), null);
});

test("unknown plan and zero-quota enabled phase fail closed", () => {
  assert.equal(validateCanonicalResumePlan({}), "phase_plan_unknown");
  const metadata = buildAutoRestartResumePlanMetadata(candidate);
  metadata.resume_plan.quota_remaining.follow = 0;
  assert.equal(validateCanonicalResumePlan(metadata.resume_plan), "phase_plan_quota_invalid");
});

test("no executable phase is rejected before authorization consumption", () => {
  const metadata = buildAutoRestartResumePlanMetadata({
    ...candidate,
    reliability: { ...candidate.reliability, phasesToRun: { welcome: false, follow: false, unfollow: false } },
  });
  assert.equal(validateCanonicalResumePlan(metadata.resume_plan), "resume_phase_plan_not_actionable");
});
