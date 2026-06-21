import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertClientCanConfigureOutreach,
  assertClientCanConfigureWelcome,
  buildOutreachActivationPath,
  buildWelcomeUpgradePath,
  projectClientDmTemplates,
  resolveOutreachActivationOffer,
} from "./client-dm-templates-projection.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function domainProjection(overrides = {}) {
  return {
    account_id: "acct-1",
    welcome_service_active: false,
    outreach_service_active: false,
    welcome_entitlement_status: "Missing",
    outreach_entitlement_status: "Missing",
    welcome_enabled: false,
    outreach_enabled: false,
    welcome_message: "",
    outreach_message: "",
    welcome_template_id: "",
    outreach_template_id: "",
    welcome_template_status: "Missing",
    outreach_template_status: "Missing",
    welcome_cap_session: 0,
    welcome_cap_day: 10,
    outreach_cap_session: 0,
    outreach_cap_day: 30,
    welcome_real_send_status: "Disabled",
    outreach_real_send_status: "Disabled",
    legacy_dm_gate_status: "Not configured",
    save_ready: true,
    validation_error: null,
    ...overrides,
  };
}

test("Growth welcome is visible but locked with change-plan CTA", () => {
  const projection = projectClientDmTemplates({
    accountId: "acct-growth",
    username: "growth_user",
    packageCode: "growth",
    domain: domainProjection({ welcome_service_active: false, outreach_service_active: false }),
  });
  assert.equal(projection.canConfigureWelcome, false);
  assert.equal(projection.welcome.locked, true);
  assert.equal(projection.welcome.canConfigure, false);
  assert.match(projection.welcomeUpgradePath ?? "", /change-plan\?intention=welcome_dm/);
  assert.equal(projection.welcome.ctaPath, buildWelcomeUpgradePath());
});

test("Pro welcome is editable when entitlement is active", () => {
  const projection = projectClientDmTemplates({
    accountId: "acct-pro",
    username: "pro_user",
    packageCode: "pro",
    domain: domainProjection({
      welcome_service_active: true,
      welcome_enabled: true,
      welcome_message: "Bonjour {{username}}",
    }),
  });
  assert.equal(projection.canConfigureWelcome, true);
  assert.equal(projection.welcome.locked, false);
  assert.equal(projection.welcome.message, "Bonjour {{username}}");
  assert.equal(projection.welcomeUpgradePath, null);
});

test("Growth welcome write guard rejects locked feature", () => {
  const guard = assertClientCanConfigureWelcome(domainProjection({ welcome_service_active: false }));
  assert.equal(guard.ok, false);
  if (!guard.ok) {
    assert.equal(guard.code, "welcome_dm_locked");
    assert.equal(guard.status, 403);
  }
});

test("Outreach disabled locks card on all packs with activation path", () => {
  const projection = projectClientDmTemplates({
    accountId: "acct-pro",
    username: "pro_user",
    packageCode: "pro",
    domain: domainProjection({ welcome_service_active: true, outreach_service_active: false }),
  });
  assert.equal(projection.canConfigureOutreach, false);
  assert.equal(projection.outreach.locked, true);
  assert.match(projection.outreachActivationPath ?? "", /activate-outreach\?account_id=acct-pro/);
});

test("Outreach enabled allows configuration when entitlement is active", () => {
  const projection = projectClientDmTemplates({
    accountId: "acct-pro",
    username: "pro_user",
    packageCode: "pro",
    domain: domainProjection({
      outreach_service_active: true,
      outreach_enabled: true,
      outreach_message: "Salut {{username}}",
    }),
  });
  assert.equal(projection.canConfigureOutreach, true);
  assert.equal(projection.outreach.locked, false);
  assert.equal(projection.outreach.message, "Salut {{username}}");
  const guard = assertClientCanConfigureOutreach(domainProjection({ outreach_service_active: true }));
  assert.equal(guard.ok, true);
});

test("Outreach write guard rejects locked feature", () => {
  const guard = assertClientCanConfigureOutreach(domainProjection({ outreach_service_active: false }));
  assert.equal(guard.ok, false);
  if (!guard.ok) {
    assert.equal(guard.code, "outreach_dm_locked");
    assert.equal(guard.status, 403);
  }
});

test("Outreach offer resolves from commercial catalog", () => {
  const offer = resolveOutreachActivationOffer();
  assert.equal(offer.available, true);
  assert.equal(offer.addonKey, "outreach_standard");
  assert.ok(Number.isFinite(offer.baseMonthlyPriceCents));
  assert.match(buildOutreachActivationPath("acct-1") ?? "", /account_id=acct-1/);
});

test("client dm routes enforce session, ownership and locked writes", () => {
  const getRoute = source("../../app/api/instagram-client/accounts/[accountId]/dm-templates/route.ts");
  const welcomeRoute = source("../../app/api/instagram-client/accounts/[accountId]/dm-templates/welcome/route.ts");
  const outreachRoute = source("../../app/api/instagram-client/accounts/[accountId]/dm-templates/outreach/route.ts");
  assert.match(getRoute, /requireClientInstagramSession/);
  assert.match(getRoute, /authorizeClientInstagramAccount/);
  assert.match(getRoute, /loadClientDmTemplatesProjection/);
  assert.match(welcomeRoute, /assertClientCanConfigureWelcome/);
  assert.match(welcomeRoute, /saveDmDomainPatch/);
  assert.match(welcomeRoute, /code: guard\.code/);
  assert.match(outreachRoute, /assertClientCanConfigureOutreach/);
  assert.match(outreachRoute, /code: guard\.code/);
});

test("client dashboard exposes DM Templates tab and empty state", () => {
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  const sectionSource = source("../../app/instagram-client/ClientDmTemplatesSection.tsx");
  assert.match(dashboardSource, /dm-templates/);
  assert.match(dashboardSource, /ClientDmTemplatesSection/);
  assert.match(sectionSource, /Ajoutez un compte Instagram pour configurer ses messages/);
  assert.match(sectionSource, /Add an Instagram account to configure its messages/);
  assert.match(sectionSource, /card\.ctaLabelFr/);
  assert.match(sectionSource, /card\.lockedBodyFr/);
  assert.match(sectionSource, /usernameHint/);
});

test("admin dm route reuses canonical dm-domain-service", () => {
  const adminRoute = source("../../app/api/instagram-dashboard/settings/dm/route.ts");
  const service = source("../instagram-dashboard/dm-domain-service.ts");
  assert.match(adminRoute, /dm-domain-service/);
  assert.match(adminRoute, /saveDmDomainPatch/);
  assert.match(service, /ig_account_dm_settings/);
  assert.match(service, /ig_dm_templates/);
});

test("change-plan supports welcome_dm intention", () => {
  const formSource = source("../../app/instagram-client/change-plan/PlanChangeCheckoutForm.tsx");
  assert.match(formSource, /intention === "welcome_dm"/);
  assert.match(formSource, /useSearchParams/);
});

test("outreach activation offer route is account-scoped and fail-closed", () => {
  const offerRoute = source("../../app/api/instagram-client/outreach-activation/offer/route.ts");
  assert.match(offerRoute, /requireClientInstagramSession/);
  assert.match(offerRoute, /authorizeClientInstagramAccount/);
  assert.match(offerRoute, /resolveOutreachActivationOffer/);
  assert.match(offerRoute, /outreachUnavailableReason/);
});

test("non-regression: client accounts and plan change routes remain present", () => {
  const accountsRoute = source("../../app/api/instagram-client/accounts/route.ts");
  const readinessRoute = source("../../app/api/instagram-client/accounts/[accountId]/check-readiness/route.ts");
  const connectRoute = source("../../app/api/instagram-client/accounts/[accountId]/connect/route.ts");
  const planChangeQuote = source("../../app/api/commercial/checkout/plan-change/quote/route.ts");
  assert.match(accountsRoute, /createClientInstagramAccount/);
  assert.match(readinessRoute, /checkClientAccountReadiness/);
  assert.match(connectRoute, /connectClientInstagramAccount/);
  assert.match(planChangeQuote, /createPlanChangeQuote/);
});
