import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runControlSource = readFileSync(
  new URL("../../../../lib/instagram-dashboard/run-control.ts", import.meta.url),
  "utf8",
);
const eligibilityRouteSource = readFileSync(new URL("./eligibility/route.ts", import.meta.url), "utf8");
const startRouteSource = readFileSync(new URL("./start/route.ts", import.meta.url), "utf8");
const scheduleMigrationSource = readFileSync(
  new URL("../../../../supabase/migrations/20260613_manual_run_mode_trigger_gates.sql", import.meta.url),
  "utf8",
);

test("technical and growth run type classifications are explicit", () => {
  assert.match(runControlSource, /TECHNICAL_ACCOUNT_RUN_TYPES = \[/);
  assert.match(runControlSource, /"login_provisioning"/);
  assert.match(runControlSource, /"credential_verification"/);
  assert.match(runControlSource, /GROWTH_RUN_TYPES = \[/);
  assert.match(runControlSource, /"account_session"/);
  assert.match(runControlSource, /"outreach_session"/);
});

test("technical runs bypass campaign schedule while growth runs require trigger classification", () => {
  assert.match(runControlSource, /function requiresScheduleWindow\(runType: string, trigger: unknown = "auto"\)/);
  assert.match(runControlSource, /if \(!isGrowthRun\(runType\)\) return false/);
  assert.match(runControlSource, /return !isManualTrigger\(trigger\)/);
  assert.match(runControlSource, /if \(isTechnicalAccountRun\(normalizedRunType\)\)[\s\S]*evaluateLoginChallengeRunEligibility/);
  assert.match(runControlSource, /account_credentials[\s\S]*secret_ref/);
  assert.match(runControlSource, /account_assignments[\s\S]*app_instance_id/);
  assert.match(runControlSource, /phone_app_instances[\s\S]*usable_for_auto_login/);
});

test("manual-only schedule gate distinguishes auto from manual triggers", () => {
  assert.match(scheduleMigrationSource, /p_trigger text default null/);
  assert.match(scheduleMigrationSource, /'technical_run_allowed_manual_only'/);
  assert.match(scheduleMigrationSource, /'manual_only_requires_manual_trigger'/);
  assert.match(scheduleMigrationSource, /'manual_start_allowed_manual_only'/);
  assert.match(scheduleMigrationSource, /elsif not v_window_active and not v_manual_trigger then/);
  assert.doesNotMatch(scheduleMigrationSource, /manual_only_runtime_disabled/);
});

test("start route accepts explicit manual trigger contract safely", () => {
  assert.match(startRouteSource, /trigger\?: unknown/);
  assert.match(startRouteSource, /manual_start\?: unknown/);
  assert.match(startRouteSource, /normalizeRunStartTrigger\(body\?\.trigger\)/);
  assert.match(startRouteSource, /evaluateRunStartEligibility\(accountId, requestedRunType,\s*\{[\s\S]*trigger/);
  assert.match(startRouteSource, /p_metadata_safe:[\s\S]*manual_start: trigger === "manual"/);
  assert.doesNotMatch(startRouteSource, /password|secret_ref|service_role/i);
});

test("eligibility route exposes technical ready reasons safely", () => {
  assert.match(eligibilityRouteSource, /technical_run_allowed_outside_campaign_window/);
  assert.match(eligibilityRouteSource, /technical_run_allowed_manual_only/);
  assert.match(eligibilityRouteSource, /Technical account run is ready now/);
  assert.doesNotMatch(eligibilityRouteSource, /password|secret_ref|service_role/i);
});
