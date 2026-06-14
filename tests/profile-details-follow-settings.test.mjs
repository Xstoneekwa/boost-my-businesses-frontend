import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "../lib/instagram-dashboard/profile-details-data.ts"), "utf8");

test("profile details projects Follow filters from runtime follow settings", () => {
  assert.match(source, /from\("ig_account_follow_settings"\)/);
  assert.match(source, /dont_follow_private_accounts/);
  assert.match(source, /skip_private_profiles:\s*filtersResult\.data\.dont_follow_private_accounts === true/);
});

test("profile details projects domain DM Unfollow and Source settings", () => {
  assert.match(source, /from\("ig_account_dm_settings"\)/);
  assert.match(source, /from\("ig_account_unfollow_settings"\)/);
  assert.match(source, /from\("account_follow_source_settings"\)/);
  assert.match(source, /welcome_dm_body/);
  assert.match(source, /unfollow_per_session_limit/);
  assert.match(source, /max_follows_per_target_per_run/);
});

test("profile details defaults skip private profiles to true", () => {
  assert.match(source, /skip_private_profiles:\s*true/);
  assert.match(source, /dont_follow_private_accounts:\s*true/);
  assert.doesNotMatch(source, /ig_account_filters"\)\.select\("\*"\)\.eq\("account_id", accountId\)/);
});
