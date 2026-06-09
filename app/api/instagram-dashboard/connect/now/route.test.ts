import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("../../../../../lib/instagram-dashboard/connect-now.ts", import.meta.url), "utf8");
const readinessSource = readFileSync(new URL("../../../../../lib/instagram-dashboard/readiness-now.ts", import.meta.url), "utf8");
const buttonsSource = readFileSync(new URL("../../../../instagram-dashboard/InstagramDashboardButtons.tsx", import.meta.url), "utf8");
const bannerSource = readFileSync(new URL("../../../../instagram-dashboard/EmailVerificationActionBanner.tsx", import.meta.url), "utf8");
const submitCodeRouteSource = readFileSync(new URL("../../dashboard-actions/submit-verification-code/route.ts", import.meta.url), "utf8");

test("Connect route is admin-gated and uses login provisioning helper", () => {
  assert.match(routeSource, /requireInstagramAdmin\(\)/);
  assert.match(routeSource, /connectNowForAccount/);
  assert.doesNotMatch(routeSource, /runs\/start|account_session|full_cycle|ig_dm_jobs|send_dm/i);
});

test("Connect helper maps readiness to safe statuses", () => {
  assert.match(helperSource, /connected/);
  assert.match(helperSource, /connecting/);
  assert.match(helperSource, /two_factor_required/);
  assert.match(helperSource, /checkpoint_required/);
  assert.match(helperSource, /credentials_missing/);
  assert.match(helperSource, /phone_unavailable/);
  assert.match(helperSource, /assignment_required/);
  assert.match(helperSource, /try_again_later/);
});

test("Connect queues only login_provisioning through readiness-now", () => {
  assert.match(readinessSource, /p_requested_run_type:\s*"login_provisioning"/);
  assert.doesNotMatch(helperSource, /account_session|full_cycle|outreach_session|ig_dm_jobs|dm_job|follow|unfollow/i);
});

test("Connect button is separate from Credentials OK Assign now Readiness and Play", () => {
  const connectSection = buttonsSource.slice(
    buttonsSource.indexOf("async function connectNow"),
    buttonsSource.indexOf("async function assignNow"),
  );
  assert.match(buttonsSource, /label:\s*"Connect"/);
  assert.match(connectSection, /\/api\/instagram-dashboard\/connect\/now/);
  assert.match(buttonsSource, /requestConnectNow/);
  assert.match(connectSection, /refreshRunEligibility\(\{\s*loading:\s*true\s*\}\)/);
  assert.doesNotMatch(connectSection, /\/api\/instagram-dashboard\/runs\/start/);
  assert.doesNotMatch(connectSection, /\/api\/instagram-dashboard\/assignments\/now/);
});

test("2FA popup uses dashboard action polling and secure submit route", () => {
  assert.match(bannerSource, /dashboard-actions\/email-verification/);
  assert.match(bannerSource, /setInterval/);
  assert.match(bannerSource, /autoOpen/);
  assert.match(submitCodeRouteSource, /submit_account_verification_code/);
  assert.match(submitCodeRouteSource, /client_can_manage_instagram_account/);
  assert.match(submitCodeRouteSource, /createLoginEmailCodeResumeRunRequest/);
});

test("Connect and code routes do not expose unsafe identifiers or secrets", () => {
  const unsafeConnectResponse = /secret_ref|Vault|token|service_role|device_id|app_instance_id|ADB|raw XML|screenshot/i;
  const unsafeSubmitCodeHandling = /console\.log|localStorage|URLSearchParams|searchParams.*verification_code|verification_code.*metadata/i;
  assert.doesNotMatch(routeSource, unsafeConnectResponse);
  assert.doesNotMatch(helperSource, unsafeConnectResponse);
  assert.doesNotMatch(buttonsSource.slice(buttonsSource.indexOf("type ConnectNowResponse"), buttonsSource.indexOf("type ConfirmValidCredentialsResponse")), unsafeConnectResponse);
  assert.doesNotMatch(submitCodeRouteSource, unsafeSubmitCodeHandling);
});
