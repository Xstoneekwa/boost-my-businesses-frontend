import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("Admin and BotApp adapt to the single canonical onboarding engine", () => {
  assert.match(source, /canonical-account-onboarding/);
  assert.match(source, /beginInstagramAccountOnboarding/);
  assert.match(source, /previewInstagramAccountOnboarding/);
  assert.match(source, /updateInstagramAccountOnboarding/);
  assert.match(source, /saveInstagramAccountOnboardingProtectionLists/);
  assert.match(source, /CANONICAL_INSTAGRAM_ACCOUNT_ONBOARDING_ENGINE/);
});

test("operator identity is server-authenticated and never accepted from payload", () => {
  assert.match(source, /getInstagramAdminUserContext\(\)/);
  assert.match(source, /canAccessTenantPages\(adminContext\)/);
  assert.match(source, /verifyCompassRelayKey\(request\.headers\)/);
  assert.match(source, /INSTAGRAM_BOTAPP_OPERATOR_USER_ID/);
  assert.doesNotMatch(source, /body\.(actor_id|operator_id|user_id)/);
});

test("canonical create requires client ownership context and stable idempotency", () => {
  assert.match(source, /client_id\?: unknown/);
  assert.match(source, /idempotency_key\?: unknown/);
  assert.match(source, /client_id_invalid/);
  assert.match(source, /idempotency_key_invalid/);
  assert.match(source, /restartInstagramAccountOnboarding/);
});

test("package truth comes only from the reserved entitlement", () => {
  assert.match(source, /source: "client_account_entitlements"/);
  assert.doesNotMatch(source, /readCommercialPackage|resolveAddProfilePackagePreset|commercial_package\?:/);
  assert.doesNotMatch(source, /applyAddProfileRuntimeDefaults|ensureAddProfileOwnership/);
});

test("device and schedule are deferred source context, never immediate provisioning", () => {
  assert.match(source, /function sourceContext/);
  assert.match(source, /deviceId: readString\(body\.device_id\)/);
  assert.match(source, /scheduleMode:/);
  assert.match(source, /runtime_activation_requested: false/);
  assert.doesNotMatch(source, /tryAssignOnboardingSchedule|assign_account_slot|provisioning_started|run_started/);
});

test("route has no parallel persistence engine", () => {
  assert.doesNotMatch(source, /\.from\(/);
  assert.doesNotMatch(source, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(source, /rotate_instagram_account_credentials|create_instagram_credentials_vault_secret/);
});

test("credentials remain write-only and required for real canonical begin", () => {
  assert.match(source, /if \(!dryRun && !password\)/);
  assert.match(source, /password_status: "write_only"/);
  assert.doesNotMatch(source, /secret_ref|service_role/i);
});

test("the shared surface exposes resume and all canonical state transitions", () => {
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  assert.match(source, /export async function PATCH/);
  for (const action of ["save_analysis", "save_protection_lists", "save_targeting", "open_targets", "complete", "abandon"]) {
    assert.match(source, new RegExp(`"${action}"`));
  }
});
