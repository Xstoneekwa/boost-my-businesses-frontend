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

export type ChartRange = 7 | 30 | 90;

const EMPTY_CHART: Record<ChartRange, number[]> = {
  7: [0, 0, 0, 0, 0, 0, 0],
  30: Array.from({ length: 30 }, () => 0),
  90: Array.from({ length: 90 }, () => 0),
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

export function buildOverviewStats(
  insights: ClientAccountInsights | null,
  lang: "fr" | "en",
): OverviewStatCard[] {
  const pending = pendingLabel(lang);
  const empty = dashValue();

  if (!insights) {
    return [
      { lbl: lang === "fr" ? "Ce mois-ci" : "This month", val: empty, sub: pending },
      { lbl: lang === "fr" ? "Total gagné" : "Total gained", val: empty, sub: pending },
      { lbl: lang === "fr" ? "Aujourd'hui" : "Today", val: empty, sub: pending },
      { lbl: lang === "fr" ? "Moy. / jour" : "Daily avg.", val: empty, sub: pending },
    ];
  }

  return [
    {
      lbl: lang === "fr" ? "Ce mois-ci" : "This month",
      val: formatCount(insights.overview.monthGain, lang),
      sub: lang === "fr" ? "Interactions campagne" : "Campaign interactions",
      highlight: true,
    },
    {
      lbl: lang === "fr" ? "Total gagné" : "Total gained",
      val: formatCount(insights.overview.totalGain, lang),
      sub: lang === "fr" ? "Sur la période chargée" : "On loaded period",
    },
    {
      lbl: lang === "fr" ? "Aujourd'hui" : "Today",
      val: formatCount(insights.overview.todayCount, lang),
      sub: lang === "fr" ? "Interactions du jour" : "Today's interactions",
    },
    {
      lbl: lang === "fr" ? "Moy. / jour" : "Daily avg.",
      val: formatCount(insights.overview.dailyAverage, lang),
      sub: lang === "fr" ? "30 derniers jours" : "Last 30 days",
    },
  ];
}

export function buildOverviewChartSeries(insights: ClientAccountInsights | null) {
  if (!insights) return undefined;
  return {
    7: insights.chartSeries.d7,
    30: insights.chartSeries.d30,
    90: insights.chartSeries.d90,
  } as Record<ChartRange, number[]>;
}

export function buildOverviewChartFallbackSeries(): Record<ChartRange, number[]> {
  return EMPTY_CHART;
}

export function buildOverviewChartTitle(
  insights: ClientAccountInsights | null,
  username: string | null,
  lang: "fr" | "en",
  fallbackTitle: string,
) {
  if (insights && username) {
    return `${lang === "fr" ? "Activité" : "Activity"} · @${username.replace(/^@+/, "")}`;
  }
  return fallbackTitle;
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

export function overviewChartMetricLabel(lang: "fr" | "en", live: boolean) {
  if (!live) return pendingLabel(lang);
  return lang === "fr" ? "interactions" : "interactions";
}

export function overviewChartDeltaLabel(delta: number, lang: "fr" | "en", live: boolean) {
  const prefix = delta >= 0 ? "+" : "";
  const suffix = overviewChartMetricLabel(lang, live);
  return `${prefix}${delta} ${suffix}`;
}
