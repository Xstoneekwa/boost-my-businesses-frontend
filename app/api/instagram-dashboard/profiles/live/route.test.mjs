import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const fullProfilesSource = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

test("live route exists and reuses the production Profiles projection", () => {
  assert.match(routeSource, /export async function GET\(request: Request\)/);
  assert.match(routeSource, /GET as getLegacyProfiles/);
  assert.match(routeSource, /legacyPayload\.activeAccounts/);
  assert.match(routeSource, /profiles_live_c0d66a5_native_v1/);
  assert.match(routeSource, /Cache-Control", "private, no-store"/);
});

test("live route reads canonical identity without importing newer lineage modules", () => {
  assert.match(routeSource, /\.from\("client_instagram_accounts"\)/);
  assert.match(routeSource, /login_identity_proof_status/);
  assert.match(routeSource, /login_state_invalidation_reason/);
  assert.doesNotMatch(routeSource, /dashboard-action-blockers|canonical_persisted_actions_sast_v1|profiles-live-projection/);
});

test("missing identity stays unavailable and never becomes fake login required", () => {
  assert.match(routeSource, /identitySource = "unavailable"/);
  assert.match(routeSource, /loginIdentityProofStatus: identity \? identity\.login_identity_proof_status \?\? null : null/);
  assert.doesNotMatch(routeSource, /login_required|connected:\s*false/);
});

test("legacy Profiles route keeps its c0d66a5 all-accounts contract", () => {
  assert.match(fullProfilesSource, /enrichAccountsWithRuntime\(manage\.allAccounts/);
  assert.doesNotMatch(fullProfilesSource, /profiles_live_c0d66a5_native_v1/);
});

test("live route is read-only and contains no account-specific logic", () => {
  assert.doesNotMatch(routeSource, /\.(?:insert|update|upsert|delete|rpc)\(/);
  assert.doesNotMatch(routeSource, /rex_gen_boost_ai|lorielebras_autom|j_automatise_pour_toi|nab_youss|growth_with_bmb|mythyl_fitness|i_m_your_traker|bmybusinesses|rb_test_/);
});
