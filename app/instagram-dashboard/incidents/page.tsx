import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { getIncidentsOverview } from "@/lib/instagram-dashboard/incidents-data";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function IncidentsPage({ searchParams }: { searchParams: SearchParams }) {
  const userContext = await requireInstagramDashboardAccess();
  if (!canAccessTenantPages(userContext)) notFound();

  const params = await searchParams;
  const requestedIncidentId = readParam(params.incident_id).trim();
  if (UUID.test(requestedIncidentId)) {
    redirect(`/instagram-dashboard/incidents/${requestedIncidentId}`);
  }
  const data = await getIncidentsOverview({
    status: readParam(params.status) || "open,acknowledged,resolved",
    severity: readParam(params.severity) || null,
    reason: readParam(params.reason) || null,
    accountId: readParam(params.account_id) || null,
    clientId: readParam(params.client_id) || null,
    deviceId: readParam(params.device_id) || null,
    hostMachine: readParam(params.host_machine) || null,
    limit: 150,
  });

  return (
    <main className="dashboard-page ig-incidents-page" data-testid="admin-incidents-list">
      <DashboardPageHeader
        eyebrow="Human review"
        title="Account incidents"
        description="Structured incidents are the source of truth. Slack and Discord only alert and link back here."
      />

      <section className="ig-incidents-summary" aria-label="Incident summary">
        <article><span>Open / acknowledged</span><strong>{data.summary.openCount}</strong></article>
        <article><span>Returned</span><strong>{data.summary.returned}</strong></article>
        <article><span>Total matching</span><strong>{data.summary.total}</strong></article>
      </section>

      <section className="ig-incidents-filters" aria-label="Incident filters">
        <FilterLink label="Open" href="/instagram-dashboard/incidents?status=open" active={readParam(params.status) === "open"} />
        <FilterLink label="Acknowledged" href="/instagram-dashboard/incidents?status=acknowledged" active={readParam(params.status) === "acknowledged"} />
        <FilterLink label="Resolved" href="/instagram-dashboard/incidents?status=resolved" active={readParam(params.status) === "resolved"} />
        <FilterLink label="All active" href="/instagram-dashboard/incidents?status=open,acknowledged" active={readParam(params.status) === "open,acknowledged"} />
        <FilterLink label="Critical" href="/instagram-dashboard/incidents?severity=critical" active={readParam(params.severity) === "critical"} />
      </section>

      <div className="ig-incidents-table-wrap">
        <table className="ig-incidents-table">
          <thead>
            <tr>
              <th>Reason</th>
              <th>Status</th>
              <th>Severity</th>
              <th>Account</th>
              <th>Phone</th>
              <th>Mac/host</th>
              <th>Last seen</th>
              <th>Action required</th>
            </tr>
          </thead>
          <tbody>
            {data.incidents.map((incident) => (
              <tr key={incident.id}>
                <td>
                  <Link href={`/instagram-dashboard/incidents/${incident.id}`}>{incident.reason || incident.incidentType}</Link>
                </td>
                <td>{incident.status}</td>
                <td>{incident.severity}</td>
                <td>
                  {incident.accountId ? (
                    <Link href={incident.deepLinks.account ?? "#"}>{incident.accountUsername || incident.accountId.slice(0, 8)}</Link>
                  ) : "—"}
                </td>
                <td>{incident.deviceLabel || "—"}</td>
                <td>{incident.hostMachine || "—"}</td>
                <td>{incident.lastSeenAt || "—"}</td>
                <td>{incident.actionRequired || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        .ig-incidents-page { max-width: 1440px; margin: 0 auto; padding: 22px 22px 48px; }
        .ig-incidents-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
        .ig-incidents-summary article, .ig-incidents-filters a {
          border: 1px solid rgba(255,255,255,.07); border-radius: 8px; background: #161820; padding: 12px 14px;
        }
        .ig-incidents-summary span { color: #4a4f5c; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
        .ig-incidents-summary strong { display: block; margin-top: 10px; color: #f0f0ee; font-size: 1.6rem; }
        .ig-incidents-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
        .ig-incidents-filters a { color: #8a8f98; text-decoration: none; font-size: 12px; }
        .ig-incidents-filters a.active { color: #f0f0ee; border-color: rgba(165,148,249,.45); }
        .ig-incidents-table-wrap { overflow-x: auto; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; }
        .ig-incidents-table { width: 100%; min-width: 1080px; border-collapse: collapse; }
        .ig-incidents-table th, .ig-incidents-table td { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.05); text-align: left; font-size: 12px; }
        .ig-incidents-table th { color: #4a4f5c; text-transform: uppercase; letter-spacing: .08em; font-size: 10px; }
        .ig-incidents-table a { color: #f0f0ee; text-decoration: none; }
        .ig-incidents-table a:hover { color: #a594f9; }
      `}</style>
    </main>
  );
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return <Link className={active ? "active" : undefined} href={href}>{label}</Link>;
}
