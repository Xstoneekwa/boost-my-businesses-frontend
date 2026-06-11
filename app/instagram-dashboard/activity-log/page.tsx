import { notFound } from "next/navigation";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { getActivityLogData } from "../activity-log-data";
import ActivityLogInvestigationLab from "./ActivityLogInvestigationLab";

export const dynamic = "force-dynamic";

export default async function InstagramActivityLogPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const data = await getActivityLogData();

  return (
    <main className="dashboard-page ig-activity-page">
      <DashboardPageHeader
        eyebrow="Investigation"
        title="Activity Log"
        description="Investigate CT sources and account interactions."
      />

      <ActivityLogInvestigationLab data={data} />

      <style>{`
        .ig-activity-page { max-width: 1440px; margin: 0 auto; padding: 22px 22px 48px; }
        .ig-investigation-lab { display: grid; gap: 16px; min-width: 0; }
        .ig-investigation-search,
        .ig-investigation-card,
        .ig-investigation-result,
        .ig-investigation-empty,
        .ig-investigation-boundary {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 14px;
          background: #161820;
          box-shadow: 0 14px 40px rgba(0,0,0,.18);
        }
        .ig-investigation-search,
        .ig-investigation-card {
          display: grid;
          gap: 14px;
          min-width: 0;
          overflow: hidden;
          padding: 16px;
        }
        .ig-investigation-search-main,
        .ig-investigation-result-main,
        .ig-investigation-actions {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          min-width: 0;
        }
        .ig-investigation-search-main label {
          display: grid;
          flex: 1;
          gap: 6px;
          min-width: 0;
        }
        .ig-investigation-search span,
        .ig-investigation-card-heading span,
        .ig-investigation-kpi span,
        .ig-investigation-select span,
        .ig-investigation-result-main span,
        .ig-investigation-field span,
        .ig-investigation-evidence span,
        .ig-investigation-empty span,
        .ig-investigation-boundary span {
          color: #6f7685;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .ig-investigation-search-main input,
        .ig-investigation-select select {
          width: 100%;
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 12px;
          background: #0f1118;
          color: #f0f0ee;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          outline: none;
        }
        .ig-investigation-search-main input { padding: 12px 13px; }
        .ig-investigation-select select { padding: 9px 10px; text-transform: capitalize; }
        .ig-investigation-search-main button,
        .ig-investigation-modes button,
        .ig-investigation-actions button,
        .ig-investigation-actions a {
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 11px;
          background: #20232e;
          color: #f0f0ee;
          cursor: pointer;
          font-size: 12px;
          font-weight: 800;
          padding: 9px 11px;
          text-decoration: none;
          white-space: nowrap;
        }
        .ig-investigation-search-main button:disabled,
        .ig-investigation-actions button:disabled {
          cursor: not-allowed;
          opacity: .46;
        }
        .ig-investigation-modes {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .ig-investigation-modes button {
          background: #11141c;
          color: #9ca3af;
          padding: 10px;
        }
        .ig-investigation-modes button.active {
          border-color: rgba(96,165,250,.36);
          background: rgba(37,99,235,.18);
          color: #bfdbfe;
        }
        .ig-investigation-kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .ig-investigation-kpi {
          display: grid;
          gap: 8px;
          min-width: 0;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 14px;
          background: #161820;
          padding: 14px;
        }
        .ig-investigation-kpi strong {
          color: #f0f0ee;
          font-size: 26px;
          line-height: 1;
        }
        .ig-investigation-kpi small,
        .ig-investigation-card-heading p,
        .ig-investigation-result-main p,
        .ig-investigation-empty p,
        .ig-investigation-boundary p {
          color: #9ca3af;
          font-size: 12px;
          line-height: 1.5;
          margin: 0;
        }
        .ig-investigation-kpi.good strong { color: #86efac; }
        .ig-investigation-kpi.warning strong { color: #facc15; }
        .ig-investigation-kpi.info strong { color: #93c5fd; }
        .ig-investigation-card-heading {
          display: grid;
          gap: 5px;
        }
        .ig-investigation-card-heading h2,
        .ig-investigation-result-main h3 {
          color: #f0f0ee;
          margin: 0;
        }
        .ig-investigation-filters {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .ig-investigation-select {
          display: grid;
          gap: 5px;
          min-width: 0;
        }
        .ig-investigation-empty {
          display: grid;
          gap: 5px;
          border-style: dashed;
          padding: 14px;
        }
        .ig-investigation-empty strong {
          color: #f0f0ee;
          font-size: 15px;
        }
        .ig-investigation-results {
          display: grid;
          gap: 11px;
          min-width: 0;
        }
        .ig-investigation-result {
          display: grid;
          gap: 12px;
          min-width: 0;
          padding: 14px;
        }
        .ig-investigation-result.good { border-left: 4px solid #22c55e; }
        .ig-investigation-result.warning { border-left: 4px solid #eab308; }
        .ig-investigation-result.danger { border-left: 4px solid #ef4444; }
        .ig-investigation-result-main > div:first-child {
          display: grid;
          gap: 4px;
          min-width: 0;
        }
        .ig-investigation-badges {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 6px;
        }
        .ig-investigation-badge {
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          padding: 5px 8px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .ig-investigation-badge.good { background: rgba(34,197,94,.14); color: #86efac; }
        .ig-investigation-badge.warning { background: rgba(234,179,8,.14); color: #fde68a; }
        .ig-investigation-badge.danger { background: rgba(239,68,68,.14); color: #fecaca; }
        .ig-investigation-meta {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 8px;
          min-width: 0;
        }
        .ig-investigation-field,
        .ig-investigation-evidence {
          display: grid;
          gap: 4px;
          min-width: 0;
          border-radius: 12px;
          background: #10131b;
          padding: 9px 10px;
        }
        .ig-investigation-field strong,
        .ig-investigation-evidence strong {
          overflow: hidden;
          color: #f0f0ee;
          font-size: 12px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ig-investigation-evidence strong { white-space: normal; }
        .ig-investigation-actions {
          justify-content: flex-start;
          flex-wrap: wrap;
        }
        .ig-investigation-boundary {
          display: grid;
          gap: 6px;
          padding: 14px 16px;
        }
        .ig-investigation-message {
          position: sticky;
          bottom: 12px;
          justify-self: start;
          max-width: min(100%, 760px);
          border: 1px solid rgba(96,165,250,.28);
          border-radius: 13px;
          background: rgba(30,64,175,.96);
          color: #eff6ff;
          box-shadow: 0 14px 40px rgba(0,0,0,.25);
          font-size: 13px;
          font-weight: 800;
          padding: 10px 12px;
        }
        @media (max-width: 1180px) {
          .ig-investigation-kpis,
          .ig-investigation-modes,
          .ig-investigation-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .ig-investigation-meta { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 760px) {
          .ig-activity-page { padding: 16px 14px 40px; }
          .ig-investigation-search-main,
          .ig-investigation-result-main,
          .ig-investigation-kpis,
          .ig-investigation-modes,
          .ig-investigation-filters,
          .ig-investigation-meta {
            display: grid;
            grid-template-columns: 1fr;
          }
          .ig-investigation-badges { justify-content: flex-start; }
        }
      `}</style>
    </main>
  );
}
