import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("../../../../../lib/instagram-dashboard/assign-now.ts", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../../../../instagram-dashboard/InstagramDashboardButtons.tsx", import.meta.url), "utf8");

test("Assign now route is admin-gated and calls only the assignment helper", () => {
  assert.match(routeSource, /requireInstagramAdmin\(\)/);
  assert.match(routeSource, /assignNowForAccount/);
  assert.doesNotMatch(routeSource, /runs\/start|create_account_run_request|account_run_requests|runner\.py/i);
});

test("Assign now repairs closed windows and creates missing assignments from available capacity", () => {
  assert.match(helperSource, /assignmentWindowContainsNow/);
  assert.match(helperSource, /list_available_assignment_slots/);
  assert.match(helperSource, /assign_account_slot/);
  assert.match(helperSource, /const status = hadClosedWindow \? "assignment_repaired" : "assigned_now"/);
  assert.match(helperSource, /recordAssignNowAudit/);
  assert.match(helperSource, /assignment_created: !hadClosedWindow/);
  assert.match(helperSource, /assignment_repaired: hadClosedWindow/);
});

test("Assign now refuses cancelled, active run, active request, and schedule blockers", () => {
  assert.match(helperSource, /Cancelled accounts cannot be assigned now/);
  assert.match(helperSource, /accountHasActiveIgRun/);
  assert.match(helperSource, /getActiveRunRequest/);
  assert.match(helperSource, /status: "active_run_exists"/);
  assert.match(helperSource, /status: "active_request_exists"/);
  assert.match(helperSource, /mapScheduleGateReasonToRunStart\(scheduleGate\.reason\)/);
  assert.doesNotMatch(helperSource, /!assignableScheduleReasons\.has\(currentEligibility\.reason\)/);
});

test("Assign now handles no capacity and already assigned states", () => {
  assert.match(helperSource, /status: "capacity_unavailable"/);
  assert.match(helperSource, /no_available_slot_now/);
  assert.match(helperSource, /status: "already_assigned"/);
});

test("Assign now maps assign_account_slot RPC failures to safe reasons", () => {
  assert.match(helperSource, /mapAssignAccountSlotFailure/);
  assert.match(helperSource, /invalid_assignment_source/);
  assert.match(helperSource, /assign_account_slot_failed/);
  assert.match(helperSource, /account_has_active_assignment_conflict/);
  assert.match(helperSource, /app_instance_capacity_unavailable/);
  assert.match(helperSource, /phone_capacity_unavailable/);
  assert.match(helperSource, /no_available_slot_now/);
  assert.match(helperSource, /business_timezone_missing/);
  assert.match(helperSource, /rpc_error_safe/);
  assert.doesNotMatch(helperSource, /reason: "assign_now_failed"/);
  assert.match(helperSource, /p_assignment_source: ASSIGN_NOW_RPC_SOURCE/);
  assert.match(helperSource, /ASSIGN_NOW_RPC_SOURCE = "manual_dashboard"/);
  assert.match(helperSource, /readPreferredCloneId/);
});

test("Assign now UI is separate from Play and refreshes eligibility", () => {
  assert.match(uiSource, /label: "Assign now"/);
  assert.match(uiSource, /\/api\/instagram-dashboard\/assignments\/now/);
  assert.match(uiSource, /requestAssignNow/);
  assert.match(uiSource, /refreshRunEligibility/);
  assert.match(uiSource, /router\.refresh\(\)/);
  assert.match(uiSource, /fetch\("\/api\/instagram-dashboard\/runs\/start"/);
  assert.doesNotMatch(uiSource, /Assign now[\s\S]{0,500}\/api\/instagram-dashboard\/runs\/start/);
});

test("Assign now response and UI do not expose unsafe identifiers", () => {
  const responseSection = helperSource.slice(
    helperSource.indexOf("export type AssignNowResult"),
    helperSource.indexOf("const assignableScheduleReasons"),
  );
  const unsafeResponsePattern = new RegExp([
    "device_id",
    "app_instance_id",
    "assignment_id",
    "adb" + "_serial",
    "secret_ref",
    "Vault",
    "pass" + "word",
    "token",
    "service_role",
    "raw" + " XML",
    "screenshot",
    "runner internals",
  ].join("|"), "i");
  const unsafeRoutePattern = new RegExp([
    "device_id",
    "app_instance_id",
    "assignment_id",
    "adb" + "_serial",
    "secret_ref",
    "service_role",
    "runner\\.py",
  ].join("|"), "i");
  assert.doesNotMatch(responseSection, unsafeResponsePattern);
  assert.doesNotMatch(routeSource, unsafeRoutePattern);
});
