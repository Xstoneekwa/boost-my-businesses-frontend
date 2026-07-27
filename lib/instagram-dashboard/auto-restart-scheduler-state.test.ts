import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isAutoRestartProductionExecutable } from "./auto-restart-mode.ts";
import {
  computeNextSchedulerCheck,
  resolveLatestCompletedTick,
  resolveSchedulerCheckState,
} from "./auto-restart-scheduler-state.ts";

test("latest completed tick uses tick_completed_at not created_at", () => {
  const source = readFileSync(
    new URL("../../app/instagram-dashboard/auto-restart-data.ts", import.meta.url),
    "utf8",
  );
  const tickLockQuery = source.match(
    /\.from\("auto_restart_tick_locks"\)[\s\S]*?\.maybeSingle<SupabaseRecord>\(\)/,
  )?.[0];

  assert.ok(tickLockQuery, "auto_restart_tick_locks query must remain present");
  assert.match(tickLockQuery, /\.select\("[^"]*tick_completed_at[^"]*"\)/);
  assert.match(tickLockQuery, /\.order\("tick_completed_at", \{ ascending: false \}\)/);
  assert.doesNotMatch(tickLockQuery, /created_at/);
});

test("phone rest query uses the production column contract", () => {
  const source = readFileSync(
    new URL("../../app/instagram-dashboard/auto-restart-data.ts", import.meta.url),
    "utf8",
  );
  const phoneRestQuery = source.match(
    /\.from\("phone_rest_windows"\)[\s\S]*?\.limit\(1000\)/,
  )?.[0];

  assert.ok(phoneRestQuery, "phone_rest_windows query must remain present");
  assert.match(phoneRestQuery, /starts_at_local/);
  assert.match(phoneRestQuery, /ends_at_local/);
  assert.doesNotMatch(phoneRestQuery, /local_start_time|local_end_time/);
  assert.match(source, /local_start_time: readString\(row\.starts_at_local/);
  assert.match(source, /local_end_time: readString\(row\.ends_at_local/);
});

test("lastSchedulerCheck comes from latest completed tick", () => {
  const resolved = resolveLatestCompletedTick({
    status: "completed",
    tick_completed_at: "2026-07-02T10:00:00.000Z",
  });
  assert.equal(resolved.lastSchedulerCheck, "2026-07-02T10:00:00.000Z");
  assert.equal(resolved.lastTickStatus, "completed");
});

test("nextSchedulerCheck uses check_every_minutes after last completed tick", () => {
  const next = computeNextSchedulerCheck({
    lastSchedulerCheck: "2026-07-02T10:00:00.000Z",
    checkEveryMinutes: 5,
    enabled: true,
    mode: "production",
  });
  assert.equal(next, "2026-07-02T10:05:00.000Z");
});

test("production enabled exposes scheduler executable state", () => {
  assert.equal(isAutoRestartProductionExecutable(true, "production"), true);
  assert.equal(isAutoRestartProductionExecutable(true, "active"), true);
});

test("disabled keeps nextSchedulerCheck null", () => {
  assert.equal(
    computeNextSchedulerCheck({
      lastSchedulerCheck: "2026-07-02T10:00:00.000Z",
      checkEveryMinutes: 1,
      enabled: false,
      mode: "production",
    }),
    null,
  );
});

test("missing completed tick returns honest null scheduler checks", () => {
  const state = resolveSchedulerCheckState({
    latestCompletedTick: null,
    checkEveryMinutes: 1,
    enabled: true,
    mode: "production",
  });
  assert.equal(state.lastSchedulerCheck, null);
  assert.equal(state.nextSchedulerCheck, null);
});

test("scheduler state helper does not mutate eligibility or enqueue behavior", () => {
  const source = readFileSync(new URL("./auto-restart-scheduler-state.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /enqueue/i);
  assert.doesNotMatch(source, /eligible/i);
  assert.doesNotMatch(source, /auto_restart_decisions/);
});
