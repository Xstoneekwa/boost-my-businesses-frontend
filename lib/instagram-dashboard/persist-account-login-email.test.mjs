import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const persistSource = readFileSync(new URL("./persist-account-login-email.ts", import.meta.url), "utf8");
const createAccountSource = readFileSync(new URL("../instagram-client/create-account.ts", import.meta.url), "utf8");
const clientRouteSource = readFileSync(new URL("../../app/api/instagram-client/accounts/route.ts", import.meta.url), "utf8");
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
  assert.match(createAccountSource, /parseLoginEmailInput/);
  assert.match(createAccountSource, /persistAccountLoginEmail/);
  assert.match(createAccountSource, /client_add_account/);
  assert.doesNotMatch(createAccountSource, /i_m_your_traker|growth_with_bmb/);
});

test("client accounts route accepts email and loginEmail aliases", () => {
  assert.match(clientRouteSource, /loginEmail/);
  assert.match(clientRouteSource, /parseLoginEmailInput/);
  assert.match(clientRouteSource, /email_invalid/);
});

test("admin add profile aligns email persistence on repair path", () => {
  assert.match(adminCreateSource, /persistAccountLoginEmail/);
  assert.match(adminCreateSource, /parseLoginEmailInput/);
  assert.match(adminCreateSource, /admin_add_profile/);
});

test("credentials submit persists safe login email instead of skipping", () => {
  assert.match(credentialsSubmitSource, /persistAccountLoginEmail/);
  assert.match(credentialsSubmitSource, /parseLoginEmailInput/);
  assert.match(credentialsSubmitSource, /persistSubmittedLoginEmail/);
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
