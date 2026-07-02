import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  accountHasActiveScheduledSlot,
  activeScheduleWindowBlockReason,
  evaluateAutoRestartScheduleGate,
  manualOnlyAutoRestartBlockReason,
} from "../lib/instagram-dashboard/auto-restart-scheduled-eligibility.ts";
import {
  computeAutoRestartOperationalState,
  maxAttemptsBlockReason,
  restartDelayBlockReason,
} from "../lib/instagram-dashboard/auto-restart-operational.ts";

const NOW = new Date("2026-07-02T12:00:00.000Z");
const ACTIVE_START = "2026-07-02T08:00:00.000Z";
const ACTIVE_END = "2026-07-02T16:00:00.000Z";

test("Auto Restart defaults remain OFF", () => {
  const source = readFileSync(new URL("../app/instagram-dashboard/auto-restart-data.ts", import.meta.url), "utf8");
  assert.match(source, /enabled: false,/);
  assert.match(source, /mode: "disabled"/);
});

test("manual_only is always excluded from schedule eligibility", () => {
  assert.equal(manualOnlyAutoRestartBlockReason("manual_only"), "manual_only_requires_manual_trigger");
  assert.equal(
    activeScheduleWindowBlockReason({
      scheduleMode: "manual_only",
      startsAt: ACTIVE_START,
      endsAt: ACTIVE_END,
      now: NOW,
    }),
    "manual_only_requires_manual_trigger",
  );
});

test("active scheduled slot is eligible when window is open", () => {
  assert.equal(
    activeScheduleWindowBlockReason({
      scheduleMode: "scheduled",
      startsAt: ACTIVE_START,
      endsAt: ACTIVE_END,
      now: NOW,
    }),
    null,
  );
  assert.equal(
    accountHasActiveScheduledSlot({
      scheduleMode: "scheduled",
      startsAt: ACTIVE_START,
      endsAt: ACTIVE_END,
      now: NOW,
    }),
    true,
  );
});

test("account outside active window is excluded", () => {
  assert.equal(
    activeScheduleWindowBlockReason({
      scheduleMode: "scheduled",
      startsAt: "2026-07-02T16:00:00.000Z",
      endsAt: "2026-07-02T20:00:00.000Z",
      now: NOW,
    }),
    "assignment_window_closed",
  );
});

test("moving from manual_only to active scheduled slot becomes eligible on next evaluation", () => {
  assert.equal(
    evaluateAutoRestartScheduleGate({
      scheduleMode: "manual_only",
      startsAt: ACTIVE_START,
      endsAt: ACTIVE_END,
      deviceId: "device-1",
      appInstanceId: "instance-1",
      now: NOW,
    }),
    "manual_only_requires_manual_trigger",
  );
  assert.equal(
    evaluateAutoRestartScheduleGate({
      scheduleMode: "scheduled",
      startsAt: ACTIVE_START,
      endsAt: ACTIVE_END,
      deviceId: "device-1",
      appInstanceId: "instance-1",
      now: NOW,
    }),
    null,
  );
});

test("active run, request, incident and missing assignment/device exclude candidates", () => {
  assert.equal(
    evaluateAutoRestartScheduleGate({
      scheduleMode: "scheduled",
      startsAt: ACTIVE_START,
      endsAt: ACTIVE_END,
      hasActiveRun: true,
      deviceId: "device-1",
      appInstanceId: "instance-1",
      now: NOW,
    }),
    "active_run_exists",
  );
  assert.equal(
    evaluateAutoRestartScheduleGate({
      scheduleMode: "scheduled",
      startsAt: ACTIVE_START,
      endsAt: ACTIVE_END,
      hasActiveRequest: true,
      deviceId: "device-1",
      appInstanceId: "instance-1",
      now: NOW,
    }),
    "active_run_request_exists",
  );
  assert.equal(
    evaluateAutoRestartScheduleGate({
      scheduleMode: "scheduled",
      startsAt: ACTIVE_START,
      endsAt: ACTIVE_END,
      hasOpenIncident: true,
      deviceId: "device-1",
      appInstanceId: "instance-1",
      now: NOW,
    }),
    "open_incident_blocked",
  );
  assert.equal(
    evaluateAutoRestartScheduleGate({
      scheduleMode: "scheduled",
      startsAt: ACTIVE_START,
      endsAt: ACTIVE_END,
      deviceId: "",
      appInstanceId: "instance-1",
      now: NOW,
    }),
    "assignment_or_device_pending",
  );
});

test("runtime limits are enforced from settings values", () => {
  assert.equal(restartDelayBlockReason("2026-07-02T12:30:00.000Z", NOW), "restart_delay_not_elapsed");
  assert.equal(maxAttemptsBlockReason("2", 2), "max_attempts_per_session");
});

test("operational state distinguishes disabled, blocked, ready, and active without pilot", () => {
  assert.equal(
    computeAutoRestartOperationalState({
      enabled: false,
      mode: "disabled",
      foundationReady: true,
      tickTokenConfigured: true,
    }).state,
    "disabled",
  );
  assert.equal(
    computeAutoRestartOperationalState({
      enabled: true,
      mode: "active",
      foundationReady: true,
      tickTokenConfigured: false,
    }).state,
    "blocked",
  );
  assert.equal(
    computeAutoRestartOperationalState({
      enabled: true,
      mode: "active",
      foundationReady: true,
      tickTokenConfigured: true,
    }).state,
    "active",
  );
});

test("tick route enforces runtime limits without pilot allowlist", () => {
  const source = readFileSync(new URL("../lib/instagram-dashboard/auto-restart-tick.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pilotAllowlistMismatchReason/);
  assert.doesNotMatch(source, /pilot_account_id/);
  assert.match(source, /maxAttemptsBlockReason/);
  assert.match(source, /restartDelayBlockReason/);
});

test("settings route persists schedule-based settings without pilot field", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/settings/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pilot_account_id/);
  assert.doesNotMatch(source, /validatePilotAccountForSettings/);
  assert.match(source, /validateActiveModePrerequisites/);
});

test("execute route imports canonical rulesFromSettingsRow", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/execute/route.ts", import.meta.url), "utf8");
  assert.match(source, /rulesFromSettingsRow/);
  assert.doesNotMatch(source, /pilot_account_id/);
});
