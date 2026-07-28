import assert from "node:assert/strict";
import test from "node:test";
import {
  pruneTerminalAccountSessionPhases,
  resolvePhaseCompletion,
  resolvePlannedAccountSession,
} from "../../lib/instagram-dashboard/auto-restart-phase-plan.ts";

const quota = (remaining: number, enabled = true) => ({
  doneToday: 0,
  capDay: 120,
  remaining,
  plannedNextRunQuota: remaining,
  enabled,
  sourceLabel: "test",
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
