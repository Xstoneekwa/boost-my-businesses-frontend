import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsKpiCard from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { formatInteger, formatPercent, readBoolean, readNumber, readString } from "@/lib/restaurant-analytics/data";
import { requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import ConversionTimelineChart from "./ConversionTimelineChart";

export const dynamic = "force-dynamic";

type PeriodValue = "today" | "7d" | "30d";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

type ConversionTimeseriesRow = {
  day?: unknown;
  links_sent?: unknown;
  clicks?: unknown;
  link_clicks?: unknown;
  bookings?: unknown;
  demos_booked?: unknown;
};

type ConversionSpeedRow = {
  average_minutes_to_convert?: unknown;
  avg_minutes_to_convert?: unknown;
  average_minutes_to_booking?: unknown;
  avg_minutes_to_booking?: unknown;
  minutes_to_convert?: unknown;
};

type ProspectFunnelRow = {
  prospect_id?: unknown;
  link_sent_at?: unknown;
  first_clicked_at?: unknown;
  booked_at?: unknown;
  link_sent?: unknown;
  clicked?: unknown;
  booked?: unknown;
};

type FunnelMetrics = {
  linksSent: number;
  linkClicks: number;
  demosBooked: number;
  clickRatePercent: number;
  bookingRatePercent: number;
};

export type ConversionTimelinePoint = {
  day: string;
  links_sent: number;
  clicks: number;
  bookings: number;
};

type ProspectFunnelItem = {
  prospectId: string;
  linkSent: boolean;
  clicked: boolean;
  booked: boolean;
  linkSentAt: string;
  firstClickedAt: string;
  bookedAt: string;
};

type LeadsTrackingDataResult =
  | {
      ok: true;
      metrics: FunnelMetrics;
      timeline: ConversionTimelinePoint[];
      prospects: ProspectFunnelItem[];
      averageMinutesToConvert: number | null;
    }
  | { ok: false; error: string };

const periodOptions: Array<{ value: PeriodValue; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const emptyMetrics: FunnelMetrics = {
  linksSent: 0,
  linkClicks: 0,
  demosBooked: 0,
  clickRatePercent: 0,
  bookingRatePercent: 0,
};

function normalizePeriod(value: string | string[] | undefined): PeriodValue {
  const raw = Array.isArray(value) ? value[0] : value;

  if (raw === "today" || raw === "30d") {
    return raw;
  }

  return "7d";
}

function getPeriodStart(period: PeriodValue) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);

  if (period === "7d") {
    date.setDate(date.getDate() - 6);
  }

  if (period === "30d") {
    date.setDate(date.getDate() - 29);
  }

  return date;
}

function getPeriodLabel(period: PeriodValue) {
  return periodOptions.find((option) => option.value === period)?.label ?? "Last 7 days";
}

function mapTimelinePoint(row: ConversionTimeseriesRow): ConversionTimelinePoint {
  const day = readString(row, ["day"]);

  return {
    day: day ? formatChartDay(day) : "Unknown",
    links_sent: readNumber(row, ["links_sent"]),
    clicks: readNumber(row, ["clicks", "link_clicks"]),
    bookings: readNumber(row, ["bookings", "demos_booked"]),
  };
}

function buildMetricsFromTimeline(rows: ConversionTimelinePoint[]): FunnelMetrics {
  const linksSent = rows.reduce((sum, row) => sum + row.links_sent, 0);
  const linkClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const demosBooked = rows.reduce((sum, row) => sum + row.bookings, 0);

  if (!linksSent) {
    return emptyMetrics;
  }

  return {
    linksSent,
    linkClicks,
    demosBooked,
    clickRatePercent: (linkClicks / linksSent) * 100,
    bookingRatePercent: (demosBooked / linksSent) * 100,
  };
}

function readAverageMinutes(row: ConversionSpeedRow | null | undefined) {
  if (!row) return null;

  const value = readNumber(
    row,
    ["average_minutes_to_convert", "avg_minutes_to_convert", "average_minutes_to_booking", "avg_minutes_to_booking", "minutes_to_convert"],
    Number.NaN,
  );

  return Number.isFinite(value) ? value : null;
}

function formatChartDay(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMinutes(value: number | null) {
  if (value === null) return "N/A";
  if (value < 60) return `${Math.round(value)}m`;

  const hours = value / 60;
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
}

function mapProspect(row: ProspectFunnelRow, index: number): ProspectFunnelItem {
  const linkSentAt = readString(row, ["link_sent_at"]);
  const firstClickedAt = readString(row, ["first_clicked_at"]);
  const bookedAt = readString(row, ["booked_at"]);

  return {
    prospectId: readString(row, ["prospect_id"], `prospect_${index + 1}`),
    linkSent: readBoolean(row, ["link_sent"]),
    clicked: readBoolean(row, ["clicked"]),
    booked: readBoolean(row, ["booked"]),
    linkSentAt: linkSentAt ? formatDateTime(linkSentAt) : "—",
    firstClickedAt: firstClickedAt ? formatDateTime(firstClickedAt) : "—",
    bookedAt: bookedAt ? formatDateTime(bookedAt) : "—",
  };
}

function isRecoverableSupabaseError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("column") || normalized.includes("does not exist") || normalized.includes("schema cache");
}

async function fetchConversionSpeed(supabase: ReturnType<typeof createSupabaseClient>, sinceDate: string) {
  const filterColumns = ["day", "booked_at", "booking_day", "converted_at"];
  let lastRecoverableError = "";

  for (const column of filterColumns) {
    const { data, error } = await supabase
      .from("restaurant_conversion_speed")
      .select("*")
      .gte(column, sinceDate)
      .limit(1)
      .returns<ConversionSpeedRow[]>();

    if (!error) return data?.[0] ?? null;

    if (!isRecoverableSupabaseError(error.message)) {
      throw new Error(error.message);
    }

    lastRecoverableError = error.message;
  }

  const { data, error } = await supabase.from("restaurant_conversion_speed").select("*").limit(1).returns<ConversionSpeedRow[]>();

  if (error && !lastRecoverableError) {
    throw new Error(error.message);
  }

  if (error && !isRecoverableSupabaseError(error.message)) {
    throw new Error(error.message);
  }

  return data?.[0] ?? null;
}

async function getLeadsTrackingData(period: PeriodValue): Promise<LeadsTrackingDataResult> {
  try {
    const userContext = await requireDashboardUserContext();

    if (userContext.role !== "superadmin") {
      notFound();
    }

    const supabase = createSupabaseClient();
    const since = getPeriodStart(period);
    const sinceDate = since.toISOString().slice(0, 10);
    const sinceDateTime = since.toISOString();

    const [timelineResult, speedRow, prospectsResult] = await Promise.all([
      supabase
        .from("restaurant_conversion_timeseries")
        .select("*")
        .gte("day", sinceDate)
        .order("day", { ascending: true })
        .returns<ConversionTimeseriesRow[]>(),
      fetchConversionSpeed(supabase, sinceDate),
      supabase
        .from("restaurant_prospect_funnel")
        .select("*")
        .gte("link_sent_at", sinceDateTime)
        .order("link_sent_at", { ascending: false, nullsFirst: false })
        .limit(50)
        .returns<ProspectFunnelRow[]>(),
    ]);

    if (timelineResult.error) {
      throw new Error(timelineResult.error.message);
    }

    if (prospectsResult.error) {
      throw new Error(prospectsResult.error.message);
    }

    const timeline = (timelineResult.data ?? []).map(mapTimelinePoint);

    return {
      ok: true,
      metrics: buildMetricsFromTimeline(timeline),
      timeline,
      prospects: (prospectsResult.data ?? []).map(mapProspect),
      averageMinutesToConvert: readAverageMinutes(speedRow),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export default async function RestaurantAnalyticsLeadsTrackingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const period = normalizePeriod((await searchParams).period);

  return (
    <div className="dashboard-page" style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardPageHeader
        eyebrow="Internal prospecting"
        title="Leads Tracking"
        description="Admin-only conversion tracking for AI Restaurant Call Assistant prospecting."
        badges={["Private admin view", "Live data"]}
        action={<DateFilter selectedPeriod={period} />}
      />

      <Suspense key={period} fallback={<LoadingState />}>
        <LeadsTrackingContent period={period} />
      </Suspense>
    </div>
  );
}

async function LeadsTrackingContent({ period }: { period: PeriodValue }) {
  const result = await getLeadsTrackingData(period);
  const selectedPeriodLabel = getPeriodLabel(period);

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  const hasProspectingData =
    result.prospects.length > 0 ||
    result.timeline.length > 0 ||
    result.metrics.linksSent > 0 ||
    result.metrics.linkClicks > 0 ||
    result.metrics.demosBooked > 0;

  if (!hasProspectingData) {
    return <EmptyState title="No prospecting data yet." text="Once prospect links are sent, clicked, or booked, the funnel will appear here." />;
  }

  return (
    <>
      <section className="dashboard-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
        <AnalyticsKpiCard label="Links Sent" value={formatInteger(result.metrics.linksSent)} trend={selectedPeriodLabel} detail="Based on selected period" />
        <AnalyticsKpiCard label="Link Clicks" value={formatInteger(result.metrics.linkClicks)} trend={selectedPeriodLabel} detail="Based on selected period" tone="good" />
        <AnalyticsKpiCard label="Demos Booked" value={formatInteger(result.metrics.demosBooked)} trend={selectedPeriodLabel} detail="Based on selected period" tone="good" />
        <AnalyticsKpiCard label="Click Rate" value={formatPercent(result.metrics.clickRatePercent)} trend={selectedPeriodLabel} detail="Based on selected period" tone="warning" />
        <AnalyticsKpiCard label="Booking Rate" value={formatPercent(result.metrics.bookingRatePercent)} trend={selectedPeriodLabel} detail="Based on selected period" tone="warning" />
        <AnalyticsKpiCard label="Avg Time to Booking" value={formatMinutes(result.averageMinutesToConvert)} trend={selectedPeriodLabel} detail="Based on selected period" tone="neutral" />
      </section>

      <div style={{ display: "grid", gap: 18 }}>
        <AnalyticsSectionCard
          title="Conversion Timeline"
          eyebrow="Daily funnel"
          description="Links sent, clicks, and bookings from restaurant_conversion_timeseries."
        >
          {result.timeline.length ? (
            <ConversionTimelineChart data={result.timeline} />
          ) : (
            <EmptyState title="No prospecting data yet." text="The conversion timeseries returned no rows for the selected period." />
          )}
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          title="Recent Prospect Funnel"
          eyebrow="Prospect activity"
          description="Latest prospect-level conversion states from restaurant_prospect_funnel."
        >
          {result.prospects.length ? (
            <ProspectFunnelTable rows={result.prospects} />
          ) : (
            <EmptyState title="No prospecting data yet." text="The prospect funnel view returned no rows for the selected period." />
          )}
        </AnalyticsSectionCard>
      </div>
    </>
  );
}

function DateFilter({ selectedPeriod }: { selectedPeriod: PeriodValue }) {
  return (
    <div
      className="mobile-inline-actions"
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        justifyContent: "flex-end",
      }}
    >
      {periodOptions.map((option) => {
        const isActive = option.value === selectedPeriod;

        return (
          <Link
            key={option.value}
            href={`/restaurant-analytics/leads-tracking?period=${option.value}`}
            style={{
              border: isActive ? "1px solid rgba(245,158,11,0.55)" : "1px solid rgba(255,255,255,0.08)",
              background: isActive ? "#F59E0B" : "rgba(255,255,255,0.035)",
              color: isActive ? "#160b02" : "rgba(255,255,255,0.70)",
              borderRadius: 999,
              padding: "9px 13px",
              fontSize: 12,
              fontWeight: 800,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

function ProspectFunnelTable({ rows }: { rows: ProspectFunnelItem[] }) {
  const headers = ["Prospect ID", "Link Sent", "Clicked", "Booked", "Link Sent At", "First Clicked At", "Booked At"];

  return (
    <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 920, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr repeat(3, minmax(86px, 0.55fr)) repeat(3, minmax(132px, 0.9fr))", gap: 12, padding: "0 14px 4px" }}>
          {headers.map((label, index) => (
            <span
              key={label}
              style={{
                color: "rgba(255,255,255,0.30)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                textAlign: index === 0 ? "left" : "right",
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {rows.map((row) => (
          <div
            key={row.prospectId}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr repeat(3, minmax(86px, 0.55fr)) repeat(3, minmax(132px, 0.9fr))",
              gap: 12,
              alignItems: "center",
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.025)",
            }}
          >
            <span style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 700, whiteSpace: "normal", overflowWrap: "anywhere" }}>{row.prospectId}</span>
            <StatusCell value={row.linkSent} />
            <StatusCell value={row.clicked} />
            <StatusCell value={row.booked} />
            <DateCell value={row.linkSentAt} />
            <DateCell value={row.firstClickedAt} />
            <DateCell value={row.bookedAt} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusCell({ value }: { value: boolean }) {
  return (
    <span
      style={{
        color: value ? "#34D399" : "rgba(255,255,255,0.42)",
        fontSize: 13,
        fontWeight: 800,
        textAlign: "right",
        whiteSpace: "nowrap",
      }}
    >
      {value ? "Yes" : "No"}
    </span>
  );
}

function DateCell({ value }: { value: string }) {
  return (
    <span
      style={{
        color: value === "—" ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.62)",
        fontSize: 13,
        fontWeight: 500,
        textAlign: "right",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  );
}

function LoadingState() {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 18, padding: 20 }}>
      <p style={{ color: "#f0f0ef", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Loading...</p>
      <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 13, lineHeight: 1.6 }}>Refreshing prospecting conversion data.</p>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <p style={{ color: "#f0f0ef", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{title}</p>
      <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 13, lineHeight: 1.6 }}>{text}</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section style={{ border: "1px solid rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.08)", borderRadius: 22, padding: 22 }}>
      <p style={{ color: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
        Supabase error
      </p>
      <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 22, marginBottom: 8 }}>
        Could not load leads tracking.
      </h2>
      <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.65 }}>{message}</p>
    </section>
  );
}
