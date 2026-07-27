import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260727154149_instagram_action_rate_limit_restriction_hold_v1.sql", import.meta.url),
  "utf8",
);

test("restriction application is atomic, blocking, and generation-deduplicated", () => {
  assert.match(migration, /apply_instagram_action_restriction_v1/);
  assert.match(migration, /instagram_account_restriction/);
  assert.match(migration, /instagram_action_rate_limit/);
  assert.match(migration, /blocking_campaign', true/);
  assert.match(migration, /operator_review_required', true/);
  assert.match(migration, /auto_restart_allowed', false/);
  assert.match(migration, /admin_lifecycle_status = 'paused'/);
  assert.match(migration, /restriction_generation/);
});

test("human resolution requires physical preflight and does not release the pause", () => {
  assert.match(migration, /mark_instagram_restriction_preflight_required_v1/);
  assert.match(migration, /status = 'verification_required'/);
  const triggerBody = migration.slice(migration.indexOf("mark_instagram_restriction_preflight_required_v1"));
  assert.doesNotMatch(triggerBody.split("release_instagram_action_restriction_hold_v1")[0], /admin_lifecycle_status = 'active'/);
});

test("only service role can apply or release a restriction hold", () => {
  assert.match(migration, /revoke all on function public\.apply_instagram_action_restriction_v1[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.release_instagram_action_restriction_hold_v1[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.apply_instagram_action_restriction_v1[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.release_instagram_action_restriction_hold_v1[\s\S]*to service_role/);
});
