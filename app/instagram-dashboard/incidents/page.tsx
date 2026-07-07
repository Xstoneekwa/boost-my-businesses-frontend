import Link from "next/link";
import { notFound } from "next/navigation";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import {
  buildIncidentCounters,
  buildIncidentList,
  type IncidentViewModel,
} from "@/lib/instagram-dashboard/incident-operations";

export const dynamic = "force-dynamic";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function stateLabel(state: IncidentViewModel["displayState"]) {
  if (state === "action_required") return "Action required";
  if (state === "resolved") return "Resolved";
  if (state === "acknowledged") return "Acknowledged";
  if (state === "ignored") return "Ignored";
  return "Open";
}

function deliveryLabel(state: IncidentViewModel["deliveryState"]) {
  if (state === "delivered") return "Slack/Discord delivered";
  if (state === "delivery_degraded") return "Delivery degraded";
  if (state === "pending") return "Delivery pending";
  return "Not notified";
}

async function loadIncidents(includeTest: boolean) {
  const supabase = createSupabaseClient();
  const { data: incidentRows, error } = await supabase
    .from("account_incidents")
    .select(
      "id,status,severity,incident_type,reason,failure_reason,action_required,admin_message,account_id,account_username,run_id,occurrence_count,first_seen_at,last_seen_at,resolved_at,source,metadata",
    )
    .order("last_seen_at", { ascending: false })
    .limit(100);
  if (error) {
    return { models: [] as IncidentViewModel[], counters: buildIncidentCounters([]), error: error.message };
  }
  const incidentIds = (incidentRows ?? []).map((row) => String(row.id ?? "")).filter(Boolean);
  let notificationRows: Record<string, unknown>[] = [];
  if (incidentIds.length) {
    const { data: outboxRows } = await supabase
      .from("account_incident_notifications")
      .select("incident_id,channel,status,attempt_count,delivered_at,last_error")
      .in("incident_id", incidentIds);
    notificationRows = outboxRows ?? [];
  }
  const models = buildIncidentList(incidentRows ?? [], notificationRows, { includeTest });
  const counters = buildIncidentCounters(
    buildIncidentList(incidentRows ?? [], notificationRows, { includeTest: true }),
  );
  return { models, counters, error: null as string | null };
}

export default async function InstagramIncidentsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userContext = await requireInstagramDashboardAccess();
  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const params = (await searchParams) ?? {};
  const includeTest = params.include_test === "1";
  const { models, counters, error } = await loadIncidents(includeTest);

  return (
    <main className="dashboard-page ig-incidents-page">
      <DashboardPageHeader
        eyebrow="Operations"
        title="Incidents"
        description="Canonical runtime incidents with true failure reasons. Internal only."
      />

      <section className="ig-inc-counters">
        <div className="ig-inc-counter ig-inc-counter-action">
          <span>Action required</span>
          <strong>{counters.actionRequired}</strong>
        </div>
        <div className="ig-inc-counter">
          <span>Open</span>
          <strong>{counters.open}</strong>
        </div>
        <div className="ig-inc-counter">
          <span>Resolved</span>
          <strong>{counters.resolved}</strong>
        </div>
        <div className="ig-inc-counter ig-inc-counter-degraded">
          <span>Delivery degraded</span>
          <strong>{counters.deliveryDegraded}</strong>
        </div>
      </section>

      {error ? (
        <section className="ig-inc-alert" role="alert">
          <strong>Incidents unavailable</strong>
          <span>{error}</span>
        </section>
      ) : null}

      {models.length === 0 && !error ? (
        <section className="ig-inc-empty">
          No incidents{includeTest ? "" : " (test incidents hidden)"}.
        </section>
      ) : null}

      <ul className="ig-inc-list">
        {models.map((incident) => (
          <li key={incident.id} className={`ig-inc-row ig-inc-state-${incident.displayState}`}>
            <div className="ig-inc-row-head">
              <span className={`ig-inc-badge ig-inc-badge-${incident.displayState}`}>
                {stateLabel(incident.displayState)}
              </span>
              <span className={`ig-inc-severity ig-inc-severity-${incident.severity}`}>
                {incident.severity}
              </span>
              {incident.isTest ? <span className="ig-inc-test-badge">TEST</span> : null}
              <span className="ig-inc-time">{formatDateTime(incident.lastSeenAt)}</span>
            </div>
            <div className="ig-inc-row-main">
              <strong>{incident.operatorLabel}</strong>
              <code>{incident.reasonCode}</code>
            </div>
            {incident.actionRequired ? (
              <p className="ig-inc-action">{incident.actionRequired}</p>
            ) : null}
            <div className="ig-inc-row-meta">
              {incident.accountHref ? (
                <Link href={incident.accountHref}>
                  @{incident.accountUsername || incident.accountId}
                </Link>
              ) : (
                <span>@{incident.accountUsername || "internal"}</span>
              )}
              <span>{incident.incidentType}</span>
              <span>×{incident.occurrenceCount}</span>
              <span className={`ig-inc-delivery ig-inc-delivery-${incident.deliveryState}`}>
                {deliveryLabel(incident.deliveryState)}
              </span>
              {incident.runId ? <span title={incident.runId}>run {incident.runId.slice(0, 8)}…</span> : null}
            </div>
          </li>
        ))}
      </ul>

      <footer className="ig-inc-footer">
        {includeTest ? (
          <Link href="/instagram-dashboard/incidents">Hide test incidents</Link>
        ) : (
          <Link href="/instagram-dashboard/incidents?include_test=1">Show test incidents</Link>
        )}
      </footer>

      <style>{`
        .ig-incidents-page {
          width: min(100%, 960px);
          margin: 0 auto;
          padding: 22px 20px 48px;
          box-sizing: border-box;
        }
        .ig-inc-counters {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
          gap: 10px;
          margin-bottom: 18px;
        }
        .ig-inc-counter {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: #1e2028;
          padding: 12px 14px;
        }
        .ig-inc-counter span {
          display: block;
          color: #8a8f98;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .06em;
          text-transform: uppercase;
        }
        .ig-inc-counter strong {
          display: block;
          margin-top: 6px;
          color: #f8fafc;
          font-size: 20px;
        }
        .ig-inc-counter-action strong { color: #fca5a5; }
        .ig-inc-counter-degraded strong { color: #fdba74; }
        .ig-inc-alert {
          display: flex;
          gap: 10px;
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid rgba(248,113,113,.28);
          border-radius: 8px;
          background: rgba(248,113,113,.08);
          color: #8a8f98;
          font-size: 13px;
        }
        .ig-inc-empty {
          padding: 22px;
          border: 1px dashed rgba(255,255,255,.12);
          border-radius: 10px;
          color: #8a8f98;
          text-align: center;
        }
        .ig-inc-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 10px;
        }
        .ig-inc-row {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: #1e2028;
          padding: 12px 14px;
          display: grid;
          gap: 8px;
        }
        .ig-inc-state-action_required { border-color: rgba(248,113,113,.35); }
        .ig-inc-row-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .ig-inc-badge {
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .04em;
          text-transform: uppercase;
        }
        .ig-inc-badge-open { background: rgba(59,130,246,.16); color: #93c5fd; }
        .ig-inc-badge-action_required { background: rgba(248,113,113,.16); color: #fca5a5; }
        .ig-inc-badge-resolved { background: rgba(34,197,94,.16); color: #86efac; }
        .ig-inc-badge-acknowledged { background: rgba(250,204,21,.14); color: #fde68a; }
        .ig-inc-badge-ignored { background: rgba(148,163,184,.16); color: #cbd5e1; }
        .ig-inc-severity {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          color: #cbd5e1;
        }
        .ig-inc-severity-critical { color: #fca5a5; }
        .ig-inc-severity-error { color: #fdba74; }
        .ig-inc-test-badge {
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(168,85,247,.18);
          color: #d8b4fe;
          font-size: 10px;
          font-weight: 800;
        }
        .ig-inc-time {
          margin-left: auto;
          color: #8a8f98;
          font-size: 12px;
          white-space: nowrap;
        }
        .ig-inc-row-main {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 10px;
        }
        .ig-inc-row-main strong { color: #f8fafc; font-size: 14px; }
        .ig-inc-row-main code {
          color: #93c5fd;
          font-size: 12px;
          background: rgba(59,130,246,.08);
          padding: 2px 6px;
          border-radius: 6px;
          overflow-wrap: anywhere;
        }
        .ig-inc-action {
          margin: 0;
          color: #fca5a5;
          font-size: 13px;
          line-height: 1.45;
        }
        .ig-inc-row-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 14px;
          color: #8a8f98;
          font-size: 12px;
        }
        .ig-inc-row-meta a { color: #93c5fd; text-decoration: none; font-weight: 700; }
        .ig-inc-delivery-delivered { color: #86efac; }
        .ig-inc-delivery-delivery_degraded { color: #fdba74; font-weight: 700; }
        .ig-inc-delivery-pending { color: #fde68a; }
        .ig-inc-footer {
          margin-top: 16px;
          font-size: 13px;
        }
        .ig-inc-footer a { color: #93c5fd; text-decoration: none; }
      `}</style>
    </main>
  );
}
