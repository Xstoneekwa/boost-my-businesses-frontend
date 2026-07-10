import assert from "node:assert/strict";
import test from "node:test";
import { buildDailySchedulerPipeline, derivePipelineStatus } from "./daily-scheduler-pipeline.ts";
import type { SchedulerUpcomingWindow } from "./scheduler-status.ts";

function mockSupabase(fixtures: Record<string, unknown[]>) {
  function builder(table: string) {
    const rows = fixtures[table] ?? [];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const method of ["select", "eq", "in", "gte", "order"]) chain[method] = self;
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    chain.limit = async () => ({ data: rows, error: null });
    return chain;
  }
  return { from: (table: string) => builder(table) };
}

const window: SchedulerUpcomingWindow = {
  account_id: "acc-1",
  username: "mythyl_fitness",
  device_id: "dev-1",
  device_name: "Samsung A16-02",
  starts_at: "2026-07-10T04:00:00.000Z",
  ends_at: "2026-07-10T10:00:00.000Z",
  timezone: "Africa/Johannesburg",
  local_slot: "06:00–12:00",
  is_open: true,
  materialized: true,
  stored_window_expired: false,
  business_action_deadline: "2026-07-10T09:50:00.000Z",
  preflight_start: "2026-07-10T03:50:00.000Z",
  transition_phase: "preflight_due",
  transition_operator_label: "Preflight due",
};

test("device_locked preflight maps to preflight_blocked pipeline status", async () => {
  const supabase = mockSupabase({
    scheduled_session_preflights: [{
      id: "preflight-1",
      account_id: "acc-1",
      assignment_id: "assign-1",
      device_id: "dev-1",
      app_instance_id: "app-1",
      expected_package: "com.instagram.androif",
      expected_username: "mythyl_fitness",
      scheduled_window_start: window.starts_at,
      scheduled_window_end: window.ends_at,
      business_action_deadline: window.business_action_deadline!,
      preflight_start: window.preflight_start!,
      status: "preflight_blocked",
      reason_code: "device_locked",
      metadata_safe: {
        screen_type: "device_keyguard",
        detection_reason: "android_keyguard_detected",
        identity_guard_stage: "pre_profile_keyguard_check",
        unlock_attempted: true,
        unlock_result: "failed",
        screenshot_captured: true,
        xml_dump_captured: true,
      },
      updated_at: "2026-07-10T08:10:00.000Z",
    }],
    account_run_requests: [],
    phone_app_instances: [{ id: "app-1", package_name: "com.instagram.androif" }],
    ig_runs: [],
  });

  const pipeline = await buildDailySchedulerPipeline(supabase, {
    upcomingWindows: [window],
    usernames: new Map([["acc-1", "mythyl_fitness"]]),
    now: new Date("2026-07-10T08:10:00.000Z"),
  });

  assert.equal(pipeline.accounts[0].pipeline_status, "preflight_blocked");
  assert.equal(pipeline.accounts[0].preflight?.reason_code, "device_locked");
  assert.equal(pipeline.accounts[0].preflight?.screen_type, "device_keyguard");
  assert.equal(pipeline.accounts[0].account_session_absent_reason, "No account session — device locked");
});

test("account session running overrides preflight_ready", () => {
  const status = derivePipelineStatus({
    now: new Date("2026-07-10T08:00:00.000Z"),
    window,
    preflight: {
      id: "preflight-1",
      account_id: "acc-1",
      assignment_id: "assign-1",
      device_id: "dev-1",
      app_instance_id: "app-1",
      expected_package: "com.instagram.androif",
      expected_username: "mythyl_fitness",
      scheduled_window_start: window.starts_at,
      scheduled_window_end: window.ends_at,
      business_action_deadline: window.business_action_deadline!,
      preflight_start: window.preflight_start!,
      status: "preflight_ready",
      reason_code: null,
      checked_at: null,
      expires_at: window.ends_at,
      lease_id: null,
      request_id: "req-preflight",
      metadata_safe: {},
    },
    preflightRequest: null,
    accountSessionRequest: { id: "req-session", status: "running", run_id: "run-1" },
    igRun: { id: "run-1", status: "running", started_at: "2026-07-10T08:00:00.000Z" },
  });
  assert.equal(status, "account_session_running");
});
