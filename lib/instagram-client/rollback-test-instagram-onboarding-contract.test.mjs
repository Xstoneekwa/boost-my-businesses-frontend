import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260726030119_rollback_test_instagram_onboarding_v1.sql", import.meta.url), "utf8");
const clientLoader = readFileSync(new URL("./load-client-instagram-accounts.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace-data.ts", import.meta.url), "utf8");
const manage = readFileSync(new URL("../../app/instagram-dashboard/manage-data.ts", import.meta.url), "utf8");
const profilesLive = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/live/route.ts", import.meta.url), "utf8");

test("rollback RPC is service-role-only, dry-run by default, and never deletes ig_accounts", () => {
  assert.match(migration, /p_dry_run boolean default true/);
  assert.match(migration, /security definer\s+set search_path = public, extensions/i);
  assert.match(migration, /revoke all on function public\.rollback_test_instagram_onboarding_v1[\s\S]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.rollback_test_instagram_onboarding_v1[\s\S]+to service_role/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.ig_accounts/i);
  assert.match(migration, /status = 'rolled_back_test_onboarding'/);
  assert.match(migration, /idempotency_fingerprint_mismatch/);
  assert.match(migration, /already_rolled_back/);
});

test("active Client and BotApp projections exclude logical onboarding rollbacks", () => {
  assert.match(clientLoader, /eq\("active", true\)/);
  assert.match(workspace, /eq\("active", true\)/);
  assert.match(manage, /rolled_back_test_onboarding/);
  assert.match(profilesLive, /rolled_back_test_onboarding/);
});
