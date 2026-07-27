import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isTechnicalSchedulerReason,
  normalizeSchedulerReason,
  REASON_UNAVAILABLE,
  SCHEDULER_REASON_CONTRACT,
} from "./scheduler-reasons.ts";

test("every mandated canonical reason code exists with a short operator label", () => {
  const mandated = [
    "scheduler_disabled",
    "technical_disabled",
    "dry_run",
    "resume_plan_missing",
    "botapp_runtime_unavailable",
    "dispatcher_unavailable",
    "device_heartbeat_stale",
    "device_unavailable",
    "phone_busy",
    "active_run_exists",
    "active_request_exists",
    "assignment_window_closed",
    "manual_only_requires_manual_trigger",
    "no_eligible_targets",
    "readiness_blocked",
    "login_not_connected",
    "quota_reached",
    "all_enabled_phase_work_completed",
    "phone_rest_active",
    "scheduler_disabled_race_rejected",
    "enqueue_failed",
  ];
  for (const code of mandated) {
    const descriptor = SCHEDULER_REASON_CONTRACT[code];
    assert.ok(descriptor, `missing canonical reason: ${code}`);
    assert.ok(descriptor.label.length > 0 && descriptor.label.length <= 40, `label out of bounds for ${code}`);
  }
});

test("legacy unknown and empty reasons map to reason_unavailable", () => {
  for (const raw of ["unknown", "", "  ", "blocked"]) {
    const normalized = normalizeSchedulerReason(raw);
    assert.equal(normalized.code, REASON_UNAVAILABLE, `raw=${JSON.stringify(raw)}`);
    assert.equal(normalized.kind, "unavailable");
    assert.equal(normalized.label, "reason unavailable");
  }
});

test("aliases converge to canonical codes without rewriting the raw reason", () => {
  const cases: Array<[string, string]> = [
    ["already_running", "active_run_exists"],
    ["account_already_running", "active_run_exists"],
    ["already_requested", "active_request_exists"],
    ["active_run_request_exists", "active_request_exists"],
    ["outside_schedule_window", "assignment_window_closed"],
    ["no_quota_remaining", "quota_reached"],
    ["skipped_phone_busy", "phone_busy"],
    ["dispatcher_unhealthy", "dispatcher_unavailable"],
    ["cron_disabled", "technical_disabled"],
    ["auto_restart_enqueue_failed", "enqueue_failed"],
  ];
  for (const [raw, expected] of cases) {
    const normalized = normalizeSchedulerReason(raw);
    assert.equal(normalized.code, expected, `raw=${raw}`);
    assert.equal(normalized.raw, raw, "raw reason is preserved for forensics");
  }
});

test("comma-joined reason lists normalize on the primary cause", () => {
  const normalized = normalizeSchedulerReason("resume_plan_missing,max_restarts_day");
  assert.equal(normalized.code, "resume_plan_missing");
  assert.equal(normalized.raw, "resume_plan_missing,max_restarts_day");
});

test("all enabled phase work completed stays a stable business reason", () => {
  const normalized = normalizeSchedulerReason("all_enabled_phase_work_completed");
  assert.equal(normalized.code, "all_enabled_phase_work_completed");
  assert.equal(normalized.kind, "business");
});

test("worker plan prefixes map to stable codes and keep their payload in raw", () => {
  assert.equal(normalizeSchedulerReason("worker_plan:resume_plan_missing").code, "resume_plan_missing");
  assert.equal(normalizeSchedulerReason("worker_plan:no_recent_run").code, "no_recent_run");
  assert.equal(normalizeSchedulerReason("worker_plan:some_worker_detail").code, "restart_not_allowed");
  assert.equal(normalizeSchedulerReason("unsafe_markers:challenge").code, "readiness_blocked");
});

test("technical errors stay distinct from business blocks", () => {
  assert.equal(isTechnicalSchedulerReason(normalizeSchedulerReason("enqueue_failed")), true);
  assert.equal(isTechnicalSchedulerReason(normalizeSchedulerReason("unexpected_tick_error")), true);
  assert.equal(isTechnicalSchedulerReason(normalizeSchedulerReason("phone_busy")), false);
  assert.equal(isTechnicalSchedulerReason(normalizeSchedulerReason("scheduler_disabled")), false);
});

test("unknown-but-real canonical reasons pass through unchanged", () => {
  const normalized = normalizeSchedulerReason("some_future_backend_reason");
  assert.equal(normalized.code, "some_future_backend_reason");
  assert.equal(normalized.label, "some_future_backend_reason");
  assert.equal(normalized.kind, "business");
});

test("the former literal unknown fallback is gone from the candidate projection", () => {
  const source = readFileSync(new URL("../../app/instagram-dashboard/auto-restart-data.ts", import.meta.url), "utf8");
  assert.match(source, /resume_plan_missing/);
  assert.doesNotMatch(source, /auto_restart_restart_block_reason, "unknown"/);
});
