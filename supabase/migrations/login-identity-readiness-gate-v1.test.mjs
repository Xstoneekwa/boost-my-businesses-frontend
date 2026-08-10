import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260810111500_login_identity_readiness_gate_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../rollback/20260810111500_login_identity_readiness_gate_v1.down.sql", import.meta.url),
  "utf8",
);
const runControl = readFileSync(
  new URL("../../lib/instagram-dashboard/run-control.ts", import.meta.url),
  "utf8",
);

test("ready lifecycle transitions require a persisted exact own-profile identity proof", () => {
  assert.match(migration, /login_identity_proof_status/);
  assert.match(migration, /login_identity_profile_opened/);
  assert.match(migration, /login_identity_username_match/);
  assert.match(migration, /login_identity_verified_at/);
  assert.match(migration, /enforce_client_instagram_ready_identity_v1/);
  assert.match(migration, /raise exception 'login_identity_not_verified'/);
  assert.match(migration, /v_expected_username = v_canonical_username/);
  assert.match(migration, /v_detected_username = v_canonical_username/);
});

test("historical accounts are classified without blind lifecycle invalidation", () => {
  assert.match(migration, /historical_model_missing/);
  const historicalBlock = migration.slice(
    migration.indexOf("update public.client_instagram_accounts\nset login_identity_proof_status"),
    migration.indexOf("create or replace function public.normalize_instagram_identity_username_v1"),
  );
  assert.doesNotMatch(historicalBlock, /login_status\s*=|provisioning_status\s*=|onboarding_status\s*=/);
  assert.match(migration, /historical_identity_model_missing/);
});

test("only a proven terminal login run can reconcile false-ready state at an idle boundary", () => {
  assert.match(migration, /reconcile_proven_false_ready_identity_v1/);
  assert.match(migration, /rr\.requested_run_type = 'login_provisioning'/);
  assert.match(migration, /v_active_request/);
  assert.match(migration, /v_active_run/);
  assert.match(migration, /v_active_lock/);
  assert.match(migration, /p_dry_run/);
  assert.match(migration, /login_status = 'verification_pending'/);
  assert.match(migration, /provisioning_status = 'login_verification_pending'/);
  assert.match(migration, /onboarding_status = 'credentials_submitted'/);
});

test("identity RPCs and the status writer are service-role only", () => {
  for (const signature of [
    "evaluate_login_identity_gate_v1(uuid)",
    "reconcile_proven_false_ready_identity_v1(uuid, uuid, jsonb, boolean)",
    "update_client_instagram_account_status(uuid, text, text, text, boolean, text, text, text, text, jsonb)",
  ]) {
    assert.ok(migration.includes(`public.${signature}`), signature);
  }
  assert.match(migration, /from public, anon, authenticated;/i);
  assert.match(migration, /to service_role;/i);
});

test("scheduler and manual starts consume the canonical identity gate reason", () => {
  assert.match(runControl, /evaluate_login_identity_gate_v1/);
  assert.match(runControl, /login_identity_not_verified/);
  assert.doesNotMatch(runControl, /login_identity_proof_status\s*===\s*["']verified["']/);
});

test("rollback removes the identity schema and restores the prior status writer safely", () => {
  assert.match(rollback, /drop trigger if exists enforce_client_instagram_ready_identity_v1/);
  assert.match(rollback, /drop column if exists login_identity_proof_status/);
  assert.match(rollback, /create or replace function public.update_client_instagram_account_status/);
  assert.match(rollback, /from public, anon, authenticated;/i);
  assert.match(rollback, /to service_role;/i);
});

test("the migration is generic and contains no production account identity", () => {
  assert.doesNotMatch(migration, /growth_with_bmb|8bdd2dde|ca0fe9dc|c8dabaa5/i);
});
