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
  assert.match(source, /auto_restart_tick_locks/);
  assert.match(source, /tick_completed_at/);
  assert.doesNotMatch(source, /auto_restart_tick_locks[\s\S]*created_at/);
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
