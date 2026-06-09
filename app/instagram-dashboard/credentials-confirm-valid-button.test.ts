import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./InstagramDashboardButtons.tsx", import.meta.url), "utf8");

test("credentials confirmation button is shown only for reauth eligibility reasons", () => {
  assert.match(source, /label:\s*"Credentials OK"/);
  assert.match(source, /new Set\(\["reauth_required", "credentials_reauth_required"\]\)/);
  assert.match(source, /const showCredentialsConfirm = eligibility\?\.ok_to_start === false && credentialsConfirmReasons\.has\(eligibility\.reason\);/);
  assert.doesNotMatch(source, /credentialsConfirmReasons[\s\S]{0,180}account_cancelled/);
  assert.doesNotMatch(source, /credentialsConfirmReasons[\s\S]{0,180}assignment_window_closed/);
});

test("credentials confirmation button has dedicated loading and disabled state", () => {
  assert.match(source, /isConfirmingCredentials/);
  assert.match(source, /setIsConfirmingCredentials\(true\)/);
  assert.match(source, /setIsConfirmingCredentials\(false\)/);
  assert.match(source, /Confirming credentials\.\.\./);
});

test("credentials confirmation click calls only confirm-valid endpoint", () => {
  const confirmSection = source.slice(
    source.indexOf("async function confirmCredentialsValid"),
    source.indexOf("async function assignNow"),
  );
  assert.match(confirmSection, /fetch\("\/api\/instagram-dashboard\/credentials\/confirm-valid"/);
  assert.match(confirmSection, /body:\s*JSON\.stringify\(\{\s*account_id:\s*accountId\s*\}\)/);
  assert.match(confirmSection, /refreshRunEligibility\(\{\s*loading:\s*true\s*\}\)/);
  assert.match(confirmSection, /router\.refresh\(\)/);
  assert.doesNotMatch(confirmSection, /\/api\/instagram-dashboard\/runs\/start/);
  assert.doesNotMatch(confirmSection, /\/api\/instagram-dashboard\/readiness\/now/);
  assert.doesNotMatch(confirmSection, /\/api\/instagram-dashboard\/assignments\/now/);
  assert.doesNotMatch(confirmSection, /requested_run_type|create_account_run_request|runner\.py|dm_job|send_dm/i);
});

test("credentials confirmation success message is safe", () => {
  assert.match(source, /Credentials confirmed\. Recheck readiness or assign now\./);
  assert.match(source, /Credentials not active\./);
  assert.match(source, /Account cannot be updated\./);
  assert.match(source, /Try again later\./);
});

test("credentials confirmation UI does not render secrets or technical identifiers", () => {
  const typeSection = source.slice(
    source.indexOf("type ConfirmValidCredentialsResponse"),
    source.indexOf("type InstagramDashboardButtonsProps"),
  );
  const confirmSection = source.slice(
    source.indexOf("async function confirmCredentialsValid"),
    source.indexOf("async function assignNow"),
  );
  for (const section of [typeSection, confirmSection]) {
    assert.doesNotMatch(section, /password|secret_ref|Vault|token|service_role|device_id|app_instance_id|ADB|raw XML|screenshot path|runner internals/i);
  }
});
