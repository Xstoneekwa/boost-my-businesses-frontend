import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutoRestartResumePlanMetadata,
  buildInstagramRestrictionPreflightMetadata,
  rebuildResolvedIncidentResumeCandidate,
  validateCanonicalResumePlan,
} from "./auto-restart-resume-metadata.ts";

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
  eligibleUnfollowCandidateCount: 12,
  unavailableUnfollowCandidateCount: 0,
  terminalUnfollowCandidateCount: 0,
  technicalHoldUnfollowCandidateCount: 0,
  unfollowPhaseCircuitOpen: false,
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
  plannedPhasesToRun: { welcome: false, follow: true, unfollow: false },
  plannedQuotaRemaining: { welcome: 0, follow: 10, unfollow: 0, outreach: 0 },
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
    plannedPhasesToRun: { welcome: false, follow: false, unfollow: false },
    plannedQuotaRemaining: { welcome: 0, follow: 0, unfollow: 0, outreach: 0 },
    reliability: { ...candidate.reliability, phasesToRun: { welcome: false, follow: false, unfollow: false } },
  });
  assert.equal(validateCanonicalResumePlan(metadata.resume_plan), "resume_phase_plan_not_actionable");
});

test("resolved incident rebuild ignores a stale empty historical phase plan", () => {
  const stale = {
    ...candidate,
    plannedPhasesToRun: { welcome: false, follow: false, unfollow: false },
    plannedQuotaRemaining: { welcome: 0, follow: 0, unfollow: 0, outreach: 0 },
    enqueueAllowed: false,
    restartEligible: false,
    plannedRunType: "none" as const,
    decisionOutcome: "not_needed" as const,
    blockReason: "all_enabled_phase_work_completed",
    reliability: {
      ...candidate.reliability,
      phasesToRun: { welcome: false, follow: false, unfollow: false },
      quotaRemaining: { welcome: 0, follow: 0, unfollow: 0 },
    },
  };
  const rebuilt = rebuildResolvedIncidentResumeCandidate(stale);
  assert.deepEqual(rebuilt.plannedPhasesToRun, { welcome: false, follow: true, unfollow: false });
  assert.equal(rebuilt.plannedQuotaRemaining.follow, 10);
  assert.equal(rebuilt.enqueueAllowed, true);
  assert.equal(rebuilt.safeRestartStrategy, "next_target");
  assert.equal(validateCanonicalResumePlan(buildAutoRestartResumePlanMetadata(rebuilt).resume_plan), null);
});

test("resolved incident remains armed when no live phase is actionable", () => {
  const rebuilt = rebuildResolvedIncidentResumeCandidate({
    ...candidate,
    eligibleFollowTargetCount: 0,
    quotas: {
      ...candidate.quotas,
      follow: { ...candidate.quotas.follow, remaining: 10 },
      unfollow: { ...candidate.quotas.unfollow, enabled: false, remaining: 0 },
      welcome: { ...candidate.quotas.welcome, enabled: false, remaining: 0 },
    },
  });
  assert.deepEqual(rebuilt.plannedPhasesToRun, { welcome: false, follow: false, unfollow: false });
  assert.equal(rebuilt.enqueueAllowed, false);
  assert.equal(rebuilt.blockReason, "resume_phase_plan_not_actionable");
  assert.equal(
    validateCanonicalResumePlan(buildAutoRestartResumePlanMetadata(rebuilt).resume_plan),
    "resume_phase_plan_not_actionable",
  );
});

test("resolved incident rebuild uses every live enabled account-session quota", () => {
  const rebuilt = rebuildResolvedIncidentResumeCandidate({
    ...candidate,
    eligibleUnfollowCandidateCount: 12,
    quotas: {
      ...candidate.quotas,
      follow: { ...candidate.quotas.follow, remaining: 7 },
      unfollow: { ...candidate.quotas.unfollow, enabled: true, remaining: 12 },
      welcome: { ...candidate.quotas.welcome, enabled: true, remaining: 3 },
    },
  });
  assert.deepEqual(rebuilt.plannedPhasesToRun, { welcome: true, follow: true, unfollow: true });
  assert.deepEqual(rebuilt.plannedQuotaRemaining, { welcome: 3, follow: 7, unfollow: 12, outreach: 0 });
});

test("resolved incident never revives an Unfollow phase with only unavailable candidates", () => {
  const rebuilt = rebuildResolvedIncidentResumeCandidate({
    ...candidate,
    eligibleFollowTargetCount: 0,
    eligibleUnfollowCandidateCount: 0,
    unavailableUnfollowCandidateCount: 1,
    quotas: {
      ...candidate.quotas,
      follow: { ...candidate.quotas.follow, enabled: false, remaining: 0 },
      unfollow: { ...candidate.quotas.unfollow, enabled: true, remaining: 50 },
      welcome: { ...candidate.quotas.welcome, enabled: false, remaining: 0 },
    },
  });
  assert.equal(rebuilt.plannedPhasesToRun.unfollow, false);
  assert.equal(rebuilt.plannedQuotaRemaining.unfollow, 0);
  assert.equal(rebuilt.enqueueAllowed, false);
});

test("resolved incident rebuild excludes terminal and held Unfollow backlog", () => {
  const rebuilt = rebuildResolvedIncidentResumeCandidate({
    ...candidate,
    eligibleFollowTargetCount: 0,
    eligibleUnfollowCandidateCount: 0,
    terminalUnfollowCandidateCount: 5,
    technicalHoldUnfollowCandidateCount: 2,
    quotas: {
      ...candidate.quotas,
      follow: { ...candidate.quotas.follow, enabled: false, remaining: 0 },
      unfollow: { ...candidate.quotas.unfollow, enabled: true, remaining: 12 },
      welcome: { ...candidate.quotas.welcome, enabled: false, remaining: 0 },
    },
  });
  assert.equal(rebuilt.plannedPhasesToRun.unfollow, false);
  assert.equal(rebuilt.plannedQuotaRemaining.unfollow, 0);
  assert.equal(rebuilt.restartEligible, false);
});

test("Unfollow phase circuit never disables still-actionable Follow", () => {
  const rebuilt = rebuildResolvedIncidentResumeCandidate({
    ...candidate,
    eligibleUnfollowCandidateCount: 12,
    unfollowPhaseCircuitOpen: true,
    quotas: {
      ...candidate.quotas,
      follow: { ...candidate.quotas.follow, enabled: true, remaining: 7 },
      unfollow: { ...candidate.quotas.unfollow, enabled: true, remaining: 12 },
    },
  });
  assert.deepEqual(rebuilt.plannedPhasesToRun, {
    welcome: false,
    follow: true,
    unfollow: false,
  });
  assert.equal(rebuilt.restartEligible, true);
});

test("a restriction preflight is the only valid zero-business-phase plan", () => {
  const metadata = buildInstagramRestrictionPreflightMetadata({
    accountId: "00000000-0000-4000-8000-000000000001",
    assignmentId: "00000000-0000-4000-8000-000000000002",
    deviceId: "00000000-0000-4000-8000-000000000003",
    appInstanceId: "00000000-0000-4000-8000-000000000004",
    incidentId: "00000000-0000-4000-8000-000000000005",
    authorizationId: "00000000-0000-4000-8000-000000000006",
    resumePlanId: "00000000-0000-4000-8000-000000000007",
    originalRunId: "00000000-0000-4000-8000-000000000008",
    retryGeneration: 0,
    now: new Date("2026-07-27T14:00:00.000Z"),
  });
  assert.equal(validateCanonicalResumePlan(metadata.resume_plan), null);
  assert.deepEqual(metadata.resume_plan.phases_to_run, {
    welcome: false,
    follow: false,
    unfollow: false,
  });
  assert.equal(metadata.resume_plan.quota_remaining.total, 0);
  assert.equal(metadata.restriction_preflight_only, true);

  const unsafe = structuredClone(metadata.resume_plan);
  unsafe.phases_to_run.unfollow = true;
  assert.equal(validateCanonicalResumePlan(unsafe), "restriction_preflight_contract_invalid");
});
