import assert from "node:assert/strict";
import test from "node:test";

import {
  resumePlanRuntimeEvidence,
  resumePlanRuntimeSupported,
} from "./auto-restart-tick-helpers.ts";

type Candidate = Parameters<typeof resumePlanRuntimeSupported>[0];

function exactBacklogCandidate(): Candidate {
  return {
    restartNeeded: true,
    historicalSafeBoundaryFallback: false,
    safeRestartStrategy: "exact_checkpoint_resume",
    sourceBusinessSessionId: "business-session-1",
    nextRetryIndex: 1,
    blockReason: "",
    gateStatus: "eligible_preview",
    plannedRunType: "account_session",
    plannedPhasesToRun: { welcome: false, follow: false, unfollow: true },
    plannedQuotaRemaining: { welcome: 0, follow: 0, unfollow: 1, outreach: 0 },
    eligibleUnfollowCandidateCount: 1,
    unavailableUnfollowCandidateCount: 2,
    terminalUnfollowCandidateCount: 0,
    technicalHoldUnfollowCandidateCount: 2,
    unfollowBacklogTotal: 3,
    unfollowNextCandidateRetryAt: "2026-07-29T10:05:00.000Z",
    unfollowNextEvaluationAt: "2026-07-29T10:05:00.000Z",
    unfollowPhaseCircuitOpen: false,
    sourceLineageValid: true,
    reliability: {
      restartAllowed: true,
      restartBlockReason: "",
      sessionTerminationClass: "partial_resumable",
      unfollowPhaseStatus: "partial_resumable",
      unsafeMarkers: [],
      businessSessionId: "business-session-1",
      retryIndex: "0",
      nextRetryIndex: "1",
      failureCategory: "ui_partial_resumable",
      cleanupCompleted: true,
      lockReleased: true,
      businessDaySast: "2026-07-29",
      lastRunId: "run-1",
      lastRunStatus: "completed",
      sourceLabel: "test",
    },
    quotas: {
      follow: { doneToday: 20, capDay: 20, remaining: 0, plannedNextRunQuota: 0, enabled: true },
      unfollow: { doneToday: 49, capDay: 120, remaining: 71, plannedNextRunQuota: 50, enabled: true },
      welcome: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false },
      outreach: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false },
    },
  };
}

test("exact actionable backlog 1 is runtime-supported below daily and session remaining", () => {
  const candidate = exactBacklogCandidate();
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
  assert.deepEqual(resumePlanRuntimeEvidence(candidate), {
    actionable_backlog: 1,
    unavailable_backlog: 2,
    actionable_now: 1,
    technical_hold_total: 2,
    terminal_total: 0,
    remaining_total: 3,
    next_evaluation_at: "2026-07-29T10:05:00.000Z",
    hold_next_retry_at: "2026-07-29T10:05:00.000Z",
    canonical_live_unfollow_resume: false,
    source_request_id: null,
    canonical_attempt_id: null,
    lineage_valid: true,
    planned_resume_quota: { welcome: 0, follow: 0, unfollow: 1, outreach: 0 },
    daily_remaining: { welcome: 0, follow: 0, unfollow: 71, outreach: 0 },
    session_remaining: { welcome: 0, follow: 0, unfollow: 50, outreach: 0 },
    runtime_supported: true,
    runtime_support_block_reason: "",
  });
});

test("actionable backlog 5 produces a supported exact Unfollow-only resume", () => {
  const candidate = exactBacklogCandidate();
  candidate.eligibleUnfollowCandidateCount = 5;
  candidate.plannedQuotaRemaining!.unfollow = 5;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
});

test("live partial Unfollow continuation overrides only the stale Worker restart_not_needed verdict", () => {
  const candidate = exactBacklogCandidate();
  candidate.reliability.restartAllowed = false;
  candidate.reliability.restartBlockReason = "restart_not_needed";
  candidate.canonicalLiveUnfollowResumeAuthorized = true;
  candidate.sourceLineageValid = true;
  candidate.sourceRequestId = "request-2";
  candidate.canonicalAttemptId = 2;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
});

test("live continuation fails closed on an open circuit or superseded lineage", () => {
  const circuit = exactBacklogCandidate();
  circuit.reliability.restartAllowed = false;
  circuit.reliability.restartBlockReason = "restart_not_needed";
  circuit.canonicalLiveUnfollowResumeAuthorized = true;
  circuit.sourceLineageValid = true;
  circuit.sourceRequestId = "request-2";
  circuit.canonicalAttemptId = 2;
  circuit.unfollowPhaseCircuitOpen = true;
  assert.deepEqual(resumePlanRuntimeSupported(circuit), { ok: false, reason: "resume_plan_invalid" });

  const stale = exactBacklogCandidate();
  stale.reliability.restartAllowed = false;
  stale.reliability.restartBlockReason = "restart_not_needed";
  stale.canonicalLiveUnfollowResumeAuthorized = true;
  stale.sourceLineageValid = false;
  stale.sourceRequestId = "request-2";
  stale.canonicalAttemptId = 2;
  assert.deepEqual(resumePlanRuntimeSupported(stale), { ok: false, reason: "resume_plan_invalid" });
});

test("live continuation fails closed without the request-linked canonical attempt", () => {
  const candidate = exactBacklogCandidate();
  candidate.reliability.restartAllowed = false;
  candidate.reliability.restartBlockReason = "restart_not_needed";
  candidate.canonicalLiveUnfollowResumeAuthorized = true;
  candidate.sourceLineageValid = true;
  candidate.sourceRequestId = "request-2";
  candidate.canonicalAttemptId = null;
  assert.deepEqual(
    resumePlanRuntimeSupported(candidate),
    { ok: false, reason: "resume_plan_invalid" },
  );
});

test("live continuation cannot be forged without an explicit partial Unfollow outcome", () => {
  const candidate = exactBacklogCandidate();
  candidate.reliability.restartAllowed = false;
  candidate.reliability.restartBlockReason = "restart_not_needed";
  candidate.reliability.unfollowPhaseStatus = "completed";
  candidate.canonicalLiveUnfollowResumeAuthorized = true;
  candidate.sourceLineageValid = true;
  candidate.sourceRequestId = "request-2";
  candidate.canonicalAttemptId = 2;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: false, reason: "resume_plan_invalid" });
});

test("live continuation never bypasses a critical Worker restart block", () => {
  const candidate = exactBacklogCandidate();
  candidate.reliability.restartAllowed = false;
  candidate.reliability.restartBlockReason = "cleanup_not_completed";
  candidate.canonicalLiveUnfollowResumeAuthorized = true;
  candidate.sourceLineageValid = true;
  candidate.sourceRequestId = "request-2";
  candidate.canonicalAttemptId = 2;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: false, reason: "resume_plan_invalid" });
});

test("session quota smaller than daily remaining remains a valid exact bound", () => {
  const candidate = exactBacklogCandidate();
  candidate.eligibleUnfollowCandidateCount = 5;
  candidate.plannedQuotaRemaining!.unfollow = 5;
  candidate.quotas.unfollow.remaining = 71;
  candidate.quotas.unfollow.plannedNextRunQuota = 5;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
});

test("Follow-only partial resume remains supported", () => {
  const candidate = exactBacklogCandidate();
  candidate.plannedPhasesToRun = { welcome: false, follow: true, unfollow: false };
  candidate.plannedQuotaRemaining = { welcome: 0, follow: 7, unfollow: 0, outreach: 0 };
  candidate.eligibleUnfollowCandidateCount = 0;
  candidate.quotas.follow = {
    doneToday: 3,
    capDay: 20,
    remaining: 17,
    plannedNextRunQuota: 10,
    enabled: true,
  };
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
});

test("runtime support validation never mutates persistent caps", () => {
  const candidate = exactBacklogCandidate();
  const capsBefore = structuredClone(candidate.quotas);
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
  assert.deepEqual(candidate.quotas, capsBefore);
});

test("unavailable backlog never authorizes an Unfollow resume", () => {
  const candidate = exactBacklogCandidate();
  candidate.eligibleUnfollowCandidateCount = 0;
  candidate.unavailableUnfollowCandidateCount = 3;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: false, reason: "resume_plan_invalid" });
});

test("planned Unfollow quota cannot exceed actionable backlog", () => {
  const candidate = exactBacklogCandidate();
  candidate.plannedQuotaRemaining!.unfollow = 2;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: false, reason: "resume_plan_invalid" });
});

test("planned Unfollow quota cannot exceed daily remaining", () => {
  const candidate = exactBacklogCandidate();
  candidate.quotas.unfollow.remaining = 0;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: false, reason: "resume_plan_invalid" });
});

test("planned Unfollow quota cannot exceed session remaining", () => {
  const candidate = exactBacklogCandidate();
  candidate.quotas.unfollow.plannedNextRunQuota = 0;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: false, reason: "resume_plan_invalid" });
});

test("planned Unfollow quota equal to daily remaining is supported", () => {
  const candidate = exactBacklogCandidate();
  candidate.quotas.unfollow.remaining = 1;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
});

test("planned Unfollow quota equal to session remaining is supported", () => {
  const candidate = exactBacklogCandidate();
  candidate.quotas.unfollow.plannedNextRunQuota = 1;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: true, reason: "" });
});

test("phase flags and exact quotas must describe the same work", () => {
  const candidate = exactBacklogCandidate();
  candidate.plannedPhasesToRun!.unfollow = false;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: false, reason: "resume_plan_invalid" });
});

test("a terminal completed session remains ineligible even with stale backlog", () => {
  const candidate = exactBacklogCandidate();
  candidate.reliability.sessionTerminationClass = "completed";
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: false, reason: "no_partial_run_to_resume" });
});

test("non-integer manual resume quota fails closed", () => {
  const candidate = exactBacklogCandidate();
  candidate.plannedQuotaRemaining!.unfollow = 1.5;
  assert.deepEqual(resumePlanRuntimeSupported(candidate), { ok: false, reason: "resume_plan_invalid" });
});
