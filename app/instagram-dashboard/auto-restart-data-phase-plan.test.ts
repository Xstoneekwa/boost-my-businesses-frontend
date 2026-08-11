import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  pruneTerminalAccountSessionPhases,
  resolveBoundedSessionQuota,
  resolvePartialUnfollowLiveResume,
  resolvePhaseCompletion,
  resolvePlannedAccountSession,
  resolveUnfollowTechnicalHoldRestartGate,
} from "../../lib/instagram-dashboard/auto-restart-phase-plan.ts";

test("a runtime session cap of zero remains zero and cannot fall back to the day cap", () => {
  assert.deepEqual(resolveBoundedSessionQuota({
    doneToday: 41,
    capDay: 120,
    sessionCap: 0,
    enabled: true,
  }), {
    remaining: 79,
    plannedNextRunQuota: 0,
  });
});

const quota = (remaining: number, enabled = true) => ({
  doneToday: 0,
  capDay: 120,
  remaining,
  plannedNextRunQuota: remaining,
  enabled,
  sourceLabel: "test",
});

const partialUnfollow = (overrides: Partial<Parameters<typeof resolvePartialUnfollowLiveResume>[0]> = {}) =>
  resolvePartialUnfollowLiveResume({
    sessionTerminationClass: "partial_resumable",
    unfollowPhaseStatus: "partial_resumable",
    lineageValid: true,
    autoRestartEnabled: true,
    unfollowEnabled: true,
    dailyQuotaRemaining: 79,
    sessionQuotaRemaining: 50,
    actionableNow: 3,
    technicalHoldTotal: 3,
    terminalTotal: 0,
    nextCandidateRetryAt: "2026-07-30T18:03:55.000Z",
    phaseCircuitOpen: false,
    phaseCircuitNextRetryAt: null,
    ...overrides,
  });

test("Loriele partial remainder rebuilds an exact Unfollow-only quota from actionable_now", () => {
  const continuation = partialUnfollow();
  assert.deepEqual(continuation, {
    applies: true,
    authorized: true,
    reason: "partial_resumable_live_unfollow_backlog",
    backlogTotal: 6,
    actionableNow: 3,
    technicalHoldTotal: 3,
    terminalTotal: 0,
    plannedQuota: 3,
    nextEvaluationAt: null,
  });
  assert.deepEqual(resolvePlannedAccountSession({
    persistedPhases: {
      welcome: false,
      follow: false,
      unfollow: continuation.authorized,
    },
    persistedQuotaRemaining: {
      welcome: 0,
      follow: 0,
      unfollow: continuation.plannedQuota,
    },
    quotas: {
      welcome: quota(0, false),
      follow: quota(70),
      unfollow: quota(79),
    },
    eligibleWorkRemaining: { unfollow: continuation.actionableNow },
  }), {
    phases: { welcome: false, follow: false, unfollow: true },
    remaining: { welcome: 0, follow: 0, unfollow: 3 },
    totalRemaining: 3,
  });
});

test("the phase circuit remains authoritative even when three candidates are actionable", () => {
  assert.deepEqual(partialUnfollow({
    phaseCircuitOpen: true,
    phaseCircuitNextRetryAt: "2026-07-30T18:04:34.000Z",
  }), {
    applies: true,
    authorized: false,
    reason: "unfollow_phase_circuit_open",
    backlogTotal: 6,
    actionableNow: 3,
    technicalHoldTotal: 3,
    terminalTotal: 0,
    plannedQuota: 0,
    nextEvaluationAt: "2026-07-30T18:04:34.000Z",
  });
});

test("expired holds become live actionables only on a future canonical backlog evaluation", () => {
  const future = partialUnfollow({
    actionableNow: 6,
    technicalHoldTotal: 0,
    nextCandidateRetryAt: null,
  });
  assert.equal(future.authorized, true);
  assert.equal(future.plannedQuota, 6);
});

test("daily and session limits bound the live continuation", () => {
  assert.equal(partialUnfollow({ actionableNow: 40, dailyQuotaRemaining: 2 }).plannedQuota, 2);
  assert.equal(partialUnfollow({ actionableNow: 40, sessionQuotaRemaining: 1 }).plannedQuota, 1);
});

test("a completed frozen session target never hides newly actionable live backlog", () => {
  const continuation = partialUnfollow({ actionableNow: 4, technicalHoldTotal: 0 });
  assert.equal(continuation.authorized, true);
  assert.equal(continuation.plannedQuota, 4);
  const plan = resolvePlannedAccountSession({
    persistedPhases: { welcome: false, follow: false, unfollow: continuation.authorized },
    persistedQuotaRemaining: { welcome: 0, follow: 0, unfollow: continuation.plannedQuota },
    quotas: { welcome: quota(0, false), follow: quota(70), unfollow: quota(79) },
    eligibleWorkRemaining: { unfollow: continuation.actionableNow },
  });
  assert.deepEqual(plan.phases, { welcome: false, follow: false, unfollow: true });
  assert.deepEqual(plan.remaining, { welcome: 0, follow: 0, unfollow: 4 });
});

test("a planned but never-started Unfollow phase cannot convert a Follow partial into Unfollow-only", () => {
  const result = partialUnfollow({ unfollowPhaseStatus: "" });
  assert.equal(result.applies, false);
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "not_partial_unfollow_lineage");
});

test("a stale or superseded source lineage fails closed", () => {
  assert.equal(partialUnfollow({ lineageValid: false }).reason, "resume_source_run_superseded");
  assert.equal(partialUnfollow({ lineageValid: false }).authorized, false);
});

test("the global Unfollow Auto Restart switch remains authoritative", () => {
  const result = partialUnfollow({ autoRestartEnabled: false });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "unfollow_auto_restart_disabled");
});

test("technical-hold-only backlog waits until next_candidate_retry_at", () => {
  const result = partialUnfollow({ actionableNow: 0, technicalHoldTotal: 3 });
  assert.equal(result.reason, "unfollow_backlog_on_cooldown");
  assert.equal(result.nextEvaluationAt, "2026-07-30T18:03:55.000Z");
});

test("hold-only backlog outranks stale quota and circuit state", () => {
  const result = partialUnfollow({
    actionableNow: 0,
    technicalHoldTotal: 3,
    dailyQuotaRemaining: 0,
    sessionQuotaRemaining: 0,
    phaseCircuitOpen: true,
    phaseCircuitNextRetryAt: "2026-07-30T18:04:34.000Z",
  });
  assert.equal(result.reason, "unfollow_backlog_on_cooldown");
  assert.equal(result.nextEvaluationAt, "2026-07-30T18:03:55.000Z");
});

test("a Mythyl-shaped Unfollow-only hold blocks enqueue even without explicit partial phase status", () => {
  assert.deepEqual(resolveUnfollowTechnicalHoldRestartGate({
    unfollowPlanned: true,
    otherExecutableWork: false,
    actionableNow: 0,
    technicalHoldTotal: 1,
    nextCandidateRetryAt: "2026-08-11T17:37:32.000Z",
  }), {
    blocked: true,
    reason: "unfollow_backlog_on_cooldown",
    nextEvaluationAt: "2026-08-11T17:37:32.000Z",
  });
});

test("a technical hold does not suppress unrelated executable phase work", () => {
  assert.equal(resolveUnfollowTechnicalHoldRestartGate({
    unfollowPlanned: true,
    otherExecutableWork: true,
    actionableNow: 0,
    technicalHoldTotal: 1,
    nextCandidateRetryAt: "2026-08-11T17:37:32.000Z",
  }).blocked, false);
});

test("terminal-only and empty backlogs outrank a stale circuit-open flag", () => {
  assert.equal(partialUnfollow({
    actionableNow: 0,
    technicalHoldTotal: 0,
    terminalTotal: 3,
    phaseCircuitOpen: true,
  }).reason, "unfollow_backlog_terminal_only");
  assert.equal(partialUnfollow({
    actionableNow: 0,
    technicalHoldTotal: 0,
    terminalTotal: 0,
    phaseCircuitOpen: true,
  }).reason, "unfollow_backlog_exhausted");
});

test("a persisted Unfollow-only plan suppresses unrelated raw Follow quota", () => {
  assert.deepEqual(resolvePlannedAccountSession({
    persistedPhases: { welcome: false, follow: false, unfollow: true },
    persistedQuotaRemaining: { follow: 30, unfollow: 2, welcome: 0 },
    quotas: { follow: quota(30), unfollow: quota(35), welcome: quota(0, false) },
  }), {
    phases: { welcome: false, follow: false, unfollow: true },
    remaining: { welcome: 0, follow: 0, unfollow: 2 },
    totalRemaining: 2,
  });
});

test("a persisted quota is bounded by the current daily remainder", () => {
  assert.deepEqual(resolvePlannedAccountSession({
    persistedPhases: { welcome: false, follow: false, unfollow: true },
    persistedQuotaRemaining: { unfollow: 8 },
    quotas: { follow: quota(0), unfollow: quota(3), welcome: quota(0, false) },
  }).remaining.unfollow, 3);
});

test("an Unfollow resume is bounded by the actionable candidate backlog", () => {
  assert.deepEqual(resolvePlannedAccountSession({
    persistedPhases: { welcome: false, follow: false, unfollow: true },
    persistedQuotaRemaining: { unfollow: 20 },
    quotas: { follow: quota(0), unfollow: quota(120), welcome: quota(0, false) },
    eligibleWorkRemaining: { unfollow: 2 },
  }), {
    phases: { welcome: false, follow: false, unfollow: true },
    remaining: { welcome: 0, follow: 0, unfollow: 2 },
    totalRemaining: 2,
  });
});

test("a not-found-only Unfollow backlog becomes non-actionable", () => {
  assert.equal(resolvePlannedAccountSession({
    persistedPhases: { welcome: false, follow: false, unfollow: true },
    persistedQuotaRemaining: { unfollow: 1 },
    quotas: { follow: quota(0), unfollow: quota(120), welcome: quota(0, false) },
    eligibleWorkRemaining: { unfollow: 0 },
  }).totalRemaining, 0);
});

test("without a persisted plan the live enabled quotas remain the source of truth", () => {
  assert.deepEqual(resolvePlannedAccountSession({
    persistedPhases: null,
    persistedQuotaRemaining: {},
    quotas: { follow: quota(4), unfollow: quota(0), welcome: quota(2) },
  }), {
    phases: { welcome: true, follow: true, unfollow: false },
    remaining: { welcome: 2, follow: 4, unfollow: 0 },
    totalRemaining: 6,
  });
});

test("a persisted phase is removed when its live day quota reaches zero", () => {
  assert.deepEqual(resolvePlannedAccountSession({
    persistedPhases: { welcome: false, follow: false, unfollow: true },
    persistedQuotaRemaining: { unfollow: 18 },
    quotas: { follow: quota(0), unfollow: quota(0), welcome: quota(0, false) },
  }), {
    phases: { welcome: false, follow: false, unfollow: false },
    remaining: { welcome: 0, follow: 0, unfollow: 0 },
    totalRemaining: 0,
  });
});

test("49/50 remains executable and 50/50 is quota-terminal", () => {
  assert.equal(resolvePhaseCompletion({ enabled: true, quotaRemaining: 1, eligibleWorkRemaining: 4 }).executable, true);
  assert.deepEqual(resolvePhaseCompletion({ enabled: true, quotaRemaining: 0, eligibleWorkRemaining: 4 }), {
    terminal: true,
    executable: false,
    reason: "quota_reached",
    quotaRemaining: 0,
    eligibleWorkRemaining: 4,
    temporarilyUnavailableWork: 0,
  });
});

test("119/120 then the last Unfollow becomes quota-terminal", () => {
  const before = resolvePhaseCompletion({ enabled: true, quotaRemaining: 1, eligibleWorkRemaining: 20 });
  const after = resolvePhaseCompletion({ enabled: true, quotaRemaining: 0, eligibleWorkRemaining: 19 });
  assert.equal(before.terminal, false);
  assert.equal(after.reason, "quota_reached");
  assert.equal(after.terminal, true);
});

test("fewer candidates than the package cap terminates by candidate exhaustion", () => {
  for (const [quotaRemaining, completed] of [[20, 100], [5, 5], [80, 20]]) {
    const outcome = resolvePhaseCompletion({ enabled: true, quotaRemaining, eligibleWorkRemaining: 0 });
    assert.equal(outcome.reason, "candidates_exhausted", `completed=${completed}`);
    assert.equal(outcome.terminal, true);
  }
});

test("a disabled phase is terminal and never executable", () => {
  assert.deepEqual(resolvePhaseCompletion({ enabled: false, quotaRemaining: 120, eligibleWorkRemaining: 50 }), {
    terminal: true,
    executable: false,
    reason: "disabled",
    quotaRemaining: 120,
    eligibleWorkRemaining: 50,
    temporarilyUnavailableWork: 0,
  });
});

test("candidate exhaustion is reevaluated when new work appears on a future tick", () => {
  const exhausted = resolvePhaseCompletion({ enabled: true, quotaRemaining: 20, eligibleWorkRemaining: 0 });
  const futureTick = resolvePhaseCompletion({ enabled: true, quotaRemaining: 20, eligibleWorkRemaining: 1 });
  assert.equal(exhausted.reason, "candidates_exhausted");
  assert.equal(futureTick.reason, "work_remaining");
  assert.equal(futureTick.executable, true);
});

test("only the incomplete executable phase survives pruning", () => {
  const plan = resolvePlannedAccountSession({
    persistedPhases: null,
    persistedQuotaRemaining: {},
    quotas: { follow: quota(0), unfollow: quota(12), welcome: quota(0) },
  });
  assert.deepEqual(pruneTerminalAccountSessionPhases(plan, {
    follow: resolvePhaseCompletion({ enabled: false, quotaRemaining: 0 }),
    welcome: resolvePhaseCompletion({ enabled: false, quotaRemaining: 0 }),
    unfollow: resolvePhaseCompletion({ enabled: true, quotaRemaining: 12, eligibleWorkRemaining: 3 }),
  }), {
    phases: { welcome: false, follow: false, unfollow: true },
    remaining: { welcome: 0, follow: 0, unfollow: 12 },
    totalRemaining: 12,
  });
});

test("actionable Unfollow quota is bounded by canonical backlog", () => {
  const plan = resolvePlannedAccountSession({
    persistedPhases: { welcome: false, follow: false, unfollow: true },
    persistedQuotaRemaining: { unfollow: 120 },
    quotas: { follow: quota(0), unfollow: quota(120), welcome: quota(0) },
    eligibleWorkRemaining: { unfollow: 3 },
  });
  assert.equal(plan.remaining.unfollow, 3);
});

test("technical candidate hold is non-terminal and non-executable", () => {
  const outcome = resolvePhaseCompletion({
    enabled: true,
    quotaRemaining: 10,
    eligibleWorkRemaining: 0,
    temporarilyUnavailableWork: 2,
  });
  assert.equal(outcome.reason, "technical_hold");
  assert.equal(outcome.terminal, false);
  assert.equal(outcome.executable, false);
});

test("phase circuit is non-terminal and does not make Unfollow executable", () => {
  const outcome = resolvePhaseCompletion({
    enabled: true,
    quotaRemaining: 10,
    eligibleWorkRemaining: 4,
    temporarilyUnavailableWork: 0,
    phaseCircuitOpen: true,
  });
  assert.equal(outcome.reason, "phase_circuit_open");
  assert.equal(outcome.terminal, false);
  assert.equal(outcome.executable, false);
});

test("run-linked PostgREST projections are chunked for 1,000+ accounts", () => {
  const source = readFileSync(new URL("./auto-restart-data.ts", import.meta.url), "utf8");
  assert.match(source, /chunked\(latestRunIds, 100\)[\s\S]*?from\("ig_action_logs"\)[\s\S]*?\.in\("run_id", runIdBatch\)/);
  assert.match(source, /chunked\(latestRunIds, 100\)[\s\S]*?from\("account_run_requests"\)[\s\S]*?\.in\("run_id", runIdBatch\)/);
  assert.doesNotMatch(source, /\.in\("run_id", latestRunIds\)/);
});

test("the projected gate status cannot disagree with the canonical decision outcome", () => {
  const source = readFileSync(new URL("./auto-restart-data.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /gateStatus:\s*decisionOutcome === "eligible" \? "eligible_preview" : decisionOutcome/,
  );
});
