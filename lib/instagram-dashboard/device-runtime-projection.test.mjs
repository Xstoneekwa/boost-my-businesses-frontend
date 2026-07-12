import assert from "node:assert/strict";
import test from "node:test";

import deviceRuntimeProjection from "./device-runtime-projection.ts";

const { projectDeviceRuntimeState } = deviceRuntimeProjection;

test("heartbeat null plus active account_run_request projects phone busy", () => {
  const projection = projectDeviceRuntimeState({
    phoneStatus: "online",
    activeRunRequestStatus: "claimed",
  });

  assert.equal(projection.deviceRuntimeActive, true);
  assert.equal(projection.deviceRuntimeProjectionSource, "active_run_request");
  assert.equal(projection.projectedPhoneStatus, "running");
});

test("heartbeat null plus active ig_run projects phone busy", () => {
  const projection = projectDeviceRuntimeState({
    phoneStatus: null,
    activeRunStatus: "running",
  });

  assert.equal(projection.deviceRuntimeActive, true);
  assert.equal(projection.deviceRuntimeProjectionSource, "active_ig_run");
  assert.equal(projection.projectedPhoneStatus, "running");
});

test("terminal run request without another active signal does not project false busy", () => {
  const projection = projectDeviceRuntimeState({
    phoneStatus: "online",
    activeRunRequestStatus: "completed",
    activeRunStatus: "completed",
  });

  assert.equal(projection.deviceRuntimeActive, false);
  assert.equal(projection.deviceRuntimeProjectionSource, "none");
  assert.equal(projection.projectedPhoneStatus, "online");
});

test("new active clone on the same phone keeps the phone busy", () => {
  const oldClone = projectDeviceRuntimeState({
    phoneStatus: "online",
    activeRunStatus: "completed",
  });
  const activeClone = projectDeviceRuntimeState({
    phoneStatus: "online",
    activeRunRequestStatus: "running",
  });

  assert.equal(oldClone.deviceRuntimeActive, false);
  assert.equal(activeClone.deviceRuntimeActive, true);
  assert.equal(activeClone.projectedPhoneStatus, "running");
});

test("no active profile signal leaves phone non busy", () => {
  const projection = projectDeviceRuntimeState({ phoneStatus: "online" });

  assert.equal(projection.deviceRuntimeActive, false);
  assert.equal(projection.deviceRuntimeProjectionSource, "none");
  assert.equal(projection.projectedPhoneStatus, "online");
});
