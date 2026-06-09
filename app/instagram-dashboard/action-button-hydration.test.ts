import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const buttonsSource = readFileSync(new URL("./InstagramDashboardButtons.tsx", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("../../lib/instagram-dashboard/dashboard-action-button-state.ts", import.meta.url), "utf8");

test("ActionButton always renders a stable boolean disabled prop", () => {
  assert.match(buttonsSource, /const disabled = resolveActionButtonDisabled\(tool\.disabled\)/);
  assert.match(buttonsSource, /disabled=\{disabled\}/);
  assert.doesNotMatch(buttonsSource, /disabled=\{tool\.disabled\}/);
});

test("dashboard tools set explicit disabled booleans for every action button", () => {
  assert.match(buttonsSource, /return \{ \.\.\.tool, disabled: false \}/);
  assert.match(buttonsSource, /disabled: playDisabled/);
  assert.match(buttonsSource, /disabled: isCheckingReadiness \|\| isStartingRun/);
});

test("SSR and client share the same initial eligibility pending state", () => {
  assert.match(buttonsSource, /useState\(false\)/);
  assert.match(buttonsSource, /isRunEligibilityPending/);
  assert.match(buttonsSource, /const eligibilityPending = isRunEligibilityPending\(eligibilityLoading, eligibility\)/);
  assert.match(stateSource, /return loading \|\| eligibility === null/);
});

test("readiness connect assign now and play actions stay separate", () => {
  assert.match(buttonsSource, /fetch\("\/api\/instagram-dashboard\/readiness\/now"/);
  assert.match(buttonsSource, /fetch\("\/api\/instagram-dashboard\/connect\/now"/);
  assert.match(buttonsSource, /fetch\("\/api\/instagram-dashboard\/assignments\/now"/);
  assert.match(buttonsSource, /fetch\("\/api\/instagram-dashboard\/runs\/start"/);
  assert.doesNotMatch(buttonsSource, /Connect[\s\S]{0,500}\/api\/instagram-dashboard\/runs\/start/);
  assert.doesNotMatch(buttonsSource, /Assign now[\s\S]{0,500}\/api\/instagram-dashboard\/runs\/start/);
});

test("connect triggers immediate email verification banner refresh", () => {
  assert.match(buttonsSource, /EMAIL_VERIFICATION_REFRESH_EVENT/);
  assert.match(buttonsSource, /dispatchEvent\(new CustomEvent\(EMAIL_VERIFICATION_REFRESH_EVENT\)\)/);
});
