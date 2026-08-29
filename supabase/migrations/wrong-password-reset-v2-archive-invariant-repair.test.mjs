import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("./20260829221528_wrong_password_reset_v2_archive_invariant_repair.sql", import.meta.url),
  "utf8",
);

test("reset V2 uses the terminal ignored incident state", () => {
  assert.match(migration, /set status = \\'ignored\\'/);
  assert.match(migration, /resolved_at = coalesce\(i\.resolved_at, v_now\)/);
  assert.match(migration, /archived_at = coalesce\(i\.archived_at, v_now\)/);
});

test("repair leaves the global retention trigger untouched", () => {
  assert.doesNotMatch(migration, /create or replace function public\.set_account_incident_retention_v1/i);
  assert.doesNotMatch(migration, /drop trigger account_incidents_retention_v1/i);
});

test("repair preserves the service-role-only RPC boundary", () => {
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
});

test("repair is source-bound and fail-closed", () => {
  assert.match(migration, /reset_v2_archive_transition_source_mismatch/);
  assert.match(migration, /reset_v2_archive_transition_already_patched/);
  assert.match(migration, /reset_v2_archive_transition_patch_noop/);
});

test("repair does not add authentication success or runtime writes", () => {
  assert.doesNotMatch(migration, /authentication_success', true/);
  assert.doesNotMatch(migration, /insert into public\.account_run_requests/i);
  assert.doesNotMatch(migration, /insert into public\.ig_runs/i);
  assert.doesNotMatch(migration, /insert into public\.auto_restart_tick/i);
});
