import AnalyticsKpiCard, { type AnalyticsKpiCardProps } from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard, {
  ANALYTICS_ACCENT_TEXT,
} from "@/components/restaurant-analytics/AnalyticsSectionCard";
import CallsByLocationTable, { type CallsByLocationRow } from "@/components/restaurant-analytics/CallsByLocationTable";
import CallsByTenantTable, { type CallsByTenantRow } from "@/components/restaurant-analytics/CallsByTenantTable";
import OverviewHeaderActions from "@/components/restaurant-analytics/OverviewHeaderActions";
import { enrichLocationNames, enrichTenantNames } from "@/lib/restaurant-analytics/name-enrichment";
import { requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { restaurantCommonCopy, type RestaurantLang } from "@/lib/restaurant-language";
import { getRestaurantServerCopy } from "@/lib/restaurant-language-server";
import { createSupabaseClient } from "@/lib/supabase";
import type { UserContext, UserRole } from "@/lib/userContext";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type AnalyticsRow = Record<string, unknown>;

type BusinessInsight = {
  label: string;
  value: string;
  detail: string;
  tone: "warning" | "danger" | "accent" | "good";
};

type OverviewCopy = (typeof restaurantCommonCopy)[RestaurantLang]["dashboard"]["overview"];

const DATE_RANGE_PRESETS = {
  "7d": { key: "7d", label: "Last 7 days", days: 7 },
  "30d": { key: "30d", label: "Last 30 days", days: 30 },
  "90d": { key: "90d", label: "Last 90 days", days: 90 },
} as const;

type DateRangePresetKey = keyof typeof DATE_RANGE_PRESETS;
type DateRangePreset = (typeof DATE_RANGE_PRESETS)[DateRangePresetKey];

const DEFAULT_DATE_RANGE: DateRangePresetKey = "30d";
const DATE_FILTER_COLUMNS = ["period_start", "period_date", "date", "day", "call_date", "created_at", "started_at"] as const;

type OverviewPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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

function percentOf(part: number, total: number) {
  if (!total) return 0;
  return (part / total) * 100;
}

function resolveDateRangePreset(value: string | string[] | undefined): DateRangePreset {
  const key = Array.isArray(value) ? value[0] : value;

  if (key && key in DATE_RANGE_PRESETS) {
    return DATE_RANGE_PRESETS[key as DateRangePresetKey];
  }

  return DATE_RANGE_PRESETS[DEFAULT_DATE_RANGE];
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

function isRateKey(key: string) {
  return /rate/i.test(key);
}

function aggregateRows(rows: AnalyticsRow[]): AnalyticsRow {
  if (rows.length <= 1) return rows[0] ?? {};

  const aggregate: AnalyticsRow = {};

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (isRateKey(key)) continue;

      if (typeof value === "number" && Number.isFinite(value)) {
        aggregate[key] = readNumber(aggregate, [key]) + value;
        continue;
      }

      if (typeof value === "string" && value.trim()) {
        const numeric = Number(value);

        if (Number.isFinite(numeric)) {
          aggregate[key] = readNumber(aggregate, [key]) + numeric;
          continue;
        }

        if (!aggregate[key]) aggregate[key] = value;
        continue;
      }

      if (typeof value === "boolean" && aggregate[key] === undefined) {
        aggregate[key] = value;
      }
    }
  }

  return aggregate;
}

function aggregateRowsByKey(rows: AnalyticsRow[], keys: string[]) {
  const groups = new Map<string, AnalyticsRow[]>();

  rows.forEach((row, index) => {
    const key = readString(row, keys, `row-${index}`);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  return Array.from(groups.values()).map(aggregateRows);
}

function buildKpis(overview: AnalyticsRow, copy?: OverviewCopy): AnalyticsKpiCardProps[] {
  const totalCalls = readNumber(overview, ["total_calls", "totalCalls", "calls_total"]);
  const totalCompleted = readNumber(overview, ["total_completed", "total_completed_calls", "completed_calls", "completedCalls"]);
  const totalEscalations = readNumber(overview, ["total_escalations", "escalations", "escalation_calls", "escalationCalls"]);
  const totalFallbacks = readNumber(overview, ["total_fallbacks", "fallbacks", "fallback_calls", "fallbackCalls"]);

  return [
    {
      label: copy?.totalCalls ?? "Total Calls",
      value: formatInteger(totalCalls),
      trend: "Live",
      detail: copy?.totalCallsDetail ?? "Inbound calls received across all restaurant tenants and locations.",
      tone: "neutral",
    },
    {
      label: copy?.completedCalls ?? "Completed Calls",
      value: formatInteger(totalCompleted),
      trend: formatPercent(percentOf(totalCompleted, totalCalls)),
      detail: copy?.completedCallsDetail ?? "Calls resolved without needing manual staff intervention.",
      tone: "good",
    },
    {
      label: copy?.escalations ?? "Escalations",
      value: formatInteger(totalEscalations),
      trend: formatPercent(percentOf(totalEscalations, totalCalls)),
      detail: copy?.escalationsDetail ?? "Human handoffs created with routing context and priority.",
      tone: "warning",
    },
    {
      label: copy?.fallbacks ?? "Fallbacks",
      value: formatInteger(totalFallbacks),
      trend: formatPercent(percentOf(totalFallbacks, totalCalls)),
      detail: copy?.fallbacksDetail ?? "Calls that required fallback handling because data or confidence was insufficient.",
      tone: "danger",
    },
  ];
}

function mapTenantRow(row: AnalyticsRow): CallsByTenantRow {
  const totalCalls = readNumber(row, ["total_calls", "totalCalls", "calls_total"]);
  const completedCalls = readNumber(row, ["total_completed", "total_completed_calls", "completed_calls", "completedCalls"]);
  const escalations = readNumber(row, ["total_escalations", "escalations", "escalation_calls", "escalationCalls"]);
  const autoHandledRate = readNumber(row, ["auto_handled_rate", "autoHandledRate"], percentOf(completedCalls, totalCalls));

  return {
    tenantId: readString(row, ["tenant_id", "tenantId", "id"]) || undefined,
    tenantName: readString(row, ["tenant_name", "tenantName", "tenant_display_name", "display_name", "name", "tenant_slug"], "Unknown tenant"),
    totalCalls,
    completedCalls,
    escalations,
    autoHandledRate: Math.round(autoHandledRate),
  };
}

function mapLocationRow(row: AnalyticsRow): CallsByLocationRow {
  const totalCalls = readNumber(row, ["total_calls", "totalCalls", "calls_total"]);
  const fallbacks = readNumber(row, ["total_fallbacks", "fallbacks", "fallback_calls", "fallbackCalls"]);
  const handoffs = readNumber(row, ["total_escalations", "escalations", "handoffs", "handoff_calls"]);

  return {
    locationId: readString(row, ["location_id", "locationId", "id"]) || undefined,
    locationName: readString(row, ["location_name", "locationName", "location_display_name", "display_name", "name", "location_slug"], "Unknown location"),
    totalCalls,
    bookings: readNumber(row, ["bookings", "total_bookings", "booking_calls", "completed_bookings"]),
    fallbackRate: Number(readNumber(row, ["fallback_rate", "fallbackRate"], percentOf(fallbacks, totalCalls)).toFixed(1)),
    handoffRate: Number(readNumber(row, ["handoff_rate", "handoffRate", "escalation_rate"], percentOf(handoffs, totalCalls)).toFixed(1)),
  };
}

function buildBusinessInsights(overview: AnalyticsRow, copy?: OverviewCopy): BusinessInsight[] {
  const totalCalls = readNumber(overview, ["total_calls", "totalCalls", "calls_total"]);
  const totalFallbacks = readNumber(overview, ["total_fallbacks", "fallbacks", "fallback_calls", "fallbackCalls"]);
  const totalEscalations = readNumber(overview, ["total_escalations", "escalations", "escalation_calls", "escalationCalls"]);
  const frustratedCustomers = readNumber(overview, ["frustrated_customers", "frustrated_customers_detected", "negative_sentiment_calls"]);
  const followUps = readNumber(overview, ["calls_needing_follow_up", "follow_up_calls", "needs_follow_up"]);

  return [
    {
      label: copy?.topEscalationReasons ?? "Top escalation reasons",
      value: readString(overview, ["top_escalation_reason", "topEscalationReason"], totalEscalations ? (copy?.needsReview ?? "Needs review") : (copy?.noEscalations ?? "No escalations")),
      detail: "Highest-volume driver of human handoff across the selected operating scope.",
      tone: "warning",
    },
    {
      label: copy?.fallbackMissed ?? "Fallback / missed opportunities",
      value: formatInteger(totalFallbacks),
      detail: `${formatPercent(percentOf(totalFallbacks, totalCalls))} of calls needed fallback logic or could represent blocked conversion.`,
      tone: "danger",
    },
    {
      label: copy?.frustrated ?? "Frustrated customers detected",
      value: formatInteger(frustratedCustomers),
      detail: "Calls flagged for negative sentiment, urgency, repeated correction, or complaint language.",
      tone: "accent",
    },
    {
      label: copy?.followUp ?? "Calls needing follow-up",
      value: formatInteger(followUps),
      detail: "Open callbacks, CRM updates, manager reviews, or guest confirmations.",
      tone: "good",
    },
  ];
}

type OverviewDataResult =
  | { ok: true; overview: AnalyticsRow; tenants: AnalyticsRow[]; locations: AnalyticsRow[] }
  | { ok: false; error: string };

async function fetchAnalyticsRows(
  supabase: SupabaseClient,
  table: "analytics_calls_overview" | "analytics_calls_by_tenant" | "analytics_calls_by_location",
  userContext: UserContext,
  dateRange: DateRangePreset
) {
  const since = getDateRangeStart(dateRange);
  let lastError = "";

  for (const column of DATE_FILTER_COLUMNS) {
    let query = supabase.from(table).select("*").gte(column, since);

    if (userContext.role === "tenant") {
      query = query.eq("tenant_id", userContext.tenantId);
    }

    const result = await query.returns<AnalyticsRow[]>();

    if (!result.error) {
      return result.data ?? [];
    }

    lastError = result.error.message;

    if (!isMissingDateColumnError(result.error.message)) {
      throw new Error(result.error.message);
    }
  }

  let fallbackQuery = supabase.from(table).select("*");

  if (userContext.role === "tenant") {
    fallbackQuery = fallbackQuery.eq("tenant_id", userContext.tenantId);
  }

  const fallbackResult = await fallbackQuery.returns<AnalyticsRow[]>();

  if (fallbackResult.error) {
    throw new Error(lastError || fallbackResult.error.message);
  }

  return fallbackResult.data ?? [];
}

async function getOverviewData(userContext: UserContext, dateRange: DateRangePreset): Promise<OverviewDataResult> {
  try {
    const supabase = createSupabaseClient();

    const [overviewRows, tenantRows, locationRows] = await Promise.all([
      fetchAnalyticsRows(supabase, "analytics_calls_overview", userContext, dateRange),
      fetchAnalyticsRows(supabase, "analytics_calls_by_tenant", userContext, dateRange),
      fetchAnalyticsRows(supabase, "analytics_calls_by_location", userContext, dateRange),
    ]);

    if (!overviewRows.length) {
      return { ok: false, error: "analytics_calls_overview returned no rows." };
    }

    return {
      ok: true,
      overview: aggregateRows(overviewRows),
      tenants: await enrichTenantNames(supabase, aggregateRowsByKey(tenantRows, ["tenant_id", "tenantId", "id"])),
      locations: await enrichLocationNames(supabase, aggregateRowsByKey(locationRows, ["location_id", "locationId", "id"])),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export default async function RestaurantAnalyticsOverviewPage({ searchParams }: OverviewPageProps) {
  const params = searchParams ? await searchParams : {};
  const dateRange = resolveDateRangePreset(params.range);
  const userContext = await requireDashboardUserContext();
  const { copy } = await getRestaurantServerCopy();
  const tenantDashboardCopy = userContext.role === "tenant" ? copy.dashboard : null;
  const tenantOverviewCopy = tenantDashboardCopy?.overview;
  const result = await getOverviewData(userContext, dateRange);
  const isTenant = userContext.role === "tenant";

  if (!result.ok) {
    return (
      <div style={{ maxWidth: 1220, margin: "0 auto" }}>
        <DashboardHeader status="Error" role={userContext.role} dateRange={dateRange} copy={tenantOverviewCopy} />
        <ErrorState message={result.error} title={tenantOverviewCopy?.loadErrorTitle} eyebrow={tenantOverviewCopy?.unavailable} />
      </div>
    );
  }

  const kpis = buildKpis(result.overview, tenantOverviewCopy ?? undefined);
  const tenantRows = result.tenants.map(mapTenantRow);
  const locationRows = result.locations.map(mapLocationRow);
  const businessInsights = buildBusinessInsights(result.overview, tenantOverviewCopy ?? undefined);

  return (
    <div className="dashboard-page" style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardHeader status="Live data" role={userContext.role} dateRange={dateRange} copy={tenantOverviewCopy} />

      <section className="dashboard-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
        {kpis.map((kpi) => (
          <AnalyticsKpiCard key={kpi.label} {...kpi} />
        ))}
      </section>

      <AnalyticsSectionCard
        title={tenantOverviewCopy?.businessInsights ?? "Business Insights"}
        eyebrow={tenantOverviewCopy?.revenueProtection ?? "Revenue protection"}
        description={tenantOverviewCopy?.businessDescription ?? "Signals that help operators understand where calls turn into risk, missed bookings, frustration, or staff follow-up."}
        tone="accent"
      >
        <BusinessInsightsGrid insights={businessInsights} />
      </AnalyticsSectionCard>

      <section className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, marginTop: 18 }}>
        {!isTenant && (
          <AnalyticsSectionCard
            title="Calls by Tenant"
            eyebrow="Tenant performance"
            description="Real data from analytics_calls_by_tenant."
            action={<span style={{ color: ANALYTICS_ACCENT_TEXT, fontSize: 12, fontWeight: 700 }}>Supabase</span>}
          >
            <CallsByTenantTable rows={tenantRows} />
          </AnalyticsSectionCard>
        )}

        <AnalyticsSectionCard
          title={tenantOverviewCopy?.locationsTitle ?? (isTenant ? "Your Locations" : "Calls by Location")}
          eyebrow={tenantOverviewCopy?.locationEyebrow ?? "Location analytics"}
          description={tenantOverviewCopy?.locationDescription ?? (isTenant ? "Location-level performance filtered to your restaurant tenant." : "Real data from analytics_calls_by_location.")}
          action={isTenant ? null : <span style={{ color: ANALYTICS_ACCENT_TEXT, fontSize: 12, fontWeight: 700 }}>Supabase</span>}
        >
          <CallsByLocationTable
            rows={locationRows}
            headers={
              tenantOverviewCopy
                ? [tenantOverviewCopy.locationsTitle, tenantOverviewCopy.totalCalls, tenantOverviewCopy.bookingsHeader, tenantOverviewCopy.reviewHeader, tenantOverviewCopy.escalations]
                : undefined
            }
          />
        </AnalyticsSectionCard>
      </section>
    </div>
  );
}

function DashboardHeader({
  status,
  role,
  dateRange,
  copy,
}: {
  status: string;
  role: UserRole;
  dateRange: DateRangePreset;
  copy?: OverviewCopy | null;
}) {
  const isTenant = role === "tenant";

  return (
    <header className="dashboard-page" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginBottom: 28, flexWrap: "wrap" }}>
      <div style={{ maxWidth: 760 }}>
        <p style={{ color: ANALYTICS_ACCENT_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
          {copy?.eyebrow ?? "Restaurant analytics"}
        </p>
        <h1 className="dashboard-page-title" style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(2rem, 4vw, 3.25rem)", lineHeight: 1.05, letterSpacing: "-0.04em", color: "#f0f0ef", marginBottom: 12 }}>
          {copy?.title ?? (isTenant ? "Your restaurant performance" : "Operations overview")}
        </h1>
        <p className="dashboard-page-copy" style={{ color: "rgba(255,255,255,0.56)", fontSize: 15.5, lineHeight: 1.7 }}>
          {isTenant
            ? (copy?.text ?? "Live your analytics filtered to your restaurant, including call volume, completed calls, escalations, fallbacks, and location-level demand.")
            : "Live your analytics for total calls, completed calls, escalations, fallbacks, tenant performance, and location-level demand."}
        </p>
      </div>

      <OverviewHeaderActions role={role} status={status} dateRangeKey={dateRange.key} dateRangeLabel={dateRange.label} />
    </header>
  );
}

function BusinessInsightsGrid({ insights }: { insights: BusinessInsight[] }) {
  return (
    <div className="dashboard-three-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
      {insights.map((insight) => {
        const color =
          insight.tone === "danger"
            ? "#F87171"
            : insight.tone === "warning"
              ? ANALYTICS_ACCENT_TEXT
              : insight.tone === "good"
                ? "#34D399"
                : "#FBBF24";

        return (
          <div
            className="dashboard-mini-kpi"
            key={insight.label}
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(7,17,31,0.50)",
              borderRadius: 16,
              padding: 16,
              minWidth: 0,
            }}
          >
            <p
              style={{
                color: "rgba(255,255,255,0.40)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              {insight.label}
            </p>
            <p style={{ color, fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em", marginBottom: 8 }}>
              {insight.value}
            </p>
            <p style={{ color: "rgba(255,255,255,0.58)", fontSize: 13, lineHeight: 1.6 }}>
              {insight.detail}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function ErrorState({ message, title, eyebrow }: { message: string; title?: string; eyebrow?: string }) {
  return (
    <section
      style={{
        border: "1px solid rgba(248,113,113,0.28)",
        background: "rgba(248,113,113,0.08)",
        borderRadius: 22,
        padding: 22,
        boxShadow: "0 22px 80px rgba(0,0,0,0.18)",
      }}
    >
      <p style={{ color: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
        {eyebrow ?? "Analytics unavailable"}
      </p>
      <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 22, marginBottom: 8 }}>
        {title ?? "Could not load the overview data."}
      </h2>
      <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.65, maxWidth: 720 }}>
        {message}
      </p>
    </section>
  );
}
