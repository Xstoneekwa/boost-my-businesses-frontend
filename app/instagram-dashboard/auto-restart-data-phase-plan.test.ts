import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlannedAccountSession } from "../../lib/instagram-dashboard/auto-restart-phase-plan.ts";

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
