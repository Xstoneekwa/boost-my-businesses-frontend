import { notFound } from "next/navigation";
import AnalyticsKpiCard from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard, { ANALYTICS_ACCENT_TEXT } from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { requireDashboardUserContext } from "@/lib/restaurant-analytics/session";

const incidents = [
  { id: "inc_001", title: "Booking provider timeout", severity: "Medium", location: "Waterfront", status: "Monitoring" },
  { id: "inc_002", title: "Low confidence private dining intent", severity: "Low", location: "Downtown", status: "Tuning" },
  { id: "inc_003", title: "Missing holiday hours", severity: "High", location: "West End", status: "Open" },
  { id: "inc_004", title: "Repeated manager request fallback", severity: "Medium", location: "Airport", status: "Resolved" },
];

export default async function RestaurantAnalyticsIncidentsPage() {
  const userContext = await requireDashboardUserContext();

  if (userContext.role === "tenant") {
    notFound();
  }

  return (
    <div className="dashboard-page" style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardPageHeader
        eyebrow="Reliability"
        title="Incidents"
        description="Monitor operational issues that affect call completion, routing confidence, integrations, and guest experience."
        badges={["Fallback monitoring", "Live soon"]}
      />

      <section className="dashboard-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 18 }}>
        <AnalyticsKpiCard label="Open Incidents" value="3" trend="Needs review" detail="Issues currently affecting automation quality." tone="warning" />
        <AnalyticsKpiCard label="Resolved" value="19" trend="7 days" detail="Incidents closed in the current period." tone="good" />
        <AnalyticsKpiCard label="Integration Issues" value="4" trend="Low" detail="Timeouts or downstream provider failures." />
        <AnalyticsKpiCard label="Critical" value="1" trend="Action" detail="High severity issue requiring operational attention." tone="danger" />
      </section>

      <AnalyticsSectionCard title="Incident log" eyebrow="Ops reliability" description="Placeholder incident list ready for error records, fallback clusters, and integration health data.">
        <div className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {incidents.map((incident) => (
            <div className="dashboard-compact-card" key={incident.id} style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)", borderRadius: 16, padding: 16 }}>
              <div className="dashboard-inline-stat" style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 16 }}>{incident.title}</h2>
                <span style={{ color: incident.severity === "High" ? "#F87171" : ANALYTICS_ACCENT_TEXT, fontSize: 12, fontWeight: 800 }}>{incident.severity}</span>
              </div>
              <p style={{ color: "rgba(255,255,255,0.50)", fontSize: 13, lineHeight: 1.55 }}>
                {incident.location} · {incident.status}
              </p>
            </div>
          ))}
        </div>
      </AnalyticsSectionCard>
    </div>
  );
}
