import Link from "next/link";
import { notFound } from "next/navigation";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { getIncidentDetail } from "@/lib/instagram-dashboard/incidents-data";
import IncidentActionsClient from "../IncidentActionsClient";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ incidentId: string }> };

export default async function IncidentDetailPage({ params }: RouteContext) {
  const userContext = await requireInstagramDashboardAccess();
  if (!canAccessTenantPages(userContext)) notFound();

  const { incidentId } = await params;
  const data = await getIncidentDetail(incidentId);
  if (!data) notFound();

  const { incident, timeline, notifications, dashboardActions } = data;

  return (
    <main className="dashboard-page ig-incident-detail-page" data-testid="admin-incident-detail">
      <DashboardPageHeader
        eyebrow="Incident"
        title={incident.reason || incident.incidentType}
        description={incident.actionRequired || "Human review required before automation resumes."}
      />

      <section className="ig-incident-grid">
        <article><span>Status</span><strong>{incident.status}</strong></article>
        <article><span>Severity</span><strong>{incident.severity}</strong></article>
        <article><span>Occurrences</span><strong>{incident.occurrenceCount}</strong></article>
        <article><span>Last seen</span><strong>{incident.lastSeenAt || "—"}</strong></article>
      </section>

      <section className="ig-incident-links">
        {incident.deepLinks.account ? <Link href={incident.deepLinks.account}>Open account</Link> : null}
        {incident.deepLinks.device ? <Link href={incident.deepLinks.device}>Open phone</Link> : null}
        {incident.deepLinks.run ? <Link href={incident.deepLinks.run}>Open run evidence</Link> : null}
      </section>

      <section className="ig-incident-panel">
        <h2>Context</h2>
        <ul>
          <li>Account: {incident.accountUsername || incident.accountId || "—"}</li>
          <li>Client: {incident.clientName || incident.clientId || "—"}</li>
          <li>Phone: {incident.deviceLabel || incident.deviceId || "—"}</li>
          <li>Mac/host: {incident.hostMachine || "—"}</li>
          <li>Clone: {incident.cloneLabel || incident.cloneId || "—"}</li>
          <li>Request: {incident.requestId || "—"}</li>
          <li>Worker: {incident.executionWorkerId || "—"}</li>
          <li>Trigger: {incident.triggerSource || "—"}</li>
        </ul>
      </section>

      <section className="ig-incident-panel">
        <h2>Redacted evidence</h2>
        <pre>{JSON.stringify(incident.evidence, null, 2)}</pre>
      </section>

      <section className="ig-incident-panel">
        <h2>Notification state</h2>
        {notifications.length ? (
          <ul>
            {notifications.map((item) => (
              <li key={item.id}>{item.channel} · {item.status} · attempts {item.attemptCount}{item.lastError ? ` · ${item.lastError}` : ""}</li>
            ))}
          </ul>
        ) : <p>No notification rows recorded for this incident.</p>}
      </section>

      <section className="ig-incident-panel">
        <h2>Timeline / audit</h2>
        {timeline.length ? (
          <ul>
            {timeline.map((item) => (
              <li key={item.id}>{item.createdAt} · {item.actionType} · {item.message}</li>
            ))}
          </ul>
        ) : <p>No timeline events recorded yet.</p>}
      </section>

      {dashboardActions.length ? (
        <section className="ig-incident-panel">
          <h2>Linked dashboard actions</h2>
          <ul>
            {dashboardActions.map((action) => (
              <li key={action.id}>{action.title} · {action.status} · {action.actionType}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <IncidentActionsClient incidentId={incident.id} status={incident.status} />

      <style>{`
        .ig-incident-detail-page { max-width: 1080px; margin: 0 auto; padding: 22px 22px 48px; display: grid; gap: 16px; }
        .ig-incident-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        .ig-incident-grid article, .ig-incident-panel {
          border: 1px solid rgba(255,255,255,.07); border-radius: 10px; background: #161820; padding: 14px 16px;
        }
        .ig-incident-grid span, .ig-incident-panel h2 { color: #4a4f5c; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
        .ig-incident-grid strong { display: block; margin-top: 8px; color: #f0f0ee; }
        .ig-incident-links { display: flex; gap: 12px; flex-wrap: wrap; }
        .ig-incident-links a { color: #a594f9; text-decoration: none; font-size: 13px; }
        .ig-incident-panel h2 { margin: 0 0 10px; font-size: 11px; }
        .ig-incident-panel ul, .ig-incident-panel p, .ig-incident-panel pre {
          margin: 0; color: #8a8f98; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
        }
        .ig-incident-panel li + li { margin-top: 6px; }
      `}</style>
    </main>
  );
}
