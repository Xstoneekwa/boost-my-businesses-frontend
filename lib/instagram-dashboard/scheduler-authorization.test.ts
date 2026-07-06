import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AUTOMATIC_RUN_SOURCE_SURFACES,
  automaticRunCreationAllowed,
  isSchedulerDisabledEnqueueError,
  loadSchedulerAutomaticRunAuthorization,
  SCHEDULER_DISABLED_REASON,
} from "./scheduler-authorization.ts";

function makeSettingsSupabase(input: { row?: Record<string, unknown> | null; error?: { message: string } | null; throws?: boolean }) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => {
      if (input.throws) return Promise.reject(new Error("settings_unavailable"));
      return Promise.resolve({ data: input.row ?? null, error: input.error ?? null });
    },
  };
  return { from: () => query };
}

test("automaticRunCreationAllowed only allows an explicit true toggle", () => {
  assert.deepEqual(automaticRunCreationAllowed({ enabled: true }), { allowed: true, reason: null });
  assert.deepEqual(automaticRunCreationAllowed({ enabled: false }), { allowed: false, reason: SCHEDULER_DISABLED_REASON });
  assert.deepEqual(automaticRunCreationAllowed({ enabled: null }), { allowed: false, reason: SCHEDULER_DISABLED_REASON });
  assert.deepEqual(automaticRunCreationAllowed({ enabled: undefined }), { allowed: false, reason: SCHEDULER_DISABLED_REASON });
});

test("loadSchedulerAutomaticRunAuthorization reads the canonical toggle", async () => {
  const on = await loadSchedulerAutomaticRunAuthorization(makeSettingsSupabase({ row: { auto_restart_enabled: true } }));
  assert.deepEqual(on, { enabled: true, allowed: true, reason: null, settingsAvailable: true });

  const off = await loadSchedulerAutomaticRunAuthorization(makeSettingsSupabase({ row: { auto_restart_enabled: false } }));
  assert.deepEqual(off, { enabled: false, allowed: false, reason: SCHEDULER_DISABLED_REASON, settingsAvailable: true });
});

test("loadSchedulerAutomaticRunAuthorization fails closed on missing row, error or throw", async () => {
  for (const supabase of [
    makeSettingsSupabase({ row: null }),
    makeSettingsSupabase({ error: { message: "boom" } }),
    makeSettingsSupabase({ throws: true }),
  ]) {
    const result = await loadSchedulerAutomaticRunAuthorization(supabase);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, SCHEDULER_DISABLED_REASON);
    assert.equal(result.settingsAvailable, false);
  }
});

test("isSchedulerDisabledEnqueueError matches the atomic RPC rejection", () => {
  assert.equal(isSchedulerDisabledEnqueueError(new Error("scheduler_disabled")), true);
  assert.equal(isSchedulerDisabledEnqueueError(new Error("22023: scheduler_disabled")), true);
  assert.equal(isSchedulerDisabledEnqueueError(new Error("account_already_running")), false);
  assert.equal(isSchedulerDisabledEnqueueError(null), false);
});

test("migration enforces the atomic guard for every automatic source surface", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20260710160000_cp0_scheduler_toggle_gates_automatic_run_requests.sql",
  );
  const source = readFileSync(migrationPath, "utf8");
  assert.match(source, /create or replace function public\.create_account_run_request/);
  for (const surface of AUTOMATIC_RUN_SOURCE_SURFACES) {
    assert.ok(source.includes(`'${surface}'`), `migration must gate source surface ${surface}`);
  }
  assert.match(source, /for share/);
  assert.match(source, /raise exception 'scheduler_disabled'/);
  assert.match(source, /coalesce\(v_scheduler_enabled, false\)/);
});

test("automatic source surfaces match the cron and tick emitters", () => {
  const cronSource = readFileSync(path.join(process.cwd(), "lib/instagram-dashboard/schedule-session-cron.ts"), "utf8");
  assert.match(cronSource, /p_source_surface: "instagram_schedule_session_cron"/);

  const helpersSource = readFileSync(path.join(process.cwd(), "lib/instagram-dashboard/auto-restart-tick-helpers.ts"), "utf8");
  assert.match(helpersSource, /AUTO_RESTART_TICK_SOURCE = "auto_restart_tick"/);
  assert.ok(AUTOMATIC_RUN_SOURCE_SURFACES.includes("auto_restart_tick"));
  assert.ok(AUTOMATIC_RUN_SOURCE_SURFACES.includes("instagram_schedule_session_cron"));
});
