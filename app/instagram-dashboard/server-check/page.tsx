import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import {
  formatDateTime,
  formatInteger,
  getRadarData,
  statusTone,
  type RadarSourceStatus,
  type ServerCheckItem,
} from "../radar-data";

export const dynamic = "force-dynamic";

export default async function InstagramServerCheckPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const data = await getRadarData();
  const { serverCheckItems } = data;

  return (
    <main className="dashboard-page ig-server-check-page">
      <DashboardPageHeader
        eyebrow="Daily worklist"
        title="Instagram Server Check"
        description="Read-only worklist for accounts that need operator review. No worker, phone, or settings actions run from this view."
      />

      {data.errors.length > 0 && (
        <section className="ig-server-check-alert" role="alert">
          <strong>Server Check data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <section className="ig-server-check-source-strip" aria-label="Server Check data source status">
        <SourcePill label="Backend API" source={data.summary.sourceStatus.backendApi} />
        <SourcePill label="Accounts" source={data.summary.sourceStatus.accounts} />
        <SourcePill label="Runs" source={data.summary.sourceStatus.runs} />
        <SourcePill label="Warnings" source={data.summary.sourceStatus.warnings} />
        <SourcePill label="Devices" source={data.summary.sourceStatus.devices} />
      </section>

      <section className="ig-server-check-summary" aria-label="Server Check summary">
        <article>
          <span>Worklist items</span>
          <strong>{formatInteger(serverCheckItems.length)}</strong>
          <small>Problem, monitor, linked warning, or unlinked warning signals</small>
        </article>
        <article>
          <span>Critical/warning</span>
          <strong>{formatInteger(serverCheckItems.filter((item) => item.severity === "critical" || item.severity === "error" || item.severity === "warning").length)}</strong>
          <small>Needs operator review</small>
        </article>
        <article>
          <span>Monitor</span>
          <strong>{formatInteger(serverCheckItems.filter((item) => item.healthStatus === "monitor").length)}</strong>
          <small>Watch but do not mutate</small>
        </article>
      </section>

      <AnalyticsSectionCard
        eyebrow="Server Check"
        title="Accounts to review"
        description="This is the future daily worklist. Review actions should happen in Manage until dedicated safe workflows are approved."
      >
        <ServerCheckList items={serverCheckItems} />
      </AnalyticsSectionCard>

      <style>{`
        .ig-server-check-page { max-width: 1440px; margin: 0 auto; padding: 22px 22px 48px; }

        .ig-server-check-alert {
          display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
          margin-bottom: 18px; padding: 12px 14px;
          border: 1px solid rgba(248,113,113,0.28); border-radius: 8px;
          background: rgba(248,113,113,0.08); color: rgba(255,255,255,0.74); font-size: 13px;
        }
        .ig-server-check-alert strong { color: #fca5a5; }

        .ig-server-check-summary {
          display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px; margin-bottom: 18px;
        }
        .ig-server-check-source-strip {
          display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px; margin-bottom: 14px;
        }
        .ig-server-check-source-pill {
          display: flex; justify-content: space-between; gap: 10px;
          border: 1px solid rgba(255,255,255,.07); border-radius: 8px;
          background: #161820; padding: 10px 12px;
        }
        .ig-server-check-summary article, .ig-server-check-empty {
          border: 1px solid rgba(255,255,255,.07); border-radius: 8px;
          background: #161820; padding: 14px 16px;
        }
        .ig-server-check-summary span, .ig-server-check-source-pill span,
        .ig-server-check-table th, .ig-server-check-empty span {
          color: #4a4f5c; font-family: 'JetBrains Mono', monospace;
          font-size: 10px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase;
        }
        .ig-server-check-summary strong {
          display: block; color: #f0f0ee; font-size: 1.85rem;
          font-weight: 700; line-height: 1; margin: 14px 0 8px;
        }
        .ig-server-check-summary small, .ig-server-check-source-pill strong,
        .ig-server-check-table td { color: #8a8f98; font-size: 12px; }

        .ig-server-check-table-wrap { overflow-x: auto; }
        .ig-server-check-table { width: 100%; min-width: 1180px; border-collapse: collapse; }
        .ig-server-check-table th {
          font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 500;
          letter-spacing: .08em; text-transform: uppercase; color: #4a4f5c;
          padding: 8px 10px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.07);
        }
        .ig-server-check-table td {
          padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,.04);
          text-align: left; vertical-align: top;
        }
        .ig-server-check-table tbody tr:last-child td { border-bottom: none; }
        .ig-server-check-table tbody tr:hover { background: rgba(255,255,255,.02); }
        .ig-server-check-table td:first-child { color: #f0f0ee; font-weight: 700; }

        .ig-server-check-account-link { color: #f0f0ee; font-weight: 700; text-decoration: none; }
        .ig-server-check-account-link:hover, .ig-server-check-account-link:focus-visible {
          color: #a594f9; outline: none;
        }

        .ig-server-check-empty {
          display: grid; gap: 8px; place-items: center; min-height: 180px; text-align: center;
        }
        .ig-server-check-empty strong { color: #f0f0ee; font-size: 17px; font-weight: 700; }
        .ig-server-check-empty p { color: #8a8f98; font-size: 13px; line-height: 1.6; margin: 0; max-width: 420px; }

        @media (max-width: 760px) {
          .ig-server-check-page { padding: 16px 14px 40px; }
          .ig-server-check-summary, .ig-server-check-source-strip { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}

function SourcePill({ label, source }: { label: string; source: RadarSourceStatus }) {
  return (
    <div className="ig-server-check-source-pill" title={source.description}>
      <span>{label}</span>
      <strong>{source.label}</strong>
    </div>
  );
}

function ServerCheckList({ items }: { items: ServerCheckItem[] }) {
  if (!items.length) {
    return (
      <div className="ig-server-check-empty">
        <span>Empty state</span>
        <strong>No server check items found</strong>
        <p>No problem, monitor, or unlinked warning accounts found from current sources.</p>
      </div>
    );
  }

  return (
    <div className="ig-server-check-table-wrap">
      <table className="ig-server-check-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Reason</th>
            <th>Severity</th>
            <th>Phone</th>
            <th>Mac/host</th>
            <th>Source</th>
            <th>Last update</th>
            <th>Recommended action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr id={`server-check-item-${encodeURIComponent(item.id)}`} key={item.id}>
              <td>
                {item.accountId || item.username ? (
                  <Link className="ig-server-check-account-link" href={`/instagram-dashboard/accounts/${encodeURIComponent(item.accountId || item.username || "")}?from=server-check`}>
                    {item.username ?? "account unknown"}
                  </Link>
                ) : (
                  "account unknown"
                )}
              </td>
              <td>{item.reason}</td>
              <td style={{ color: statusTone(item.healthStatus), fontWeight: 900 }}>{item.severity}</td>
              <td>{item.phoneName}</td>
              <td>{item.macHostName}</td>
              <td>{item.sourceLabel}</td>
              <td>{formatDateTime(item.lastUpdate)}</td>
              <td>{item.recommendedAction}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
