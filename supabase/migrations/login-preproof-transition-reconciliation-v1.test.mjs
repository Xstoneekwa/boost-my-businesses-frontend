import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("./20260810230000_login_preproof_transition_reconciliation_v1.sql", import.meta.url),
  "utf8",
);

test("reconciles every eligible pre-gate login without account hardcoding", () => {
  assert.match(migration, /login_identity_proof_status = 'proven_false_ready'/);
  assert.match(migration, /requested_run_type = 'login_provisioning'/);
  assert.match(migration, /rr\.status = 'completed'/);
  assert.match(migration, /r\.status = 'completed'/);
  assert.match(migration, /rr\.created_at < timestamptz '2026-08-10 11:19:19\+00'/);
  assert.doesNotMatch(migration, /growth_with_bmb|8bdd2dde/i);
});

test("restores connected readiness but never invents a verified proof", () => {
  assert.match(migration, /login_status = 'connected'/);
  assert.match(migration, /provisioning_status = 'ready'/);
  assert.match(migration, /onboarding_status = 'ready'/);
  assert.match(migration, /login_identity_proof_status = 'historical_model_missing'/);
  assert.match(migration, /login_identity_verified_at = null/);
  assert.doesNotMatch(migration, /login_identity_proof_status = 'verified'/);
});

test("keeps explicit invalidations and unsafe credentials fail closed", () => {
  assert.match(migration, /login_state_invalidation_reason is null/);
  assert.match(migration, /reauth_required, false\) is false/);
  assert.match(migration, /admin_lifecycle_status, ''\)\) = 'active'/);
  assert.match(migration, /ia\.archived_at is null/);
  assert.match(migration, /ia\.trashed_at is null/);
});

test("is a one-time data reconciliation with no new callable surface", () => {
  assert.doesNotMatch(migration, /create\s+(or\s+replace\s+)?function/i);
  assert.doesNotMatch(migration, /grant\s+execute/i);
  assert.match(
    migration,
    /alter table public\.client_instagram_accounts\s+disable trigger enforce_client_instagram_ready_identity_v1/,
  );
  assert.match(
    migration,
    /alter table public\.client_instagram_accounts\s+enable trigger enforce_client_instagram_ready_identity_v1/,
  );
  assert.equal(
    (migration.match(/disable trigger enforce_client_instagram_ready_identity_v1/g) ?? []).length,
    1,
  );
  assert.equal(
    (migration.match(/enable trigger enforce_client_instagram_ready_identity_v1/g) ?? []).length,
    1,
  );
});
