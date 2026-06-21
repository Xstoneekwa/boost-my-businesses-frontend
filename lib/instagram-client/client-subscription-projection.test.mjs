import assert from "node:assert/strict";
import test from "node:test";
import { buildSubscriptionOverviewCard } from "./client-overview-projection.ts";
import {
  addCalendarMonthsUtc,
  isClientVisibleRuntimePackageCode,
  projectClientSubscriptionDisplay,
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

test("projectClientSubscriptionDisplay builds Pro checkout simulation view without runtime labels", () => {
  const projection = projectClientSubscriptionDisplay({
    commercial: {
      planKey: "pro",
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
