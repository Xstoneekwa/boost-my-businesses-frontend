import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  backendUnderstandsEveryDbResumeState,
  DB_ALLOWED_RESUME_STATES,
  resolveRunActiveProof,
  STALE_RESUME_PLAN_STATE,
} from "./resume-state-contract.ts";

test("backend understands every database resume state", () => {
  assert.equal(backendUnderstandsEveryDbResumeState(DB_ALLOWED_RESUME_STATES), true);
  assert.equal(backendUnderstandsEveryDbResumeState([...DB_ALLOWED_RESUME_STATES, "partial_resumable"]), false);
});

test("run_active accepts an exact genuinely active source run", () => {
  assert.deepEqual(resolveRunActiveProof({
    resumeState: "run_active",
    sourceRunStatus: "running",
    sourceRequestStatus: "completed",
    activeRunExists: true,
    activeRequestExists: false,
    liveDeviceLockExists: false,
  }), { proven: true, reason: "run_active_live_proof" });
});

test("run_active accepts an authoritative live device lease during lifecycle gaps", () => {
  assert.equal(resolveRunActiveProof({
    resumeState: "run_active",
    sourceRunStatus: "completed",
    sourceRequestStatus: "completed",
    activeRunExists: false,
    activeRequestExists: false,
    liveDeviceLockExists: true,
  }).proven, true);
});

test("a terminal source without live execution is STALE_RESUME_PLAN_STATE", () => {
  assert.deepEqual(resolveRunActiveProof({
    resumeState: "run_active",
    sourceRunStatus: "completed",
    sourceRequestStatus: "completed",
    activeRunExists: false,
    activeRequestExists: false,
    liveDeviceLockExists: false,
  }), { proven: false, reason: STALE_RESUME_PLAN_STATE });
});

test("resume_requested is a terminal plan state and needs no live proof", () => {
  assert.equal(resolveRunActiveProof({
    resumeState: "resume_requested",
    sourceRunStatus: "completed",
    sourceRequestStatus: "completed",
    activeRunExists: false,
    activeRequestExists: false,
    liveDeviceLockExists: false,
  }).proven, true);
});

test("stale-plan reconciliation runs only at a natural non-dry tick boundary", () => {
  const tickSource = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");
  assert.match(
    tickSource,
    /if \(!forceDryRun && !options\.manual\) \{[\s\S]*reconcile_stale_account_session_resume_plans_v1/,
  );
  assert.doesNotMatch(
    tickSource.slice(
      tickSource.indexOf("reconcile_stale_account_session_resume_plans_v1"),
      tickSource.indexOf("const overview ="),
    ),
    /create_account_run_request|consume_resume_authorization_and_create_request/,
  );
});
