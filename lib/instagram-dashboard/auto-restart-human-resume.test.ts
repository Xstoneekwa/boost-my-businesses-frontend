import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Contract tests over the canonical Auto Restart tick source: the P3
 * human-confirmed resume path must stay atomic, retry-safe and canonical
 * (no second scheduler, no direct worker call, no backend-launched run).
 */
const tickSource = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");
const authorizationSource = readFileSync(
  new URL("./incident-resume-authorization.ts", import.meta.url),
  "utf8",
);

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

test("only the audited account-scoped one-shot may preserve a frozen Follow-only plan", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /retry_generation,frozen_phase_plan,test/);
  assert.match(humanSection, /applyFollow60sOneShotFrozenPlan/);
  assert.match(humanSection, /follow60sOneShot\?\.matched\s*\?/);
  assert.match(humanSection, /follow60sOneShot\.metadata/);
});

test("an armed Follow60 control overrides resolved-incident generic phases", () => {
  const callerSection = tickSource.slice(
    tickSource.indexOf("await processHumanConfirmedResumes"),
    tickSource.indexOf("await processHumanConfirmedResumes") + 700,
  );
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));

  assert.match(callerSection, /follow60ControlByAccount/);
  assert.match(callerSection, /follow60ActiveControlCount: follow60ControlRows\.length/);
  assert.match(humanSection, /resolveArmedFollow60Control\(\{/);
  assert.match(humanSection, /row: input\.follow60ControlByAccount\.get\(accountId\)/);
  assert.match(humanSection, /if \(follow60Resolution && !follow60Resolution\.ok\) \{\s*await blockResume\(follow60Resolution\.reason\)/);
  assert.match(humanSection, /projectArmedFollow60Candidate\(rebuiltGoldenCandidate, follow60Resolution\.control\)/);
  assert.match(humanSection, /attachArmedFollow60Contract\(/);
  assert.match(humanSection, /rebuiltCandidate && !follow60Authority/);
  assert.match(humanSection, /follow60sOneShot\?\.matched\s*\?/);
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

test("a resolved human authorization must match the latest canonical run", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /validateResumeAuthorizationLineage/);
  assert.match(humanSection, /latestCanonicalRunId: candidate\?\.sourceRunId/);
  assert.match(humanSection, /resolvedIncidentAuthorized: true/);
  assert.match(humanSection, /markAuthorizationExpired\(supabase, authorizationId, now\)/);
  assert.match(humanSection, /await blockResume\(lineageVerdict\.reason\)/);
});

test("resolved review gets one atomic retry credit without changing global budgets", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.doesNotMatch(humanSection, /restartDelayBlockReason\(candidate\.reliability\.nextRestartAt, now\)/);
  assert.match(humanSection, /authorizationRetryCreditScope = "one_shot_atomic_authorization"/);
  assert.match(humanSection, /authorization_retry_credit_scope: authorizationRetryCreditScope/);
  assert.doesNotMatch(humanSection, /await blockResume\("max_restarts_day"\)/);
  assert.doesNotMatch(humanSection, /await blockResume\("max_restarts_window"\)/);
  assert.match(humanSection, /evaluateRunStartEligibility/);
  assert.match(humanSection, /validateCanonicalResumePlan/);
  assert.match(humanSection, /consumeAuthorizationAndCreateRequest\(supabase/);
});

test("human Unfollow resume transports the exact persisted Daily Plan checkpoint", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(authorizationSource, /attempts_in_window,plan,test/);
  assert.match(humanSection, /storedPlanPayload = readRecord\(storedPlan\.plan\)/);
  assert.match(humanSection, /storedPlanPayload\?\.unfollow_checkpoint/);
  assert.match(humanSection, /resumeMetadata\.resume_plan\.unfollow_checkpoint = storedUnfollowCheckpoint/);
  assert.ok(
    humanSection.indexOf("resumeMetadata.resume_plan.unfollow_checkpoint = storedUnfollowCheckpoint")
      < humanSection.indexOf("consumeAuthorizationAndCreateRequest(supabase"),
    "the exact checkpoint must be attached before atomic request creation",
  );
});

test("generic auto restart still enforces global retry budgets", () => {
  const genericSection = tickSource.slice(0, tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(genericSection, /max_restarts_day/);
  assert.match(genericSection, /max_restarts_window/);
});

test("every decision is audited in auto_restart_decisions", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /human_confirmed_resume_enqueued/);
  assert.match(humanSection, /human_confirmed_resume_evaluated/);
  assert.match(humanSection, /writeDecision/);
});
