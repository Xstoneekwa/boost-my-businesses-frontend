import assert from "node:assert/strict";
import test from "node:test";

import { phoneRestOverrideBlocksAssignment } from "./auto-restart-lifecycle.ts";

const migrationPause = {
  deviceId: "device-1",
  status: "paused" as const,
  reason: "app_instance_migration_in_progress",
  updatedAt: "2026-08-12T13:02:16Z",
};

const ready = {
  id: "app-1",
  deviceId: "device-1",
  currentAccountId: "account-1",
  status: "occupied",
  isLaunchable: true,
  usableForAutoLogin: true,
};

test("migration pause does not block an exactly bound runnable app instance", () => {
  assert.equal(phoneRestOverrideBlocksAssignment({
    override: migrationPause,
    accountId: "account-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    appInstance: ready,
  }), false);
});

test("migration pause remains fail-closed for missing, stale, or non-runnable bindings", () => {
  const base = {
    override: migrationPause,
    accountId: "account-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
  };
  assert.equal(phoneRestOverrideBlocksAssignment(base), true);
  assert.equal(phoneRestOverrideBlocksAssignment({ ...base, appInstance: { ...ready, currentAccountId: "other" } }), true);
  assert.equal(phoneRestOverrideBlocksAssignment({ ...base, appInstance: { ...ready, status: "available" } }), true);
  assert.equal(phoneRestOverrideBlocksAssignment({ ...base, appInstance: { ...ready, isLaunchable: false } }), true);
  assert.equal(phoneRestOverrideBlocksAssignment({ ...base, appInstance: { ...ready, usableForAutoLogin: false } }), true);
});

test("explicit phone rests remain device-wide even for a runnable app instance", () => {
  assert.equal(phoneRestOverrideBlocksAssignment({
    override: { ...migrationPause, reason: "operator_pause" },
    accountId: "account-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    appInstance: ready,
  }), true);
});
