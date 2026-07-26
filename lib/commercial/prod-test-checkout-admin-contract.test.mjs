import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("prod-test authorization admin route remains admin-only", () => {
  const route = source("app/api/instagram-dashboard/commercial/prod-test-authorizations/route.ts");
  const postStart = route.indexOf("export async function POST");
  const adminGuard = route.indexOf("await requireInstagramAdmin()", postStart);
  const bodyRead = route.indexOf("readJsonBody<CreateBody>", postStart);
  assert.ok(adminGuard > postStart);
  assert.ok(bodyRead > adminGuard);
});

test("admin route resolves add-account tenant and exposes exact mismatch codes", () => {
  const route = source("app/api/instagram-dashboard/commercial/prod-test-authorizations/route.ts");
  assert.match(route, /resolveProdTestCheckoutClientIdByEmail/);
  assert.match(route, /authorization_tenant_not_found/);
  assert.match(route, /authorization_tenant_mismatch/);
  assert.match(route, /authorization_scope_mismatch/);
  assert.match(route, /authorizedFlows:\s*scope === "add_account" \? \["new_account"\]/);
});

test("admin UI describes per-authorization grants and has no global max-two label", () => {
  const panel = source("app/instagram-dashboard/commercial-prod-test/CommercialProdTestAdminPanel.tsx");
  assert.match(panel, /Activations Test accordées à cette autorisation \(max 10\)/);
  assert.match(panel, /Créer ou renouveler l'autorisation/);
  assert.doesNotMatch(panel, /Limite de comptes \(max 2\)/);
});

test("choose-plan quote projects add-account authorization to the activation button", () => {
  const quoteRoute = source("app/api/commercial/checkout/quote/route.ts");
  const checkoutForm = source("app/instagram-growth/checkout/CommercialCheckoutForm.tsx");
  assert.match(quoteRoute, /flowType === "additional_account"/);
  assert.match(quoteRoute, /clientId = session\.clientId/);
  assert.match(quoteRoute, /simulatedActivationAvailable:\s*simulationAvailability\.simulationAvailable/);
  assert.match(checkoutForm, /Boolean\(parsed\.data\.simulatedActivationAvailable\)/);
  assert.match(checkoutForm, /disabled=\{activationState\.ctaDisabled\}/);
});

test("authorization management does not call Stripe, create accounts, or consume entitlements", () => {
  const route = source("app/api/instagram-dashboard/commercial/prod-test-authorizations/route.ts");
  const authorization = source("lib/commercial/prod-test-checkout-authorization.ts");
  const combined = `${route}\n${authorization}`;
  assert.doesNotMatch(combined, /checkout\.sessions\.create|paymentIntents|stripe\./i);
  assert.doesNotMatch(combined, /client_instagram_accounts|ig_accounts/);
  assert.doesNotMatch(combined, /client_account_entitlements/);
});
