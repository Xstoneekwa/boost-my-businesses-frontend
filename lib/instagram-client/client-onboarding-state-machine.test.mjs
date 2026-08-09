import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("client onboarding chain wires checkout entitlement add credentials assignment readiness", () => {
  const activate = source("../commercial/activate-client-account-entitlement-from-checkout.ts");
  const entitlements = source("../commercial/entitlements.ts");
  const canonicalOnboarding = source("./client-account-onboarding.ts");
  const transaction = source("../../supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql");
  const onboarding = source("../instagram-dashboard/onboarding-schedule.ts");
  const connectAccount = source("./connect-account.ts");
  const readiness = source("../instagram-dashboard/readiness-now.ts");
  const projection = source("./client-readiness-projection.ts");

  assert.match(activate, /client_account_entitlements/);
  assert.match(activate, /commercial_checkout_sessions/);
  assert.match(entitlements, /entitlement_reserved/);
  assert.match(entitlements, /entitlement_consumed/);
  assert.match(transaction, /insert into public\.client_instagram_accounts/);
  assert.match(transaction, /create_instagram_credentials_vault_secret/);
  assert.match(canonicalOnboarding, /tryAutoAssignOnboardingSchedule/);
  assert.match(canonicalOnboarding, /pending_assignment/);
  assert.match(onboarding, /assign_account_slot/);
  assert.match(onboarding, /onboarding_auto/);
  assert.match(onboarding, /retryOnboardingAutoAssignmentIfPending/);
  assert.match(connectAccount, /retryOnboardingAutoAssignmentIfPending/);
  assert.match(connectAccount, /checkClientAccountReadiness/);
  assert.match(readiness, /missing_assignment/);
  assert.match(projection, /preparation_pending/);
  assert.match(projection, /ready_to_connect/);
});

test("check-readiness retries onboarding assignment without enqueueing connect", () => {
  const readinessRoute = source("../../app/api/instagram-client/accounts/[accountId]/check-readiness/route.ts");
  const connectAccount = source("./connect-account.ts");
  const checkReadinessBody = connectAccount.slice(
    connectAccount.indexOf("export async function checkClientAccountReadiness"),
    connectAccount.indexOf("export async function connectClientInstagramAccount"),
  );
  assert.match(readinessRoute, /checkClientAccountReadiness/);
  assert.match(connectAccount, /retryOnboardingAutoAssignmentIfPending/);
  assert.match(checkReadinessBody, /PASSIVE_READINESS_MODE/);
  assert.doesNotMatch(checkReadinessBody, /enqueueClientConnectRequest/);
  assert.doesNotMatch(readinessRoute, /connectClientInstagramAccount/);
});

test("onboarding assignment defers honestly when physical phones are unavailable", () => {
  const resolver = source("../instagram-dashboard/assignment-live-capacity.ts");
  const canonicalOnboarding = source("./client-account-onboarding.ts");
  assert.match(resolver, /live_device_unavailable/);
  assert.match(resolver, /physical_phone_only/);
  assert.match(canonicalOnboarding, /assignmentStatus:\s*"pending_assignment"/);
  assert.match(canonicalOnboarding, /assignment\.assigned \? "onboarding_auto_assigned" : "pending_assignment"/);
  assert.doesNotMatch(canonicalOnboarding, /assignment\.assigned \? "ready_to_connect"/);
});

test("onboarding assignment advances when live capacity is selected", () => {
  const onboarding = source("../instagram-dashboard/onboarding-schedule.ts");
  const resolver = source("../instagram-dashboard/assignment-live-capacity.ts");
  assert.match(resolver, /live_capacity_selected/);
  assert.match(onboarding, /assigned: true/);
  assert.match(onboarding, /onboarding_auto_assigned/);
});
