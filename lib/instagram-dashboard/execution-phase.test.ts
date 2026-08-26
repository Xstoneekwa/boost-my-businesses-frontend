import assert from "node:assert/strict";
import test from "node:test";
import { projectExecutionPhase } from "./execution-phase.ts";

const request = (status: string) => ({ id: "request-1", status });
const run = { id: "run-1", status: "running" };

test("queued, claimed, and admitted PRE_DEVICE never project ACTIVE", () => {
  assert.equal(projectExecutionPhase({ activeRequest: request("queued") }), "QUEUED");
  assert.equal(projectExecutionPhase({ activeRequest: request("claimed") }), "PREPARING");
  assert.equal(projectExecutionPhase({ activeRequest: request("running"), activeRun: run, capsule: {
    irreversible_work_state: "PRE_DEVICE", resume_state: "run_active",
  } }), "PREPARING");
});

test("PRE_DEVICE recovery states project RECOVERING", () => {
  for (const resume_state of ["pre_device_stopped", "recovery_enqueued", "resume_requested"]) {
    assert.equal(projectExecutionPhase({ activeRequest: request("running"), activeRun: run, capsule: {
      irreversible_work_state: "PRE_DEVICE", resume_state,
    } }), "RECOVERING");
  }
});

test("device gate and connection project startup without false ACTIVE", () => {
  assert.equal(projectExecutionPhase({ activeRequest: request("running"), activeRun: run, capsule: {
    irreversible_work_state: "STARTED_OR_AMBIGUOUS",
  } }), "STARTING_DEVICE");
  assert.equal(projectExecutionPhase({ activeRequest: request("running"), activeRun: run, capsule: {
    irreversible_work_state: "STARTED_OR_AMBIGUOUS", device_connected_at: "2026-08-26T00:00:01Z",
  } }), "STARTING_INSTAGRAM");
});

test("ACTIVE requires gate, device connection, and Instagram foreground proof", () => {
  assert.equal(projectExecutionPhase({ activeRequest: request("running"), activeRun: run, capsule: {
    irreversible_work_state: "STARTED_OR_AMBIGUOUS",
    device_connected_at: "2026-08-26T00:00:01Z",
    instagram_foreground_verified_at: "2026-08-26T00:00:02Z",
  } }), "ACTIVE");
  assert.notEqual(projectExecutionPhase({ activeRequest: request("running"), activeRun: run, capsule: {
    irreversible_work_state: "PRE_DEVICE",
    device_connected_at: "2026-08-26T00:00:01Z",
    instagram_foreground_verified_at: "2026-08-26T00:00:02Z",
  } }), "ACTIVE");
});

test("terminal or absent runtime projects TERMINAL", () => {
  assert.equal(projectExecutionPhase({ latestRun: { status: "completed" } }), "TERMINAL");
});
