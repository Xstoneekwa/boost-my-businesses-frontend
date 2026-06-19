import assert from "node:assert/strict";
import test from "node:test";
import { resolveClientAccountConnectionUi } from "./client-account-connection-ui.ts";
import {
  buildAccountManagerOverview,
  buildOverviewStats,
  buildSubscriptionOverviewCard,
} from "./client-overview-projection.ts";

test("connected ready account shows green readiness and connect states", () => {
  const ui = resolveClientAccountConnectionUi({
    connected: true,
    loginStatus: "connected",
    onboardingStatus: "ready",
  }, "fr");
  assert.equal(ui.badgeLabel, "Compte connecté");
  assert.equal(ui.readinessLabel, "Préparation vérifiée");
  assert.equal(ui.connectLabel, "Connecté");
  assert.equal(ui.readinessDisabled, true);
  assert.equal(ui.connectDisabled, true);
  assert.equal(ui.readinessTone, "success");
});

test("connected but readiness pending shows check readiness action", () => {
  const ui = resolveClientAccountConnectionUi({
    connected: true,
    loginStatus: "connected",
    onboardingStatus: "pending",
  }, "fr");
  assert.equal(ui.readinessLabel, "Vérifier la préparation");
  assert.equal(ui.readinessDisabled, false);
  assert.equal(ui.connectDisabled, true);
});

test("not connected account shows connect action", () => {
  const ui = resolveClientAccountConnectionUi({
    connected: false,
    loginStatus: "unknown",
    onboardingStatus: "pending",
  }, "en");
  assert.equal(ui.badgeLabel, "Not connected");
  assert.equal(ui.connectLabel, "Connect");
  assert.equal(ui.connectDisabled, false);
});

test("challenge account uses client-safe action required wording", () => {
  const ui = resolveClientAccountConnectionUi({
    connected: false,
    loginStatus: "checkpoint",
    onboardingStatus: "pending",
  }, "fr");
  assert.equal(ui.badgeLabel, "Action requise");
  assert.match(ui.connectLabel, /vérifier/i);
  assert.doesNotMatch(ui.connectLabel, /worker|supabase|device|clone/i);
});

test("overview stats use real insights without mock numbers", () => {
  const stats = buildOverviewStats({
    accountId: "a1",
    username: "brand",
    packageLabel: "Growth",
    packageCode: "growth",
    campaignActive: true,
    statsDays: [],
    overview: { monthGain: 42, totalGain: 120, todayCount: 5, dailyAverage: 3.2 },
    chartSeries: { d7: [0], d30: [0], d90: [0] },
    activity: [],
    targets: [],
    whitelist: [],
    blacklist: [],
  }, "fr");
  assert.equal(stats[0]?.val, "42");
  assert.equal(stats[2]?.val, "5");
  assert.doesNotMatch(stats[0]?.val || "", /342|847|94/);
});

test("overview stats fallback avoids fake values when insights missing", () => {
  const stats = buildOverviewStats(null, "fr");
  assert.equal(stats[0]?.val, "—");
  assert.equal(stats[0]?.sub, "Données en cours");
  assert.doesNotMatch(JSON.stringify(stats), /197|300–500|\+342/);
});

test("subscription card avoids hardcoded price and growth when metadata missing", () => {
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
    memberSince: null,
    subscriptionType: "full_cycle",
    subscriptionLabel: "Growth",
    subscriptionStatus: "active",
    subscriptionSince: null,
    subscriptionPriceLabel: "",
    subscriptionGrowthLabel: "",
    subscriptionSupportLabel: "",
    campaignActive: true,
    linkedInstagramAccounts: [],
    billing: { status: "not_configured", nextBillingLabel: "", paymentMethodLabel: "", invoicesAvailable: false },
    accountManager: { name: "", subtitle: "", email: "", bookingUrl: "", bio: "" },
  }, "Growth", "fr");
  assert.equal(card.price, "—");
  assert.equal(card.growthEstimate, "Données en cours");
  assert.equal(card.nextBilling, "Données en cours");
  assert.doesNotMatch(card.price, /197/);
});

test("account manager card avoids hardcoded person when metadata missing", () => {
  const card = buildAccountManagerOverview(null, "fr", {
    subtitle: "Votre account manager",
    text: "fallback",
    emailLabel: "Envoyer un email",
    bookingLabel: "Prendre RDV",
  });
  assert.equal(card.name, "Données en cours");
  assert.equal(card.emailHref, null);
  assert.doesNotMatch(card.name, /Mythyl/);
});
