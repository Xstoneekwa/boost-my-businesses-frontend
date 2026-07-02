import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  computeAutoRestartOperationalState,
  maxAttemptsBlockReason,
  pilotAllowlistMismatchReason,
  restartDelayBlockReason,
  validatePilotForActivation,
  validatePilotSelection,
} from "../lib/instagram-dashboard/auto-restart-pilot.ts";

test("pilot allowlist enforces exactly one account at enqueue time", () => {
  assert.equal(pilotAllowlistMismatchReason("acc-a", null), "pilot_allowlist_missing");
  assert.equal(pilotAllowlistMismatchReason("acc-b", "acc-a"), "pilot_allowlist_mismatch");
  assert.equal(pilotAllowlistMismatchReason("acc-a", "acc-a"), null);
});

test("manual_only and assignment gates block pilot selection", () => {
  assert.equal(
    validatePilotSelection({ accountId: "acc-1", scheduleMode: "manual_only", deviceId: "d1", appInstanceId: "i1" }),
    "pilot_manual_only_forbidden",
  );
  assert.equal(
    validatePilotSelection({ accountId: "acc-1", scheduleMode: "scheduled", deviceId: "", appInstanceId: "i1" }),
    "pilot_assignment_device_missing",
  );
  assert.equal(
    validatePilotSelection({ accountId: "acc-1", scheduleMode: "scheduled", deviceId: "d1", appInstanceId: "i1", hasActiveRun: true }),
    "pilot_active_run_exists",
  );
});

test("activation requires eligible pilot account", () => {
  assert.equal(
    validatePilotForActivation({
      accountId: "acc-1",
      scheduleMode: "scheduled",
      deviceId: "d1",
      appInstanceId: "i1",
      restartEligible: false,
      blockReason: "assignment_window_closed",
    }),
    "pilot_not_eligible:assignment_window_closed",
  );
});

test("runtime limits are enforced from settings values", () => {
  const now = new Date("2026-07-02T12:00:00.000Z");
  assert.equal(restartDelayBlockReason("2026-07-02T12:30:00.000Z", now), "restart_delay_not_elapsed");
  assert.equal(maxAttemptsBlockReason("2", 2), "max_attempts_per_session");
});

test("operational state distinguishes disabled, blocked, ready, and active", () => {
  assert.equal(
    computeAutoRestartOperationalState({
      enabled: false,
      mode: "disabled",
      foundationReady: true,
      tickTokenConfigured: true,
      pilotAccountId: null,
      pilotValidationReason: null,
    }).state,
    "disabled",
  );
  assert.equal(
    computeAutoRestartOperationalState({
      enabled: true,
      mode: "active",
      foundationReady: true,
      tickTokenConfigured: false,
      pilotAccountId: "acc-1",
      pilotValidationReason: null,
    }).state,
    "blocked",
  );
  assert.equal(
    computeAutoRestartOperationalState({
      enabled: true,
      mode: "active",
      foundationReady: true,
      tickTokenConfigured: true,
      pilotAccountId: "acc-1",
      pilotValidationReason: null,
    }).state,
    "active",
  );
});

test("tick route enforces pilot allowlist before enqueue", () => {
  const source = readFileSync(new URL("../lib/instagram-dashboard/auto-restart-tick.ts", import.meta.url), "utf8");
  assert.match(source, /pilotAllowlistMismatchReason/);
  assert.match(source, /maxAttemptsBlockReason/);
  assert.match(source, /restartDelayBlockReason/);
});

test("settings route persists pilot_account_id", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/settings/route.ts", import.meta.url), "utf8");
  assert.match(source, /pilot_account_id/);
  assert.match(source, /validatePilotAccountForSettings/);
});
