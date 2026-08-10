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
  const deleteStart = route.indexOf("export async function DELETE");
  const deleteGuard = route.indexOf("await requireInstagramAdmin()", deleteStart);
  assert.ok(deleteStart > 0);
  assert.ok(deleteGuard > deleteStart);
});

test("admin route resolves add-account tenant and exposes exact mismatch codes", () => {
  const route = source("app/api/instagram-dashboard/commercial/prod-test-authorizations/route.ts");
  assert.match(route, /resolveProdTestCheckoutClientIdByEmail/);
  assert.match(route, /authorization_tenant_not_found/);
  assert.match(route, /authorization_tenant_mismatch/);
  assert.match(route, /authorization_scope_mismatch/);
  assert.match(route, /authorizedFlows:\s*scope === "add_account" \? \["new_account"\]/);
});

test("admin UI exposes scoped ON and OFF controls and has no unsafe global toggle", () => {
  const panel = source("app/instagram-dashboard/commercial-prod-test/CommercialProdTestAdminPanel.tsx");
  assert.match(panel, /Activations Test accordées à cette autorisation \(max 10\)/);
  assert.match(panel, /Activer, étendre ou renouveler/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /Désactiver/);
  assert.doesNotMatch(panel, /Limite de comptes \(max 2\)/);
  assert.doesNotMatch(panel, /global.*ON|global.*OFF/i);
});

test("superadmin navigation exposes Test Activation without exposing it to clients", () => {
  const sidebar = source("app/instagram-dashboard/AdminSidebar.tsx");
  const clientPage = source("app/instagram-client/choose-plan/page.tsx");
  assert.match(sidebar, /label: "Test Activation"/);
  assert.match(sidebar, /href: "\/instagram-dashboard\/commercial-prod-test"/);
  assert.doesNotMatch(clientPage, /prod-test-authorizations|commercial-prod-test/);
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

test("production checkout reads the DB authorization before any legacy test guard", () => {
  const access = source("lib/commercial/checkout-simulation-access.ts");
  assert.match(access, /isProductionCheckoutEnvironment\(input\.env\)/);
  assert.match(access, /Production has exactly one authority/);
  const evaluatorStart = access.indexOf("export async function evaluateCheckoutSimulationAccess");
  const databaseAuthorization = access.indexOf("await evaluateProdTestCheckoutAuthorization", evaluatorStart);
  const legacyGuard = access.indexOf("canUseSimulatedCheckoutForEmail(normalizedEmail", evaluatorStart);
  assert.ok(databaseAuthorization > evaluatorStart);
  assert.ok(legacyGuard > databaseAuthorization);
});
