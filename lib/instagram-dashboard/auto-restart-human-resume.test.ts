import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Contract tests over the canonical Auto Restart tick source: the P3
 * human-confirmed resume path must stay atomic, retry-safe and canonical
 * (no second scheduler, no direct worker call, no backend-launched run).
 */
const tickSource = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");

test("human-confirmed resumes run inside the canonical tick only", () => {
  assert.match(tickSource, /processHumanConfirmedResumes/);
  // Never in dry-run/shadow mode.
  assert.match(tickSource, /if \(!forceDryRun\) \{\s*await processHumanConfirmedResumes/);
});

test("authorization consumption and request creation use one atomic RPC", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /consumeAuthorizationAndCreateRequest\(supabase/);
  assert.doesNotMatch(humanSection, /claimAuthorizationAtomically/);
  assert.match(tickSource, /consume_resume_authorization_and_create_request_v3/);
});

test("resume request creation stays on the canonical CP0 path", () => {
  // The generic and human paths both ultimately use the guarded DB primitive.
  assert.match(tickSource, /rpc\("create_account_run_request"/);
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /consumeAuthorizationAndCreateRequest\(supabase/);
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
  const claimIndex = humanSection.indexOf("consumeAuthorizationAndCreateRequest(supabase");
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
  assert.match(humanSection, /evaluateRunStartEligibility\(accountId, "account_session", \{/);
  assert.match(humanSection, /phasesToRun: resumeMetadata\.resume_plan\.phases_to_run/);
});

test("resolved Instagram restrictions enqueue only a zero-business-action preflight", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /instagram_account_restriction/);
  assert.match(humanSection, /buildInstagramRestrictionPreflightMetadata/);
  assert.match(humanSection, /verification_required/);
  assert.match(humanSection, /restriction_preflight_only: restrictionPreflight/);
});

test("a failed atomic enqueue leaves authorization retryable", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /database transaction rolls back authorization consumption/i);
  assert.doesNotMatch(humanSection, /bindAuthorizationToRequest/);
  assert.match(humanSection, /restore_prebusiness_resume_retry_credits_v1/);
});

test("internal test authorizations can never enqueue anything", () => {
  assert.match(tickSource, /test_authorization_excluded/);
});

test("a human authorization must match the latest canonical partial run", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /validateResumeAuthorizationLineage/);
  assert.match(humanSection, /latestCanonicalRunId: candidate\?\.sourceRunId/);
  assert.match(humanSection, /markAuthorizationExpired\(supabase, authorizationId, now\)/);
  assert.match(humanSection, /await blockResume\(lineageVerdict\.reason\)/);
});

test("the configured global delay also gates human-confirmed resumes", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /restartDelayBlockReason\(candidate\.reliability\.nextRestartAt, now\)/);
  assert.match(humanSection, /await blockResume\(delayReason\)/);
});

test("every decision is audited in auto_restart_decisions", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /human_confirmed_resume_enqueued/);
  assert.match(humanSection, /human_confirmed_resume_evaluated/);
  assert.match(humanSection, /writeDecision/);
});
