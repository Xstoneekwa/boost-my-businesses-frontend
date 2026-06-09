import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./InstagramDashboardButtons.tsx", import.meta.url), "utf8");

test("admin readiness button calls readiness now endpoint", () => {
  assert.match(source, /label:\s*"Run readiness now"/);
  assert.match(source, /fetch\("\/api\/instagram-dashboard\/readiness\/now"/);
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*account_id:\s*accountId,\s*audience:\s*"admin"\s*\}\)/);
});

test("admin readiness button has loading and result states", () => {
  assert.match(source, /isCheckingReadiness/);
  assert.match(source, /setIsCheckingReadiness\(true\)/);
  assert.match(source, /setIsCheckingReadiness\(false\)/);
  assert.match(source, /readinessNowSuccessMessage/);
  for (const label of [
    "Ready",
    "Checking connection",
    "2FA required",
    "Checkpoint required",
    "Update password",
    "Capacity unavailable",
    "Waiting next slot",
    "Try again later",
  ]) {
    assert.match(source, new RegExp(label));
  }
});

test("admin readiness action remains separate from manual run now", () => {
  assert.match(source, /fetch\("\/api\/instagram-dashboard\/runs\/start"/);
  assert.match(source, /requested_run_type:\s*"account_session"/);
  assert.match(source, /This checks Instagram login\/readiness now\. It will not start a full Growth session\./);
  assert.doesNotMatch(source, /readiness\/now[\s\S]{0,300}requested_run_type:\s*"account_session"/);
});

test("admin readiness UI does not render technical identifiers", () => {
  const readinessSection = source.slice(
    source.indexOf("type ReadinessNowStatus"),
    source.indexOf("type InstagramDashboardButtonsProps"),
  );
  assert.doesNotMatch(readinessSection, /device_id|app_instance_id|ADB serial|secret_ref|Vault|token|service_role|raw XML|screenshot|runner internals/i);
  assert.doesNotMatch(readinessSection, /assignment_id\??:/i);
});
