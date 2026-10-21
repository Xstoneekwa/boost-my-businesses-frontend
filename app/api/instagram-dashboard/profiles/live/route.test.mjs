import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const fullProfilesSource = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

test("live route exists and reuses the production Profiles projection", () => {
  assert.match(routeSource, /export async function GET\(request: Request\)/);
  assert.match(routeSource, /getManageData\(\{ requireCanonicalComplete: true \}\)/);
  assert.match(routeSource, /selectCanonicalVisibleProfiles\(manage\.activeAccounts\)/);
  assert.doesNotMatch(routeSource, /selectCanonicalVisibleProfiles\(manage\.allAccounts\)/);
  assert.doesNotMatch(routeSource, /GET as getLegacyProfiles|legacyPayload/);
  assert.match(routeSource, /source: "profiles_live_shared_core_v3"/);
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
});

test("live route reuses canonical identity from the shared core without a second lineage query", () => {
  assert.match(routeSource, /loginIdentityProofStatus: profile\.loginIdentityProofStatus \?\? null/);
  assert.match(routeSource, /loginStateInvalidationReason: profile\.loginStateInvalidationReason \?\? null/);
  assert.match(routeSource, /identityProjectionSource: "shared_profile_core"/);
  assert.doesNotMatch(routeSource, /\.from\("client_instagram_accounts"\)|dashboard-action-blockers|canonical_persisted_actions_sast_v1/);
});

test("missing identity stays unavailable and never becomes fake login required", () => {
  assert.match(routeSource, /loginIdentityProofStatus: profile\.loginIdentityProofStatus \?\? null/);
  assert.match(routeSource, /loginIdentityProfileOpened: profile\.loginIdentityProfileOpened \?\? null/);
  assert.match(routeSource, /loginIdentityUsernameMatch: profile\.loginIdentityUsernameMatch \?\? null/);
  assert.match(routeSource, /loginIdentityVerifiedAt: profile\.loginIdentityVerifiedAt \?\? null/);
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
