import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountScopedSubscriptionCard,
  buildSubscriptionOverviewCard,
} from "./client-overview-projection.ts";
import {
  addCalendarMonthsUtc,
  formatClientCommercialDate,
  isClientVisibleRuntimePackageCode,
  projectClientSubscriptionDisplay,
  resolveClientCommercialPlanKey,
  resolveClientPlanLabel,
  resolveSubscriptionPeriodEnd,
} from "./client-subscription-projection.ts";

test("resolveClientPlanLabel maps commercial plan keys to client-safe display names", () => {
  assert.equal(resolveClientPlanLabel("pro", "fr"), "Pro");
  assert.equal(resolveClientPlanLabel("growth", "en"), "Growth");
  assert.equal(resolveClientPlanLabel("premium", "fr"), "Premium");
});

test("resolveClientPlanLabel never exposes runtime package codes to clients", () => {
  for (const code of ["full_cycle", "outreach_cycle", "outreach_only", "account_session"]) {
    assert.equal(isClientVisibleRuntimePackageCode(code), true);
    assert.doesNotMatch(resolveClientPlanLabel(code, "fr"), /full|cycle|outreach|session/i);
    assert.equal(resolveClientPlanLabel(code, "fr"), "Formule en cours d'activation");
  }
});

test("resolveClientPlanLabel falls back safely for unknown commercial keys", () => {
  assert.equal(resolveClientPlanLabel("mystery_pack", "fr"), "Formule en cours d'activation");
  assert.equal(resolveClientPlanLabel("", "en"), "Plan activation in progress");
});

test("resolveSubscriptionPeriodEnd uses activated_at plus billing interval months", () => {
  const periodEnd = resolveSubscriptionPeriodEnd({
    periodStartAt: "2026-06-21T09:29:19.878Z",
    billingIntervalMonths: 6,
    explicitPeriodEndAt: null,
  });
  assert.ok(periodEnd);
  const date = new Date(periodEnd);
  assert.equal(date.getUTCFullYear(), 2026);
  assert.equal(date.getUTCMonth(), 11);
  assert.equal(date.getUTCDate(), 21);
});

test("canonical Stripe period end wins over entitlement, subscription, and derived dates", () => {
  assert.equal(resolveSubscriptionPeriodEnd({
    periodStartAt: "2026-08-31T16:35:38.883Z",
    billingIntervalMonths: 3,
    canonicalStripePeriodEndAt: "2026-11-30T19:01:40.000Z",
    canonicalEntitlementPeriodEndAt: "2026-11-30T18:00:00.000Z",
    explicitPeriodEndAt: "2026-12-01T00:00:00.000Z",
  }), "2026-11-30T19:01:40.000Z");
});

test("canonical entitlement period end wins when Stripe actual is unavailable", () => {
  assert.equal(resolveSubscriptionPeriodEnd({
    periodStartAt: "2026-08-31T16:35:38.883Z",
    billingIntervalMonths: 3,
    canonicalStripePeriodEndAt: null,
    canonicalEntitlementPeriodEndAt: "2026-11-30T19:01:40.000Z",
  }), "2026-11-30T19:01:40.000Z");
});

test("legacy records without an authoritative end preserve the derived fallback", () => {
  assert.equal(resolveSubscriptionPeriodEnd({
    periodStartAt: "2026-06-21T09:29:19.878Z",
    billingIntervalMonths: 6,
  }), "2026-12-21T09:29:19.878Z");
});

test("31 August plus three months cannot override Stripe 30 November", () => {
  assert.equal(resolveSubscriptionPeriodEnd({
    periodStartAt: "2026-08-31T16:35:38.883Z",
    billingIntervalMonths: 3,
    canonicalStripePeriodEndAt: "2026-11-30T19:01:40.000Z",
  }), "2026-11-30T19:01:40.000Z");
});

test("canonical period end remains authoritative across plan changes and all durations", () => {
  for (const transition of ["premium_to_growth", "growth_to_pro"]) {
    for (const billingIntervalMonths of [1, 3, 6, 12]) {
      assert.equal(resolveSubscriptionPeriodEnd({
        periodStartAt: "2026-08-31T16:35:38.883Z",
        billingIntervalMonths,
        canonicalStripePeriodEndAt: "2026-11-30T19:01:40.000Z",
      }), "2026-11-30T19:01:40.000Z", `${transition}/${billingIntervalMonths}m`);
    }
  }
});

test("canonical period end wins for leap-year and DST-boundary timestamps", () => {
  assert.equal(resolveSubscriptionPeriodEnd({
    periodStartAt: "2028-01-31T23:30:00.000Z",
    billingIntervalMonths: 1,
    canonicalStripePeriodEndAt: "2028-02-29T23:30:00.000Z",
  }), "2028-02-29T23:30:00.000Z");
  assert.equal(resolveSubscriptionPeriodEnd({
    periodStartAt: "2026-10-31T23:30:00.000Z",
    billingIntervalMonths: 1,
    canonicalStripePeriodEndAt: "2026-11-30T19:01:40.000Z",
  }), "2026-11-30T19:01:40.000Z");
});

test("client commercial date formatting is deterministic in the business timezone", () => {
  assert.equal(formatClientCommercialDate("2026-11-30T19:01:40.000Z", "fr"), "30 novembre 2026");
  assert.equal(formatClientCommercialDate("2026-11-30T19:01:40.000Z", "en"), "November 30, 2026");
});

test("account-scoped client card renders the canonical Stripe expiry", () => {
  const card = buildAccountScopedSubscriptionCard({
    accountId: "synthetic-account-id",
    username: "synthetic_account",
    planLabel: "Pro",
    statusLabel: "Actif",
    priceLabel: "177€",
    growthLabel: "~300–500 abonnés",
    supportLabel: "Données en cours",
    billingDisplayMode: "period_end",
    billingDateIso: "2026-11-30T19:01:40.000Z",
  }, "fr");

  assert.equal(card.planName, "Pro");
  assert.equal(card.price, "177€");
  assert.equal(card.growthEstimate, "~300–500 abonnés");
  assert.equal(card.nextBilling, "30 novembre 2026");
});

test("projectClientSubscriptionDisplay builds Pro checkout simulation view without runtime labels", () => {
  const projection = projectClientSubscriptionDisplay({
    commercial: {
      planKey: "pro",
      commercialPackageCode: "pro",
      checkoutSessionPlanKey: "pro",
      billingIntervalMonths: 6,
      periodStartAt: "2026-06-21T09:29:19.878Z",
      periodEndAt: null,
      growthEstimateLabel: "~300–500 abonnés",
      monthlyPriceCents: 19700,
    },
    subscriptionStartsAt: "2026-06-21T09:29:19.878Z",
    clientCreatedAt: "2026-06-21T09:20:00.000Z",
    clientMetadata: null,
    preferredLanguage: "fr",
  });

  assert.equal(projection.clientPlanLabel, "Pro");
  assert.equal(projection.memberSince, "2026-06-21T09:29:19.878Z");
  assert.equal(projection.billingDisplayMode, "period_end");
  assert.equal(projection.paymentMethodDisplay, "Aucun moyen de paiement lié pour le moment");
  assert.ok(projection.subscriptionPeriodEnd);
  assert.doesNotMatch(JSON.stringify(projection), /full_cycle|Full Cycle|outreach_cycle/i);
});

test("projectClientSubscriptionDisplay is generic for a second catalog plan", () => {
  const projection = projectClientSubscriptionDisplay({
    commercial: {
      planKey: "growth",
      commercialPackageCode: "growth",
      checkoutSessionPlanKey: "growth",
      billingIntervalMonths: 3,
      periodStartAt: "2026-01-10T12:00:00.000Z",
      periodEndAt: null,
      growthEstimateLabel: "~200–350 abonnés",
      monthlyPriceCents: 14700,
    },
    subscriptionStartsAt: "2026-01-10T12:00:00.000Z",
    clientCreatedAt: "2026-01-10T11:00:00.000Z",
    clientMetadata: null,
    preferredLanguage: "fr",
  });

  assert.equal(projection.clientPlanLabel, "Growth");
  assert.equal(projection.subscriptionPriceLabel, "147€");
});

test("projectClientSubscriptionDisplay switches to next billing when payment is configured", () => {
  const projection = projectClientSubscriptionDisplay({
    commercial: {
      planKey: "pro",
      commercialPackageCode: "pro",
      checkoutSessionPlanKey: "pro",
      billingIntervalMonths: 1,
      periodStartAt: "2026-06-01T00:00:00.000Z",
      periodEndAt: null,
      growthEstimateLabel: null,
      monthlyPriceCents: null,
    },
    subscriptionStartsAt: "2026-06-01T00:00:00.000Z",
    clientCreatedAt: "2026-06-01T00:00:00.000Z",
    clientMetadata: {
      payment_method_label: "Visa •••• 4242",
      billing_provider: "stripe",
      next_billing_at: "2026-07-01T00:00:00.000Z",
    },
    preferredLanguage: "en",
  });

  assert.equal(projection.billingDisplayMode, "next_billing");
  assert.equal(projection.subscriptionPeriodEnd, "2026-07-01T00:00:00.000Z");
  assert.equal(projection.paymentMethodDisplay, "Visa •••• 4242");
});

test("addCalendarMonthsUtc preserves day-of-month when possible", () => {
  assert.equal(
    addCalendarMonthsUtc("2026-06-21T09:29:19.878Z", 6),
    "2026-12-21T09:29:19.878Z",
  );
});

test("subscription overview card uses commercial plan label and period end when billing is not configured", () => {
  const card = buildSubscriptionOverviewCard({
    clientId: "c1",
    displayName: "Client",
    firstName: "Client",
    lastName: "",
    authEmail: "client@example.com",
    contactEmail: "client@example.com",
    emailEditable: false,
    phone: "",
    servicePageUrl: "/instagram-growth",
    preferredLanguage: "fr",
    clientPlanLabel: "Pro",
    memberSince: "2026-06-21T09:29:19.878Z",
    subscriptionPeriodEnd: "2026-12-21T09:29:19.878Z",
    billingDisplayMode: "period_end",
    paymentMethodDisplay: "Aucun moyen de paiement lié pour le moment",
    subscriptionLabel: "Pro",
    subscriptionStatus: "active",
    subscriptionSince: "2026-06-21T09:29:19.878Z",
    subscriptionPriceLabel: "197€",
    subscriptionGrowthLabel: "~300–500 abonnés",
    subscriptionSupportLabel: "",
    campaignActive: true,
    linkedInstagramAccounts: [],
    billing: {
      status: "not_configured",
      nextBillingLabel: "2026-12-21T09:29:19.878Z",
      paymentMethodLabel: "Aucun moyen de paiement lié pour le moment",
      invoicesAvailable: false,
      displayMode: "period_end",
      periodEndLabel: "2026-12-21T09:29:19.878Z",
    },
    accountManager: { name: "", subtitle: "", email: "", bookingUrl: "", bio: "" },
  }, "", "fr");

  assert.equal(card.planName, "Pro");
  assert.equal(card.billingDateLabel, "Échéance de l'abonnement");
  assert.match(card.nextBilling, /21/);
  assert.doesNotMatch(JSON.stringify(card), /full_cycle|Full Cycle/i);
});

test("resolveClientCommercialPlanKey prefers commercial package code over runtime entitlement plan_key", () => {
  const resolved = resolveClientCommercialPlanKey({
    entitlementPlanKey: "full_cycle",
    entitlementCommercialPackageCode: "pro",
    checkoutSessionPlanKey: "growth",
    linkedAccountPackageCodes: [],
    subscriptionPlanKey: null,
  });
  assert.equal(resolved.planKey, "pro");
  assert.equal(resolved.source, "entitlement_package_code");
});

test("linked account Pro package prevents activation pending label for historical accounts", () => {
  const projection = projectClientSubscriptionDisplay({
    commercial: {
      planKey: "full_cycle",
      commercialPackageCode: null,
      checkoutSessionPlanKey: null,
      billingIntervalMonths: 6,
      periodStartAt: "2026-06-21T09:29:19.878Z",
      periodEndAt: null,
      growthEstimateLabel: "~300–500 abonnés",
      monthlyPriceCents: 19700,
    },
    subscriptionStartsAt: "2026-06-21T09:29:19.878Z",
    clientCreatedAt: "2026-06-21T09:20:00.000Z",
    clientMetadata: null,
    preferredLanguage: "fr",
    linkedAccountPackageCodes: ["pro"],
  });

  assert.equal(projection.clientPlanLabel, "Pro");
  assert.equal(projection.planResolutionSource, "linked_account_package");
  assert.doesNotMatch(projection.clientPlanLabel, /activation/i);
});

test("resolveClientCommercialPlanKey picks highest linked account plan for multi-account clients", () => {
  const resolved = resolveClientCommercialPlanKey({
    entitlementPlanKey: null,
    entitlementCommercialPackageCode: null,
    checkoutSessionPlanKey: null,
    linkedAccountPackageCodes: ["growth", "pro", "premium"],
    subscriptionPlanKey: null,
  });
  assert.equal(resolved.planKey, "premium");
  assert.equal(resolved.source, "linked_account_package");
});
