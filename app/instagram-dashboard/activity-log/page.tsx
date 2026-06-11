import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { getActivityLogData, type ActivityLogItem } from "../activity-log-data";
import { getRadarData } from "../radar-data";

export const dynamic = "force-dynamic";

export default async function InstagramActivityLogPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const [data, radarData] = await Promise.all([getActivityLogData(), getRadarData()]);

  return (
    <main className="dashboard-page ig-activity-page">
      <DashboardPageHeader
        eyebrow="Investigation"
        title="Activity Log"
        description="Investigate safe interaction evidence across client accounts, CT sources, runs and device labels."
      />

      <section className="ig-activity-kpis" aria-label="Activity Log summary">
        <Kpi label="Evidence records" value={String(data.summary.totalItems)} detail={data.sourceDetails.activityLog.label} />
        <Kpi label="Admin actions" value={String(data.summary.adminActionsCount)} detail="CT lifecycle actions when the fallback audit source is active" />
        <Kpi label="Worker events" value={String(data.summary.systemActionsCount)} detail="Interaction evidence written by the runtime when projection is active" />
        <Kpi label="Failed / rejected" value={String(data.summary.failedActionsCount)} detail="Failed interactions or rejected CT audit results" tone="warning" />
      </section>

      <AnalyticsSectionCard
        eyebrow="Investigation"
        title="Interaction evidence"
        description="Newest safe evidence first. Technical logs, worker payloads and sensitive runtime artifacts are kept out of this view."
      >
        <ActivityList items={data.items} />
      </AnalyticsSectionCard>

      <style>{`
        .ig-activity-page { max-width: 1440px; margin: 0 auto; padding: 22px 22px 48px; }
        .ig-activity-kpis {
          display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px; margin-bottom: 18px;
        }
        .ig-activity-kpi, .ig-activity-empty {
          border: 1px solid rgba(255,255,255,.07); border-radius: 8px; background: #161820;
        }
        .ig-activity-empty { display: grid; gap: 8px; padding: 14px; }
        .ig-activity-kpi { min-height: 120px; padding: 14px 16px; }
        .ig-activity-kpi span, .ig-activity-table th, .ig-activity-empty span {
          color: #4a4f5c; font-family: 'JetBrains Mono', monospace;
          font-size: 10px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase;
        }
        .ig-activity-empty strong { color: #f0f0ee; font-size: 15px; font-weight: 700; }
        .ig-activity-kpi small, .ig-activity-empty p, .ig-activity-table td {
          color: #8a8f98; font-size: 12px; line-height: 1.5;
        }
        .ig-activity-kpi strong {
          display: block; color: #f0f0ee; font-size: 1.65rem;
          font-weight: 700; line-height: 1; margin: 14px 0 8px; overflow-wrap: anywhere;
        }
        .ig-activity-table-wrap { overflow-x: auto; }
        .ig-activity-table { width: 100%; min-width: 1180px; border-collapse: collapse; }
        .ig-activity-table th {
          font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 500;
          letter-spacing: .08em; text-transform: uppercase; color: #4a4f5c;
          padding: 8px 10px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.07);
        }
        .ig-activity-table td {
          padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,.04);
          text-align: left; vertical-align: top;
        }
        .ig-activity-table tbody tr:last-child td { border-bottom: none; }
        .ig-activity-table tbody tr:hover { background: rgba(255,255,255,.02); }
        .ig-activity-table td strong, .ig-activity-table td small { display: block; }
        .ig-activity-table td strong { color: #f0f0ee; font-size: 12px; font-weight: 700; }
        .ig-activity-empty { place-items: center; min-height: 210px; text-align: center; }
        .ig-activity-empty p { max-width: 560px; margin: 0; }
        @media (max-width: 1120px) { .ig-activity-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 760px) {
          .ig-activity-page { padding: 16px 14px 40px; }
          .ig-activity-kpis { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}

function Kpi({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "warning" }) {
  const color = tone === "warning" ? "#FBBF24" : "#f0f0ef";

  return (
    <article className="ig-activity-kpi">
      <span>{label}</span>
      <strong style={{ color }}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ActivityList({ items }: { items: ActivityLogItem[] }) {
  if (!items.length) {
    return (
      <div className="ig-activity-empty">
        <span>No evidence</span>
        <strong>No interaction evidence found.</strong>
        <p>No safe interaction evidence is available from the current Activity Log source.</p>
      </div>
    );
  }

  return (
    <div className="ig-activity-table-wrap">
      <table className="ig-activity-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Account / target</th>
            <th>Result</th>
            <th>Reason</th>
            <th>Safe summary</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.timestamp ?? "unknown"}</td>
              <td>{item.actorType}</td>
              <td>{item.action}</td>
              <td>
                <strong>{item.username ?? "unknown account"}</strong>
                <small>{item.targetLabel ?? item.targetIdShort ?? "target unknown"}{item.batchIdShort ? ` · batch ${item.batchIdShort}` : ""}</small>
              </td>
              <td>{item.result}</td>
              <td>{item.reason ?? "—"}</td>
              <td>{item.safeSummary}</td>
              <td>{item.sourceSurface ?? "unknown"} · {item.metadataStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
