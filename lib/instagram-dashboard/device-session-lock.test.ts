import assert from "node:assert/strict";
import test from "node:test";

import {
  deviceSessionLockBlocksStart,
  pendingManualLockWorkerId,
} from "./device-session-lock.ts";

test("device lock blocks manual start when another session holds the phone", () => {
  const reason = deviceSessionLockBlocksStart(
    {
      deviceId: "device-1",
      workerId: "run-dispatcher:mac-a",
      accountId: "account-a",
      appInstanceId: "clone-a",
      requestId: "req-auto-1",
      reason: "auto_restart",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    { accountId: "account-b" },
  );
  assert.equal(reason, "device_lease_unavailable");
});

test("device lock allows same pending manual request owner", () => {
  const reason = deviceSessionLockBlocksStart(
    {
      deviceId: "device-1",
      workerId: pendingManualLockWorkerId("req-manual-1"),
      accountId: "account-a",
      appInstanceId: "clone-a",
      requestId: "req-manual-1",
      reason: "manual_run",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    { accountId: "account-a", requestId: "req-manual-1" },
  );
  assert.equal(reason, null);
});

test("clone on same phone is blocked by device-level lock", () => {
  const reason = deviceSessionLockBlocksStart(
    {
      deviceId: "device-1",
      workerId: "run-dispatcher:mac-a",
      accountId: "account-a",
      appInstanceId: "clone-a",
      requestId: "req-1",
      reason: "manual_run",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    { accountId: "account-b", requestId: "req-2" },
  );
  assert.equal(reason, "device_lease_unavailable");
});
