import Link from "next/link";
import AnalyticsSectionCard, { ANALYTICS_ACCENT_TEXT } from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import {
  aggregateRows,
  fetchScopedRows,
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

export const dynamic = "force-dynamic";

type LocationListItem = {
  id: string;
  name: string;
  calls: number;
  bookings: number;
  handoffs: number;
};

type LocationsDataResult =
  | { ok: true; locations: LocationListItem[]; userContext: UserContext }
  | { ok: false; error: string; userContext?: UserContext };

function groupLocationRows(rows: Record<string, unknown>[]) {
  const groups = new Map<string, Record<string, unknown>[]>();

  rows.forEach((row, index) => {
    const key = readString(row, ["location_id", "locationId", "id"], `location-${index}`);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  return Array.from(groups.values()).map(aggregateRows);
}

function mapLocationItem(row: Record<string, unknown>): LocationListItem {
  const id = readString(row, ["location_id", "locationId", "id"]);
  const name = readString(row, ["location_name", "locationName", "location_display_name", "display_name", "name"], "Restaurant location");
  const calls = readNumber(row, ["total_calls", "totalCalls", "calls_total"]);
  const handoffs = readNumber(row, ["total_escalations", "escalations", "handoffs", "handoff_calls"]);

  return {
    id,
    name,
    calls,
    bookings: readNumber(row, ["total_reservations", "reservations", "bookings", "total_bookings", "booking_calls", "completed_bookings"]),
    handoffs,
  };
}

async function getLocationsData(): Promise<LocationsDataResult> {
  try {
    const userContext = await requireDashboardUserContext();
    const supabase = createSupabaseClient();
    const rows = await fetchScopedRows({
      supabase,
      userContext,
      sources: ["restaurant_dashboard_filtered"],
    });
    const enrichedRows = await enrichLocationNames(supabase, rows);
    const locations = groupLocationRows(enrichedRows).map(mapLocationItem).filter((location) => location.id);

    return { ok: true, locations, userContext };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export default async function RestaurantAnalyticsLocationsPage() {
  const result = await getLocationsData();
  const { copy } = await getRestaurantServerCopy();
  const tenantCopy = result.userContext?.role === "tenant" ? copy.dashboard.locations : null;

  if (!result.ok) {
    return (
      <div style={{ maxWidth: 1220, margin: "0 auto" }}>
        <DashboardPageHeader
          eyebrow={tenantCopy?.eyebrow ?? "Location analytics"}
          title={tenantCopy?.title ?? "Locations"}
          description={tenantCopy?.description ?? "Open a restaurant location to inspect calls, bookings, handoffs, fallback reasons, and local service quality."}
          badges={[tenantCopy ? copy.dashboard.locationDetail.locationScope : "Location scope", tenantCopy ? copy.dashboard.error : "Error"]}
        />
        <ErrorState message={result.error} title={tenantCopy?.loadErrorTitle} eyebrow={tenantCopy ? copy.dashboard.supabaseError : undefined} />
      </div>
    );
  }

  return (
    <div className="dashboard-page" style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardPageHeader
        eyebrow={tenantCopy?.eyebrow ?? "Location analytics"}
        title={tenantCopy?.title ?? "Locations"}
        description={tenantCopy?.description ?? "Open a restaurant location to inspect calls, bookings, handoffs, fallback reasons, and local service quality."}
        badges={[tenantCopy ? copy.dashboard.locationDetail.locationScope : "Location scope", tenantCopy ? copy.dashboard.liveData : "Live data"]}
      />

      <AnalyticsSectionCard title={tenantCopy?.listTitle ?? "Location list"} eyebrow={tenantCopy?.listEyebrow ?? "Restaurant sites"} description={tenantCopy?.listDescription ?? "Location links use the real Supabase location id used by analytics_calls_by_location.location_id."}>
        {result.locations.length ? (
          <div className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 12 }}>
            {result.locations.map((location) => (
              <Link
                key={location.id}
                href={`/restaurant-analytics/locations/${location.id}`}
                className="dashboard-compact-card"
                style={{
                  border: "1px solid rgba(255,255,255,0.07)",
                  background: "rgba(255,255,255,0.025)",
                  borderRadius: 16,
                  padding: 16,
                  textDecoration: "none",
                  display: "block",
                }}
              >
                <p style={{ color: "#f0f0ef", fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{location.name}</p>
                <p style={{ color: "rgba(255,255,255,0.46)", fontSize: 12, marginBottom: 14 }}>
                  {tenantCopy ? copy.dashboard.locationDetail.locationScope : location.id}
                </p>
                <div className="dashboard-location-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  <Metric label={tenantCopy ? copy.dashboard.locationDetail.calls : "Calls"} value={formatInteger(location.calls)} />
                  <Metric label={tenantCopy ? copy.dashboard.locationDetail.bookings : "Bookings"} value={formatInteger(location.bookings)} />
                  <Metric label={tenantCopy ? copy.dashboard.locationDetail.handoffs : "Handoffs"} value={formatPercent(percentOf(location.handoffs, location.calls))} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title={tenantCopy?.noLocationsTitle ?? "No locations found"} text={tenantCopy?.noLocationsText ?? "No location analytics rows exist for the current dashboard scope."} />
        )}
      </AnalyticsSectionCard>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-mini-kpi">
      <p style={{ color: ANALYTICS_ACCENT_TEXT, fontSize: 13, fontWeight: 900, marginBottom: 3 }}>{value}</p>
      <p style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{label}</p>
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
        {title ?? "Could not load locations."}
      </h2>
      <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.65 }}>{message}</p>
    </section>
  );
}
