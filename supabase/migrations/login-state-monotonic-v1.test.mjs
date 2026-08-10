import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260810170000_login_state_monotonic_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../rollback/20260810170000_login_state_monotonic_v1.down.sql", import.meta.url),
  "utf8",
);

test("STALE_PENDING_EVENT_CANNOT_OVERWRITE_VERIFIED_LOGIN", () => {
  assert.match(migration, /login_state_source_at/);
  assert.match(migration, /login_state_version/);
  assert.match(migration, /login_state_downgrade_requires_newer_canonical_invalidation/);
  assert.match(migration, /new\.login_state_source_at <= v_old_ordering_at/);
  assert.match(migration, /new\.login_state_version <= old\.login_state_version/);
});

test("only explicit canonical invalidations may downgrade a verified login", () => {
  for (const reason of [
    "explicit_logout",
    "identity_mismatch",
    "auth_session_invalidated",
    "instagram_login_screen_confirmed",
    "credential_invalidation",
    "account_disabled",
    "security_challenge_requires_login",
  ]) {
    assert.ok(migration.includes(`'${reason}'`), reason);
  }
  assert.match(migration, /invalidate_client_instagram_login_v1/);
  assert.match(migration, /newer_verified_login_preserved/);
});

test("social collection vocabulary cannot own canonical login invalidation", () => {
  assert.doesNotMatch(migration, /social_(?:pending|stale|unavailable)|followers_snapshot|following_snapshot|posts_snapshot/);
});

test("the invalidation RPC is service-role only", () => {
  const signature = "invalidate_client_instagram_login_v1(uuid, text, timestamptz, text, text, text, boolean, text, text, text, jsonb)";
  assert.ok(migration.includes(`public.${signature}`));
  assert.match(migration, /from public, anon, authenticated;/i);
  assert.match(migration, /to service_role;/i);
});

test("rollback removes only the monotonic successor contract", () => {
  assert.match(rollback, /drop trigger if exists enforce_client_instagram_login_monotonic_v1/);
  assert.match(rollback, /drop function if exists public\.invalidate_client_instagram_login_v1/);
  assert.match(rollback, /drop column if exists login_state_source_at/);
  assert.doesNotMatch(rollback, /drop column if exists login_identity_proof_status/);
});

test("the migration is generic and contains no field account identity", () => {
  assert.doesNotMatch(migration, /growth_with_bmb|8bdd2dde|ca0fe9dc|c8dabaa5/i);
});
