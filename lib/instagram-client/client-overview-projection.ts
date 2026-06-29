import type { ClientAccountInsights } from "./load-account-insights";
import type { AccountCommercialSubscriptionDisplay } from "./load-account-commercial-subscription";
import type { ClientWorkspaceView } from "./workspace-data";
import { COMMERCIAL_PLANS, type PlanKey } from "../commercial/catalog.ts";
import { isKnownCommercialPlanKey } from "./client-subscription-projection";

export type OverviewStatCard = {
  lbl: string;
  val: string;
  sub: string;
  highlight?: boolean;
};

export type OverviewSubscriptionCard = {
  title?: string;
  planName: string;
  statusLabel: string;
  price: string;
  period: string;
  growthEstimate: string;
  billingDateLabel: string;
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
  const toConfigure = lang === "fr" ? "À configurer" : "To be configured";
  const billingDateLabel = workspace?.billingDisplayMode === "next_billing"
    ? (lang === "fr" ? "Prochain prélèvement" : "Next billing")
    : (lang === "fr" ? "Échéance de l'abonnement" : "Subscription end date");

  const billingIso = workspace?.billing?.nextBillingLabel
    || workspace?.subscriptionPeriodEnd
    || workspace?.billing?.periodEndLabel
    || "";
  const nextBilling = billingIso
    ? formatBillingDate(billingIso, lang)
    : toConfigure;

  return {
    planName: workspace?.clientPlanLabel || packageLabel || dashValue(),
    statusLabel: workspace?.subscriptionStatus === "active"
      ? (lang === "fr" ? "Actif" : "Active")
      : pending,
    price: workspace?.subscriptionPriceLabel || dashValue(),
    period: workspace?.subscriptionPriceLabel
      ? (lang === "fr" ? "/mois" : "/mo")
      : "",
    growthEstimate: workspace?.subscriptionGrowthLabel || pending,
    billingDateLabel,
    nextBilling,
    support: workspace?.subscriptionSupportLabel || pending,
  };
}

function catalogGrowthLabel(planKey: PlanKey, lang: "fr" | "en") {
  return lang === "fr"
    ? COMMERCIAL_PLANS[planKey].growthEstimateLabelFr
    : COMMERCIAL_PLANS[planKey].growthEstimateLabelEn;
}

export function buildAgencyAccountSubscriptionCard(
  display: AccountCommercialSubscriptionDisplay | null,
  insights: ClientAccountInsights | null,
  accountId: string,
  lang: "fr" | "en",
): OverviewSubscriptionCard {
  if (display) return buildAccountScopedSubscriptionCard(display, lang);
  const pending = pendingLabel(lang);
  const username = readString(insights?.username, "…").replace(/^@+/, "");
  const packageCode = readString(insights?.packageCode).toLowerCase();
  const planLabel = insights?.packageLabel || pending;
  const growthLabel = isKnownCommercialPlanKey(packageCode)
    ? catalogGrowthLabel(packageCode, lang)
    : pending;
  return buildAccountScopedSubscriptionCard({
    accountId,
    username,
    planLabel,
    statusLabel: pending,
    priceLabel: lang === "fr" ? "Disponible prochainement" : "Available soon",
    growthLabel,
    supportLabel: pending,
    billingDisplayMode: "period_end",
    billingDateIso: "",
  }, lang);
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function buildAccountScopedSubscriptionCard(
  display: AccountCommercialSubscriptionDisplay,
  lang: "fr" | "en",
): OverviewSubscriptionCard {
  const pending = pendingLabel(lang);
  const billingDateLabel = display.billingDisplayMode === "next_billing"
    ? (lang === "fr" ? "Prochain prélèvement" : "Next billing")
    : (lang === "fr" ? "Échéance de l'abonnement" : "Subscription end date");
  const nextBilling = display.billingDateIso
    ? formatBillingDate(display.billingDateIso, lang)
    : pending;
  const handle = display.username.replace(/^@+/, "");
  const hasPrice = /€|\d/.test(display.priceLabel);

  return {
    title: lang === "fr" ? `Abonnement — @${handle}` : `Subscription — @${handle}`,
    planName: display.planLabel || "—",
    statusLabel: display.statusLabel || pending,
    price: display.priceLabel || "—",
    period: hasPrice ? (lang === "fr" ? "/mois" : "/mo") : "",
    growthEstimate: display.growthLabel || pending,
    billingDateLabel,
    nextBilling,
    support: display.supportLabel || pending,
  };
}

export function buildAccountManagerOverview(
  workspace: ClientWorkspaceView | null,
  lang: "fr" | "en",
  fallback: { subtitle: string; text: string; emailLabel: string; bookingLabel: string },
  options?: { agencyContact?: boolean },
): OverviewAccountManagerCard {
  const manager = workspace?.accountManager;
  const pending = pendingLabel(lang);
  const name = manager?.name || pending;
  const initial = manager?.name?.trim().charAt(0).toUpperCase() || "—";
  const agencySubtitle = lang === "fr" ? "Votre contact agence" : "Your agency contact";

  return {
    initial,
    name,
    subtitle: options?.agencyContact
      ? agencySubtitle
      : (manager?.subtitle || fallback.subtitle),
    text: manager?.bio || (lang === "fr"
      ? "Votre responsable sera affiché ici dès qu'il est assigné."
      : "Your manager will appear here once assigned."),
    emailLabel: fallback.emailLabel,
    emailHref: manager?.email ? `mailto:${manager.email}` : null,
    bookingLabel: fallback.bookingLabel,
    bookingHref: manager?.bookingUrl || null,
  };
}

