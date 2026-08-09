import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const wizard = await readFile(new URL("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../../app/api/instagram-client/onboarding/route.ts", import.meta.url), "utf8");
const service = await readFile(new URL("./client-account-onboarding.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../../supabase/migrations/20260726150027_atomic_onboarding_protection_lists.sql", import.meta.url), "utf8");

test("onboarding textareas keep raw text so Enter inserts a newline", () => {
  assert.match(wizard, /value=\{blockedAccountsInput\}/);
  assert.match(wizard, /setBlockedAccountsInput\(event\.target\.value\)/);
  assert.match(wizard, /value=\{protectedAccountsInput\}/);
  assert.doesNotMatch(wizard, /setBlockedAccounts\(parseList\(event\.target\.value\)\)/);
});

test("save uses one onboarding request instead of two independent list PUTs", () => {
  const saveBlock = wizard.match(/async function saveProtectionLists[\s\S]*?async function reanalyzePublicProfile/)?.[0] ?? "";
  assert.match(saveBlock, /action: "save_protection_lists"/);
  assert.match(saveBlock, /mode === "skip"/);
  assert.doesNotMatch(saveBlock, /Promise\.all/);
  assert.doesNotMatch(saveBlock, /method: "PUT"/);
  assert.match(route, /saveInstagramAccountOnboardingProtectionLists/);
  assert.match(service, /save_instagram_account_onboarding_protection_lists_v1/);
});

test("skip advances without sending list values or validators", () => {
  assert.match(wizard, /mode: "skip",\s*request_key:/);
  assert.match(migration, /p_mode = 'save'[\s\S]*?mutate_account_protection_list/);
  assert.match(migration, /else\s+update public\.client_instagram_onboarding_sessions[\s\S]*?protection_lists_skipped_at/);
});

test("double submit is guarded synchronously", () => {
  assert.match(wizard, /protectionSaveInFlightRef\.current/);
  assert.match(wizard, /protectionSaveInFlightRef\.current = true/);
  assert.match(wizard, /protectionSaveInFlightRef\.current = false/);
});

test("a concurrent edit reloads the latest validators and never renders a raw backend code", () => {
  assert.match(wizard, /\["version_conflict", "idempotency_conflict"\]/);
  assert.match(wizard, /setFiltersReloadAttempt/);
  assert.doesNotMatch(wizard, /throw new Error\(stepPayload\.error/);
});

test("RPC rollback boundary covers both mutations and onboarding progression", () => {
  assert.match(migration, /begin[\s\S]*?unfollow_whitelist[\s\S]*?interaction_blacklist[\s\S]*?current_step = 'targeting'[\s\S]*?exception/);
  assert.match(migration, /rolled_back', true/);
  assert.match(migration, /revoke all on function public\.save_client_instagram_onboarding_protection_lists[\s\S]*?public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_client_instagram_onboarding_protection_lists[\s\S]*?service_role/);
});
