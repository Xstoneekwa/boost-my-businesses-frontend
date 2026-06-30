import assert from "node:assert/strict";
import test from "node:test";
import {
  BOTAPP_SCHEDULER_RUNTIME_STALE_MS,
  buildBotAppSchedulerRuntimeWorkerId,
  loadBotAppSchedulerRuntimeHealth,
  normalizeBotAppSchedulerRuntimeHeartbeatPayload,
  projectBotAppSchedulerRuntimeHealth,
} from "./botapp-scheduler-runtime-health.ts";

test("buildBotAppSchedulerRuntimeWorkerId is stable per host", () => {
  assert.equal(
    buildBotAppSchedulerRuntimeWorkerId("Mac-Mini-01"),
    "botapp-scheduler-runtime:mac-mini-01",
  );
});

test("fresh active heartbeat is schedulerConnected", () => {
  const now = new Date("2026-06-30T12:00:00.000Z");
  const health = projectBotAppSchedulerRuntimeHealth({
    now,
    heartbeat: {
      worker_id: "botapp-scheduler-runtime:mac-mini-01",
      status: "idle",
      last_seen_at: "2026-06-30T11:59:30.000Z",
      metadata: {
        runtime_host: "Mac-Mini-01",
        scheduler_available: true,
        voluntary_shutdown: false,
        dispatcher_observed_status: "running",
      },
    },
  });
  assert.equal(health.status, "active");
  assert.equal(health.schedulerConnected, true);
});

test("voluntary shutdown marks runtime unavailable", () => {
  const now = new Date("2026-06-30T12:00:00.000Z");
  const health = projectBotAppSchedulerRuntimeHealth({
    now,
    heartbeat: {
      worker_id: "botapp-scheduler-runtime:mac-mini-01",
      status: "stopping",
      last_seen_at: now.toISOString(),
      metadata: {
        runtime_host: "Mac-Mini-01",
        scheduler_available: false,
        voluntary_shutdown: true,
      },
    },
  });
  assert.equal(health.status, "unavailable");
  assert.equal(health.schedulerConnected, false);
});

test("heartbeat older than stale threshold is stale", () => {
  const now = new Date("2026-06-30T12:00:00.000Z");
  const health = projectBotAppSchedulerRuntimeHealth({
    now,
    heartbeat: {
      worker_id: "botapp-scheduler-runtime:mac-mini-01",
      status: "idle",
      last_seen_at: "2026-06-30T11:58:00.000Z",
      metadata: { scheduler_available: true, voluntary_shutdown: false },
    },
  });
  assert.equal(health.status, "stale");
  assert.equal(BOTAPP_SCHEDULER_RUNTIME_STALE_MS, 90_000);
});

test("normalize heartbeat payload derives worker id from runtime host", () => {
  const payload = normalizeBotAppSchedulerRuntimeHeartbeatPayload({
    runtime_host: "farm-mac-1",
    status: "idle",
    scheduler_available: true,
    voluntary_shutdown: false,
  });
  assert.equal(payload.worker_id, "botapp-scheduler-runtime:farm-mac-1");
});

test("loadBotAppSchedulerRuntimeHealth reads latest prefixed heartbeat", async () => {
  const supabase = {
    from() {
      return {
        select: () => ({
          like: () => ({
            order: () => ({
              limit: async () => ({
                data: [{
                  worker_id: "botapp-scheduler-runtime:mac-mini-01",
                  status: "idle",
                  last_seen_at: new Date().toISOString(),
                  metadata: { scheduler_available: true, voluntary_shutdown: false },
                }],
                error: null,
              }),
            }),
          }),
          eq: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      };
    },
  };
  const health = await loadBotAppSchedulerRuntimeHealth(supabase as never);
  assert.equal(health.schedulerConnected, true);
});
