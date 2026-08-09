import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const facade = source("./canonical-account-onboarding.ts");
const service = source("../instagram-client/client-account-onboarding.ts");
const clientRoute = source("../../app/api/instagram-client/onboarding/route.ts");
const operatorRoute = source("../../app/api/instagram-dashboard/accounts/create/route.ts");
const operatorActorAuth = source("../instagram-dashboard/instagram-dashboard-actor-auth.ts");
const legacyCreate = source("../instagram-client/create-account.ts");
const migration = source("../../supabase/migrations/20260809210000_canonical_instagram_account_onboarding_v1.sql");
const rollback = source("../../supabase/rollback/20260809210000_canonical_instagram_account_onboarding_v1.down.sql");

test("one exported engine serves client, admin and BotApp actor contexts", () => {
  assert.match(facade, /canonical_instagram_account_onboarding_v1/);
  for (const actor of ["client", "admin", "botapp_operator"]) assert.match(service, new RegExp(`"${actor}"`));
  assert.match(clientRoute, /actorType: "client"[\s\S]*source: "client_dashboard"/);
  assert.match(operatorRoute, /resolveInstagramDashboardActor/);
  assert.match(operatorActorAuth, /actorType: "admin"[\s\S]*source: "admin_dashboard"/);
  assert.match(operatorActorAuth, /actorType: "botapp_operator"[\s\S]*source: "botapp"/);
});

test("all three surfaces share the same persisted workflow and 15-target gate", () => {
  assert.match(clientRoute, /beginInstagramAccountOnboarding/);
  assert.match(operatorRoute, /beginInstagramAccountOnboarding/);
  assert.match(operatorRoute, /updateInstagramAccountOnboarding/);
  assert.match(operatorRoute, /saveInstagramAccountOnboardingProtectionLists/);
  assert.match(service, /CLIENT_ONBOARDING_TARGET_MINIMUM/);
  assert.match(service, /finalizeCompletedOnboardingAssignment/);
  assert.match(migration, /public\.advance_client_instagram_onboarding\(/);
});

test("actor authorization is server-side and account-scoped", () => {
  assert.match(migration, /public\.authorize_instagram_account_onboarding_actor_v1/);
  assert.match(migration, /public\.client_users/);
  assert.match(migration, /public\.tenant_users/);
  assert.match(migration, /tu\.role = 'superadmin'/);
  assert.match(migration, /cu\.client_id = p_client_id/);
  assert.match(service, /assertInstagramOnboardingActorAccess/);
});

test("package, entitlement, credentials and ownership remain in one transaction", () => {
  assert.match(service, /getReservedEntitlementForClient/);
  assert.match(service, /entitlementToAddProfileInput/);
  assert.match(migration, /public\.begin_client_instagram_onboarding\(/);
  assert.match(migration, /p_entitlement_id/);
  assert.doesNotMatch(operatorRoute, /commercial_package\?:|resolveAddProfilePackagePreset|applyAddProfileRuntimeDefaults/);
});

test("assignment intent stays inert until canonical completion", () => {
  assert.match(migration, /source_context jsonb/);
  assert.match(migration, /runtime_activation_requested', false/);
  assert.match(service, /if \(input\.action !== "complete" \|\| projected\.status !== "completed"\) return projected/);
  assert.match(service, /finalizeCompletedOnboardingAssignment/);
  assert.doesNotMatch(operatorRoute, /assign_account_slot|tryAssignOnboardingSchedule/);
});

test("legacy direct create is fail-closed and write-free", () => {
  assert.match(legacyCreate, /legacy_direct_create_disabled/);
  assert.match(legacyCreate, /input\.dryRun !== true/);
  assert.doesNotMatch(legacyCreate, /\.insert\(|\.upsert\(|rotate_instagram_account_credentials/);
});

test("canonical RPCs are service-role-only with a complete rollback", () => {
  for (const fn of [
    "authorize_instagram_account_onboarding_actor_v1",
    "begin_instagram_account_onboarding_v1",
    "advance_instagram_account_onboarding_v1",
    "save_instagram_account_onboarding_protection_lists_v1",
    "restart_instagram_account_onboarding_v1",
    "expire_instagram_account_onboarding_sessions_v1",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*service_role`));
    assert.match(rollback, new RegExp(`drop function if exists public\\.${fn}`));
  }
});

test("idempotency is stable and cannot cross actor boundaries", () => {
  assert.match(service, /existing\.initiated_by_actor_id/);
  assert.match(service, /existingActorId !== input\.actor\.actorId/);
  assert.match(service, /idempotency_actor_mismatch/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /idempotency_actor_mismatch/);
  assert.match(migration, /initiated_by_actor_id <> p_actor_id/);
  assert.match(operatorRoute, /idempotency_key_invalid/);
});

test("an authorized actor may continue a session created on another surface", () => {
  assert.match(migration, /where s\.id = p_session_id and s\.client_id = p_client_id/);
  const advance = migration.slice(
    migration.indexOf("create or replace function public.advance_instagram_account_onboarding_v1"),
    migration.indexOf("create or replace function public.save_instagram_account_onboarding_protection_lists_v1"),
  );
  assert.doesNotMatch(advance, /s\.initiated_by_actor_id = p_actor_id/);
  assert.match(advance, /'actor_id', p_actor_id/);
});
