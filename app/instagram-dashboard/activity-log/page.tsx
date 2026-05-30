import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../InstagramDashboardViewNav";
import { getActivityLogData, type ActivityLogItem } from "../activity-log-data";
import { getRadarData } from "../radar-data";

export const dynamic = "force-dynamic";

export default async function InstagramActivityLogPage() {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const [data, radarData] = await Promise.all([getActivityLogData(), getRadarData()]);

  return (
    <main className="dashboard-page ig-activity-page">
      <DashboardPageHeader
        eyebrow="Audit"
        title="Activity Log"
        description="Traceable admin and system activity across dashboard actions."
        action={<InstagramDashboardViewNav active="activity-log" badges={{ radar: radarData.notificationSummary.radarBadgeCount, "server-check": radarData.notificationSummary.serverCheckBadgeCount }} notificationItems={{ radar: radarData.notificationItems.radar, "server-check": radarData.notificationItems.serverCheck }} />}
      />

      <section className="ig-activity-source-strip" aria-label="Activity Log source status">
        <SourcePill label="Activity Log backend" value={data.sourceDetails.activityLog.label} detail={data.sourceDetails.activityLog.description} />
        <SourcePill label="Technical logs" value={data.sourceDetails.technicalLogs.label} detail={data.sourceDetails.technicalLogs.description} />
        <SourcePill label="Admin audit" value={data.sourceDetails.auditBackend.label} detail={data.sourceDetails.auditBackend.description} />
      </section>

      <section className="ig-activity-kpis" aria-label="Activity Log summary">
        <Kpi label="Total CT events" value={String(data.summary.totalItems)} detail={data.sourceDetails.activityLog.label} />
        <Kpi label="Admin actions" value={String(data.summary.adminActionsCount)} detail="Target add, verify, archive, restore and reset events" />
        <Kpi label="System events" value={String(data.summary.systemActionsCount)} detail="System-written CT audit events when present" />
        <Kpi label="Failed / rejected" value={String(data.summary.failedActionsCount)} detail="Failed or rejected CT audit results" tone="warning" />
        <Kpi label="Source status" value={data.sourceStatus.auditBackend} detail={data.sourceDetails.auditBackend.description} />
      </section>

      <AnalyticsSectionCard
        eyebrow="Filters"
        title="Prepared filters"
        description="CT audit events are sorted newest first. Dedicated interactive filters can be added later without changing the safe projection."
      >
        <FilterPreview />
      </AnalyticsSectionCard>

      <AnalyticsSectionCard
        eyebrow="Activity"
        title="Target activity"
        description="Read-only CT audit visibility from ct_target_audit_events. Raw metadata and provider payloads are never rendered."
      >
        <ActivityList items={data.items} />
      </AnalyticsSectionCard>

      <style>{`
        .ig-activity-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
        }

        .ig-activity-source-strip,
        .ig-activity-kpis,
        .ig-activity-filters {
          display: grid;
          gap: 14px;
        }

        .ig-activity-source-strip {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin-bottom: 14px;
        }

        .ig-activity-kpis {
          grid-template-columns: repeat(5, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-activity-source-pill,
        .ig-activity-kpi,
        .ig-activity-filter,
        .ig-activity-empty {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
        }

        .ig-activity-source-pill,
        .ig-activity-filter,
        .ig-activity-empty {
          display: grid;
          gap: 8px;
          padding: 14px;
        }

        .ig-activity-kpi {
          min-height: 126px;
          padding: 16px;
        }

        .ig-activity-source-pill span,
        .ig-activity-kpi span,
        .ig-activity-filter span,
        .ig-activity-table th,
        .ig-activity-empty span {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-activity-source-pill strong,
        .ig-activity-filter strong,
        .ig-activity-empty strong {
          color: #f0f0ef;
          font-size: 15px;
        }

        .ig-activity-source-pill small,
        .ig-activity-kpi small,
        .ig-activity-filter p,
        .ig-activity-empty p,
        .ig-activity-table td {
          color: rgba(255,255,255,0.60);
          font-size: 12px;
          line-height: 1.5;
        }

        .ig-activity-kpi strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.65rem;
          line-height: 1;
          margin: 16px 0 10px;
          overflow-wrap: anywhere;
        }

        .ig-activity-filters {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .ig-activity-filter button {
          justify-self: start;
          min-height: 32px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.42);
          cursor: not-allowed;
          font-size: 12px;
          font-weight: 900;
          padding: 0 12px;
        }

        .ig-activity-table-wrap {
          overflow-x: auto;
        }

        .ig-activity-table {
          width: 100%;
          min-width: 1180px;
          border-collapse: collapse;
        }

        .ig-activity-table th,
        .ig-activity-table td {
          padding: 12px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          text-align: left;
          vertical-align: top;
        }

        .ig-activity-table td strong,
        .ig-activity-table td small {
          display: block;
        }

        .ig-activity-table td strong {
          color: rgba(255,255,255,0.82);
          font-size: 12px;
        }

        .ig-activity-empty {
          place-items: center;
          min-height: 210px;
          text-align: center;
        }

        .ig-activity-empty p {
          max-width: 560px;
          margin: 0;
        }

        @media (max-width: 1120px) {
          .ig-activity-source-strip,
          .ig-activity-kpis,
          .ig-activity-filters {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .ig-activity-page {
            padding: 22px 14px 40px;
          }

          .ig-activity-source-strip,
          .ig-activity-kpis,
          .ig-activity-filters {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function SourcePill({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="ig-activity-source-pill" title={detail}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
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

function FilterPreview() {
  const filters = [
    ["Domain", "Targets"],
    ["Actions", "Add, bulk add, verify, archive, restore, reset"],
    ["Actor", "admin, client, system when present"],
    ["Result", "accepted, archived, restored, review, failed"],
  ];

  return (
    <div className="ig-activity-filters" aria-label="Prepared Activity Log filters">
      {filters.map(([label, text]) => (
        <article className="ig-activity-filter" key={label}>
          <span>{label}</span>
          <strong>{text}</strong>
          <p>Read-only projection. Interactive filtering remains future work.</p>
          <button type="button" disabled>
            View only
          </button>
        </article>
      ))}
    </div>
  );
}

function ActivityList({ items }: { items: ActivityLogItem[] }) {
  if (!items.length) {
    return (
      <div className="ig-activity-empty">
        <span>No CT events</span>
        <strong>No target audit events found.</strong>
        <p>Target add, bulk add, verify, archive, restore and reset events will appear here once written to ct_target_audit_events.</p>
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
