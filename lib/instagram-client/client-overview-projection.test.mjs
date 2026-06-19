import assert from "node:assert/strict";
import test from "node:test";
import { resolveClientAccountConnectionUi } from "./client-account-connection-ui.ts";
import {
  CLIENT_CAMPAIGN_INTERACTION_TYPES,
  resolveClientCampaignInteractionRule,
  shouldCountClientCampaignInteractionEvent,
} from "./client-campaign-interaction-types.ts";
import { computeClientCampaignInteractionOverview } from "./client-campaign-interaction-stats.ts";
import { buildPendingClientFollowerEvolutionMetrics, resolveClientFollowerEvolutionMetrics } from "./client-follower-evolution-metrics.ts";
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

test("campaign interaction taxonomy counts follow, unfollow, like, dm, story only on success", () => {
  for (const actionType of ["follow_sent", "unfollow_sent", "like_sent", "dm_sent", "story_viewed"]) {
    assert.equal(shouldCountClientCampaignInteractionEvent({
      id: actionType,
      event_type: actionType,
      event_status: "success",
      event_at: "2026-06-15T10:00:00.000Z",
    }), true);
    assert.equal(shouldCountClientCampaignInteractionEvent({
      id: `${actionType}-failed`,
      event_type: actionType,
      event_status: "failed",
      event_at: "2026-06-15T10:00:00.000Z",
    }), false);
  }
});

test("mute and internal events are excluded from campaign interactions", () => {
  assert.equal(shouldCountClientCampaignInteractionEvent({
    id: "mute-1",
    event_type: "mute_success",
    event_status: "success",
    event_at: "2026-06-15T10:00:00.000Z",
  }), false);
  assert.equal(resolveClientCampaignInteractionRule({ eventType: "follow_requested" }), null);
});

test("campaign interaction overview deduplicates by event id and uses business timezone day boundaries", () => {
  const overview = computeClientCampaignInteractionOverview([
    { id: "evt-1", event_type: "follow_sent", event_status: "success", event_at: "2026-06-15T06:00:00.000Z" },
    { id: "evt-1", event_type: "follow_sent", event_status: "success", event_at: "2026-06-15T06:00:00.000Z" },
    { id: "evt-2", event_type: "like_sent", event_status: "success", event_at: "2026-06-15T20:00:00.000Z" },
    { id: "evt-3", event_type: "follow_sent", event_status: "success", event_at: "2026-05-15T10:00:00.000Z" },
  ], "Africa/Johannesburg", new Date("2026-06-15T12:00:00.000Z"));

  assert.equal(overview.monthInteractions, 2);
  assert.equal(overview.todayInteractions, 2);
});

test("overview stats cards use campaign interactions for cards 1 and 3 and pending follower metrics for cards 2 and 4", () => {
  const stats = buildOverviewStats({
    accountId: "a1",
    username: "brand",
    packageLabel: "Growth",
    packageCode: "growth",
    campaignActive: true,
    statsDays: [],
    overview: {
      campaignInteractions: {
        monthInteractions: 153,
        todayInteractions: 0,
        businessTimezone: "Africa/Johannesburg",
      },
      followerEvolution: buildPendingClientFollowerEvolutionMetrics(),
    },
    chartSeries: { d7: [0], d30: [0], d90: [0] },
    activity: [],
    targets: [],
    whitelist: [],
    blacklist: [],
  }, "fr");

  assert.equal(stats[0]?.lbl, "Ce mois-ci");
  assert.equal(stats[0]?.val, "153");
  assert.equal(stats[0]?.sub, "Interactions campagne");
  assert.equal(stats[1]?.lbl, "Évolution des abonnés");
  assert.equal(stats[1]?.val, "—");
  assert.equal(stats[1]?.sub, "Historique des abonnés en cours de collecte");
  assert.equal(stats[2]?.lbl, "Aujourd'hui");
  assert.equal(stats[2]?.val, "0");
  assert.equal(stats[3]?.lbl, "Moy. abonnés / jour");
  assert.equal(stats[3]?.val, "—");
  assert.equal(stats[3]?.sub, "Historique des abonnés en cours de collecte");
});

test("follower evolution never derives from bot actions when snapshots are missing", () => {
  const metrics = resolveClientFollowerEvolutionMetrics({
    currentFollowersCount: 153,
    snapshotRows: [],
  });
  assert.equal(metrics.status, "pending");
  assert.equal(metrics.netChange, null);
  assert.equal(metrics.dailyAverage, null);
});

test("overview stats fallback avoids fake values when insights missing", () => {
  const stats = buildOverviewStats(null, "fr");
  assert.equal(stats[0]?.val, "—");
  assert.equal(stats[1]?.val, "—");
  assert.equal(stats[1]?.sub, "Historique des abonnés en cours de collecte");
  assert.doesNotMatch(JSON.stringify(stats), /197|300–500|Total gagné|Moy\. \/ jour/);
  assert.doesNotMatch(stats[1]?.val ?? "", /Données en cours/);
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
  assert.doesNotMatch(card.price, /197/);
});

test("taxonomy exposes explicit rules for future actions", () => {
  assert.ok(CLIENT_CAMPAIGN_INTERACTION_TYPES.some((rule) => rule.actionType === "follow_sent" && rule.countInCampaignInteractions));
  assert.ok(CLIENT_CAMPAIGN_INTERACTION_TYPES.some((rule) => rule.actionType === "mute_success" && !rule.countInCampaignInteractions));
});
