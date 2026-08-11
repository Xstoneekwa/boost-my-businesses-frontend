import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("./20260811150000_device_level_schedule_allocator_collision_prevention_v1.sql", import.meta.url), "utf8");
const resolver = readFileSync(new URL("../../lib/instagram-dashboard/assignment-live-capacity.ts", import.meta.url), "utf8");

test("device-level recurring schedule source is current account_assignments", () => {
  assert.match(sql, /from public\.account_assignments aa/);
  assert.match(sql, /aa\.device_id = p_device_id/);
  assert.match(sql, /aa\.released_at is null/);
  assert.match(sql, /aa\.status in \('pending', 'reserved', 'active'\)/);
});

test("all clones share one phone mutex and atomic trigger guard", () => {
  assert.match(sql, /from public\.phone_devices pd where pd\.id = new\.device_id for update/);
  assert.match(sql, /before insert or update of device_id, starts_at, ends_at, status, schedule_mode, released_at/);
  assert.match(sql, /assignment_recurring_slot_conflict/);
  assert.match(sql, /v_current_assignment_id/);
});

test("manual changes and cross-midnight recurrence use the persisted local wall clock", () => {
  assert.match(sql, /at time zone v_timezone/);
  assert.match(sql, /if v_left_end <= v_left_start then v_left_end := v_left_end \+ 1440/);
  assert.match(sql, /if v_right_end <= v_right_start then v_right_end := v_right_end \+ 1440/);
});

test("allocator tries each phone and fails closed farm-wide", () => {
  assert.match(sql, /for v_device in[\s\S]*public\.phone_devices/);
  assert.match(sql, /order by case when pd\.id = v_assignment\.device_id then 0 else 1 end/);
  assert.match(sql, /NO_SAFE_PHONE_SCHEDULE_SLOT/);
  assert.match(resolver, /NO_SAFE_PHONE_SCHEDULE_SLOT/);
});

test("fixed rest and app-instance policies remain delegated to canonical legacy catalog", () => {
  assert.match(sql, /list_available_assignment_slots_absolute_legacy_v1/);
  assert.match(sql, /current_instance_reusable/);
});

test("RPC surface is service-role only", () => {
  assert.match(sql, /revoke all on function public\.list_available_assignment_slots\(uuid,uuid,text,date\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.list_available_assignment_slots\(uuid,uuid,text,date\) to service_role/);
  assert.match(sql, /grant execute on function public\.reconcile_account_assignment_schedule_v1\(uuid\) to service_role/);
});
