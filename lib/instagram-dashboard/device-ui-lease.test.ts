import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEVICE_LEASE_OPERATOR_LABEL,
  DEVICE_LEASE_UNAVAILABLE,
  deviceLeaseOperatorLabel,
  mapDeviceLockReasonToLeaseReason,
  runtimeLockFromActiveLease,
} from "./device-ui-lease.ts";
import { deviceSessionLockBlocksStart } from "./device-session-lock.ts";

describe("device ui lease CP3", () => {
  it("maps legacy device_lock_held to device_lease_unavailable", () => {
    assert.equal(mapDeviceLockReasonToLeaseReason("device_lock_held"), DEVICE_LEASE_UNAVAILABLE);
    assert.equal(deviceLeaseOperatorLabel("device_lock_held"), DEVICE_LEASE_OPERATOR_LABEL);
  });

  it("projects runtimeLock when an active phone lease exists", () => {
    assert.equal(
      runtimeLockFromActiveLease({
        deviceId: "device-1",
        workerId: "pending-request:req-1",
        accountId: "acct-1",
        appInstanceId: null,
        requestId: "req-1",
        reason: "manual_run",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, "device-1"),
      "device_level_lock",
    );
    assert.equal(
      runtimeLockFromActiveLease({
        deviceId: "device-1",
        workerId: "pending-request:req-1",
        accountId: "acct-1",
        appInstanceId: null,
        requestId: "req-1",
        reason: "manual_run",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, "device-2"),
      "none",
    );
  });

  it("blocks cross-owner starts with device_lease_unavailable", () => {
    const reason = deviceSessionLockBlocksStart(
      {
        deviceId: "device-1",
        workerId: "worker-a",
        accountId: "acct-a",
        appInstanceId: null,
        requestId: "req-a",
        reason: "manual_run",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      { accountId: "acct-b" },
    );
    assert.equal(reason, "device_lease_unavailable");
  });
});
