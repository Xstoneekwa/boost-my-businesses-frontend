import assert from "node:assert/strict";
import test from "node:test";
import { projectCanonicalAccountCapacityState } from "./account-capacity-state.ts";

const ACCOUNT_SOLOMON = "0d299d1e-46ee-49d2-8a84-4f928f2bb182";
const ACCOUNT_LIAM = "83de9cc9-5c37-42d1-9edc-c924352b17b1";
const DEVICE_ID = "device-1";
const APP_INSTANCE_ID = "app-1";

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    account_id: ACCOUNT_SOLOMON,
    device_id: DEVICE_ID,
    app_instance_id: APP_INSTANCE_ID,
    status: "reserved",
    schedule_mode: "manual_only",
    slot_kind: "manual_only",
    ...overrides,
  };
}

function device(overrides: Record<string, unknown> = {}) {
  return { id: DEVICE_ID, name: "Samsung A16-02", status: "available", ...overrides };
}

function appInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_INSTANCE_ID,
    device_id: DEVICE_ID,
    visible_label: "Samsung A16-02 clone 2",
    current_account_id: ACCOUNT_SOLOMON,
    status: "occupied",
    ...overrides,
  };
}

test("valid assignment projects assigned capacity state", () => {
  const projected = projectCanonicalAccountCapacityState({
    accountId: ACCOUNT_SOLOMON,
    assignment: assignment(),
    device: device(),
    appInstance: appInstance(),
  });
  assert.equal(projected.assignmentHealth, "assigned");
  assert.equal(projected.assignmentHealthReason, "assigned");
});

test("no assignment and no linked app instance projects true unassigned state", () => {
  const projected = projectCanonicalAccountCapacityState({
    accountId: ACCOUNT_SOLOMON,
    assignment: null,
    appInstancesPointingToAccount: [],
  });
  assert.equal(projected.assignmentHealth, "unassigned");
  assert.equal(projected.assignmentHealthReason, "no_active_assignment");
});

test("active assignment with missing app instance requires attention", () => {
  const projected = projectCanonicalAccountCapacityState({
    accountId: ACCOUNT_SOLOMON,
    assignment: assignment(),
    device: device(),
    appInstance: null,
  });
  assert.equal(projected.assignmentHealth, "requires_attention");
  assert.equal(projected.assignmentHealthReason, "assignment_app_instance_missing");
});

test("active assignment with wrong current_account_id requires attention", () => {
  const projected = projectCanonicalAccountCapacityState({
    accountId: ACCOUNT_SOLOMON,
    assignment: assignment(),
    device: device(),
    appInstance: appInstance({ current_account_id: ACCOUNT_LIAM }),
  });
  assert.equal(projected.assignmentHealth, "requires_attention");
  assert.equal(projected.assignmentHealthReason, "app_instance_account_mismatch");
});

test("scheduled assignment with expired unreleased timeslot requires attention", () => {
  const projected = projectCanonicalAccountCapacityState({
    accountId: ACCOUNT_SOLOMON,
    assignment: assignment({
      schedule_mode: "scheduled",
      slot_kind: "full_cycle_6h",
      starts_at: "2026-07-03T22:00:00.000Z",
      ends_at: "2026-07-04T04:00:00.000Z",
      released_at: null,
    }),
    device: device(),
    appInstance: appInstance(),
    now: new Date("2026-07-04T23:00:00.000Z"),
  });
  assert.equal(projected.assignmentHealth, "requires_attention");
  assert.equal(projected.assignmentHealthReason, "assignment_window_expired");
});

test("linked app instance without assignment is not displayed as unassigned", () => {
  const projected = projectCanonicalAccountCapacityState({
    accountId: ACCOUNT_SOLOMON,
    assignment: null,
    appInstancesPointingToAccount: [appInstance()],
  });
  assert.equal(projected.assignmentHealth, "requires_attention");
  assert.equal(projected.assignmentHealthReason, "app_instance_without_assignment");
});
