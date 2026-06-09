import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const buttonsSource = readFileSync(new URL("./InstagramDashboardButtons.tsx", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("../../lib/instagram-dashboard/dashboard-action-button-state.ts", import.meta.url), "utf8");

test("ActionButton always renders a stable boolean disabled prop", () => {
  assert.match(buttonsSource, /const isDisabled = resolveActionButtonDisabled\(tool\.disabled\) === true/);
  assert.match(buttonsSource, /disabled=\{isDisabled \? true : false\}/);
  assert.doesNotMatch(buttonsSource, /disabled=\{tool\.disabled\}/);
});

test("dashboard tools set explicit disabled booleans for every action button", () => {
  assert.match(buttonsSource, /return \{ \.\.\.tool, disabled: resolveActionButtonDisabled\(false\) \}/);
  assert.match(buttonsSource, /disabled: resolveActionButtonDisabled\(playDisabled\)/);
  assert.match(buttonsSource, /disabled: resolveActionButtonDisabled\(isCheckingReadiness \|\| isStartingRun\)/);
});

test("SSR and client share the same initial eligibility pending state", () => {
  assert.match(buttonsSource, /const \[runEligibilityLoading, setRunEligibilityLoading\] = useState\(true\)/);
  assert.match(buttonsSource, /const \[hasHydratedActionButtons, setHasHydratedActionButtons\] = useState\(false\)/);
  assert.match(buttonsSource, /setHasHydratedActionButtons\(true\)/);
  assert.match(buttonsSource, /isRunEligibilityPending/);
  assert.match(buttonsSource, /const eligibilityPending = isRunEligibilityPending\(eligibilityLoading, eligibility, hasHydrated\)/);
  assert.match(buttonsSource, /buildConnectButtonDisabledState/);
  assert.match(buttonsSource, /disabled: resolveActionButtonDisabled\(connectDisabled\)/);
  assert.match(buttonsSource, /disabled=\{isDisabled \? true : false\}/);
  assert.match(stateSource, /if \(!hasHydrated\) return true/);
});

test("connect button with null eligibility never exposes null disabled", () => {
  assert.match(stateSource, /export function buildConnectButtonDisabledState/);
  assert.match(stateSource, /const disabled = resolveActionButtonDisabled\(/);
  assert.match(buttonsSource, /const connectButtonState = buildConnectButtonDisabledState\(/);
  assert.match(buttonsSource, /disabled: resolveActionButtonDisabled\(connectDisabled\)/);
  assert.doesNotMatch(buttonsSource, /disabled=\{connectDisabled\}/);
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
