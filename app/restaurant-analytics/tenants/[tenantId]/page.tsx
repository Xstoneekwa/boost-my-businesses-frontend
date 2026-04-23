import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsKpiCard from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard, { ANALYTICS_ACCENT_TEXT } from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { aggregateRows, fetchScopedRows, formatPercent, percentOf, readNumber, readString } from "@/lib/restaurant-analytics/data";
import { enrichLocationNames } from "@/lib/restaurant-analytics/name-enrichment";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";

type TenantPageProps = {
  params: Promise<{ tenantId: string }>;
};

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function groupLocationRows(rows: Record<string, unknown>[]) {
  const groups = new Map<string, Record<string, unknown>[]>();

  rows.forEach((row, index) => {
    const key = readString(row, ["location_id", "locationId", "id"], `location-${index}`);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  return Array.from(groups.values()).map(aggregateRows);
}

export default async function RestaurantAnalyticsTenantDetailPage({ params }: TenantPageProps) {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const { tenantId } = await params;
  const tenantName = titleFromSlug(tenantId);
  const supabase = createSupabaseClient();
  const locationRows = await fetchScopedRows({
    supabase,
    userContext,
    sources: ["analytics_calls_by_location"],
    filters: [{ columns: ["tenant_id", "tenantId"], value: tenantId }],
  });
  const locations = (await enrichLocationNames(supabase, groupLocationRows(locationRows)))
    .map((row) => {
      const calls = readNumber(row, ["total_calls", "totalCalls", "calls_total"]);
      const handoffs = readNumber(row, ["total_escalations", "escalations", "handoffs", "handoff_calls"]);

      return {
        id: readString(row, ["location_id", "locationId", "id"]),
        name: readString(row, ["location_name", "locationName", "location_display_name", "display_name", "name"], "Restaurant location"),
        calls,
        bookings: readNumber(row, ["bookings", "total_bookings", "booking_calls", "completed_bookings"]),
        handoffRate: formatPercent(percentOf(handoffs, calls)),
      };
    })
    .filter((location) => location.id);
  const tenantCalls = locations.reduce((sum, location) => sum + location.calls, 0);
  const tenantBookings = locations.reduce((sum, location) => sum + location.bookings, 0);
  const tenantHandoffs = locationRows.reduce((sum, row) => sum + readNumber(row, ["total_escalations", "escalations", "handoffs", "handoff_calls"]), 0);
  const tenantFallbacks = locationRows.reduce((sum, row) => sum + readNumber(row, ["total_fallbacks", "fallbacks", "fallback_calls", "fallbackCalls"]), 0);

  return (
    <div style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardPageHeader
        eyebrow="Tenant detail"
        title={tenantName}
        description="A tenant-level view for call volume, automation quality, location performance, escalation behavior, and operational tuning."
        badges={["Tenant scope", "Live data"]}
        action={
          <Link href="/restaurant-analytics/tenants" style={{ color: "rgba(255,255,255,0.66)", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
            Back to tenants
          </Link>
        }
      />

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 18 }}>
        <AnalyticsKpiCard label="Tenant Calls" value={tenantCalls.toLocaleString()} trend="Live" detail="Total calls processed for this tenant." />
        <AnalyticsKpiCard label="Bookings" value={tenantBookings.toLocaleString()} trend={formatPercent(percentOf(tenantBookings, tenantCalls))} detail="Bookings captured or qualified by AI." tone="good" />
        <AnalyticsKpiCard label="Escalations" value={tenantHandoffs.toLocaleString()} trend={formatPercent(percentOf(tenantHandoffs, tenantCalls))} detail="Handoffs sent with context and priority." tone="warning" />
        <AnalyticsKpiCard label="Fallbacks" value={tenantFallbacks.toLocaleString()} trend={formatPercent(percentOf(tenantFallbacks, tenantCalls))} detail="Calls that needed fallback logic." tone="danger" />
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18 }}>
        <AnalyticsSectionCard title="Locations" eyebrow="Site performance" description="Locations connected to this tenant, linked with real Supabase location ids.">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {locations.length ? locations.map((location) => (
              <Link
                key={location.id}
                href={`/restaurant-analytics/locations/${location.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr repeat(3, minmax(70px, 0.35fr))",
                  gap: 12,
                  alignItems: "center",
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.07)",
                  background: "rgba(255,255,255,0.025)",
                  textDecoration: "none",
                }}
              >
                <span style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 800 }}>{location.name}</span>
                <span style={{ color: "rgba(255,255,255,0.62)", fontSize: 13, textAlign: "right" }}>{location.calls}</span>
                <span style={{ color: "rgba(255,255,255,0.62)", fontSize: 13, textAlign: "right" }}>{location.bookings}</span>
                <span style={{ color: ANALYTICS_ACCENT_TEXT, fontSize: 13, fontWeight: 800, textAlign: "right" }}>{location.handoffRate}</span>
              </Link>
            )) : (
              <div style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 14, padding: 18 }}>
                <p style={{ color: "#f0f0ef", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>No locations found</p>
                <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 13, lineHeight: 1.6 }}>No location analytics rows exist for this tenant.</p>
              </div>
            )}
          </div>
        </AnalyticsSectionCard>

        <AnalyticsSectionCard title="Tenant notes" eyebrow="Ops summary" description="Placeholder for account-level recommendations, routing changes, and tenant-specific QA findings." tone="accent">
          <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.7 }}>
            Prioritize FAQ tuning for peak dinner calls, then review private dining escalation rules. This area can later be powered by reviewed transcripts and tenant-level quality scoring.
          </p>
        </AnalyticsSectionCard>
      </section>
    </div>
  );
}
