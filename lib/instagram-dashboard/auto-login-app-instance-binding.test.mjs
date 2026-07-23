import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260724130000_auto_login_app_instance_binding_v1.sql", import.meta.url),
  "utf8",
);

test("login requests persist the complete canonical app-instance binding", () => {
  for (const field of [
    "binding_version",
    "assignment_id",
    "device_id",
    "app_instance_id",
    "package_name",
    "clone_index",
  ]) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
  assert.match(migration, /from public\.account_assignments aa/);
  assert.match(migration, /from public\.phone_app_instances pai/);
  assert.match(migration, /order by aa\.created_at desc/);
});

test("login routing fails closed instead of defaulting to primary", () => {
  for (const reason of [
    "login_assignment_binding_missing",
    "login_app_instance_binding_missing",
    "login_package_binding_missing",
    "login_app_instance_device_mismatch",
    "login_app_instance_account_mismatch",
    "login_app_instance_unavailable",
  ]) {
    assert.match(migration, new RegExp(`raise exception '${reason}'`));
  }
  assert.doesNotMatch(migration, /com\.instagram\.android/);
});

test("resume requests preserve the parent request binding", () => {
  assert.match(migration, /requested_run_type = 'login_email_code_resume'/);
  assert.match(migration, /login_parent_binding_missing/);
  assert.match(migration, /login_parent_binding_changed/);
  assert.match(migration, /parent_request_id/);
});

test("existing scheduler and idempotency gates remain present", () => {
  assert.match(migration, /scheduler_disabled/);
  assert.match(migration, /idempotency_key = v_idempotency_key/);
  assert.match(migration, /account_run_already_requested/);
});
