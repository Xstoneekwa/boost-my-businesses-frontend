import assert from "node:assert/strict";
import test from "node:test";

import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";
import {
  buildManualFollow60RequestContract,
} from "./manual-follow60-control.ts";

const ACCOUNT_ID = "b024e94e-395d-4f02-9787-81ddc679b014";
const CONTROL_ID = "68503555-6479-44a0-bedb-a4cc1cf0dd05";
const WORKER_SHA = "a8d00cf99f80a126a26c69b0c72b8a948aef2e07";
const SOURCE_RUN_ID = "8e6faf36-616d-4993-a393-ba273d9627d7";
const NOW = new Date("2026-08-04T00:00:00.000Z");

function control(overrides: Record<string, unknown> = {}) {
  return {
    account_id: ACCOUNT_ID,
    status: "armed",
    baseline_follow_count: 0,
    evaluation_increment: 10,
    target_follow_count: 10,
    metadata_safe: {
      schema: "FOLLOW_60S_CANARY_CONTROL_V3",
      control_id: CONTROL_ID,
      expected_worker_sha: WORKER_SHA,
      baseline_release_sha: WORKER_SHA,
      baseline_account_id: ACCOUNT_ID,
      expected_username: "rex_gen_boost_ai",
      expected_run_type: "account_session",
      binding_version: "FOLLOW_60S_CANARY_BINDING_V2",
      runtime_binding_consumed: false,
      active_control_count: 1,
      expires_at: "2026-08-04T06:30:00.000Z",
      ...overrides,
    },
  };
}

function quota(doneToday: number, capDay: number, remaining: number, enabled: boolean) {
  return {
    doneToday,
    capDay,
    remaining,
    plannedNextRunQuota: remaining,
    enabled,
    sourceLabel: "test",
  };
}

function candidate(overrides: Partial<AutoRestartCandidate> = {}): AutoRestartCandidate {
  return {
    accountId: ACCOUNT_ID,
    assignmentId: "assignment",
    deviceId: "device",
    appInstanceId: "app",
    username: "rex_gen_boost_ai",
    packageLabel: "Premium",
    packageCode: "premium",
    commercialAddonsLabel: "",
    outreachSourceLabel: "",
    runtimeProfilesLabel: "",
    followFiltersLabel: "",
    enabledServices: ["Follow"],
    phoneName: "Samsung A16-01",
    phoneRestStatus: "clear",
    sessionWindowStatus: "in_window",
    assignmentStatus: "active",
    gateStatus: "eligible_preview",
    accountEligible: true,
    accountEligibilityReason: "eligible",
    restartNeeded: true,
    restartNeedReason: "follow60_armed_control_fresh_start",
    exactViewportResumeAvailable: false,
    safeRestartStrategy: "rebuilt_safe_target_plan",
    safeRestartReason: "follow60_armed_control_fresh_boundary",
    historicalSafeBoundaryFallback: false,
    freshBoundaryOnly: true,
    enqueueAllowed: true,
    sourceRunId: SOURCE_RUN_ID,
    sourceBusinessSessionId: `follow60:${CONTROL_ID}`,
    priorTargetId: null,
    nextTargetId: null,
    nextRetryIndex: 0,
    remainingFollowQuota: 10,
    plannedPhasesToRun: { welcome: true, follow: true, unfollow: true },
    plannedQuotaRemaining: { welcome: 2, follow: 10, unfollow: 24, outreach: 0 },
    decisionOutcome: "eligible",
    restartEligible: true,
    blockReason: "",
    plannedRunType: "account_session",
    reliability: {
      restartAllowed: true,
      restartBlockReason: "",
      unsafeMarkers: [],
      currentAttempt: "0",
      nextAttempt: "1",
      nextRestartAt: null,
      lastRestartError: "",
      sessionTerminationClass: "fresh_start",
      businessSessionId: `follow60:${CONTROL_ID}`,
      attemptId: "0",
      retryIndex: "0",
      nextRetryIndex: "0",
      previousRunId: SOURCE_RUN_ID,
      rootFailureCode: "",
      failureSignature: "",
      failureCategory: "",
      cleanupCompleted: true,
      lockReleased: true,
      businessDaySast: "2026-08-04",
      phasesToRun: { welcome: false, follow: true, unfollow: false },
      quotaRemaining: { welcome: 0, follow: 10, unfollow: 0, outreach: 0 },
      safeCheckpointAvailable: false,
      targetRotationSafeAfterScrollFailure: false,
      scrollFailureSurfaceAmbiguous: false,
      lastRunId: SOURCE_RUN_ID,
      lastRunStatus: "completed",
      sourceLabel: "test",
    },
    quotas: {
      follow: quota(0, 120, 10, true),
      unfollow: quota(0, 120, 24, true),
      welcome: quota(0, 2, 2, true),
      outreach: quota(0, 0, 0, false),
    },
    ...overrides,
  };
}

test("BotApp Play projects an armed control onto the canonical Follow60 contract", () => {
  const result = buildManualFollow60RequestContract({
    accountId: ACCOUNT_ID,
    controlRow: control(),
    activeControlCount: 1,
    candidate: candidate(),
    now: NOW,
  });

  assert.equal(result.matched, true);
  assert.equal(result.ok, true);
  assert.ok(result.metadata);
  assert.equal(result.metadata?.source, "auto_restart_tick");
  assert.equal(result.metadata?.trigger_source, "botapp_manual_play");
  assert.equal(result.metadata?.manual_play_contract, "FOLLOW60_CANONICAL_PLAY_V1");
  const plan = result.metadata?.resume_plan as Record<string, unknown>;
  assert.equal(plan.phase_plan_source, "follow60_armed_control");
  assert.deepEqual(plan.phases_to_run, { welcome: false, follow: true, unfollow: false });
  assert.deepEqual(plan.quota_remaining, { welcome: 0, follow: 10, unfollow: 0, outreach: 0 });
  const contractValue = plan.follow_60s_canary_contract as Record<string, unknown>;
  assert.equal(contractValue.control_id, CONTROL_ID);
  assert.equal(contractValue.source_run_id, SOURCE_RUN_ID);
  assert.equal(contractValue.expected_worker_sha, WORKER_SHA);
  assert.equal(contractValue.follow_quota, 10);
  assert.equal(contractValue.golden_fallback_policy, "proof_rejection_only");
  assert.deepEqual(plan.preserved_business_backlog, { welcome: 2, unfollow: 24, outreach: 0 });
});

test("ordinary BotApp Play remains on the existing Golden path without an armed control", () => {
  const result = buildManualFollow60RequestContract({
    accountId: ACCOUNT_ID,
    controlRow: null,
    activeControlCount: 0,
    candidate: null,
    now: NOW,
  });
  assert.deepEqual(result, { matched: false, ok: true, reason: "", metadata: null });
});

test("present but expired or colliding controls fail closed", () => {
  const expired = buildManualFollow60RequestContract({
    accountId: ACCOUNT_ID,
    controlRow: control({ expires_at: "2026-08-03T23:59:59.000Z" }),
    activeControlCount: 1,
    candidate: candidate(),
    now: NOW,
  });
  assert.equal(expired.matched, true);
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "follow60_armed_control_invalid");

  const collision = buildManualFollow60RequestContract({
    accountId: ACCOUNT_ID,
    controlRow: control(),
    activeControlCount: 2,
    candidate: candidate(),
    now: NOW,
  });
  assert.equal(collision.matched, true);
  assert.equal(collision.ok, false);
  assert.equal(collision.reason, "follow60_armed_control_invalid");
});

test("a control cannot be rebound without its immutable source run", () => {
  const result = buildManualFollow60RequestContract({
    accountId: ACCOUNT_ID,
    controlRow: control(),
    activeControlCount: 1,
    candidate: candidate({ sourceRunId: "" }),
    now: NOW,
  });
  assert.equal(result.matched, true);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "follow60_manual_play_source_run_missing");
});
