import assert from "node:assert/strict";
import test from "node:test";

import { projectDispatcherSchedulerRuntimeHealth } from "./dispatcher-scheduler-runtime-health.ts";

const now = new Date("2026-07-15T08:00:00.000Z");
const healthyHeartbeat = {
  worker_id: "run-dispatcher:mac-admin-01",
  status: "idle",
  last_seen_at: "2026-07-15T07:59:40.000Z",
  process_id: "4242",
  metadata: {
    component: "run_control_dispatcher",
    health_only: false,
    launch_enabled: true,
  },
};

test("fresh launch-capable dispatcher heartbeat is active", () => {
  const health = projectDispatcherSchedulerRuntimeHealth({
    workerId: "run-dispatcher:mac-admin-01",
    heartbeat: healthyHeartbeat,
    now,
    maxAgeSeconds: 60,
  });

  assert.equal(health.dispatcherConnected, true);
  assert.equal(health.status, "active");
  assert.equal(health.processId, "4242");
});

test("missing dispatcher heartbeat is unavailable", () => {
  const health = projectDispatcherSchedulerRuntimeHealth({
    workerId: "run-dispatcher:mac-admin-01",
    heartbeat: null,
    now,
  });

  assert.equal(health.dispatcherConnected, false);
  assert.equal(health.status, "unavailable");
});

test("stale dispatcher heartbeat is rejected at the canonical threshold", () => {
  const health = projectDispatcherSchedulerRuntimeHealth({
    workerId: "run-dispatcher:mac-admin-01",
    heartbeat: { ...healthyHeartbeat, last_seen_at: "2026-07-15T07:58:59.000Z" },
    now,
    maxAgeSeconds: 60,
  });

  assert.equal(health.dispatcherConnected, false);
  assert.equal(health.status, "stale");
  assert.equal(health.heartbeatAgeSeconds, 61);
});

test("heartbeat without a launch-capable live process is rejected", () => {
  for (const heartbeat of [
    { ...healthyHeartbeat, process_id: null },
    { ...healthyHeartbeat, status: "starting" },
    { ...healthyHeartbeat, metadata: { ...healthyHeartbeat.metadata, launch_enabled: false } },
    { ...healthyHeartbeat, metadata: { ...healthyHeartbeat.metadata, health_only: true } },
  ]) {
    const health = projectDispatcherSchedulerRuntimeHealth({
      workerId: "run-dispatcher:mac-admin-01",
      heartbeat,
      now,
      maxAgeSeconds: 60,
    });
    assert.equal(health.dispatcherConnected, false);
    assert.equal(health.status, "unavailable");
  }
});
