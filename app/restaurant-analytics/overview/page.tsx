import Link from "next/link";
import ExportReportButton from "@/components/restaurant-analytics/ExportReportButton";
import { requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { getRestaurantServerCopy } from "@/lib/restaurant-language-server";
import { createSupabaseClient } from "@/lib/supabase";
import type { UserContext } from "@/lib/userContext";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type AnalyticsRow = Record<string, unknown>;
type CurrencyCode = "EUR" | "USD" | "ZAR";
type PlanTier = "growth" | "pro" | "premium";
type Lang = "fr" | "en";

type DateRangePreset = {
  key: "7d" | "30d" | "90d";
  label: string;
  days: number;
};

type OverviewPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "warning" | "danger";
  kind?: "default" | "revenue";
};

type LocationMetric = {
  id?: string;
  name: string;
  calls: number;
  reservations: number;
  escalations: number;
  conversionRate: number;
};

type DashboardSummary = {
  tenantName: string;
  tenantSlug: string;
  plan: PlanTier;
  locations: LocationMetric[];
  totalCalls: number;
  totalReservations: number;
  totalEscalations: number;
  callToBookingRate: number;
  quotaUsagePercent: number;
  smsFollowupsSent: number | null;
  whatsappFollowupsSent: number | null;
  failedFollowups: number | null;
  estimatedRevenue: Partial<Record<CurrencyCode, number>>;
  recoveredRevenue: Partial<Record<CurrencyCode, number>>;
  reservationStatus: {
    confirmed: number;
    pending: number;
    cancelled: number;
    noShow: number;
  };
};

type OverviewDataResult =
  | { ok: true; summary: DashboardSummary }
  | { ok: false; error: string };

const DATE_RANGE_PRESETS: Record<DateRangePreset["key"], DateRangePreset> = {
  "7d": { key: "7d", label: "Last 7 days", days: 7 },
  "30d": { key: "30d", label: "Last 30 days", days: 30 },
  "90d": { key: "90d", label: "Last 90 days", days: 90 },
};

const DEFAULT_DATE_RANGE: DateRangePreset["key"] = "30d";
const DATE_FILTER_COLUMNS = ["period_start", "period_date", "date", "day", "call_date", "created_at", "started_at"] as const;

const AC = "#F59E0B";
const AC_TEXT = "#FBBF24";
const AC_DIM = "rgba(245,158,11,0.10)";
const AC_BORDER = "rgba(245,158,11,0.24)";
const CARD_BG = "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.025))";
const PANEL_BG = "rgba(255,255,255,0.035)";

const dashboardText = {
  fr: {
    ranges: { "7d": "7 derniers jours", "30d": "30 derniers jours", "90d": "90 derniers jours" },
    dashboard: "dashboard",
    hello: "Bonjour",
    manager: "Manager",
    subtitle: "Voici les performances de votre restaurant aujourd'hui.",
    exportReport: "Exporter le rapport",
    operational: "Système opérationnel",
    totalCalls: "Appels reçus",
    reservationsRecovered: "Réservations récupérées",
    reservationsConfirmed: "Réservations confirmées",
    escalations: "Escalades",
    conversionRate: "Taux de conversion",
    quotaUsage: "Utilisation du quota",
    whatsappFollowups: "Suivis WhatsApp",
    smsFollowups: "Suivis SMS",
    estimatedRevenue: "Revenu estimé",
    recoveredRevenue: "Revenu récupéré",
    inboundCalls: "Appels entrants traités par l'IA",
    bookingsCaptured: "Réservations capturées depuis les appels",
    humanHandoffs: "Transmissions humaines créées",
    callsConverted: "Appels convertis en réservations",
    monthlyPackageUsage: "Utilisation du quota mensuel du plan",
    whatsappDetail: "Messages WhatsApp automatisés",
    smsDetail: "Confirmations et suivis SMS",
    generatedDetail: "Généré depuis les réservations confirmées",
    recoveredDetail: "Récupéré grâce aux suivis",
    callPerformance: "Performance des appels",
    monthlySummary: "Résumé mensuel",
    calls: "Appels",
    reservations: "Réservations",
    reservationsByStatus: "Réservations par statut",
    live: "Live",
    confirmed: "Confirmées",
    pending: "En attente",
    cancelled: "Annulées",
    noShow: "No-show",
    total: "Total",
    realtime: "Interactions en temps réel",
    noRecent: "Aucune interaction récente pour le moment. Les appels, réservations et suivis récents apparaîtront ici dès que les données seront disponibles.",
    topSources: "Sources principales de réservation",
    source: "Source",
    share: "Part",
    conversion: "Conversion",
    voiceAiCalls: "Appels Voice AI",
    followups: "Suivis",
    escalationsRecovered: "Escalades récupérées",
    websiteManual: "Site web / Manuel",
    upcoming: "Prochaines réservations",
    noUpcoming: "Aucune réservation à venir pour le moment. Les réservations connectées au calendrier apparaîtront ici dès que disponibles.",
    quickActions: "Actions rapides",
    viewCalendar: "Voir le calendrier",
    manageReservations: "Gérer les réservations",
    viewFollowups: "Voir les suivis",
    viewEscalations: "Voir les escalades",
    weekly: "Performance hebdomadaire",
    weeklyTitle: "Performance cette semaine",
    weeklyDetail: "Résumé filtré par plan depuis la vue dashboard restaurant.",
    revenueAnalytics: "Analytics revenu",
    upgrade: "Passer à Pro",
    notAvailable: "Indisponible",
    upsell: "Upgrade",
    upsellTitle: "Augmente tes réservations",
    growthUpsell: "Débloque les suivis WhatsApp + SMS et les analytics avancés pour récupérer plus de réservations.",
    proUpsell: "Débloque le reporting multi-sites, les flows personnalisés et le support dédié.",
    explorePremium: "Explorer Premium",
    locked: "Verrouillé",
    lockedWhatsapp: "Suivis WhatsApp + SMS",
    lockedWhatsappText: "Récupère les réservations manquées avec des workflows automatiques WhatsApp et SMS.",
    lockedAnalytics: "Analytics avancés",
    lockedAnalyticsText: "Débloque conversion, échecs de suivis, qualité des escalades et revenu récupéré.",
    lockedRevenue: "Récupération de revenu",
    lockedRevenueText: "Suis le revenu généré et récupéré en EUR, USD et ZAR.",
    lockedMulti: "Reporting multi-sites",
    lockedMultiText: "Compare les sites, quotas, réservations et escalades sur tout le groupe.",
    lockedFlows: "Flows IA personnalisés",
    lockedFlowsText: "Crée des flows pour VIP, groupes, privatisations et cas opérationnels.",
    lockedIntegrations: "Intégrations avancées",
    lockedIntegrationsText: "Connecte systèmes de réservation, CRM, outils internes et reporting personnalisé.",
    multiLocation: "Comparaison multi-sites",
    premium: "Premium",
    customReporting: "Reporting personnalisé et intégrations",
    noMulti: "La comparaison multi-sites apparaît lorsqu'au moins deux sites sont connectés.",
    customItems: ["Reporting personnalisé", "Intégrations avancées", "Flows IA personnalisés", "Optimisation dédiée"],
    unavailable: "Analytics indisponibles",
    loadError: "Impossible de charger les données de la vue globale.",
  },
  en: {
    ranges: { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" },
    dashboard: "dashboard",
    hello: "Hello",
    manager: "Manager",
    subtitle: "Here are your restaurant's performances today.",
    exportReport: "Export report",
    operational: "System operational",
    totalCalls: "Calls received",
    reservationsRecovered: "Reservations recovered",
    reservationsConfirmed: "Reservations confirmed",
    escalations: "Escalations",
    conversionRate: "Conversion rate",
    quotaUsage: "Quota usage",
    whatsappFollowups: "WhatsApp follow-ups",
    smsFollowups: "SMS follow-ups",
    estimatedRevenue: "Estimated revenue",
    recoveredRevenue: "Recovered revenue",
    inboundCalls: "Inbound AI-handled calls",
    bookingsCaptured: "Bookings captured from calls",
    humanHandoffs: "Human handoffs created",
    callsConverted: "Calls converted to bookings",
    monthlyPackageUsage: "Monthly package usage",
    whatsappDetail: "Automated WhatsApp messages",
    smsDetail: "Confirmations and follow-ups",
    generatedDetail: "Generated from confirmed reservations",
    recoveredDetail: "Recovered through follow-up",
    callPerformance: "Call performance",
    monthlySummary: "Monthly summary",
    calls: "Calls",
    reservations: "Reservations",
    reservationsByStatus: "Reservations by status",
    live: "Live",
    confirmed: "Confirmed",
    pending: "Pending",
    cancelled: "Cancelled",
    noShow: "No-show",
    total: "Total",
    realtime: "Real-time interactions",
    noRecent: "No recent interactions yet. Recent calls, reservations, and follow-ups will appear here once data is available.",
    topSources: "Top reservation sources",
    source: "Source",
    share: "Share",
    conversion: "Conversion",
    voiceAiCalls: "Voice AI calls",
    followups: "Follow-ups",
    escalationsRecovered: "Escalations recovered",
    websiteManual: "Website / Manual",
    upcoming: "Upcoming reservations",
    noUpcoming: "No upcoming reservations yet. Calendar-connected reservations will appear here once available.",
    quickActions: "Quick actions",
    viewCalendar: "View calendar",
    manageReservations: "Manage reservations",
    viewFollowups: "View follow-ups",
    viewEscalations: "View escalations",
    weekly: "Weekly performance",
    weeklyTitle: "Performance this week",
    weeklyDetail: "Package-aware summary from your restaurant dashboard view.",
    revenueAnalytics: "Revenue analytics",
    upgrade: "Upgrade to Pro",
    notAvailable: "Not available",
    upsell: "Upgrade",
    upsellTitle: "Increase your reservations",
    growthUpsell: "Unlock WhatsApp + SMS follow-ups and advanced analytics to recover more bookings.",
    proUpsell: "Unlock multi-location reporting, custom flows, and dedicated support.",
    explorePremium: "Explore Premium",
    locked: "Locked",
    lockedWhatsapp: "WhatsApp + SMS follow-ups",
    lockedWhatsappText: "Recover missed bookings with automatic WhatsApp and SMS follow-up workflows.",
    lockedAnalytics: "Advanced analytics",
    lockedAnalyticsText: "Unlock conversion, failed follow-ups, escalation quality, and revenue recovery analytics.",
    lockedRevenue: "Revenue recovery",
    lockedRevenueText: "Track estimated generated revenue and follow-up recovered revenue in EUR, USD, and ZAR.",
    lockedMulti: "Multi-location reporting",
    lockedMultiText: "Compare locations, quota usage, reservations, and escalation patterns across the group.",
    lockedFlows: "Custom AI flows",
    lockedFlowsText: "Design custom flows for VIPs, groups, private dining, and operational edge cases.",
    lockedIntegrations: "Advanced integrations",
    lockedIntegrationsText: "Connect booking systems, CRM, internal tools, and custom reporting workflows.",
    multiLocation: "Multi-location comparison",
    premium: "Premium",
    customReporting: "Custom reporting and integrations",
    noMulti: "Multi-location comparison appears when more than one location is connected.",
    customItems: ["Custom reporting", "Advanced integrations", "Custom AI flows", "Dedicated optimization"],
    unavailable: "Analytics unavailable",
    loadError: "Could not load the overview data.",
  },
} as const;

function readNumber(row: AnalyticsRow, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return fallback;
}

function readNullableNumber(row: AnalyticsRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function readString(row: AnalyticsRow, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }

  return fallback;
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString();
}

function formatPercent(value: number) {
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(normalized % 1 === 0 ? 0 : 1)}%`;
}

function formatCurrency(value: number, currency: CurrencyCode) {
  if (currency === "ZAR") {
    return `R ${value.toLocaleString("en", { maximumFractionDigits: value % 1 === 0 ? 0 : 2 })}`;
  }

  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatRevenueSet(items: Array<{ currency: CurrencyCode; value: number; formatted: string }>) {
  const byCurrency = new Map(items.map((item) => [item.currency, item.formatted]));
  return (["EUR", "ZAR"] as CurrencyCode[])
    .map((currency) => byCurrency.get(currency))
    .filter((value): value is string => Boolean(value))
    .join(" / ");
}

function percentOf(part: number, total: number) {
  if (!total) return 0;
  return (part / total) * 100;
}

function resolveDateRangePreset(value: string | string[] | undefined): DateRangePreset {
  const key = Array.isArray(value) ? value[0] : value;
  return key && key in DATE_RANGE_PRESETS ? DATE_RANGE_PRESETS[key as DateRangePreset["key"]] : DATE_RANGE_PRESETS[DEFAULT_DATE_RANGE];
}

function getDateRangeStart(dateRange: DateRangePreset) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - dateRange.days);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

function isMissingDateColumnError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("column") || normalized.includes("schema cache") || normalized.includes("does not exist");
}

function normalizePlan(value: string): PlanTier {
  const plan = value.trim().toLowerCase();
  if (plan === "premium" || plan === "enterprise") return "premium";
  if (plan === "pro") return "pro";
  return "growth";
}

function canSeePro(plan: PlanTier) {
  return plan === "pro" || plan === "premium";
}

function canSeePremium(plan: PlanTier) {
  return plan === "premium";
}

function planLabel(plan: PlanTier) {
  if (plan === "premium") return "Premium";
  if (plan === "pro") return "Pro";
  return "Growth";
}

function sumNullable(rows: AnalyticsRow[], key: string) {
  let total = 0;
  let found = false;

  for (const row of rows) {
    const value = readNullableNumber(row, [key]);
    if (value === null) continue;
    total += value;
    found = true;
  }

  return found ? total : null;
}

function firstNullable(rows: AnalyticsRow[], key: string) {
  for (const row of rows) {
    const value = readNullableNumber(row, [key]);
    if (value !== null) return value;
  }

  return null;
}

function pickRevenue(rows: AnalyticsRow[], prefix: string): Partial<Record<CurrencyCode, number>> {
  const eur = sumNullable(rows, `${prefix}_eur`);
  const usd = sumNullable(rows, `${prefix}_usd`) ?? (eur !== null ? eur * 1.08 : null);
  const zar = sumNullable(rows, `${prefix}_zar`) ?? (eur !== null ? eur * 20.2 : null);

  return {
    EUR: eur ?? undefined,
    USD: usd ?? undefined,
    ZAR: zar ?? undefined,
  };
}

function buildSummary(rows: AnalyticsRow[], userContext: UserContext): DashboardSummary {
  const totalCalls = rows.reduce((sum, row) => sum + readNumber(row, ["total_calls"]), 0);
  const totalReservations = rows.reduce((sum, row) => sum + readNumber(row, ["total_reservations"]), 0);
  const totalEscalations = rows.reduce((sum, row) => sum + readNumber(row, ["total_escalations"]), 0);
  const plan = userContext.role === "superadmin" ? "premium" : normalizePlan(readString(rows[0] ?? {}, ["plan"], "growth"));

  const locations = rows.map((row, index) => {
    const calls = readNumber(row, ["total_calls"]);
    const reservations = readNumber(row, ["total_reservations"]);
    const escalations = readNumber(row, ["total_escalations"]);

    return {
      id: readString(row, ["location_id", "locationId", "id"]) || undefined,
      name: readString(row, ["location_name", "locationName", "name"], `Location ${index + 1}`),
      calls,
      reservations,
      escalations,
      conversionRate: readNumber(row, ["call_to_booking_rate"], percentOf(reservations, calls)),
    };
  });

  return {
    tenantName: readString(rows[0] ?? {}, ["tenant_name", "tenantName", "name"], userContext.role === "tenant" ? "Restaurant workspace" : "Boost restaurant network"),
    tenantSlug: readString(rows[0] ?? {}, ["tenant_slug", "tenantSlug"], ""),
    plan,
    locations,
    totalCalls,
    totalReservations,
    totalEscalations,
    callToBookingRate: firstNullable(rows, "call_to_booking_rate") ?? percentOf(totalReservations, totalCalls),
    quotaUsagePercent: firstNullable(rows, "quota_usage_percent") ?? 0,
    smsFollowupsSent: sumNullable(rows, "sms_followups_sent"),
    whatsappFollowupsSent: sumNullable(rows, "whatsapp_followups_sent"),
    failedFollowups: sumNullable(rows, "failed_followups"),
    estimatedRevenue: pickRevenue(rows, "estimated_revenue"),
    recoveredRevenue: pickRevenue(rows, "estimated_followup_recovered_revenue"),
    reservationStatus: {
      confirmed: totalReservations,
      pending: sumNullable(rows, "pending_reservations") ?? 0,
      cancelled: sumNullable(rows, "cancelled_reservations") ?? 0,
      noShow: sumNullable(rows, "no_show_reservations") ?? 0,
    },
  };
}

async function fetchDashboardRows(supabase: SupabaseClient, userContext: UserContext, dateRange: DateRangePreset) {
  const since = getDateRangeStart(dateRange);
  let lastError = "";

  for (const column of DATE_FILTER_COLUMNS) {
    let query = supabase.from("restaurant_dashboard_filtered").select("*").gte(column, since);
    if (userContext.role === "tenant") query = query.eq("tenant_id", userContext.tenantId);

    const result = await query.returns<AnalyticsRow[]>();
    if (!result.error) return result.data ?? [];

    lastError = result.error.message;
    if (!isMissingDateColumnError(result.error.message)) throw new Error(result.error.message);
  }

  let fallbackQuery = supabase.from("restaurant_dashboard_filtered").select("*");
  if (userContext.role === "tenant") fallbackQuery = fallbackQuery.eq("tenant_id", userContext.tenantId);

  const fallback = await fallbackQuery.returns<AnalyticsRow[]>();
  if (fallback.error) throw new Error(lastError || fallback.error.message);

  return fallback.data ?? [];
}

async function getOverviewData(userContext: UserContext, dateRange: DateRangePreset): Promise<OverviewDataResult> {
  try {
    const rows = await fetchDashboardRows(createSupabaseClient(), userContext, dateRange);
    if (!rows.length) return { ok: false, error: "restaurant_dashboard_filtered returned no rows." };
    return { ok: true, summary: buildSummary(rows, userContext) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export default async function RestaurantAnalyticsOverviewPage({ searchParams }: OverviewPageProps) {
  const params = searchParams ? await searchParams : {};
  const dateRange = resolveDateRangePreset(params.range);
  const userContext = await requireDashboardUserContext();
  const { lang } = await getRestaurantServerCopy();
  const t = dashboardText[lang];
  const result = await getOverviewData(userContext, dateRange);

  if (!result.ok) {
    return (
      <div className="dashboard-page" style={{ maxWidth: 1380, margin: "0 auto" }}>
        <ErrorState message={result.error} t={t} />
      </div>
    );
  }

  const summary = result.summary;
  const proVisible = canSeePro(summary.plan);
  const premiumVisible = canSeePremium(summary.plan);
  const revenueMetrics = buildRevenueMetrics(summary);
  const topMetrics = buildTopMetrics(summary, proVisible, revenueMetrics, t);

  return (
    <div className="dashboard-page" style={{ maxWidth: 1380, margin: "0 auto" }}>
      <DashboardTopBar summary={summary} dateRange={dateRange} userContext={userContext} lang={lang} t={t} />

      <section className="dashboard-kpi-grid dashboard-kpi-six" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 14, marginBottom: 18 }}>
        {topMetrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24, marginBottom: 24, alignItems: "start" }} className="dashboard-main-grid">
        <div style={{ display: "grid", gap: 24, minWidth: 0, gridColumn: "span 8" }} className="dashboard-left-column">
          <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(320px, 0.85fr)", gap: 18 }} className="dashboard-two-col">
            <CallPerformanceCard summary={summary} t={t} />
            <ReservationStatusCard summary={summary} t={t} />
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.95fr) minmax(0, 1.05fr)", gap: 18 }} className="dashboard-two-col">
            <TopSourcesCard summary={summary} t={t} />
            <UpcomingReservationsCard t={t} />
          </section>
        </div>

        <aside style={{ display: "grid", gap: 18, alignContent: "start", minWidth: 0, gridColumn: "span 4" }} className="dashboard-right-column">
          <RealtimeInteractionsCard t={t} />
          <QuickActionsCard t={t} range={dateRange.key} lang={lang} />
        </aside>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: 24,
          alignItems: "stretch",
          marginBottom: 24,
        }}
        className="dashboard-weekly-upsell-grid"
      >
        <div style={{ gridColumn: premiumVisible ? "1 / -1" : "span 8", minWidth: 0 }} className="dashboard-weekly-wrap">
          <WeeklySummaryBanner summary={summary} revenueMetrics={revenueMetrics} proVisible={proVisible} t={t} />
        </div>
        {!premiumVisible && (
          <div style={{ gridColumn: "span 4", minWidth: 0 }} className="dashboard-upsell-wrap">
            <UpsellCard plan={summary.plan} compact t={t} />
          </div>
        )}
      </section>

      {!proVisible && (
        <section className="dashboard-three-col" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 18, marginTop: 0, marginBottom: 24 }}>
          <LockedFeatureCard title={t.lockedWhatsapp} text={t.lockedWhatsappText} cta={t.upgrade} t={t} />
          <LockedFeatureCard title={t.lockedAnalytics} text={t.lockedAnalyticsText} cta={t.upgrade} t={t} />
          <LockedFeatureCard title={t.lockedRevenue} text={t.lockedRevenueText} cta={t.upgrade} t={t} />
        </section>
      )}

      {proVisible && !premiumVisible && (
        <section className="dashboard-three-col" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 18, marginTop: 0, marginBottom: 24 }}>
          <LockedFeatureCard title={t.lockedMulti} text={t.lockedMultiText} cta={t.explorePremium} t={t} />
          <LockedFeatureCard title={t.lockedFlows} text={t.lockedFlowsText} cta={t.explorePremium} t={t} />
          <LockedFeatureCard title={t.lockedIntegrations} text={t.lockedIntegrationsText} cta={t.explorePremium} t={t} />
        </section>
      )}

      {premiumVisible && (
        <section className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)", gap: 24 }}>
          <MultiLocationComparison summary={summary} t={t} />
          <PremiumOperationsCard t={t} />
        </section>
      )}
    </div>
  );
}

function buildRevenueMetrics(summary: DashboardSummary) {
  return {
    estimated: (["EUR", "USD", "ZAR"] as CurrencyCode[]).flatMap((currency) => {
      const value = summary.estimatedRevenue[currency];
      return typeof value === "number" ? [{ currency, value, formatted: formatCurrency(value, currency) }] : [];
    }),
    recovered: (["EUR", "USD", "ZAR"] as CurrencyCode[]).flatMap((currency) => {
      const value = summary.recoveredRevenue[currency];
      return typeof value === "number" ? [{ currency, value, formatted: formatCurrency(value, currency) }] : [];
    }),
  };
}

function buildTopMetrics(summary: DashboardSummary, proVisible: boolean, revenueMetrics: ReturnType<typeof buildRevenueMetrics>, t: (typeof dashboardText)[Lang]): DashboardMetric[] {
  const base: DashboardMetric[] = [
    { label: t.totalCalls, value: formatInteger(summary.totalCalls), detail: t.inboundCalls, tone: "neutral" },
    { label: proVisible ? t.reservationsConfirmed : t.reservationsRecovered, value: formatInteger(summary.totalReservations), detail: t.bookingsCaptured, tone: "good" },
  ];

  if (proVisible) {
    if (summary.whatsappFollowupsSent !== null) {
      base.push({ label: t.whatsappFollowups, value: formatInteger(summary.whatsappFollowupsSent), detail: t.whatsappDetail, tone: "good" });
    }
    if (summary.smsFollowupsSent !== null) {
      base.push({ label: t.smsFollowups, value: formatInteger(summary.smsFollowupsSent), detail: t.smsDetail, tone: "good" });
    }
    if (revenueMetrics.estimated.length) {
      base.push({ label: t.estimatedRevenue, value: formatRevenueSet(revenueMetrics.estimated), detail: t.generatedDetail, tone: "good", kind: "revenue" });
    }
    if (revenueMetrics.recovered.length) {
      base.push({ label: t.recoveredRevenue, value: formatRevenueSet(revenueMetrics.recovered), detail: t.recoveredDetail, tone: "good", kind: "revenue" });
    }
    return base;
  }

  return [
    ...base,
    { label: t.escalations, value: formatInteger(summary.totalEscalations), detail: t.humanHandoffs, tone: "warning" },
    { label: t.conversionRate, value: formatPercent(summary.callToBookingRate), detail: t.callsConverted, tone: "good" },
    { label: t.quotaUsage, value: formatPercent(summary.quotaUsagePercent), detail: t.monthlyPackageUsage, tone: "warning" },
  ];
}

function DashboardTopBar({ summary, dateRange, userContext, lang, t }: { summary: DashboardSummary; dateRange: DateRangePreset; userContext: UserContext; lang: Lang; t: (typeof dashboardText)[Lang] }) {
  const roleName = userContext.role === "superadmin" ? t.manager : summary.tenantName || t.manager;

  return (
    <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, marginBottom: 22, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
          {planLabel(summary.plan)} {t.dashboard}
        </p>
        <h1 className="dashboard-page-title" style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.9rem, 3vw, 2.7rem)", lineHeight: 1.05, letterSpacing: "-0.04em", marginBottom: 8 }}>
          {t.hello}, {roleName} 👋
        </h1>
        <p className="dashboard-page-copy" style={{ color: "rgba(255,255,255,0.56)", fontSize: 15, lineHeight: 1.65 }}>
          {t.subtitle}
        </p>
      </div>

      <div className="dashboard-header-actions" style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <DateRangeSelector activeKey={dateRange.key} t={t} />
        <ExportReportButton label={t.exportReport} range={dateRange.key} lang={lang} />
        <span style={{ ...pillStyle, color: "#86EFAC", borderColor: "rgba(34,197,94,0.24)", background: "rgba(34,197,94,0.10)" }}>
          {t.operational}
        </span>
      </div>
    </header>
  );
}

function DateRangeSelector({ activeKey, t }: { activeKey: DateRangePreset["key"]; t: (typeof dashboardText)[Lang] }) {
  return (
    <div style={{ display: "flex", gap: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.035)", borderRadius: 999, padding: 4 }}>
      {Object.values(DATE_RANGE_PRESETS).map((option) => (
        <Link
          key={option.key}
          href={`/restaurant-analytics/overview?range=${option.key}`}
          style={{
            borderRadius: 999,
            padding: "8px 10px",
            color: activeKey === option.key ? "#160b02" : "rgba(255,255,255,0.62)",
            background: activeKey === option.key ? AC : "transparent",
            fontSize: 12,
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          {t.ranges[option.key]}
        </Link>
      ))}
    </div>
  );
}

function MetricCard({ metric }: { metric: DashboardMetric }) {
  const color =
    metric.tone === "danger" ? "#F87171" : metric.tone === "good" ? "#34D399" : metric.tone === "warning" ? AC_TEXT : "#93C5FD";
  const isRevenue = metric.kind === "revenue";

  return (
    <article style={{ ...cardStyle, minHeight: 138, padding: isRevenue ? "18px 16px" : cardStyle.padding }}>
      <p style={{ color: "rgba(255,255,255,0.58)", fontSize: 13, fontWeight: 700, marginBottom: isRevenue ? 12 : 14 }}>{metric.label}</p>
      <p style={{ color: isRevenue ? "#34D399" : "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: isRevenue ? 17 : metric.value.length > 18 ? 20 : 30, lineHeight: isRevenue ? 1.28 : 1.05, fontWeight: 800, letterSpacing: isRevenue ? "0" : "-0.04em", marginBottom: 9, whiteSpace: isRevenue ? "nowrap" : "normal" }}>
        {metric.value}
      </p>
      <p style={{ color, fontSize: 12.5, lineHeight: 1.5 }}>{metric.detail}</p>
    </article>
  );
}

function CallPerformanceCard({ summary, t }: { summary: DashboardSummary; t: (typeof dashboardText)[Lang] }) {
  const max = Math.max(summary.totalCalls, summary.totalReservations, summary.totalEscalations, 1);
  const rows = [
    { label: t.calls, value: summary.totalCalls, color: AC_TEXT },
    { label: t.reservations, value: summary.totalReservations, color: "#34D399" },
    { label: t.escalations, value: summary.totalEscalations, color: "#F87171" },
  ];

  return (
    <DashboardPanel title={t.callPerformance} action={t.monthlySummary}>
      <div style={{ display: "grid", gap: 16 }}>
        {rows.map((row) => (
          <div key={row.label}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
              <span style={{ color: "rgba(255,255,255,0.60)", fontSize: 13 }}>{row.label}</span>
              <span style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 800 }}>{formatInteger(row.value)}</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(4, (row.value / max) * 100)}%`, height: "100%", borderRadius: 999, background: row.color }} />
            </div>
          </div>
        ))}
      </div>
    </DashboardPanel>
  );
}

function ReservationStatusCard({ summary, t }: { summary: DashboardSummary; t: (typeof dashboardText)[Lang] }) {
  const rows = [
    { label: t.confirmed, value: summary.reservationStatus.confirmed, color: "#34D399" },
    { label: t.pending, value: summary.reservationStatus.pending, color: AC_TEXT },
    { label: t.cancelled, value: summary.reservationStatus.cancelled, color: "#60A5FA" },
    { label: t.noShow, value: summary.reservationStatus.noShow, color: "#F87171" },
  ];
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <DashboardPanel title={t.reservationsByStatus} action={t.live}>
      <div style={{ display: "grid", gridTemplateColumns: "150px minmax(0, 1fr)", gap: 20, alignItems: "center" }} className="dashboard-two-col">
        <div style={{ width: 138, height: 138, borderRadius: "50%", border: `22px solid ${AC_BORDER}`, display: "grid", placeItems: "center", margin: "0 auto", background: "rgba(7,17,31,0.50)" }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800 }}>{formatInteger(total)}</p>
            <p style={{ color: "rgba(255,255,255,0.44)", fontSize: 12 }}>{t.total}</p>
          </div>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row) => (
            <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
              <span style={{ color: "rgba(255,255,255,0.64)", fontSize: 13 }}><span style={{ color: row.color }}>●</span> {row.label}</span>
              <span style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 800 }}>{formatInteger(row.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </DashboardPanel>
  );
}

function RealtimeInteractionsCard({ t }: { t: (typeof dashboardText)[Lang] }) {
  return (
    <DashboardPanel title={t.realtime} action={t.live}>
      <EmptyState text={t.noRecent} />
    </DashboardPanel>
  );
}

function TopSourcesCard({ summary, t }: { summary: DashboardSummary; t: (typeof dashboardText)[Lang] }) {
  const followUps = (summary.smsFollowupsSent ?? 0) + (summary.whatsappFollowupsSent ?? 0);
  const rows = [
    { source: t.voiceAiCalls, value: summary.totalReservations, conversion: summary.callToBookingRate },
    { source: t.followups, value: followUps, conversion: 0 },
    { source: t.escalationsRecovered, value: summary.totalEscalations, conversion: 0 },
    { source: t.websiteManual, value: 0, conversion: 0 },
  ];
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <DashboardPanel title={t.topSources}>
      <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 520, display: "grid", gap: 8 }}>
          <TableHeader columns={[t.source, t.reservations, t.share, t.conversion]} />
          {rows.map((row) => (
            <div key={row.source} style={tableRowStyle}>
              <span style={firstCellStyle}>{row.source}</span>
              <span style={cellStyle}>{formatInteger(row.value)}</span>
              <span style={cellStyle}><Progress value={(row.value / max) * 100} /></span>
              <span style={cellStyle}>{row.conversion ? formatPercent(row.conversion) : "0%"}</span>
            </div>
          ))}
        </div>
      </div>
    </DashboardPanel>
  );
}

function UpcomingReservationsCard({ t }: { t: (typeof dashboardText)[Lang] }) {
  return (
    <DashboardPanel title={t.upcoming}>
      <EmptyState text={t.noUpcoming} />
    </DashboardPanel>
  );
}

function QuickActionsCard({ t, range, lang }: { t: (typeof dashboardText)[Lang]; range: string; lang: Lang }) {
  const actions = [
    { label: t.viewCalendar, href: "/restaurant-analytics/overview" },
    { label: t.manageReservations, href: "/restaurant-analytics/overview" },
    { label: t.viewFollowups, href: "/restaurant-analytics/quality" },
    { label: t.viewEscalations, href: "/restaurant-analytics/handoffs" },
  ];

  return (
    <DashboardPanel title={t.quickActions}>
      <div style={{ display: "grid", gap: 8 }}>
        {actions.map((action) => (
          <Link key={action.label} href={action.href} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(7,17,31,0.38)", borderRadius: 13, padding: "12px 13px", color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
            {action.label}
            <span style={{ color: AC_TEXT }}>→</span>
          </Link>
        ))}
        <ExportReportButton label={t.exportReport} range={range} lang={lang} variant="row" />
      </div>
    </DashboardPanel>
  );
}

function WeeklySummaryBanner({ summary, revenueMetrics, proVisible, t }: { summary: DashboardSummary; revenueMetrics: ReturnType<typeof buildRevenueMetrics>; proVisible: boolean; t: (typeof dashboardText)[Lang] }) {
  const items = proVisible
    ? [
        { label: t.conversionRate, value: formatPercent(summary.callToBookingRate) },
        { label: t.quotaUsage, value: formatPercent(summary.quotaUsagePercent) },
        { label: t.estimatedRevenue, value: formatRevenueSet(revenueMetrics.estimated) || t.notAvailable },
        { label: t.recoveredRevenue, value: formatRevenueSet(revenueMetrics.recovered) || t.notAvailable },
      ]
    : [
        { label: t.calls, value: formatInteger(summary.totalCalls) },
        { label: t.reservations, value: formatInteger(summary.totalReservations) },
        { label: t.conversion, value: formatPercent(summary.callToBookingRate) },
        { label: t.revenueAnalytics, value: t.upgrade },
      ];

  return (
    <section style={{ border: `1px solid ${AC_BORDER}`, background: "linear-gradient(135deg, rgba(245,158,11,0.14), rgba(255,255,255,0.035))", borderRadius: 22, padding: 20, display: "grid", gridTemplateColumns: "minmax(200px, 0.8fr) repeat(4, minmax(0, 1fr))", gap: 16, alignItems: "center", minHeight: "100%" }} className="dashboard-weekly-banner">
      <div>
        <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{t.weekly}</p>
        <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 20, marginBottom: 5 }}>{t.weeklyTitle}</h2>
        <p style={{ color: "rgba(255,255,255,0.52)", fontSize: 13, lineHeight: 1.5 }}>{t.weeklyDetail}</p>
      </div>
      {items.map((item) => (
        <div key={item.label} style={{ borderLeft: "1px solid rgba(255,255,255,0.10)", paddingLeft: 14 }}>
          <p style={{ color: "rgba(255,255,255,0.44)", fontSize: 12, marginBottom: 7 }}>{item.label}</p>
          <p style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em" }}>{item.value}</p>
        </div>
      ))}
    </section>
  );
}

function UpsellCard({ plan, compact = false, t }: { plan: PlanTier; compact?: boolean; t: (typeof dashboardText)[Lang] }) {
  const isGrowth = plan === "growth";

  return (
    <section style={{ border: `1px solid ${AC_BORDER}`, background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(255,255,255,0.03))", borderRadius: 20, padding: compact ? 18 : 20, minHeight: "100%", boxSizing: "border-box" }}>
      <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 9 }}>
        {t.upsell}
      </p>
      <h3 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 18, marginBottom: 8 }}>{t.upsellTitle}</h3>
      <p style={{ color: "rgba(255,255,255,0.58)", fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
        {isGrowth
          ? t.growthUpsell
          : t.proUpsell}
      </p>
      <ActionButton href="/agent/restaurant-call-assistant#pricing" label={isGrowth ? t.upgrade : t.explorePremium} />
    </section>
  );
}

function LockedFeatureCard({ title, text, cta, t }: { title: string; text: string; cta: string; t: (typeof dashboardText)[Lang] }) {
  return (
    <section style={{ ...cardStyle, borderColor: AC_BORDER, background: "rgba(245,158,11,0.06)" }}>
      <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>{t.locked}</p>
      <h3 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 18, marginBottom: 8 }}>{title}</h3>
      <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>{text}</p>
      <ActionButton href="/agent/restaurant-call-assistant#pricing" label={cta} />
    </section>
  );
}

function MultiLocationComparison({ summary, t }: { summary: DashboardSummary; t: (typeof dashboardText)[Lang] }) {
  return (
    <DashboardPanel title={t.multiLocation} action={t.premium}>
      {summary.locations.length > 1 ? (
        <div style={{ display: "grid", gap: 10 }}>
          {summary.locations.map((location) => (
            <div key={location.id ?? location.name} style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(7,17,31,0.42)", borderRadius: 14, padding: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <strong style={{ color: "#f0f0ef", fontSize: 13 }}>{location.name}</strong>
                <span style={{ color: AC_TEXT, fontSize: 12, fontWeight: 800 }}>{formatPercent(location.conversionRate)}</span>
              </div>
              <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 12.5 }}>{formatInteger(location.calls)} {t.calls.toLowerCase()} · {formatInteger(location.reservations)} {t.reservations.toLowerCase()} · {formatInteger(location.escalations)} {t.escalations.toLowerCase()}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text={t.noMulti} />
      )}
    </DashboardPanel>
  );
}

function PremiumOperationsCard({ t }: { t: (typeof dashboardText)[Lang] }) {
  return (
    <DashboardPanel title={t.customReporting} action={t.premium}>
      <div className="dashboard-three-col" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {t.customItems.map((item) => (
          <div key={item} style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(7,17,31,0.42)", borderRadius: 14, padding: 14 }}>
            <p style={{ color: AC_TEXT, fontSize: 12, fontWeight: 800, marginBottom: 7 }}>{t.premium}</p>
            <p style={{ color: "rgba(255,255,255,0.70)", fontSize: 13 }}>{item}</p>
          </div>
        ))}
      </div>
    </DashboardPanel>
  );
}

function DashboardPanel({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return (
    <section style={{ ...cardStyle, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h2 className="dashboard-card-title" style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 20 }}>{title}</h2>
        {action && <span style={{ color: AC_TEXT, background: AC_DIM, border: `1px solid ${AC_BORDER}`, borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 800 }}>{action}</span>}
      </div>
      {children}
    </section>
  );
}

function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 38, padding: "10px 14px", borderRadius: 999, background: AC, color: "#160b02", fontSize: 12.5, fontWeight: 900, textDecoration: "none", boxShadow: "0 8px 28px rgba(245,158,11,0.20)" }}>
      {label}
    </Link>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ border: "1px dashed rgba(255,255,255,0.14)", borderRadius: 16, padding: 18, minHeight: 118, display: "grid", placeItems: "center", textAlign: "center", color: "rgba(255,255,255,0.46)", fontSize: 13 }}>
      {text}
    </div>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <span style={{ display: "block", height: 8, width: "100%", borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
      <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, value))}%`, borderRadius: 999, background: AC }} />
    </span>
  );
}

function TableHeader({ columns }: { columns: string[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.25fr repeat(3, minmax(90px, 0.7fr))", gap: 12, padding: "0 12px 3px" }}>
      {columns.map((column, index) => (
        <span key={column} style={{ color: "rgba(255,255,255,0.32)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: index === 0 ? "left" : "right" }}>
          {column}
        </span>
      ))}
    </div>
  );
}

function ErrorState({ message, t }: { message: string; t: (typeof dashboardText)[Lang] }) {
  return (
    <section style={{ border: "1px solid rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.08)", borderRadius: 22, padding: 22, boxShadow: "0 22px 80px rgba(0,0,0,0.18)" }}>
      <p style={{ color: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>{t.unavailable}</p>
      <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 22, marginBottom: 8 }}>{t.loadError}</h2>
      <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.65, maxWidth: 720 }}>{message}</p>
    </section>
  );
}

const pillStyle: React.CSSProperties = {
  borderRadius: 999,
  padding: "9px 13px",
  fontSize: 12,
  fontWeight: 800,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 38,
};

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  background: CARD_BG,
  borderRadius: 20,
  padding: 18,
  boxShadow: "0 20px 70px rgba(0,0,0,0.18)",
};

const tableRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.25fr repeat(3, minmax(90px, 0.7fr))",
  gap: 12,
  alignItems: "center",
  border: "1px solid rgba(255,255,255,0.07)",
  background: PANEL_BG,
  borderRadius: 13,
  padding: "11px 12px",
};

const firstCellStyle: React.CSSProperties = {
  color: "#f0f0ef",
  fontSize: 13,
  fontWeight: 700,
};

const cellStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.66)",
  fontSize: 13,
  fontWeight: 600,
  textAlign: "right",
};
