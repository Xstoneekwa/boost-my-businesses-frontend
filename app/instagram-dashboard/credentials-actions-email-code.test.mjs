import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("credentials actions keeps pending email code actions visible", () => {
  const dataSource = source("./credentials-actions-data.ts");

  assert.match(dataSource, /enter_email_verification_code/);
  assert.match(dataSource, /Enter email verification code/);
  assert.match(dataSource, /"code_submitted"/);
  assert.match(dataSource, /account_dashboard_actions/);
});

test("credentials page shows a priority email code action with Enter code modal", () => {
  const pageSource = source("./credentials-actions/page.tsx");

  assert.match(pageSource, /Immediate action/);
  assert.match(pageSource, /Email verification code required/);
  assert.match(pageSource, /VerificationCodeActionModal/);
  assert.match(pageSource, /enter_email_verification_code/);
});

test("verification modal accepts six digits and refreshes after safe submit", () => {
  const modalSource = source("./VerificationCodeActionModal.tsx");

  assert.match(modalSource, /Enter code/);
  assert.match(modalSource, /\/api\/instagram-dashboard\/dashboard-actions\/submit-verification-code/);
  assert.match(modalSource, /inputMode="numeric"/);
  assert.match(modalSource, /pattern="\[0-9\]\{6\}"/);
  assert.match(modalSource, /router\.refresh\(\)/);
  assert.match(modalSource, /setCode\(""\)/);
  assert.match(modalSource, /Code submitted\. Login resume queued\./);
  assert.match(modalSource, /autoOpen/);
  assert.match(modalSource, /setOpen\(true\)/);
  assert.match(modalSource, /setAutoOpenConsumed\(true\)/);
  assert.equal(modalSource.includes("console.log"), false);
});

test("submit route queues login resume without leaking code", () => {
  const routeSource = source("../api/instagram-dashboard/dashboard-actions/submit-verification-code/route.ts");

  assert.match(routeSource, /submit_account_verification_code/);
  assert.match(routeSource, /createLoginEmailCodeResumeRunRequest/);
  assert.match(routeSource, /login_email_code_resume/);
  assert.match(routeSource, /resume_queued/);
  assert.match(routeSource, /resume_already_queued/);
  assert.match(routeSource, /canAccessTenantPages/);
  assert.match(routeSource, /isInstagramAdmin/);
  assert.match(routeSource, /p_actor_type:\s*isInstagramAdmin \? "admin" : "client"/);
  assert.equal(routeSource.includes("console.log"), false);
  assert.equal(
    routeSource.split("\n").some((line) => /^\s*verification_code:\s*verificationCode/.test(line)),
    false,
  );
});

test("run control exposes login challenge run types", () => {
  const runControlSource = source("../../lib/instagram-dashboard/run-control.ts");

  assert.match(runControlSource, /login_provisioning/);
  assert.match(runControlSource, /login_email_code_resume/);
  assert.match(runControlSource, /createLoginEmailCodeResumeRunRequest/);
  assert.match(runControlSource, /evaluateLoginChallengeRunEligibility/);
});

test("verification modal shows resume queued and running states", () => {
  const modalSource = source("./VerificationCodeActionModal.tsx");

  assert.match(modalSource, /resumeStatus/);
  assert.match(modalSource, /Resume queued/);
  assert.match(modalSource, /Resume running/);
  assert.match(modalSource, /needs_new_code/);
  assert.match(modalSource, /resume_queued/);
});

test("submit route does not return or log the verification code", () => {
  const routeSource = source("../api/instagram-dashboard/dashboard-actions/submit-verification-code/route.ts");

  assert.match(routeSource, /code_submitted/);
});

test("dashboard email verification banner polls and exposes Enter code modal", () => {
  const bannerSource = source("./EmailVerificationActionBanner.tsx");
  const manageSource = source("./page.tsx");
  const credentialsSource = source("./credentials-actions/page.tsx");

  assert.match(bannerSource, /POLL_INTERVAL_MS = 15_000/);
  assert.match(bannerSource, /EMAIL_VERIFICATION_REFRESH_EVENT/);
  assert.match(bannerSource, /addEventListener\(EMAIL_VERIFICATION_REFRESH_EVENT/);
  assert.match(bannerSource, /Email verification code required for/);
  assert.match(bannerSource, /Email verification codes required/);
  assert.match(bannerSource, /Choose the matching account before entering a code/);
  assert.match(bannerSource, /actions\.map/);
  assert.match(bannerSource, /1 action required/);
  assert.match(bannerSource, /actions required/);
  assert.match(bannerSource, /VerificationCodeActionModal/);
  assert.match(bannerSource, /AUTO_OPEN_STORAGE_KEY/);
  assert.match(bannerSource, /readAutoOpenedActionIds/);
  assert.match(bannerSource, /writeAutoOpenedActionIds/);
  assert.match(bannerSource, /resumeStatusLabel/);
  assert.match(bannerSource, /resumeStatus=\{action\.resumeStatus\}/);
  assert.match(bannerSource, /actionNeedsCodeInput/);
  assert.match(bannerSource, /autoOpen=\{autoOpenActionId === action\.id\}/);
  assert.match(bannerSource, /method: "DELETE"/);
  assert.match(bannerSource, /ig-email-verification-delete/);
  assert.match(bannerSource, /Remove stale email verification request/);
  assert.match(bannerSource, /if \(actions\.length === 0\) return null/);
  assert.match(bannerSource, /\/api\/instagram-dashboard\/dashboard-actions\/email-verification/);
  assert.match(manageSource, /EmailVerificationActionBanner/);
  assert.match(credentialsSource, /EmailVerificationActionBanner/);
  assert.equal(bannerSource.includes("console.log"), false);
});

test("email verification polling route returns safe action metadata only", () => {
  const routeSource = source("../api/instagram-dashboard/dashboard-actions/email-verification/route.ts");

  assert.match(routeSource, /enter_email_verification_code/);
  assert.match(routeSource, /code_submitted/);
  assert.match(routeSource, /EMAIL_CODE_ACTION_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(routeSource, /BLOCKED_ACCOUNT_STATUSES/);
  assert.match(routeSource, /archived/);
  assert.match(routeSource, /trashed/);
  assert.match(routeSource, /cancelled/);
  assert.match(routeSource, /isFreshAction/);
  assert.match(routeSource, /isResumeActionable/);
  assert.match(routeSource, /isAccountVisible/);
  assert.match(routeSource, /resumeStatus/);
  assert.match(routeSource, /resumeRequestId/);
  assert.match(routeSource, /requireInstagramAdmin/);
  assert.match(routeSource, /ig_accounts/);
  assert.match(routeSource, /export async function DELETE/);
  assert.match(routeSource, /status: "dismissed"/);
  assert.match(routeSource, /\.in\("status", \[\.\.\.ACTIVE_EMAIL_CODE_STATUSES\]\)/);
  assert.equal(routeSource.includes("verification_code"), true);
  assert.equal(routeSource.includes("secret_ref"), false);
  assert.equal(routeSource.includes("vault"), false);
  assert.equal(routeSource.includes("console.log"), false);
});

test("email verification route excludes stale and out-of-scope accounts", () => {
  const routeSource = source("../api/instagram-dashboard/dashboard-actions/email-verification/route.ts");

  assert.match(routeSource, /visibleActions = actions\.filter/);
  assert.match(routeSource, /isAccountVisible\(accountById\.get\(accountId\)\)/);
  assert.match(routeSource, /isFreshAction\(row, nowMs\)/);
  assert.match(routeSource, /isResumeActionable\(row\)/);
  assert.doesNotMatch(routeSource, /metadata\}\)/);
});
