import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("settings schedule evaluates recurring slot conflicts at device level", () => {
  assert.match(source, /fetchScheduledAssignmentsForDevice/);
  assert.match(source, /slotMatches/);
  assert.match(source, /current_conflict/);
  assert.match(source, /occupied_by: assignmentUsername/);
});

test("settings schedule edit keeps existing app instance and reopens free slots", () => {
  assert.match(source, /applyEditSlotAvailability/);
  assert.match(source, /selectable: true/);
  assert.match(source, /availability: "available"/);
  assert.doesNotMatch(source, /no_app_instance_available.*available: false[\s\S]*applyEditSlotAvailability/);
});

test("settings schedule save rejects device slot conflicts before assignment rpc", () => {
  assert.match(source, /findDeviceSlotConflict/);
  assert.match(source, /scheduleBlockMessage\("assignment_slot_conflict"\)/);
  assert.match(source, /assign_account_slot/);
});
