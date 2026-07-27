import assert from "node:assert/strict";
import test from "node:test";
import { resolveClientAccountConnectionUi } from "./client-account-connection-ui.ts";
import {
  CLIENT_CAMPAIGN_INTERACTION_TYPES,
  resolveClientCampaignInteractionRule,
  shouldCountClientCampaignInteractionEvent,
} from "./client-campaign-interaction-types.ts";
import { computeClientCampaignInteractionOverview } from "./client-campaign-interaction-stats.ts";
import { buildClientPersistedInteractionEvidence } from "./client-persisted-interaction-evidence.ts";
import { buildPendingClientFollowerEvolutionMetrics, resolveClientFollowerEvolutionMetrics } from "./client-follower-evolution-metrics.ts";
import { buildOverviewStats, buildSubscriptionOverviewCard } from "./client-overview-projection.ts";

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

test("campaign interaction taxonomy counts only follow, unfollow, like, welcome DM and outreach on success", () => {
  for (const actionType of ["follow_sent", "unfollow_sent", "like_sent", "welcome_dm_sent", "outreach_dm_sent"]) {
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
  for (const actionType of ["story_viewed", "dm_sent", "send_dm_sent"]) {
    assert.equal(shouldCountClientCampaignInteractionEvent({
      id: actionType,
      event_type: actionType,
      event_status: "success",
      event_at: "2026-06-15T10:00:00.000Z",
    }), false);
  }
  assert.equal(shouldCountClientCampaignInteractionEvent({
    id: "like-interaction-failed",
    event_type: "like_sent",
    event_status: null,
    interaction_status: "failed",
    event_at: "2026-06-15T10:00:00.000Z",
  }), false);
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

test("persisted evidence adds canonical unfollows, welcome DMs and outreach without follow verification duplicates", () => {
  const evidence = buildClientPersistedInteractionEvidence({
    interactionEvents: [
      { id: "follow-1", account_id: "a1", event_type: "follow_sent", event_status: "success", event_at: "2026-07-27T08:00:00.000Z" },
      { id: "follow-proof-1", account_id: "a1", event_type: "follow_verified", event_status: "success", event_at: "2026-07-27T08:00:01.000Z" },
      { id: "like-1", account_id: "a1", event_type: "post_like_success", event_status: "success", event_at: "2026-07-27T08:01:00.000Z" },
      { id: "mute-1", account_id: "a1", event_type: "mute_success", event_status: "success", event_at: "2026-07-27T08:02:00.000Z" },
      { id: "raw-unfollow", account_id: "a1", event_type: "unfollow_sent", event_status: "success", event_at: "2026-07-27T08:03:00.000Z" },
      { id: "raw-welcome", account_id: "a1", event_type: "welcome_dm_sent", event_status: "success", event_at: "2026-07-27T08:04:00.000Z" },
      { id: "raw-outreach", account_id: "a1", event_type: "outreach_dm_sent", event_status: "success", event_at: "2026-07-27T08:05:00.000Z" },
    ],
    unfollowRows: [
      { id: "unfollow-1", account_id: "a1", run_id: "run-1", username: "target", unfollow_result: "success", unfollowed_at: "2026-07-27T08:03:00.000Z" },
    ],
    dmJobs: [
      { id: "dm-1", account_id: "a1", dm_type: "welcome", recipient_username: "new-follower", status: "sent", sent_at: "2026-07-27T08:04:00.000Z" },
      { id: "dm-2", account_id: "a1", dm_type: "outreach", recipient_username: "lead", status: "sent", sent_at: "2026-07-27T08:05:00.000Z" },
    ],
  });
  const overview = computeClientCampaignInteractionOverview(
    evidence,
    "Africa/Johannesburg",
    new Date("2026-07-27T10:00:00.000Z"),
  );
  assert.equal(overview.todayInteractions, 5);
  assert.deepEqual(overview.todayByActionType, {
    follow_sent: 1,
    like_sent: 1,
    unfollow_sent: 1,
    welcome_dm_sent: 1,
    outreach_dm_sent: 1,
  });
  assert.equal(overview.verifiedOnly, true);
  assert.equal(overview.source, "verified_persisted_interaction_evidence");
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
        monthByActionType: { follow_sent: 153 },
        todayByActionType: {},
        source: "verified_persisted_interaction_evidence",
        verifiedOnly: true,
        lastEventAt: "2026-06-15T10:00:00.000Z",
        status: "ready",
        sourceErrors: [],
      },
      followerEvolution: buildPendingClientFollowerEvolutionMetrics(),
    },
    chartSeries: { d7: [0], d30: [0], d90: [0] },
    activity: [],
    recentFeed: [],
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

test("follower evolution exposes pending, insufficient, unavailable and error without fake values", () => {
  const pending = resolveClientFollowerEvolutionMetrics({ currentFollowersCount: null, snapshotRows: [] });
  const insufficient = resolveClientFollowerEvolutionMetrics({
    currentFollowersCount: 10,
    snapshotRows: [{ observed_at: new Date().toISOString(), followers_count: 10, lookup_status: "found" }],
  });
  const unavailable = resolveClientFollowerEvolutionMetrics({
    currentFollowersCount: null,
    snapshotRows: [],
    sourceStatus: "unavailable",
  });
  const error = resolveClientFollowerEvolutionMetrics({
    currentFollowersCount: null,
    snapshotRows: [],
    sourceStatus: "error",
  });
  assert.equal(pending.status, "pending");
  assert.equal(insufficient.status, "insufficient");
  assert.equal(unavailable.status, "unavailable");
  assert.equal(error.status, "error");
  assert.equal(error.netChange, null);
});

test("follower evolution uses real elapsed snapshot history and preserves a real zero", () => {
  const metrics = resolveClientFollowerEvolutionMetrics({
    currentFollowersCount: 999,
    snapshotRows: [
      { observed_at: "2026-07-21T20:55:42.000Z", followers_count: 53, lookup_status: "found" },
      { observed_at: "2026-07-22T12:20:55.000Z", followers_count: 53, lookup_status: "found" },
      { observed_at: "2026-07-26T02:15:44.000Z", followers_count: 69, lookup_status: "found" },
    ],
    now: new Date("2026-07-27T12:00:00.000Z"),
  });
  assert.equal(metrics.status, "ready");
  assert.equal(metrics.netChange, 16);
  assert.ok(Math.abs(metrics.dailyAverage - 3.789) < 0.01);
  assert.equal(metrics.source, "ig_account_social_profile_snapshots");

  const zero = resolveClientFollowerEvolutionMetrics({
    currentFollowersCount: 999,
    snapshotRows: [
      { observed_at: "2026-07-25T02:15:44.000Z", followers_count: 69, lookup_status: "found" },
      { observed_at: "2026-07-26T02:15:44.000Z", followers_count: 69, lookup_status: "found" },
    ],
    now: new Date("2026-07-27T12:00:00.000Z"),
  });
  assert.equal(zero.netChange, 0);
  assert.equal(zero.dailyAverage, 0);
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
    clientPlanLabel: "Growth",
    memberSince: null,
    subscriptionPeriodEnd: null,
    billingDisplayMode: "period_end",
    paymentMethodDisplay: "Aucun moyen de paiement lié pour le moment",
    subscriptionLabel: "Growth",
    subscriptionStatus: "active",
    subscriptionSince: null,
    subscriptionPriceLabel: "",
    subscriptionGrowthLabel: "",
    subscriptionSupportLabel: "",
    campaignActive: true,
    linkedInstagramAccounts: [],
    billing: {
      status: "not_configured",
      nextBillingLabel: "",
      paymentMethodLabel: "",
      invoicesAvailable: false,
      displayMode: "period_end",
      periodEndLabel: "",
    },
    accountManager: { name: "", subtitle: "", email: "", bookingUrl: "", bio: "" },
  }, "Growth", "fr");
  assert.equal(card.price, "—");
  assert.doesNotMatch(card.price, /197/);
});

test("taxonomy exposes explicit rules for future actions", () => {
  assert.ok(CLIENT_CAMPAIGN_INTERACTION_TYPES.some((rule) => rule.actionType === "follow_sent" && rule.countInCampaignInteractions));
  assert.ok(CLIENT_CAMPAIGN_INTERACTION_TYPES.some((rule) => rule.actionType === "mute_success" && !rule.countInCampaignInteractions));
});
