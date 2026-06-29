import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMMERCIAL_PLANS } from "../commercial/catalog.ts";
import {
  buildAccountScopedSubscriptionCard,
  buildAgencyAccountSubscriptionCard,
  buildSubscriptionOverviewCard,
} from "./client-overview-projection.ts";
import {
  loadAccountCommercialSubscriptionDisplay,
} from "./load-account-commercial-subscription.ts";
import {
  projectClientSubscriptionDisplay,
  resolveClientCommercialPlanKey,
} from "./client-subscription-projection.ts";

const dashboardSource = readFileSync(new URL("../../app/instagram-client/ClientDashboard.tsx", import.meta.url), "utf8");

test("account scoped subscription card titles username and uses account package only", () => {
  const growthCard = buildAccountScopedSubscriptionCard({
    accountId: "growth-id",
    username: "nab_autom_ig",
    planLabel: "Growth",
    statusLabel: "Actif",
    priceLabel: "147€",
    growthLabel: COMMERCIAL_PLANS.growth.growthEstimateLabelFr,
    supportLabel: "Données en cours",
    billingDisplayMode: "period_end",
    billingDateIso: "2026-07-29T00:00:00.000Z",
  }, "fr");
  assert.match(growthCard.title, /Abonnement — @nab_autom_ig/);
  assert.equal(growthCard.planName, "Growth");
  assert.equal(growthCard.price, "147€");
  assert.doesNotMatch(growthCard.growthEstimate, /300–500/);

  const proCard = buildAccountScopedSubscriptionCard({
    accountId: "pro-id",
    username: "mythyl_fitness",
    planLabel: "Pro",
    statusLabel: "Actif",
    priceLabel: "197€",
    growthLabel: COMMERCIAL_PLANS.pro.growthEstimateLabelFr,
    supportLabel: "Données en cours",
    billingDisplayMode: "period_end",
    billingDateIso: "2026-07-29T00:00:00.000Z",
  }, "fr");
  assert.equal(proCard.planName, "Pro");
  assert.equal(proCard.price, "197€");
  assert.doesNotMatch(proCard.growthEstimate, /200–350/);
});

test("tenant workspace subscription resolution prefers highest linked package", () => {
  const resolved = resolveClientCommercialPlanKey({
    linkedAccountPackageCodes: ["growth", "pro"],
  });
  assert.equal(resolved.planKey, "pro");
  assert.equal(resolved.source, "linked_account_package");
});

test("single account commercial projection does not borrow another account package", () => {
  const growthOnly = projectClientSubscriptionDisplay({
    commercial: {
      planKey: "growth",
      commercialPackageCode: "growth",
      checkoutSessionPlanKey: null,
      billingIntervalMonths: 1,
      periodStartAt: "2026-06-01T00:00:00.000Z",
      periodEndAt: null,
      growthEstimateLabel: COMMERCIAL_PLANS.growth.growthEstimateLabelFr,
      monthlyPriceCents: 14700,
    },
    subscriptionStartsAt: "2026-06-01T00:00:00.000Z",
    clientCreatedAt: null,
    clientMetadata: null,
    preferredLanguage: "fr",
    linkedAccountPackageCodes: ["growth"],
    subscriptionPlanKey: null,
  });
  assert.equal(growthOnly.clientPlanLabel, "Growth");
  assert.equal(growthOnly.subscriptionPriceLabel, "147€");
  assert.match(growthOnly.subscriptionGrowthLabel, /200–350/);
  assert.doesNotMatch(growthOnly.subscriptionGrowthLabel, /300–500/);
});

test("missing commercial fields stay honest without borrowing workspace values", () => {
  const card = buildAccountScopedSubscriptionCard({
    accountId: "acct-1",
    username: "brand",
    planLabel: "Growth",
    statusLabel: "Actif",
    priceLabel: "Disponible prochainement",
    growthLabel: "Données en cours",
    supportLabel: "Données en cours",
    billingDisplayMode: "period_end",
    billingDateIso: "",
  }, "fr");
  assert.equal(card.period, "");
  assert.equal(card.nextBilling, "Données en cours");
  assert.doesNotMatch(card.price, /197/);
});

test("dashboard wires account scoped subscription fetch in agency account view", () => {
  assert.match(dashboardSource, /buildAgencyAccountSubscriptionCard/);
  assert.match(dashboardSource, /accountSubscriptionDisplay/);
  assert.match(dashboardSource, /\/subscription\?lang=/);
  assert.match(dashboardSource, /agencyContact: agencyModeActive && overviewScope === "agency"/);
  assert.match(dashboardSource, /useAccountScopedSubscription/);
});

test("agency account subscription fallback never borrows another account commercial values", () => {
  const card = buildAgencyAccountSubscriptionCard(null, {
    accountId: "growth-id",
    username: "nab_autom_ig",
    packageLabel: "Growth",
    packageCode: "growth",
    campaignActive: true,
    statsDays: [],
    overview: {
      campaignInteractions: { monthInteractions: 0, todayInteractions: 0, businessTimezone: "UTC" },
      followerEvolution: { status: "pending", netChange: null, dailyAverage: null },
    },
    chartSeries: { d7: [], d30: [], d90: [] },
    activity: [],
    recentFeed: [],
    targets: [],
    whitelist: [],
    blacklist: [],
  }, "growth-id", "fr");
  assert.match(card.title, /@nab_autom_ig/);
  assert.equal(card.planName, "Growth");
  assert.doesNotMatch(card.price, /197/);
  assert.doesNotMatch(card.growthEstimate, /300–500/);
});

test("loadAccountCommercialSubscriptionDisplay is exported for tenant-scoped API", async () => {
  const module = await import("./load-account-commercial-subscription.ts");
  assert.equal(typeof module.loadAccountCommercialSubscriptionDisplay, "function");
});
