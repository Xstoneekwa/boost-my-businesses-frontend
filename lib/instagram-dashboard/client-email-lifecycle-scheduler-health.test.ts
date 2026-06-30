import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CLIENT_EMAIL_LIFECYCLE_CRON_PATH,
  CLIENT_EMAIL_LIFECYCLE_CRON_SCHEDULE,
  CLIENT_EMAIL_LIFECYCLE_NATIVE_CRON_STALE_MS,
  buildClientEmailLifecycleCronHeartbeatMetadata,
  detectClientEmailLifecycleCronInvoker,
  projectClientEmailLifecycleSchedulerHealth,
} from "./client-email-lifecycle-scheduler-health.ts";

test("vercel.json registers exactly one native lifecycle cron every 15 minutes", () => {
  const vercelJson = readFileSync(
    fileURLToPath(new URL("../../vercel.json", import.meta.url)),
    "utf8",
  );
  const parsed = JSON.parse(vercelJson) as { crons?: Array<{ path?: string; schedule?: string }> };
  const lifecycleCrons = (parsed.crons ?? []).filter((cron) => cron.path === CLIENT_EMAIL_LIFECYCLE_CRON_PATH);
  assert.equal(lifecycleCrons.length, 1);
  assert.equal(lifecycleCrons[0]?.schedule, CLIENT_EMAIL_LIFECYCLE_CRON_SCHEDULE);
});

test("detectClientEmailLifecycleCronInvoker recognizes native Vercel header", () => {
  const native = new Headers({ "x-vercel-cron": "1" });
  const manual = new Headers({ authorization: "Bearer secret" });
  assert.equal(detectClientEmailLifecycleCronInvoker(native), "vercel_native");
  assert.equal(detectClientEmailLifecycleCronInvoker(manual), "manual");
});

test("scheduler health is misconfigured without CRON_SECRET", () => {
  const health = projectClientEmailLifecycleSchedulerHealth({ env: {} });
  assert.equal(health.status, "misconfigured");
  assert.equal(health.schedulerConnected, false);
});

test("CRON_SECRET alone does not make scheduler healthy", () => {
  const health = projectClientEmailLifecycleSchedulerHealth({
    env: { CRON_SECRET: "configured" },
  });
  assert.equal(health.status, "awaiting_first_native_tick");
  assert.equal(health.schedulerConnected, false);
});

test("native tick success becomes healthy within stale window", () => {
  const now = new Date("2026-06-30T12:00:00.000Z");
  const health = projectClientEmailLifecycleSchedulerHealth({
    env: { CRON_SECRET: "configured" },
    heartbeatMetadata: {
      last_native_success_at: "2026-06-30T11:45:00.000Z",
      native_tick_count: 1,
      last_invoker: "vercel_native",
    },
    now,
  });
  assert.equal(health.status, "healthy");
  assert.equal(health.schedulerConnected, true);
});

test("native tick older than 30 minutes becomes stale", () => {
  const now = new Date("2026-06-30T12:00:00.000Z");
  const health = projectClientEmailLifecycleSchedulerHealth({
    env: { CRON_SECRET: "configured" },
    heartbeatMetadata: {
      last_native_success_at: "2026-06-30T11:00:00.000Z",
      native_tick_count: 3,
      last_invoker: "vercel_native",
    },
    now,
  });
  assert.equal(health.status, "stale");
  assert.equal(health.schedulerConnected, false);
  assert.equal(CLIENT_EMAIL_LIFECYCLE_NATIVE_CRON_STALE_MS, 30 * 60 * 1000);
});

test("manual heartbeat does not increment native tick count", () => {
  const metadata = buildClientEmailLifecycleCronHeartbeatMetadata({
    existingMetadata: {
      native_tick_count: 0,
      last_native_success_at: null,
    },
    ok: true,
    invoker: "manual",
    now: new Date("2026-06-30T12:00:00.000Z"),
    consecutiveFailures: 0,
    incidentSignals: [],
  });
  assert.equal(metadata.native_tick_count, 0);
  assert.equal(metadata.last_native_success_at, null);
  assert.equal(metadata.last_invoker, "manual");
});

test("native heartbeat increments native tick count and success timestamp", () => {
  const metadata = buildClientEmailLifecycleCronHeartbeatMetadata({
    existingMetadata: {
      native_tick_count: 2,
      last_native_success_at: "2026-06-30T11:30:00.000Z",
    },
    ok: true,
    invoker: "vercel_native",
    now: new Date("2026-06-30T12:00:00.000Z"),
    consecutiveFailures: 0,
    incidentSignals: [],
  });
  assert.equal(metadata.native_tick_count, 3);
  assert.equal(metadata.last_native_success_at, "2026-06-30T12:00:00.000Z");
  assert.equal(metadata.last_invoker, "vercel_native");
});
