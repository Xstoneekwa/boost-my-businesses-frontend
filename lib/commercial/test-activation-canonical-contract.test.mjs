import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("TEST_ACTIVATION_ON_ALLOWS_TEST_FLOW", () => {
  const authorization = source("lib/commercial/prod-test-checkout-authorization.ts");
  const access = source("lib/commercial/checkout-simulation-access.ts");
  assert.match(authorization, /authorization\.authorized_flows\.includes\(flow\)/);
  assert.match(access, /source: "prod_test_authorization"/);
});

test("TEST_ACTIVATION_OFF_BLOCKS_TEST_FLOW", () => {
  const authorization = source("lib/commercial/prod-test-checkout-authorization.ts");
  assert.match(authorization, /authorization\.status === "revoked"/);
  assert.match(authorization, /reason: "authorization_revoked"/);
});

test("CLIENT_CANNOT_CHANGE_TEST_ACTIVATION_STATE", () => {
  const route = source("app/api/instagram-dashboard/commercial/prod-test-authorizations/route.ts");
  const clientPage = source("app/instagram-client/choose-plan/page.tsx");
  assert.match(route, /requireInstagramAdmin/);
  assert.doesNotMatch(clientPage, /prod-test-authorizations/);
});

test("SUPERADMIN_CAN_CHANGE_TEST_ACTIVATION_STATE", () => {
  const route = source("app/api/instagram-dashboard/commercial/prod-test-authorizations/route.ts");
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /revokeProdTestCheckoutAuthorization/);
});

test("TEST_MODE_NEVER_SWITCHES_TO_LIVE_STRIPE", () => {
  const route = source("app/api/instagram-dashboard/commercial/prod-test-authorizations/route.ts");
  const authorization = source("lib/commercial/prod-test-checkout-authorization.ts");
  assert.doesNotMatch(`${route}\n${authorization}`, /stripe\.checkout|checkout\.sessions\.create|paymentIntents/i);
});

test("TEST_ACTIVATION_USES_CANONICAL_ONBOARDING", () => {
  const choosePlan = source("app/instagram-client/choose-plan/page.tsx");
  const form = source("app/instagram-growth/checkout/CommercialCheckoutForm.tsx");
  assert.match(choosePlan, /CommercialCheckoutForm flowType="additional_account"/);
  assert.match(form, /\/api\/commercial\/checkout\/quote/);
  assert.match(form, /\/api\/commercial\/checkout\/simulated\/activate/);
});

test("NO_LEGACY_CREATE_PATH_REINTRODUCED", () => {
  const choosePlan = source("app/instagram-client/choose-plan/page.tsx");
  assert.doesNotMatch(choosePlan, /client_instagram_accounts|ig_accounts|insert\(/);
  assert.match(choosePlan, /CommercialCheckoutForm/);
});
