import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("all client add-account entry points use the canonical wizard", () => {
  const section = source("../../app/instagram-client/ClientAccountsSection.tsx");
  const accountsRoute = source("../../app/api/instagram-client/accounts/route.ts");
  const checkoutContext = source("../commercial/checkout-context.ts");

  assert.match(section, /ClientInstagramOnboardingWizard/);
  assert.match(section, /onboardingResumable/);
  assert.doesNotMatch(section, /Nouveau compte|New account/);
  assert.doesNotMatch(section, /body: JSON\.stringify\(\{ username, email, password/);
  assert.match(accountsRoute, /instagram_onboarding_required/);
  assert.doesNotMatch(accountsRoute, /createClientInstagramAccount/);
  assert.match(checkoutContext, /\/instagram-client\?onboarding=1/);
});

test("canonical onboarding persists account-scoped protection before targeting", () => {
  const wizard = source("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx");
  const filtersRoute = source("../../app/api/instagram-client/accounts/[accountId]/filters/route.ts");

  assert.match(wizard, /"protection_lists"/);
  assert.match(wizard, /unfollow_whitelist/);
  assert.match(wizard, /interaction_blacklist/);
  assert.match(wizard, /saveProtectionLists/);
  assert.match(wizard, /save_protection_lists/);
  assert.match(filtersRoute, /authorizeClientInstagramAccount/);
  assert.match(filtersRoute, /legacy_protection_lists_retired/);
  assert.doesNotMatch(filtersRoute, /whitelist_words|blacklist_accounts/);
});

test("Stripe Test additional-account checkout is session-bound and returns to onboarding", () => {
  const createRoute = source("../../app/api/commercial/checkout/stripe/create-session/route.ts");
  const statusRoute = source("../../app/api/commercial/checkout/stripe/session-status/route.ts");
  const successPage = source("../../app/commercial/stripe-test/success/page.tsx");

  assert.match(createRoute, /flowType === "additional_account"/);
  assert.match(createRoute, /requireClientInstagramSession/);
  assert.match(createRoute, /clientId = session\.clientId/);
  assert.match(createRoute, /authUserId = session\.userId/);
  assert.doesNotMatch(createRoute, /clientId: readString\(body\.client_id\)/);
  assert.match(statusRoute, /ready_for_handoff/);
  assert.match(statusRoute, /redirect_path/);
  assert.match(successPage, /router\.replace\(destination \|\| loginPath\)/);
});

test("canonical onboarding remains resumable, idempotent, and leaves login explicit", () => {
  const section = source("../../app/instagram-client/ClientAccountsSection.tsx");
  const wizard = source("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx");
  const service = source("./client-account-onboarding.ts");

  assert.match(section, /fetch\("\/api\/instagram-client\/onboarding"/);
  assert.match(wizard, /idempotencyKeyRef/);
  assert.match(service, /begin_client_instagram_onboarding/);
  assert.match(wizard, /Auto Login démarrera uniquement après ton clic explicite/);
  assert.doesNotMatch(wizard, /\/connect/);
});
