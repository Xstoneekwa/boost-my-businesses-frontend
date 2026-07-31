import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFollow60sOneShotFrozenPlan,
  FOLLOW_60S_ONE_SHOT_ACCOUNT_ID,
  FOLLOW_60S_ONE_SHOT_SCHEMA,
} from "./auto-restart-resume-metadata.ts";

function baseMetadata() {
  return {
    resume_plan_version: 2,
    resume_plan_schema: "AUTO_RESTART_RESUME_PLAN_V2",
    prior_run_id: "source-run",
    session_termination_class: "partial_resumable",
    restart_block_reason: "",
    business_session_id: "business-session",
    attempt_id: 2,
    retry_index: 1,
    previous_run_id: "source-run",
    root_failure_code: "operator_canceled_partial_resumable",
    failure_signature: null,
    failure_category: null,
    scheduled_at: "2026-07-30T23:45:00.000Z",
    business_day_sast: "2026-07-31",
    account_eligible: true,
    restart_needed: true,
    exact_viewport_resume_available: false,
    safe_restart_strategy: "rebuilt_safe_target_plan",
    safe_restart_reason: "resolved_incident_canonical_target_plan_rebuild",
    historical_safe_boundary_fallback: false,
    prior_target_id: null,
    next_target_id: null,
    remaining_follow_quota: 40,
    resume_plan: {
      schema: "AUTO_RESTART_RESUME_PLAN_V2",
      plan_version: 2,
      account_id: FOLLOW_60S_ONE_SHOT_ACCOUNT_ID,
      assignment_id: "assignment",
      device_id: "device",
      app_instance_id: "app",
      package_id: "premium",
      package_label: "Premium",
      package_caps: null,
      package_contract_ready: true,
      warmup_day: 4,
      warmup_status: "warmed_up",
      warmup_cap: 50,
      scheduled_window_start: "2026-07-30T22:00:00.000Z",
      scheduled_window_end: "2026-07-31T04:00:00.000Z",
      window_id: "assignment",
      phase_order: ["welcome", "follow", "unfollow"],
      follow_enabled: true,
      unfollow_enabled: true,
      outreach_enabled: false,
      follow_target: 40,
      follow_remaining: 40,
      follow_session_override: 50,
      max_follows_per_target_per_run: 30,
      max_targets_per_run: 4,
      unfollow_target: 24,
      unfollow_remaining: 24,
      outreach_remaining: 0,
      candidate_counts: {},
      unfollow_phase_circuit: {},
      restart_allowed: true,
      session_termination_class: "partial_resumable",
      retry_generation: 0,
      phases_to_run: { welcome: false, follow: true, unfollow: true },
      quota_consumed: { follow: 10, welcome: 0, unfollow: 0, outreach: 0 },
      quota_caps: { follow: 50, welcome: 10, unfollow: 120, outreach: 0 },
      quota_remaining: { welcome: 0, follow: 40, unfollow: 24, outreach: 0 },
      prior_run_id: "source-run",
      resume_plan_version: 2,
    },
  };
}

function frozenPlan() {
  return {
    schema: "AUTO_RESTART_RESUME_PLAN_V2",
    plan_version: 2,
    account_id: FOLLOW_60S_ONE_SHOT_ACCOUNT_ID,
    package_contract_ready: true,
    phase_order: ["welcome", "follow", "unfollow"],
    phases_to_run: { welcome: false, follow: true, unfollow: false },
    quota_remaining: { welcome: 0, follow: 40, unfollow: 0, outreach: 0, total: 40 },
    follow_60s_canary_contract: {
      schema: FOLLOW_60S_ONE_SHOT_SCHEMA,
      source_run_id: "source-run",
      follow_quota: 40,
      golden_fallback_policy: "proof_rejection_only",
      expires_at: "2026-07-31T04:00:00.000Z",
    },
  };
}

test("account-scoped one-shot preserves exact Follow-only plan and strips rebuilt Unfollow", () => {
  const result = applyFollow60sOneShotFrozenPlan({
    baseMetadata: baseMetadata(),
    frozenPlan: frozenPlan(),
    authorizationAccountId: FOLLOW_60S_ONE_SHOT_ACCOUNT_ID,
    originalRunId: "source-run",
    liveFollowRemaining: 40,
  });

  assert.equal(result.matched, true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.metadata.resume_plan.phases_to_run, {
    welcome: false,
    follow: true,
    unfollow: false,
  });
  assert.deepEqual(result.metadata.resume_plan.quota_remaining, {
    welcome: 0,
    follow: 40,
    unfollow: 0,
    outreach: 0,
  });
});

test("account-scoped one-shot fails closed when live Follow quota changed", () => {
  const result = applyFollow60sOneShotFrozenPlan({
    baseMetadata: baseMetadata(),
    frozenPlan: frozenPlan(),
    authorizationAccountId: FOLLOW_60S_ONE_SHOT_ACCOUNT_ID,
    originalRunId: "source-run",
    liveFollowRemaining: 39,
  });

  assert.equal(result.matched, true);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "follow_60s_one_shot_live_quota_mismatch");
});

test("ordinary authorizations retain the canonical live rebuild", () => {
  const base = baseMetadata();
  const result = applyFollow60sOneShotFrozenPlan({
    baseMetadata: base,
    frozenPlan: { schema: "AUTO_RESTART_RESUME_PLAN_V2" },
    authorizationAccountId: "another-account",
    originalRunId: "another-run",
    liveFollowRemaining: 7,
  });

  assert.equal(result.matched, false);
  assert.equal(result.ok, true);
  assert.equal(result.metadata, base);
});
