import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsKpiCard from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard, { ANALYTICS_ACCENT_TEXT } from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";

const tenants = [
  { id: "maison-group", name: "Maison Group", locations: 8, calls: 684, completed: 591, handoffs: 42, health: "Strong" },
  { id: "table-fire", name: "Table & Fire", locations: 5, calls: 438, completed: 386, handoffs: 21, health: "Excellent" },
  { id: "harbor-dining", name: "Harbor Dining Co.", locations: 4, calls: 392, completed: 326, handoffs: 37, health: "Watch" },
  { id: "noka-hospitality", name: "Noka Hospitality", locations: 3, calls: 328, completed: 233, handoffs: 44, health: "Needs tuning" },
];

export default async function RestaurantAnalyticsTenantsPage() {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const totalCalls = tenants.reduce((sum, tenant) => sum + tenant.calls, 0);
  const totalLocations = tenants.reduce((sum, tenant) => sum + tenant.locations, 0);
  const totalHandoffs = tenants.reduce((sum, tenant) => sum + tenant.handoffs, 0);

  return (
    <div style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardPageHeader
        eyebrow="Tenant analytics"
        title="Tenants"
        description="Monitor restaurant groups, franchises, and hospitality operators from one multi-tenant command center."
        badges={["All tenants", "Live soon"]}
      />

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 18 }}>
        <AnalyticsKpiCard label="Active Tenants" value={tenants.length} trend="Portfolio" detail="Restaurant groups connected to the call assistant." />
        <AnalyticsKpiCard label="Locations" value={totalLocations} trend="Multi-site" detail="Locations represented across the tenant base." tone="good" />
        <AnalyticsKpiCard label="Total Calls" value={totalCalls.toLocaleString()} trend="30 days" detail="Inbound calls processed across tenants." />
        <AnalyticsKpiCard label="Handoffs" value={totalHandoffs} trend={`${((totalHandoffs / totalCalls) * 100).toFixed(1)}%`} detail="Human escalations with structured context." tone="warning" />
      </section>

      <AnalyticsSectionCard
        title="Tenant portfolio"
        eyebrow="Groups"
        description="Placeholder tenant list ready to be replaced with Supabase tenant records and aggregate call metrics."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {tenants.map((tenant) => (
            <Link
              key={tenant.id}
              href={`/restaurant-analytics/tenants/${tenant.id}`}
              style={{
                display: "block",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.025)",
                borderRadius: 16,
                padding: 16,
                textDecoration: "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 18 }}>{tenant.name}</h2>
                <span style={{ color: ANALYTICS_ACCENT_TEXT, fontSize: 12, fontWeight: 800 }}>{tenant.health}</span>
              </div>
              <p style={{ color: "rgba(255,255,255,0.48)", fontSize: 13, lineHeight: 1.55, marginBottom: 14 }}>
                {tenant.locations} locations · {tenant.calls.toLocaleString()} calls · {tenant.handoffs} handoffs
              </p>
              <span style={{ color: ANALYTICS_ACCENT_TEXT, fontSize: 13, fontWeight: 700 }}>Open tenant →</span>
            </Link>
          ))}
        </div>
      </AnalyticsSectionCard>
    </div>
  );
}
