import assert from "node:assert/strict";
import test from "node:test";

import { deriveAgencyModeSnapshot, agencyDiscountPercentForBillableCount } from "./agency.ts";
import { buildCommercialQuote, formatEurosFromCents } from "./pricing.ts";
import { canUseSimulatedCheckoutForEmail, projectSimulatedCheckoutAvailability, simulatedCheckoutClientMessages } from "./simulated-checkout-guard.ts";

test("Growth / Pro / Premium base monthly prices", () => {
  for (const [planKey, cents] of [["growth", 14700], ["pro", 19700], ["premium", 24700]]) {
    const quote = buildCommercialQuote({
      planKey,
      billingIntervalMonths: 1,
      billableAccountCount: 1,
    });
    assert.ok(!("error" in quote));
    assert.equal(quote.packLine.baseMonthlyPriceCents, cents);
    assert.equal(quote.packLine.monthlyDiscountedPriceCents, cents);
  }
});

test("term discounts 3 / 6 / 12 months", () => {
  const q3 = buildCommercialQuote({ planKey: "growth", billingIntervalMonths: 3, billableAccountCount: 1 });
  const q6 = buildCommercialQuote({ planKey: "growth", billingIntervalMonths: 6, billableAccountCount: 1 });
  const q12 = buildCommercialQuote({ planKey: "growth", billingIntervalMonths: 12, billableAccountCount: 1 });
  assert.equal(q3.packLine.monthlyDiscountedPriceCents, 13230);
  assert.equal(q6.packLine.monthlyDiscountedPriceCents, 11760);
  assert.equal(q12.packLine.monthlyDiscountedPriceCents, 11025);
});

test("Pro 3-month example with Outreach IA matches cent math", () => {
  const quote = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 3,
    outreachAddonKey: "outreach_ai",
    billableAccountCount: 1,
  });
  assert.equal(quote.packLine.monthlyDiscountedPriceCents, 17730);
  assert.equal(quote.packLine.billingPeriodTotalCents, 53190);
  assert.equal(quote.outreachLine?.monthlyDiscountedPriceCents, 13410);
  assert.equal(quote.outreachLine?.billingPeriodTotalCents, 40230);
  assert.equal(quote.totalPeriodCents, 93420);
  assert.equal(formatEurosFromCents(93420), "934,20");
});

test("Outreach Standard and Outreach IA are mutually exclusive at quote level", () => {
  const standard = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 1,
    outreachAddonKey: "outreach_standard",
    billableAccountCount: 1,
  });
  const ai = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 1,
    outreachAddonKey: "outreach_ai",
    billableAccountCount: 1,
  });
  assert.equal(standard.outreachLine?.label, "Outreach Standard");
  assert.equal(ai.outreachLine?.label, "Outreach IA");
  assert.notEqual(standard.outreachLine?.monthlyDiscountedPriceCents, ai.outreachLine?.monthlyDiscountedPriceCents);
});

test("best discount wins without stacking term and agency", () => {
  const termOnly = buildCommercialQuote({ planKey: "pro", billingIntervalMonths: 3, billableAccountCount: 3 });
  assert.equal(termOnly.appliedDiscountPercent, 0.1);
  assert.equal(termOnly.appliedDiscountType, "term");

  const agencyOnly = buildCommercialQuote({ planKey: "pro", billingIntervalMonths: 1, billableAccountCount: 6 });
  assert.equal(agencyOnly.appliedDiscountPercent, 0.14);
  assert.equal(agencyOnly.appliedDiscountType, "agency");

  const agencyWins = buildCommercialQuote({ planKey: "pro", billingIntervalMonths: 3, billableAccountCount: 6 });
  assert.equal(agencyWins.appliedDiscountPercent, 0.14);
  assert.equal(agencyWins.appliedDiscountType, "agency");
  assert.equal(agencyWins.packLine.monthlyDiscountedPriceCents, 16942);
  assert.equal(agencyWins.outreachLine, null);
});

test("agency discount tiers", () => {
  assert.equal(agencyDiscountPercentForBillableCount(5), 0);
  assert.equal(agencyDiscountPercentForBillableCount(6), 0.14);
  assert.equal(agencyDiscountPercentForBillableCount(11), 0.22);
  assert.equal(agencyDiscountPercentForBillableCount(26), 0.32);
  assert.equal(agencyDiscountPercentForBillableCount(41), 0.4);
  assert.equal(agencyDiscountPercentForBillableCount(51), 0.45);
});

test("agency mode displayed when at least two linked accounts", () => {
  assert.equal(deriveAgencyModeSnapshot({ linkedAccountCount: 1, reservedEntitlementCount: 0 }).agencyModeDisplayed, false);
  assert.equal(deriveAgencyModeSnapshot({ linkedAccountCount: 2, reservedEntitlementCount: 0 }).agencyModeDisplayed, true);
});

test("simulated checkout guard requires flag and allowlist", () => {
  const env = {
    SIMULATED_CHECKOUT_ENABLED: "true",
    SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "liam@example.com, ops@example.com",
    NODE_ENV: "development",
  };
  assert.equal(canUseSimulatedCheckoutForEmail("liam@example.com", env).ok, true);
  assert.equal(canUseSimulatedCheckoutForEmail("  LIAM@EXAMPLE.COM  ", env).ok, true);
  assert.equal(canUseSimulatedCheckoutForEmail("other@example.com", env).ok, false);
  assert.equal(canUseSimulatedCheckoutForEmail("other@example.com", env).reason, "simulated_checkout_email_not_allowlisted");
});

test("simulated checkout guard rejects when flag absent or false", () => {
  assert.equal(canUseSimulatedCheckoutForEmail("liam@example.com", {}).reason, "simulated_checkout_disabled");
  assert.equal(canUseSimulatedCheckoutForEmail("liam@example.com", { SIMULATED_CHECKOUT_ENABLED: "false" }).reason, "simulated_checkout_disabled");
  assert.equal(canUseSimulatedCheckoutForEmail("liam@example.com", { SIMULATED_CHECKOUT_ENABLED: "0" }).reason, "simulated_checkout_disabled");
});

test("simulated checkout guard rejects empty allowlist when enabled", () => {
  const env = { SIMULATED_CHECKOUT_ENABLED: "true", SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "" };
  assert.equal(canUseSimulatedCheckoutForEmail("liam@example.com", env).reason, "simulated_checkout_allowlist_empty");
});

test("simulated checkout guard rejects production without explicit allow flag", () => {
  const env = {
    SIMULATED_CHECKOUT_ENABLED: "true",
    SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "liam@example.com",
    NODE_ENV: "production",
  };
  assert.equal(canUseSimulatedCheckoutForEmail("liam@example.com", env).reason, "simulated_checkout_environment_forbidden");
  assert.equal(
    canUseSimulatedCheckoutForEmail("liam@example.com", { ...env, SIMULATED_CHECKOUT_ALLOW_PRODUCTION: "true" }).ok,
    true,
  );
});

test("simulated checkout availability projection respects email guard", () => {
  const env = {
    SIMULATED_CHECKOUT_ENABLED: "true",
    SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "liam@example.com",
    NODE_ENV: "development",
  };

  assert.equal(projectSimulatedCheckoutAvailability("", env).requiresEmail, true);
  assert.equal(projectSimulatedCheckoutAvailability("", env).simulatedActivationAvailable, false);
  assert.equal(projectSimulatedCheckoutAvailability("", env).messageFr, null);

  const blocked = projectSimulatedCheckoutAvailability("other@example.com", env);
  assert.equal(blocked.simulatedActivationAvailable, false);
  assert.match(blocked.messageFr ?? "", /adresse e-mail/i);

  const allowed = projectSimulatedCheckoutAvailability("  LIAM@EXAMPLE.COM ", env);
  assert.equal(allowed.simulatedActivationAvailable, true);
  assert.equal(allowed.simulatedCheckoutEnabled, true);

  const disabled = projectSimulatedCheckoutAvailability("liam@example.com", { SIMULATED_CHECKOUT_ENABLED: "false" });
  assert.equal(disabled.simulatedCheckoutEnabled, false);
  assert.match(disabled.messageFr ?? "", /temporairement indisponible/i);
});

test("simulated checkout client messages stay safe", () => {
  assert.match(
    simulatedCheckoutClientMessages("simulated_checkout_email_not_allowlisted").messageFr,
    /adresse e-mail/i,
  );
  assert.match(
    simulatedCheckoutClientMessages("simulated_checkout_disabled").messageFr,
    /temporairement indisponible/i,
  );
  assert.doesNotMatch(
    simulatedCheckoutClientMessages("simulated_checkout_disabled").messageFr,
    /allowlist|SIMULATED_CHECKOUT/i,
  );
});

test("invalid outreach addon rejected", () => {
  const quote = buildCommercialQuote({
    planKey: "growth",
    billingIntervalMonths: 1,
    outreachAddonKey: "both",
    billableAccountCount: 1,
  });
  assert.equal("error" in quote, true);
});
