import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Contract tests over the canonical Auto Restart tick source: the P3
 * human-confirmed resume path must stay atomic, anti-loop and canonical
 * (no second scheduler, no direct worker call, no backend-launched run).
 */
const tickSource = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");

test("human-confirmed resumes run inside the canonical tick only", () => {
  assert.match(tickSource, /processHumanConfirmedResumes/);
  // Never in dry-run/shadow mode.
  assert.match(tickSource, /if \(!forceDryRun\) \{\s*await processHumanConfirmedResumes/);
});

test("authorization is claimed atomically BEFORE the request is created", () => {
  const claimIndex = tickSource.indexOf("claimAuthorizationAtomically(supabase, authorizationId, now)");
  const enqueueIndex = tickSource.indexOf('idempotencyKey: `resume-auth:${authorizationId}`,');
  assert.ok(claimIndex > 0, "atomic claim present");
  assert.ok(enqueueIndex > 0, "canonical enqueue present");
  assert.ok(claimIndex < enqueueIndex, "claim happens before enqueue");
  // The loser of a concurrent claim sees a stable reason.
  assert.match(tickSource, /resume_authorization_consumed/);
});

test("resume request creation stays on the canonical CP0 path", () => {
  // The only creation primitive is the guarded RPC (via enqueueAutoRestartRequest).
  assert.match(tickSource, /rpc\("create_account_run_request"/);
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /enqueueAutoRestartRequest\(supabase/);
  assert.doesNotMatch(humanSection, /fetch\(/);
  // Recovery metadata links everything for the worker + audit.
  assert.match(humanSection, /recovery_mode: "human_confirmed_resume"/);
  assert.match(humanSection, /incident_id: incidentId/);
  assert.match(humanSection, /original_run_id: originalRunId/);
  assert.match(humanSection, /resume_plan_id: resumePlanId/);
  assert.match(humanSection, /resume_window_key: resumeWindowKey/);
  assert.match(humanSection, /trigger: "scheduler_tick"/);
});

test("human-confirmed resume rebuilds explicit phases before consuming authorization", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  const planIndex = humanSection.indexOf("buildAutoRestartResumePlanMetadata(");
  const claimIndex = humanSection.indexOf("claimAuthorizationAtomically(supabase, authorizationId, now)");
  assert.ok(planIndex > 0, "canonical current resume plan is rebuilt");
  assert.ok(claimIndex > planIndex, "phase plan is certified before atomic consumption");
  assert.match(humanSection, /resume_candidate_unavailable/);
  assert.match(humanSection, /resume_phase_plan_not_actionable/);
  assert.match(humanSection, /\.\.\.resumeMetadata/);
});

test("expired window expires the authorization with a stable reason", () => {
  assert.match(tickSource, /markAuthorizationExpired\(supabase, authorizationId, now\)/);
  assert.match(tickSource, /resume_authorization_expired/);
});

test("canonical run-start gates apply (manual_only excluded, no active run)", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /evaluateRunStartEligibility\(accountId, "account_session", \{\s*trigger: "scheduler",?\s*\}\)/);
});

test("a failed resume never loops: authorization stays consumed", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  // On enqueue failure the incident flips to reintervention_required and the
  // consumed authorization is never re-armed automatically.
  assert.match(humanSection, /reintervention_required/);
  assert.doesNotMatch(humanSection, /status:\s*"armed"/);
});

test("internal test authorizations can never enqueue anything", () => {
  assert.match(tickSource, /test_authorization_excluded/);
});

test("every decision is audited in auto_restart_decisions", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /human_confirmed_resume_enqueued/);
  assert.match(humanSection, /human_confirmed_resume_evaluated/);
  assert.match(humanSection, /writeDecision/);
});
