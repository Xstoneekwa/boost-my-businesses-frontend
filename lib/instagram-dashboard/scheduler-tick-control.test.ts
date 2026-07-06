import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SCHEDULER_DISABLED_REASON,
  schedulerTickGate,
} from "./auto-restart-tick-helpers.ts";

const tickSource = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");
const dataSource = readFileSync(
  new URL("../../app/instagram-dashboard/auto-restart-data.ts", import.meta.url),
  "utf8",
);
const settingsRouteSource = readFileSync(
  new URL("../../app/api/instagram-dashboard/auto-restart/settings/route.ts", import.meta.url),
  "utf8",
);

test("scheduler OFF: tick gate skips with the canonical scheduler_disabled reason", () => {
  const gate = schedulerTickGate({ enabled: false, mode: "production" });
  assert.equal(gate.forceDryRun, true);
  assert.equal(gate.skipReason, SCHEDULER_DISABLED_REASON);
});

test("scheduler OFF: tick returns before any candidate scan or enqueue", () => {
  const skipIndex = tickSource.indexOf("tickGate.skipReason");
  const scanIndex = tickSource.indexOf("getAutoRestartData()");
  const enqueueIndex = tickSource.indexOf("await enqueueAutoRestartRequest(");
  assert.ok(skipIndex > -1, "tick must consult the canonical gate");
  assert.ok(scanIndex > skipIndex, "candidate scan must happen after the OFF gate");
  assert.ok(enqueueIndex > skipIndex, "enqueue RPC must be unreachable when OFF");
  assert.match(tickSource, /if \(tickGate\.skipReason\) \{[\s\S]*?return \{ status: 200, result: summary \};[\s\S]*?\}/);
});

test("scheduler OFF: active runs are never touched by the tick", () => {
  assert.doesNotMatch(tickSource, /\.from\("ig_runs"\)/, "tick must not read/write ig_runs directly");
  assert.doesNotMatch(tickSource, /stop_account_run|force_stop/i);
});

test("scheduler ON: gate lets the canonical selection run, without local shortcuts", () => {
  const gate = schedulerTickGate({ enabled: true, mode: "production" });
  assert.equal(gate.forceDryRun, false);
  assert.equal(gate.skipReason, null);
  // Selection remains guarded by canonical eligibility + RPC only.
  assert.match(tickSource, /if \(!candidate\.restartEligible\) \{/);
  assert.match(tickSource, /evaluateRunStartEligibility\(/);
  assert.match(tickSource, /create_account_run_request/);
});

test("scheduler ON in dry-run stays side-effect free", () => {
  const gate = schedulerTickGate({ enabled: true, mode: "production", dryRun: true });
  assert.equal(gate.forceDryRun, true);
  assert.equal(gate.skipReason, null);
  const dryRunBranch = tickSource.indexOf("if (forceDryRun) {");
  const enqueueCall = tickSource.indexOf("await enqueueAutoRestartRequest(");
  assert.ok(dryRunBranch > -1 && enqueueCall > dryRunBranch, "dry-run continue must precede the real enqueue");
});

test("non-executable mode never enqueues even when enabled", () => {
  const gate = schedulerTickGate({ enabled: true, mode: "draft" });
  assert.equal(gate.forceDryRun, true);
  assert.equal(gate.skipReason, null);
});

test("manual_only stays a hard canonical exclusion", () => {
  assert.match(dataSource, /manual_only_requires_manual_trigger/);
  assert.match(dataSource, /if \(scheduleMode === "manual_only"\) blockingReasons\.push/);
  // Tick counts non-eligible candidates as blocked with their canonical reason.
  assert.match(tickSource, /reason: candidate\.blockReason \|\| "blocked"/);
});

test("ON/OFF mutations go only through the relay/admin protected settings endpoint", () => {
  assert.match(settingsRouteSource, /requireRelayOrAdmin\(request, "Auto Restart settings"\)/);
  assert.match(settingsRouteSource, /auto_restart_settings_updated/);
  assert.doesNotMatch(settingsRouteSource, /create_account_run_request/);
});
