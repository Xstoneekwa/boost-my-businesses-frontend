import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const bannerSource = source("./EmailVerificationActionBanner.tsx");
const modalSource = source("./VerificationCodeActionModal.tsx");
const emailRouteSource = source("../api/instagram-dashboard/dashboard-actions/email-verification/route.ts");
const submitRouteSource = source("../api/instagram-dashboard/dashboard-actions/submit-verification-code/route.ts");
const submitServiceSource = source("../../lib/instagram-dashboard/submit-verification-code-service.ts");
const runControlSource = source("../../lib/instagram-dashboard/run-control.ts");
const loadProgressSource = source("../../lib/instagram-client/load-client-connect-progress.ts");
const credentialsPageSource = source("./credentials-actions/page.tsx");

test("admin Auto Login challenge surfaces through email verification banner and modal", () => {
  assert.match(bannerSource, /Email verification code required/);
  assert.match(bannerSource, /VerificationCodeActionModal/);
  assert.match(bannerSource, /enter_email_verification_code/);
  assert.match(modalSource, /Enter code/);
  assert.match(modalSource, /submit-verification-code/);
  assert.match(runControlSource, /login_provisioning/);
  assert.match(runControlSource, /login_email_code_resume/);
});

test("admin dashboard refresh during challenge keeps polling the same action metadata", () => {
  assert.match(bannerSource, /POLL_INTERVAL_MS = 15_000/);
  assert.match(bannerSource, /refreshActions/);
  assert.match(bannerSource, /router\.refresh\(\)/);
  assert.match(bannerSource, /resumeRequestId/);
  assert.match(emailRouteSource, /resumeRequestId/);
  assert.match(emailRouteSource, /resumeStatus/);
  assert.match(emailRouteSource, /isFreshAction/);
});

test("closing and reopening admin verification modal does not dismiss the backend action", () => {
  assert.match(modalSource, /setOpen\(false\)/);
  assert.match(modalSource, /setOpen\(true\)/);
  assert.match(modalSource, /autoOpenConsumed/);
  assert.doesNotMatch(modalSource, /dismiss/);
  assert.match(bannerSource, /actionNeedsCodeInput/);
  assert.match(bannerSource, /if \(actions\.length === 0\) return null/);
});

test("admin code submission uses canonical write-only service and resumes same request", () => {
  assert.match(submitRouteSource, /submitAccountVerificationCode/);
  assert.match(submitServiceSource, /login_email_code_resume/);
  assert.match(submitRouteSource, /resume_request_id/);
  assert.match(submitRouteSource, /resume_queued/);
  assert.match(submitRouteSource, /resume_already_queued/);
  assert.match(submitRouteSource, /verification_code/);
  assert.match(submitServiceSource, /verificationCode/);
  assert.equal(submitRouteSource.includes("console.log"), false);
});

test("terminal admin Auto Login failure stays coherent and never maps to client connect progress", () => {
  assert.match(modalSource, /preflight_failed/);
  assert.match(modalSource, /needs_new_code/);
  assert.match(emailRouteSource, /BLOCKED_ACCOUNT_STATUSES/);
  assert.match(emailRouteSource, /isResumeActionable/);
  assert.doesNotMatch(loadProgressSource, /EmailVerificationActionBanner/);
  assert.doesNotMatch(credentialsPageSource, /ClientAccountsSection/);
});

test("admin dashboard never returns not_created when an active verification action exists", () => {
  assert.match(loadProgressSource, /findActiveVerificationAction/);
  assert.match(loadProgressSource, /verificationPending/);
  assert.match(loadProgressSource, /loadLoginProvisioningRequestByAttemptId/);
  assert.match(emailRouteSource, /enter_email_verification_code/);
  assert.match(emailRouteSource, /ACTIVE_EMAIL_CODE_STATUSES/);
  assert.doesNotMatch(loadProgressSource, /not_created/);
});

test("admin Auto Login popup cycle remains independent from client dashboard connect flow", () => {
  assert.doesNotMatch(bannerSource, /connect_operation_token/);
  assert.doesNotMatch(modalSource, /instagram-client/);
  assert.match(submitRouteSource, /frontend_credentials_actions/);
  assert.match(submitRouteSource, /isInstagramAdmin \? "admin" : "client"/);
  assert.doesNotMatch(bannerSource, /ClientAccountsSection/);
  assert.doesNotMatch(credentialsPageSource, /connect_operation_token/);
});
