import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConnectButtonDisabledState,
  isPlayDisabled,
  isRunEligibilityPending,
  resolveActionButtonDisabled,
  shouldShowAssignNow,
  shouldShowConnect,
  shouldShowCredentialsConfirm,
} from "./dashboard-action-button-state.ts";

test("resolveActionButtonDisabled never treats nullish values as enabled mismatch", () => {
  assert.equal(resolveActionButtonDisabled(undefined), false);
  assert.equal(resolveActionButtonDisabled(null), false);
  assert.equal(resolveActionButtonDisabled(false), false);
  assert.equal(resolveActionButtonDisabled(true), true);
});

test("connect button stays disabled with a boolean while eligibility is unknown", () => {
  const pending = buildConnectButtonDisabledState({
    isConnectingNow: false,
    isStartingRun: false,
    isCheckingReadiness: false,
    eligibilityLoading: false,
    eligibilityError: "",
    eligibility: null,
  });

  assert.equal(pending.disabled, true);
  assert.equal(pending.disabledReason, "Checking run eligibility...");
  assert.equal(typeof pending.disabled, "boolean");
  assert.notEqual(pending.disabled, null);
  assert.equal(resolveActionButtonDisabled(pending.disabled), true);
});

test("initial SSR and client treat unknown eligibility as pending", () => {
  assert.equal(isRunEligibilityPending(false, null), true);
  assert.equal(isRunEligibilityPending(true, null), true);
  assert.equal(isRunEligibilityPending(false, { ok_to_start: true, reason: "ready", message: "ready" }, false), true);
  assert.equal(
    isPlayDisabled(false, isRunEligibilityPending(false, null), "", null),
    true,
  );
});

test("ok_to_start=true enables play once eligibility is known", () => {
  const eligibility = { ok_to_start: true, reason: "ready", message: "Manual run is ready." };
  assert.equal(isRunEligibilityPending(false, eligibility), false);
  assert.equal(isPlayDisabled(false, false, "", eligibility), false);
});

test("assignment_window_closed shows assign now and ready hides it", () => {
  const blocked = {
    ok_to_start: false,
    reason: "assignment_window_closed",
    message: "Manual run is blocked because the account is outside its assigned schedule window.",
  };
  const ready = { ok_to_start: true, reason: "ready", message: "Manual run is ready." };
  assert.equal(shouldShowAssignNow(blocked), true);
  assert.equal(shouldShowAssignNow(ready), false);
});

test("credentials confirm stays separate from assign now", () => {
  const reauth = { ok_to_start: false, reason: "reauth_required", message: "Credentials need attention." };
  const assignment = { ok_to_start: false, reason: "assignment_window_closed", message: "Window closed." };
  assert.equal(shouldShowCredentialsConfirm(reauth), true);
  assert.equal(shouldShowAssignNow(reauth), false);
  assert.equal(shouldShowAssignNow(assignment), true);
  assert.equal(shouldShowCredentialsConfirm(assignment), false);
});

test("connect is visible for login blockers and separate from assign now", () => {
  const login = { ok_to_start: false, reason: "login_not_connected", message: "Connect required." };
  const verification = { ok_to_start: false, reason: "login_verification_required", message: "Verification required." };
  const assignment = { ok_to_start: false, reason: "assignment_window_closed", message: "Window closed." };
  const ready = { ok_to_start: true, reason: "ready", message: "Manual run is ready." };

  assert.equal(shouldShowConnect(login), true);
  assert.equal(shouldShowConnect(verification), true);
  assert.equal(shouldShowConnect(assignment), false);
  assert.equal(shouldShowAssignNow(login), false);
  assert.equal(shouldShowConnect(ready), false);
});
