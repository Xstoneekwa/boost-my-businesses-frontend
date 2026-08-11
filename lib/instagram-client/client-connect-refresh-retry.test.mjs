import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sectionSource = readFileSync(
  new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
  "utf8",
);
const retryRouteSource = readFileSync(
  new URL("../../app/api/instagram-client/accounts/[accountId]/connect/retry-attempt/route.ts", import.meta.url),
  "utf8",
);
const cancelServiceSource = readFileSync(
  new URL("./cancel-client-connect-attempt.ts", import.meta.url),
  "utf8",
);

test("Actualiser invokes the authenticated retry command before refreshing progress", () => {
  assert.match(sectionSource, /connect\/retry-attempt/);
  assert.match(sectionSource, /method: "POST"/);
  const retryIndex = sectionSource.indexOf("connect/retry-attempt");
  const progressIndex = sectionSource.indexOf("syncConnectProgress(accountId, retryOperationToken)");
  assert.ok(retryIndex >= 0 && progressIndex > retryIndex);
});

test("Verifier et connecter uses the same canonical retry contract as Actualiser", () => {
  const reopenStart = sectionSource.indexOf("async function handleReopenVerification");
  const reopenEnd = sectionSource.indexOf("async function handleManualRefresh", reopenStart);
  const reopenSource = sectionSource.slice(reopenStart, reopenEnd);
  assert.match(reopenSource, /ensureClientConnectAttempt\(account\.accountId\)/);
  assert.match(reopenSource, /resumeActiveConnect\(account, true, connectOperationToken\)/);
  assert.ok(
    reopenSource.indexOf("ensureClientConnectAttempt") < reopenSource.indexOf("resumeActiveConnect"),
    "the active-or-retry request must be ensured before progress polling resumes",
  );
});

test("shared retry helper is account generic and carries the operation token into progress", () => {
  const helperStart = sectionSource.indexOf("const ensureClientConnectAttempt");
  const helperEnd = sectionSource.indexOf("const resumeActiveConnect", helperStart);
  const helperSource = sectionSource.slice(helperStart, helperEnd);
  assert.match(helperSource, /encodeURIComponent\(accountId\)/);
  assert.match(helperSource, /connect\/retry-attempt/);
  assert.match(helperSource, /connect_operation_token/);
  assert.doesNotMatch(helperSource, /nab_youss|email|sms|whatsapp|authenticator/i);
});

test("active login request makes refresh idempotent and never cancels it", () => {
  assert.match(retryRouteSource, /ACTIVE_LOGIN_REQUEST_STATUSES/);
  assert.match(retryRouteSource, /retry_reason: "active_login_request"/);
  assert.match(retryRouteSource, /request_queued: true/);
  assert.ok(retryRouteSource.indexOf("if (activeRequest)") < retryRouteSource.indexOf("const canceled = await cancelClientConnectAttempt"));
});

test("terminal stale verification is cleaned before a fresh login request", () => {
  assert.match(retryRouteSource, /dismissRetryableLoginReview: true/);
  assert.match(retryRouteSource, /client_refresh_retry_login/);
  assert.ok(retryRouteSource.indexOf("cancelClientConnectAttempt({") < retryRouteSource.indexOf("connectClientInstagramAccount({"));
});

test("operator review cleanup is restricted to terminal correlated login runs", () => {
  assert.match(cancelServiceSource, /linkedRunId/);
  assert.match(cancelServiceSource, /requested_run_type/);
  assert.match(cancelServiceSource, /LOGIN_REQUEST_TYPES/);
  assert.match(cancelServiceSource, /TERMINAL_LOGIN_REQUEST_STATUSES/);
  assert.match(cancelServiceSource, /dismissRetryableLoginReview === true/);
});

test("refresh retry never reads or resubmits the stored verification code", () => {
  assert.doesNotMatch(retryRouteSource, /verification_code|account_verification_code_submissions|Vault|vault/i);
  assert.doesNotMatch(sectionSource.slice(sectionSource.indexOf("async function handleProcessRefresh"), sectionSource.indexOf("async function runConnectProcess")), /verificationCode|submit-verification-code/);
});

test("refresh retry is channel agnostic for email sms whatsapp and authenticator", () => {
  assert.doesNotMatch(retryRouteSource, /verification_channel|challenge_type/);
  assert.match(retryRouteSource, /connectClientInstagramAccount/);
  for (const channel of ["email", "sms", "whatsapp", "authenticator_app"]) {
    assert.doesNotMatch(retryRouteSource, new RegExp(`=== ["']${channel}["']`));
  }
});
