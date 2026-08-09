import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const persistSource = readFileSync(new URL("./persist-account-login-email.ts", import.meta.url), "utf8");
const canonicalOnboardingSource = readFileSync(new URL("../instagram-client/client-account-onboarding.ts", import.meta.url), "utf8");
const onboardingTransactionSource = readFileSync(new URL("../../supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql", import.meta.url), "utf8");
const clientOnboardingRouteSource = readFileSync(new URL("../../app/api/instagram-client/onboarding/route.ts", import.meta.url), "utf8");
const adminCreateSource = readFileSync(new URL("../../app/api/instagram-dashboard/accounts/create/route.ts", import.meta.url), "utf8");
const credentialsSubmitSource = readFileSync(new URL("../../app/api/instagram-dashboard/credentials/submit/route.ts", import.meta.url), "utf8");

test("persist helper validates and writes ig_account_settings.email", () => {
  assert.match(persistSource, /parseLoginEmailInput/);
  assert.match(persistSource, /persistAccountLoginEmail/);
  assert.match(persistSource, /normalizeSafeEmail/);
  assert.match(persistSource, /ig_account_settings/);
  assert.match(persistSource, /email_present: true/);
  assert.doesNotMatch(persistSource, /console\.info\([\s\S]*password/);
});

test("client add account uses centralized login email persistence", () => {
  assert.match(clientOnboardingRouteSource, /parseLoginEmailInput/);
  assert.match(clientOnboardingRouteSource, /email:\s*email\.email \?\? ""/);
  assert.match(canonicalOnboardingSource, /begin_instagram_account_onboarding_v1/);
  assert.match(onboardingTransactionSource, /insert into public\.ig_account_settings/);
  assert.doesNotMatch(onboardingTransactionSource, /i_m_your_traker|growth_with_bmb/);
});

test("client onboarding accepts one canonical optional login email field", () => {
  assert.match(clientOnboardingRouteSource, /email\?: unknown/);
  assert.match(clientOnboardingRouteSource, /parseLoginEmailInput/);
  assert.match(clientOnboardingRouteSource, /email_invalid/);
  assert.doesNotMatch(clientOnboardingRouteSource, /loginEmail/);
});

test("admin add profile aligns email persistence on repair path", () => {
  assert.match(adminCreateSource, /parseLoginEmailInput/);
  assert.match(adminCreateSource, /beginInstagramAccountOnboarding/);
  assert.match(adminCreateSource, /canonical-account-onboarding/);
  assert.match(onboardingTransactionSource, /p_login_email/);
  assert.doesNotMatch(adminCreateSource, /\.from\("ig_account_settings"\)/);
});

test("credentials submit persists safe login email instead of skipping", () => {
  assert.match(credentialsSubmitSource, /persistAccountLoginEmail/);
  assert.match(credentialsSubmitSource, /parseLoginEmailInput/);
  assert.match(credentialsSubmitSource, /persistSubmittedLoginEmail/);
  assert.match(credentialsSubmitSource, /resolveServerCredentialsConfig/);
  assert.doesNotMatch(credentialsSubmitSource, /email_status:.*skipped_not_supported/);
  assert.match(credentialsSubmitSource, /email_status: emailStatus/);
  assert.match(credentialsSubmitSource, /password_status/);
});

test("login email sync route uses email-only persistence helper", () => {
  const routeSource = readFileSync(new URL("../../app/api/instagram-dashboard/accounts/login-email/route.ts", import.meta.url), "utf8");
  const scriptSource = readFileSync(new URL("../../scripts/sync-account-login-email.mjs", import.meta.url), "utf8");
  assert.match(routeSource, /persistAccountLoginEmail/);
  assert.match(routeSource, /settings_sync/);
  assert.match(routeSource, /password_status: "unchanged"/);
  assert.match(scriptSource, /ig_account_settings\.email/);
  assert.match(scriptSource, /LOGIN_EMAIL/);
  assert.doesNotMatch(scriptSource, /growth_with_bmb/);
});
