import type { ClientAccountInsights } from "./load-account-insights";
import type { ClientWorkspaceView } from "./workspace-data";

export type OverviewStatCard = {
  lbl: string;
  val: string;
  sub: string;
  highlight?: boolean;
};

export type OverviewSubscriptionCard = {
  planName: string;
  statusLabel: string;
  price: string;
  period: string;
  growthEstimate: string;
  nextBilling: string;
  support: string;
};

export type OverviewAccountManagerCard = {
  initial: string;
  name: string;
  subtitle: string;
  text: string;
  emailLabel: string;
  emailHref: string | null;
  bookingLabel: string;
  bookingHref: string | null;
};

function pendingLabel(lang: "fr" | "en") {
  return lang === "fr" ? "Données en cours" : "Data pending";
}

function dashValue() {
  return "—";
}

function formatCount(value: number, lang: "fr" | "en") {
  return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatBillingDate(value: string, lang: "fr" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatSignedCount(value: number, lang: "fr" | "en") {
  const formatted = new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 1 }).format(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function followerHistoryPendingSubtitle(lang: "fr" | "en") {
  return lang === "fr"
    ? "Historique des abonnés en cours de collecte"
    : "Follower history collection in progress";
}

function followerHistoryAvailableSubtitle(lang: "fr" | "en") {
  return lang === "fr" ? "Sur les 30 derniers jours" : "Over the last 30 days";
}

export function buildOverviewStats(
  insights: ClientAccountInsights | null,
  lang: "fr" | "en",
): OverviewStatCard[] {
  const empty = dashValue();

  if (!insights) {
    return [
      { lbl: lang === "fr" ? "Ce mois-ci" : "This month", val: empty, sub: lang === "fr" ? "Interactions campagne" : "Campaign interactions" },
      { lbl: lang === "fr" ? "Évolution des abonnés" : "Follower change", val: empty, sub: followerHistoryPendingSubtitle(lang) },
      { lbl: lang === "fr" ? "Aujourd'hui" : "Today", val: empty, sub: lang === "fr" ? "Interactions du jour" : "Today's interactions" },
      { lbl: lang === "fr" ? "Moy. abonnés / jour" : "Avg. followers / day", val: empty, sub: followerHistoryPendingSubtitle(lang) },
    ];
  }

  const interactions = insights.overview.campaignInteractions;
  const followers = insights.overview.followerEvolution;
  const followerAvailable = followers.status === "available";
  const followerSubtitle = followerAvailable
    ? followerHistoryAvailableSubtitle(lang)
    : followerHistoryPendingSubtitle(lang);

  return [
    {
      lbl: lang === "fr" ? "Ce mois-ci" : "This month",
      val: formatCount(interactions.monthInteractions, lang),
      sub: lang === "fr" ? "Interactions campagne" : "Campaign interactions",
      highlight: true,
    },
    {
      lbl: lang === "fr" ? "Évolution des abonnés" : "Follower change",
      val: followerAvailable && followers.netChange !== null
        ? formatSignedCount(followers.netChange, lang)
        : empty,
      sub: followerSubtitle,
    },
    {
      lbl: lang === "fr" ? "Aujourd'hui" : "Today",
      val: formatCount(interactions.todayInteractions, lang),
      sub: lang === "fr" ? "Interactions du jour" : "Today's interactions",
    },
    {
      lbl: lang === "fr" ? "Moy. abonnés / jour" : "Avg. followers / day",
      val: followerAvailable && followers.dailyAverage !== null
        ? formatSignedCount(followers.dailyAverage, lang)
        : empty,
      sub: followerSubtitle,
    },
  ];
}

export function buildSubscriptionOverviewCard(
  workspace: ClientWorkspaceView | null,
  packageLabel: string,
  lang: "fr" | "en",
): OverviewSubscriptionCard {
  const pending = pendingLabel(lang);
  const billingConfigured = workspace?.billing?.status === "configured";
  const nextBilling = billingConfigured && workspace?.billing?.nextBillingLabel
    ? formatBillingDate(workspace.billing.nextBillingLabel, lang)
    : pending;

  return {
    planName: workspace?.subscriptionLabel || packageLabel || dashValue(),
    statusLabel: workspace?.subscriptionStatus === "active"
      ? (lang === "fr" ? "Actif" : "Active")
      : pending,
    price: workspace?.subscriptionPriceLabel || dashValue(),
    period: workspace?.subscriptionPriceLabel
      ? (lang === "fr" ? "/mois" : "/mo")
      : "",
    growthEstimate: workspace?.subscriptionGrowthLabel || pending,
    nextBilling,
    support: workspace?.subscriptionSupportLabel || pending,
  };
}

export function buildAccountManagerOverview(
  workspace: ClientWorkspaceView | null,
  lang: "fr" | "en",
  fallback: { subtitle: string; text: string; emailLabel: string; bookingLabel: string },
): OverviewAccountManagerCard {
  const manager = workspace?.accountManager;
  const pending = pendingLabel(lang);
  const name = manager?.name || pending;
  const initial = manager?.name?.trim().charAt(0).toUpperCase() || "—";

  return {
    initial,
    name,
    subtitle: manager?.subtitle || fallback.subtitle,
    text: manager?.bio || (lang === "fr"
      ? "Votre responsable sera affiché ici dès qu'il est assigné."
      : "Your manager will appear here once assigned."),
    emailLabel: fallback.emailLabel,
    emailHref: manager?.email ? `mailto:${manager.email}` : null,
    bookingLabel: fallback.bookingLabel,
    bookingHref: manager?.bookingUrl || null,
  };
}

