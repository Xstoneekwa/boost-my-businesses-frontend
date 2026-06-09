import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runControlSource = readFileSync(
  new URL("../../lib/instagram-dashboard/run-control.ts", import.meta.url),
  "utf8",
);
const eligibilityRouteSource = readFileSync(
  new URL("../api/instagram-dashboard/runs/eligibility/route.ts", import.meta.url),
  "utf8",
);
const buttonsSource = readFileSync(new URL("./InstagramDashboardButtons.tsx", import.meta.url), "utf8");

test("play is enabled by default and only explicit false disables it", () => {
  assert.match(runControlSource, /export function runControlPlayFeatureEnabled/);
  assert.match(runControlSource, /if \(raw === "false"\) return false;/);
  assert.match(runControlSource, /return true;/);
});

test("dispatcher worker id accepts instagram and python env aliases", () => {
  assert.match(runControlSource, /INSTAGRAM_RUN_CONTROL_DISPATCHER_WORKER_ID/);
  assert.match(runControlSource, /RUN_CONTROL_DISPATCHER_WORKER_ID/);
});

test("run start eligibility maps run-control health to explicit block reasons", () => {
  assert.match(runControlSource, /export function resolveRunControlHealthBlockReason/);
  assert.match(runControlSource, /reason: "dispatcher_unconfigured"/);
  assert.match(runControlSource, /const healthBlock = resolveRunControlHealthBlockReason\(health\)/);
  assert.doesNotMatch(
    runControlSource,
    /if \(!health\.playEnabled \|\| !health\.healthy\) \{\s*return \{ ok: false as const, reason: "dispatcher_unhealthy"/,
  );
});

test("run control health projection maps display states for dashboard banner", () => {
  assert.match(runControlSource, /export type RunControlDisplayState/);
  assert.match(runControlSource, /export function projectRunControlHealthState/);
  assert.match(runControlSource, /displayState: "ready"/);
  assert.match(runControlSource, /displayState: "offline"/);
  assert.match(runControlSource, /displayState: "stale"/);
  assert.match(runControlSource, /displayState: "launch_disabled"/);
  assert.match(runControlSource, /displayState: "maintenance_disabled"/);
  assert.match(runControlSource, /displayState: "unconfigured"/);
});

test("play maintenance, dispatcher config, and unhealthy states have clear messages", () => {
  assert.match(runControlSource, /case "play_disabled":[\s\S]*maintenance mode/);
  assert.match(runControlSource, /case "dispatcher_unconfigured":[\s\S]*no runtime dispatcher worker is configured/);
  assert.match(runControlSource, /case "dispatcher_unhealthy":[\s\S]*fresh heartbeat/);
});

test("account business block messages stay separate from run-control health", () => {
  assert.match(runControlSource, /case "no_eligible_targets":[\s\S]*no eligible target account/i);
  assert.match(runControlSource, /case "assignment_window_closed":[\s\S]*schedule window/i);
});

test("eligibility payload distinguishes config readiness from start eligibility", () => {
  assert.match(eligibilityRouteSource, /eligibility_status: "blocked"/);
  assert.match(eligibilityRouteSource, /primary_block_reason: eligibility\.reason/);
  assert.match(eligibilityRouteSource, /reason_description: runStartBlockDescription\(eligibility\.reason\)/);
  assert.match(runControlSource, /Account settings are ready, but this run cannot start because Welcome DM is enabled/);
  assert.match(runControlSource, /Account settings are ready, but this run cannot start outside the assigned schedule window/);
});

test("eligibility route and dashboard UI do not expose unsafe identifiers", () => {
  const eligibilityUi = buttonsSource.slice(
    buttonsSource.indexOf("type RunEligibilityProjection"),
    buttonsSource.indexOf("type RunStartResponse"),
  );
  assert.doesNotMatch(eligibilityRouteSource, /device_id|app_instance_id|assignment_id|adb_serial|secret_ref|service_role/i);
  assert.doesNotMatch(eligibilityUi, /device_id|app_instance_id|assignment_id|adb_serial|secret_ref|service_role/i);
});
