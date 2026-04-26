import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsKpiCard from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard, { ANALYTICS_ACCENT_TEXT } from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import {
  aggregateRows,
  fetchScopedRows,
  formatAge,
  formatInteger,
  formatPercent,
  percentOf,
  readNumber,
  readString,
} from "@/lib/restaurant-analytics/data";
import { enrichLocationNames } from "@/lib/restaurant-analytics/name-enrichment";
import { requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { getRestaurantServerCopy } from "@/lib/restaurant-language-server";
import { createSupabaseClient } from "@/lib/supabase";
import type { UserContext } from "@/lib/userContext";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type LocationPageProps = {
  params: Promise<{ locationId: string }>;
};

type RecentCall = {
  id: string;
  intent: string;
  status: string;
  time: string;
  outcome: string;
};

type Recommendation =
  | { tone: "handoff"; percent: string }
  | { tone: "fallback"; percent: string }
  | { tone: "clear" };

type LocationDataResult =
  | {
      ok: true;
      locationId: string;
      locationName: string;
      summary: Record<string, unknown> | null;
      recentCalls: RecentCall[];
      recommendation: Recommendation | null;
      userContext: UserContext;
    }
  | { ok: false; error: string; locationId: string; locationName: string; userContext: UserContext }
  | { ok: false; notFound: true };

type ResolvedLocation = {
  id: string;
  name: string;
};

const locationIdFilterColumns = ["location_id", "locationId", "id"];

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readLocationName(row: Record<string, unknown>, fallback: string) {
  return readString(row, ["location_name", "locationName", "location_display_name", "display_name", "name"], fallback);
}

function rowBelongsToTenant(row: Record<string, unknown>, userContext: UserContext) {
  if (userContext.role === "superadmin") return true;

  return readString(row, ["tenant_id", "tenantId"]) === userContext.tenantId;
}

async function resolveLocationById(supabase: SupabaseClient, userContext: UserContext, locationId: string): Promise<ResolvedLocation | null> {
  if (!isUuid(locationId)) return null;

  let locationQuery = supabase
    .from("restaurant_locations")
    .select("id, tenant_id, name")
    .eq("id", locationId)
    .limit(1);

  if (userContext.role === "tenant") {
    locationQuery = locationQuery.eq("tenant_id", userContext.tenantId);
  }

  const locationResult = await locationQuery.returns<Record<string, unknown>[]>();

  if (locationResult.error) {
    throw new Error(locationResult.error.message);
  }

  const location = locationResult.data?.find((row) => rowBelongsToTenant(row, userContext));

  if (location) {
    return {
      id: readString(location, ["id"]),
      name: readLocationName(location, "Restaurant location"),
    };
  }

  let analyticsQuery = supabase
    .from("analytics_calls_by_location")
    .select("tenant_id, location_id")
    .eq("location_id", locationId)
    .limit(1);

  if (userContext.role === "tenant") {
    analyticsQuery = analyticsQuery.eq("tenant_id", userContext.tenantId);
  }

  const analyticsResult = await analyticsQuery.returns<Record<string, unknown>[]>();

  if (analyticsResult.error) {
    throw new Error(analyticsResult.error.message);
  }

  const analyticsLocation = analyticsResult.data?.find((row) => rowBelongsToTenant(row, userContext));

  return analyticsLocation
    ? {
        id: readString(analyticsLocation, ["location_id"]),
        name: "Restaurant location",
      }
    : null;
}

async function fetchLocationRows(
  supabase: SupabaseClient,
  userContext: UserContext,
  locationId: string,
  sources: string[],
  limit?: number
) {
  const scopedRows = await fetchScopedRows({
    supabase,
    userContext,
    sources,
    filters: [{ columns: locationIdFilterColumns, value: locationId }],
    limit,
  });

  if (scopedRows.length) return scopedRows;
  return [];
}

function mapRecentCall(row: Record<string, unknown>, index: number): RecentCall {
  const status = readString(row, ["status", "call_status", "handoff_status", "outcome_status"], readNumber(row, ["total_escalations", "escalations"]) ? "Escalated" : "Completed");

  return {
    id: readString(row, ["id", "call_id", "handoff_id"], `call_${index + 1}`),
    intent: readString(row, ["intent", "detected_intent", "reason", "handoff_reason", "escalation_reason"], "General call"),
    status,
    time: readString(row, ["time", "call_time"], formatAge(row)),
    outcome: readString(row, ["outcome", "final_response", "summary", "result"], "Operational record captured"),
  };
}

function buildRecommendation(summary: Record<string, unknown> | null, recentRows: Record<string, unknown>[]): Recommendation | null {
  if (!summary && !recentRows.length) return null;

  const totalCalls = summary ? readNumber(summary, ["total_calls", "totalCalls", "calls_total"]) : recentRows.length;
  const handoffs = summary ? readNumber(summary, ["total_escalations", "escalations", "handoffs", "handoff_calls"]) : recentRows.filter((row) => readString(row, ["status", "handoff_status"]).toLowerCase().includes("open")).length;
  const fallbacks = summary ? readNumber(summary, ["total_fallbacks", "fallbacks", "fallback_calls", "fallbackCalls"]) : 0;

  if (handoffs) {
    return { tone: "handoff", percent: formatPercent(percentOf(handoffs, totalCalls)) };
  }

  if (fallbacks) {
    return { tone: "fallback", percent: formatPercent(percentOf(fallbacks, totalCalls)) };
  }

  return { tone: "clear" };
}

function formatRecommendation(
  recommendation: Recommendation,
  copy: {
    recommendationHandoff: string;
    recommendationFallback: string;
    recommendationClear: string;
  }
) {
  if (recommendation.tone === "handoff") {
    return `${recommendation.percent} ${copy.recommendationHandoff}`;
  }

  if (recommendation.tone === "fallback") {
    return `${recommendation.percent} ${copy.recommendationFallback}`;
  }

  return copy.recommendationClear;
}

async function getLocationData(locationId: string): Promise<LocationDataResult> {
  const userContext = await requireDashboardUserContext();
  const fallbackName = "Restaurant location";

  try {
    const supabase = createSupabaseClient();
    const resolvedLocation = await resolveLocationById(supabase, userContext, locationId);

    if (!resolvedLocation) {
      return { ok: false, notFound: true };
    }

    const summaryRows = await fetchLocationRows(supabase, userContext, resolvedLocation.id, ["analytics_calls_by_location"]);
    const enrichedSummaryRows = await enrichLocationNames(supabase, summaryRows);
    const summary = enrichedSummaryRows.length ? aggregateRows(enrichedSummaryRows) : null;
    const locationName = summary
      ? readString(summary, ["location_name", "locationName", "location_display_name", "display_name", "name"], resolvedLocation.name)
      : resolvedLocation.name;

    const recentRows = await fetchLocationRows(
      supabase,
      userContext,
      resolvedLocation.id,
      ["analytics_recent_calls", "restaurant_call_logs", "restaurant_calls", "calls", "analytics_handoffs"],
      12
    );
    const enrichedRecentRows = await enrichLocationNames(supabase, recentRows);

    return {
      ok: true,
      locationId: resolvedLocation.id,
      locationName,
      summary,
      recentCalls: enrichedRecentRows.map(mapRecentCall),
      recommendation: buildRecommendation(summary, enrichedRecentRows),
      userContext,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
      locationId,
      locationName: fallbackName,
      userContext,
    };
  }
}

export default async function RestaurantAnalyticsLocationDetailPage({ params }: LocationPageProps) {
  const { locationId } = await params;
  const result = await getLocationData(locationId);
  const { copy } = await getRestaurantServerCopy();

  if ("notFound" in result) {
    notFound();
  }

  const tenantCopy = result.userContext.role === "tenant" ? copy.dashboard.locationDetail : null;

  if (!result.ok) {
    return (
      <div style={{ maxWidth: 1220, margin: "0 auto" }}>
        <DashboardPageHeader
          eyebrow={tenantCopy?.eyebrow ?? "Location detail"}
          title={result.locationName}
          description={tenantCopy?.description ?? "A location-level operating view for call demand, bookings, handoffs, fallback reasons, and local service quality."}
          badges={[tenantCopy?.locationScope ?? "Location scope", tenantCopy ? copy.dashboard.error : "Error"]}
        />
        <ErrorState message={result.error} title={tenantCopy?.loadErrorTitle} eyebrow={tenantCopy ? copy.dashboard.supabaseError : undefined} />
      </div>
    );
  }

  const totalCalls = result.summary ? readNumber(result.summary, ["total_calls", "totalCalls", "calls_total"]) : 0;
  const bookings = result.summary ? readNumber(result.summary, ["bookings", "total_bookings", "booking_calls", "completed_bookings"]) : 0;
  const handoffs = result.summary ? readNumber(result.summary, ["total_escalations", "escalations", "handoffs", "handoff_calls"]) : 0;
  const fallbacks = result.summary ? readNumber(result.summary, ["total_fallbacks", "fallbacks", "fallback_calls", "fallbackCalls"]) : 0;
  const recommendationCopy = tenantCopy ?? {
    recommendationHandoff: "of this site's calls required staff escalation. Review the top reasons and make sure the team receives complete context before peak service windows.",
    recommendationFallback: "of this site's calls needed backup handling. Check local menu details, opening hours, and booking availability coverage.",
    recommendationClear: "No urgent local tuning signals are visible for this site right now.",
  };
  const recommendationText = result.recommendation ? formatRecommendation(result.recommendation, recommendationCopy) : null;

  return (
    <div className="dashboard-page" style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardPageHeader
        eyebrow={tenantCopy?.eyebrow ?? "Location detail"}
        title={result.locationName}
        description={tenantCopy?.description ?? "A location-level operating view for call demand, bookings, handoffs, fallback reasons, and local service quality."}
        badges={[tenantCopy?.locationScope ?? "Location scope", tenantCopy ? copy.dashboard.liveData : "Live data"]}
        action={
          result.userContext.role === "superadmin" ? (
            <Link href="/restaurant-analytics/tenants" style={{ color: "rgba(255,255,255,0.66)", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
              Tenant list
            </Link>
          ) : null
        }
      />

      {!result.summary && (
        <div style={{ marginBottom: 18 }}>
          <EmptyState title={tenantCopy?.noAnalyticsTitle ?? "No location analytics found"} text={tenantCopy?.noAnalyticsText ?? "Supabase returned no location summary for this route and dashboard scope."} />
        </div>
      )}

      <section className="dashboard-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 18 }}>
        <AnalyticsKpiCard label={tenantCopy?.calls ?? "Location Calls"} value={formatInteger(totalCalls)} trend={tenantCopy ? copy.dashboard.liveData : "Live"} detail={tenantCopy?.callsDetail ?? "Inbound calls for this restaurant location."} />
        <AnalyticsKpiCard label={tenantCopy?.bookings ?? "Bookings"} value={formatInteger(bookings)} trend={formatPercent(percentOf(bookings, totalCalls))} detail={tenantCopy?.bookingsDetail ?? "Bookings captured or qualified by AI."} tone="good" />
        <AnalyticsKpiCard label={tenantCopy?.handoffs ?? "Handoffs"} value={formatInteger(handoffs)} trend={formatPercent(percentOf(handoffs, totalCalls))} detail={tenantCopy?.handoffsDetail ?? "Calls escalated to staff with context."} tone="warning" />
        <AnalyticsKpiCard label={tenantCopy?.fallbacks ?? "Fallbacks"} value={formatInteger(fallbacks)} trend={formatPercent(percentOf(fallbacks, totalCalls))} detail={tenantCopy?.fallbacksDetail ?? "Fallbacks due to missing data or low confidence."} tone="danger" />
      </section>

      <section className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18 }}>
        <AnalyticsSectionCard title={tenantCopy?.recentCalls ?? "Recent calls"} eyebrow={tenantCopy?.callActivity ?? "Call activity"} description={tenantCopy?.recentDescription ?? "Recent Supabase call or escalation records for this location."}>
          {result.recentCalls.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {result.recentCalls.map((call) => (
                <div
                  key={call.id}
                  className="mobile-card-row"
                  style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 60px", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)" }}
                >
                  <div>
                    <p style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 800, marginBottom: 3 }}>{call.intent}</p>
                    <p style={{ color: "rgba(255,255,255,0.42)", fontSize: 12 }}>{call.outcome}</p>
                  </div>
                  <span style={{ color: call.status.toLowerCase().includes("escalat") || call.status.toLowerCase().includes("open") ? ANALYTICS_ACCENT_TEXT : "#34D399", fontSize: 13, fontWeight: 800 }}>{call.status}</span>
                  <span style={{ color: "rgba(255,255,255,0.54)", fontSize: 13, textAlign: "right" }}>{call.time}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={tenantCopy?.noRecentTitle ?? "No recent call records"} text={tenantCopy?.noRecentText ?? "There are no recent call or handoff rows for this location in Supabase."} />
          )}
        </AnalyticsSectionCard>

        <AnalyticsSectionCard title={tenantCopy?.localTuning ?? "Local tuning"} eyebrow={tenantCopy?.recommendations ?? "Recommendations"} description={tenantCopy?.tuningDescription ?? "Site-specific routing, FAQ, staffing, and fallback signals generated from live analytics."} tone="accent">
          {recommendationText ? (
            <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.7 }}>
              {recommendationText}
            </p>
          ) : (
            <EmptyState title={tenantCopy?.noSignalTitle ?? "No tuning signal"} text={tenantCopy?.noSignalText ?? "No location-level quality signal exists for this dashboard scope yet."} />
          )}
        </AnalyticsSectionCard>
      </section>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 14, padding: 18 }}>
      <p style={{ color: "#f0f0ef", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{title}</p>
      <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 13, lineHeight: 1.6 }}>{text}</p>
    </div>
  );
}

function ErrorState({ message, title, eyebrow }: { message: string; title?: string; eyebrow?: string }) {
  return (
    <section style={{ border: "1px solid rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.08)", borderRadius: 22, padding: 22 }}>
      <p style={{ color: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
        {eyebrow ?? "Supabase error"}
      </p>
      <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 22, marginBottom: 8 }}>
        {title ?? "Could not load this location."}
      </h2>
      <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.65 }}>{message}</p>
    </section>
  );
}
