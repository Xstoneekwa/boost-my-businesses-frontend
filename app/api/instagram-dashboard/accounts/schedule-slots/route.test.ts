import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("schedule slots route is read-only and phone scoped", () => {
  assert.match(source, /requireInstagramAdmin\(\)/);
  assert.match(source, /phone_devices/);
  assert.match(source, /generate_assignment_slot_catalog/);
  assert.match(source, /account_assignments/);
  assert.equal(source.includes(".insert("), false);
  assert.equal(source.includes(".update("), false);
  assert.equal(source.includes(".delete("), false);
});

test("schedule slots route maps onboarding runtime modes to assignment types", () => {
  assert.match(source, /safe_setup: "full_cycle"/);
  assert.match(source, /follow_only_test: "full_cycle"/);
  assert.match(source, /outreach_only: "outreach_only"/);
});

test("schedule slots route exposes occupied reasons without mutating schedule", () => {
  assert.match(source, /available: !occupant/);
  assert.match(source, /occupied_by/);
});
