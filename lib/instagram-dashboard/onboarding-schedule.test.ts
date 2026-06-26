import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./onboarding-schedule.ts", import.meta.url), "utf8");

test("onboarding schedule helper reserves manual_only placement through dedicated rpc", () => {
  assert.match(source, /tryAssignManualOnlyOnboardingSchedule/);
  assert.match(source, /assign_account_manual_only/);
  assert.match(source, /manual_only_requires_app_instance/);
  assert.match(source, /manual_only_assigned/);
  assert.doesNotMatch(source, /tryAssignManualOnlyOnboardingSchedule[\s\S]*assign_account_slot/);
});

test("onboarding auto assign uses canonical live capacity resolver", () => {
  assert.match(source, /resolveLiveAssignmentTarget/);
  assert.match(source, /already_assigned/);
  assert.match(source, /physical_phone_only/);
  assert.match(source, /reservationMode: explicitWindowProvided \? "immediate" : "onboarding"/);
  assert.match(source, /releaseIneligibleOnboardingAssignment/);
  assert.doesNotMatch(source, /requireCurrentWindow: !explicitWindowProvided/);
});
