import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./InstagramDashboardButtons.tsx", import.meta.url), "utf8");

test("manual run button loads backend eligibility reason", () => {
  assert.match(source, /type RunEligibilityProjection/);
  assert.match(source, /runEligibility/);
  assert.match(source, /runEligibilityLoading/);
  assert.match(source, /runEligibilityError/);
  assert.match(source, /\/api\/instagram-dashboard\/runs\/eligibility\?account_id=/);
  assert.match(source, /eligibility\.message/);
});

test("manual run button is enabled only when backend eligibility is ok", () => {
  assert.match(
    source,
    /const playDisabled = isStartingRun \|\| eligibilityLoading \|\| Boolean\(eligibilityError\) \|\| eligibility\?\.ok_to_start !== true;/,
  );
  assert.doesNotMatch(source, /playDisabled = isStartingRun \|\| !health\?\.playEnabled/);
  assert.doesNotMatch(source, /!health\?\.healthy \|\| eligibility\?\.ok_to_start === false/);
});

test("manual run button has safe loading and error disabled reasons", () => {
  assert.match(source, /Checking run eligibility\.\.\./);
  assert.match(source, /Unable to verify run eligibility\./);
  assert.match(source, /eligibility\?\.ok_to_start === false[\s\S]{0,80}\? eligibility\.message/);
});

test("manual run button remains separate from readiness and start actions", () => {
  assert.match(source, /fetch\("\/api\/instagram-dashboard\/runs\/start"/);
  assert.match(source, /requested_run_type:\s*"account_session"/);
  assert.match(source, /fetch\("\/api\/instagram-dashboard\/readiness\/now"/);
  assert.doesNotMatch(source, /runs\/eligibility[\s\S]{0,300}create_account_run_request/);
  assert.doesNotMatch(source, /runs\/eligibility[\s\S]{0,300}requested_run_type:\s*"account_session"/);
});

test("manual run eligibility UI does not expose technical identifiers", () => {
  const eligibilitySection = source.slice(
    source.indexOf("type RunEligibilityProjection"),
    source.indexOf("type RunStartResponse"),
  );
  assert.doesNotMatch(eligibilitySection, /device_id|app_instance_id|assignment_id|ADB serial|secret_ref|Vault|token|service_role|raw XML|screenshot|runner internals/i);
});
