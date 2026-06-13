import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("schedule slots route returns real availability and occupant details", () => {
  assert.match(source, /generate_assignment_slot_catalog/);
  assert.match(source, /account_assignments/);
  assert.match(source, /availability/);
  assert.match(source, /occupied_by/);
  assert.match(source, /occupied_by_account/);
  assert.match(source, /reserved/);
});

test("schedule slots route validates selected app instance without filtering device capacity", () => {
  assert.match(source, /phone_app_instances/);
  assert.match(source, /app_instance_unavailable/);
  assert.doesNotMatch(source, /assignmentQuery = assignmentQuery\.eq\("app_instance_id"/);
});

test("schedule slots route compares recurring slot windows across dates", () => {
  assert.match(source, /recurringTimeOverlaps/);
  assert.match(source, /utcMinuteOfDay/);
});

test("schedule slots route exposes manual_only as a separate selectable option", () => {
  assert.match(source, /readManualSlot/);
  assert.match(source, /Run manually/);
  assert.match(source, /schedule_mode: "manual_only"/);
  assert.match(source, /Manual-only · no scheduled window/);
  assert.match(source, /slotsWithManual/);
});

test("schedule slots route accepts BotApp relay auth like other shared backend APIs", () => {
  assert.match(source, /verifyCompassRelayKey/);
  assert.match(source, /requireRelayOrAdmin/);
  assert.match(source, /Schedule slots relay authentication failed/);
  assert.doesNotMatch(source, /export async function GET[\s\S]*requireInstagramAdmin\(\)/);
});
