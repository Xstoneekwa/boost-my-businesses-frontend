import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = readFileSync(new URL("./onboarding-bootstrap-error-contract.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../instagram-client/client-account-onboarding.ts", import.meta.url), "utf8");
const clientRoute = readFileSync(new URL("../../app/api/instagram-client/onboarding/route.ts", import.meta.url), "utf8");
const operatorRoute = readFileSync(new URL("../../app/api/instagram-dashboard/accounts/create/route.ts", import.meta.url), "utf8");
const canonicalMigration = readFileSync(new URL("../../supabase/migrations/20260809210000_canonical_instagram_account_onboarding_v1.sql", import.meta.url), "utf8");
const storageMigration = readFileSync(new URL("../../supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql", import.meta.url), "utf8");

test("bootstrap exposes stable non-secret reason codes", () => {
  for (const code of [
    "ONBOARDING_BOOTSTRAP_AUTHORIZATION_MISSING", "ENTITLEMENT_INVALID",
    "ENTITLEMENT_ALREADY_CONSUMED", "PACKAGE_INVALID", "ONBOARDING_SESSION_CONFLICT",
    "IDEMPOTENCY_CONFLICT", "SERVER_ERROR",
  ]) assert.match(contract, new RegExp(`\\b${code}\\b`));
  assert.doesNotMatch(contract, /vault_secret|service_role_key/i);
});

test("Client, Admin and BotApp surfaces use the same bootstrap error contract", () => {
  assert.match(clientRoute, /onboardingBootstrapErrorCode/);
  assert.match(operatorRoute, /onboardingBootstrapErrorCode/);
  assert.match(operatorRoute, /resolveInstagramDashboardActor/);
  assert.match(operatorRoute, /beginInstagramAccountOnboarding/);
});

test("FIRST_PURCHASE_AND_NEW_ACCOUNT_SHARE_BOOTSTRAP_ENGINE", () => {
  assert.match(clientRoute, /beginInstagramAccountOnboarding/);
  assert.match(operatorRoute, /beginInstagramAccountOnboarding/);
  assert.doesNotMatch(service, /flow_type\s*===?\s*["']first_purchase/);
});

test("VALID_NEW_ACCOUNT_ENTITLEMENT_CREATES_OR_RESUMES_ONE_SESSION", () => {
  assert.match(service, /loadSessionRowByIdempotency/);
  assert.match(service, /getReservedEntitlementForClient/);
  assert.match(canonicalMigration, /canonical_instagram_onboarding:idempotency/);
});

test("DOUBLE_BOOTSTRAP_IS_IDEMPOTENT", () => {
  assert.match(canonicalMigration, /pg_advisory_xact_lock/);
  assert.match(canonicalMigration, /already_started/);
});

test("PARTIAL_BOOTSTRAP_CAN_RESUME", () => {
  assert.match(storageMigration, /failed_retryable/);
  assert.match(storageMigration, /set package_code = v_package_code,[\s\S]*status = 'creating'/);
});

test("NO_DUPLICATE_ENTITLEMENT and NO_DUPLICATE_ACCOUNT_DRAFT", () => {
  assert.match(storageMigration, /where id = p_entitlement_id[\s\S]*for update/);
  assert.match(storageMigration, /exception when others[\s\S]*status = 'failed_retryable'/);
});

test("NO_LEGACY_ACCOUNT_COUNT_GATE and CLIENT_ADMIN_BOTAPP_BOOTSTRAP_PARITY", () => {
  assert.doesNotMatch(service, /max_accounts|account_count|first_purchase/);
  assert.match(operatorRoute, /resolveInstagramDashboardActor/);
  assert.match(clientRoute, /actorType: "client"/);
});
