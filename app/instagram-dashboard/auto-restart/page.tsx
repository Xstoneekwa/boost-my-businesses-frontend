import { notFound } from "next/navigation";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import AutoRestartRulesEditor from "@/components/instagram-dashboard/AutoRestartRulesEditor";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { getAutoRestartData } from "../auto-restart-data";

export const dynamic = "force-dynamic";

function formatDateTime(value: string | null) {
  if (!value) return "None";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function operationalLabel(state: string) {
  if (state === "active") return "Active";
  if (state === "blocked") return "Blocked";
  if (state === "ready") return "Ready";
  return "Disabled";
}

function blockReasonCopy(reasons: string[], foundationBlocked: boolean) {
  if (foundationBlocked) return "Blocked — automation foundation is not available.";
  if (reasons.includes("production_mode_tick_token_not_configured")) {
    return "Blocked — production tick token is not configured.";
  }
  if (reasons.length) return `Blocked — ${reasons.join(", ")}`;
  return "";
}

export default async function InstagramAutoRestartPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const data = await getAutoRestartData();
  const { status, rules } = data;
  const foundationBlocked = data.sourceStatus.some(
    (row) => row.label === "Auto Restart settings" && row.status === "pending",
  );
  const statusDetail = blockReasonCopy(status.blockReasons, foundationBlocked)
    || (status.operationalState === "active"
      ? "Auto Restart is active in Production mode."
      : status.operationalState === "ready"
        ? "Ready to enable. Gates are green."
        : "Auto Restart is disabled.");

  return (
    <main className="dashboard-page ig-auto-restart-page">
      <DashboardPageHeader
        eyebrow="Operations"
        title="Auto Restart"
        description="Production automation controls for scheduled account restarts."
      />

      <header className="ig-ar-header">
        <div className="ig-ar-header-main">
          <span className={`ig-ar-status-badge ig-ar-status-${status.operationalState}`}>
            {foundationBlocked ? "Blocked" : operationalLabel(status.operationalState)}
          </span>
          <p>{statusDetail}</p>
        </div>
        {!foundationBlocked ? (
          <a className="ig-ar-view-link" href="#candidates">View candidates</a>
        ) : null}
      </header>

      {data.errors.length > 0 ? (
        <section className="ig-ar-alert" role="alert">
          <strong>Partial data unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      ) : null}

      <AutoRestartRulesEditor
        initialRules={rules}
        foundationBlocked={foundationBlocked}
        runtimeStatus={foundationBlocked ? undefined : {
          eligibleCount: status.activeRestartCandidates,
          blockedCount: status.blockedCandidates,
          nextEvaluation: formatDateTime(status.nextSchedulerCheck),
          lastEvaluation: formatDateTime(status.lastSchedulerCheck),
        }}
      />

      {!foundationBlocked && data.candidates.length ? (
        <section id="candidates" className="ig-ar-candidates">
          <h3>Eligible candidates ({status.activeRestartCandidates})</h3>
          <ul className="ig-ar-candidate-list">
            {data.candidates.slice(0, 12).map((candidate) => (
              <li key={candidate.accountId}>
                <strong>{candidate.username}</strong>
                <span>{candidate.restartEligible ? "Eligible" : "Blocked"}</span>
                <small>{candidate.blockReason || candidate.plannedRunType}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <style>{`
        .ig-auto-restart-page {
          width: min(100%, 960px);
          margin: 0 auto;
          padding: 22px 20px 48px;
          box-sizing: border-box;
          overflow-x: clip;
        }

        .ig-ar-header {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 18px;
          min-width: 0;
        }

        .ig-ar-header-main {
          display: grid;
          gap: 8px;
          min-width: 0;
          flex: 1 1 240px;
        }

        .ig-ar-header-main p {
          margin: 0;
          color: #8a8f98;
          font-size: 14px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .ig-ar-status-badge {
          display: inline-flex;
          width: fit-content;
          max-width: 100%;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .ig-ar-status-disabled { background: rgba(148,163,184,.16); color: #cbd5e1; }
        .ig-ar-status-ready { background: rgba(59,130,246,.16); color: #93c5fd; }
        .ig-ar-status-blocked { background: rgba(248,113,113,.16); color: #fca5a5; }
        .ig-ar-status-active { background: rgba(34,197,94,.16); color: #86efac; }

        .ig-ar-view-link {
          color: #93c5fd;
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
          white-space: nowrap;
        }

        .ig-ar-alert {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid rgba(248, 113, 113, 0.28);
          border-radius: 8px;
          background: rgba(248, 113, 113, 0.08);
          color: #8a8f98;
          font-size: 13px;
        }

        .ig-ar-editor {
          display: grid;
          gap: 16px;
          min-width: 0;
        }

        .ig-ar-section {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: #1e2028;
          padding: 14px;
          min-width: 0;
        }

        .ig-ar-section h3 {
          margin: 0 0 12px;
          color: #f8fafc;
          font-size: 14px;
        }

        .ig-ar-fields {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
          gap: 10px;
          min-width: 0;
        }

        .ig-ar-field {
          display: grid;
          gap: 6px;
          min-width: 0;
          padding: 10px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: rgba(15,23,42,0.35);
        }

        .ig-ar-field span {
          color: #8a8f98;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .ig-ar-field input[type="number"],
        .ig-ar-field input[type="checkbox"] {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }

        .ig-ar-field input[type="number"] {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #1e2028;
          color: #e2e8f0;
          padding: 8px 10px;
        }

        .ig-ar-field-static strong {
          color: #f8fafc;
          font-size: 15px;
        }

        .ig-ar-field-static small {
          color: rgba(255,255,255,0.54);
          font-size: 12px;
          line-height: 1.45;
        }

        .ig-ar-toggle {
          grid-template-columns: 1fr auto;
          align-items: center;
        }

        .ig-ar-section-actions,
        .ig-ar-editor-actions,
        .ig-ar-confirm-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
          margin-top: 12px;
          min-width: 0;
        }

        .ig-ar-save-btn,
        .ig-ar-secondary-btn {
          border-radius: 8px;
          padding: 10px 14px;
          font-weight: 800;
          cursor: pointer;
          max-width: 100%;
        }

        .ig-ar-save-btn {
          border: 1px solid rgba(34,197,94,0.35);
          background: rgba(34,197,94,0.18);
          color: #86efac;
        }

        .ig-ar-secondary-btn {
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.04);
          color: #e2e8f0;
        }

        .ig-ar-save-btn:disabled,
        .ig-ar-secondary-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .ig-ar-inline-meta {
          color: #8a8f98;
          font-size: 12px;
          overflow-wrap: anywhere;
        }

        .ig-ar-inline-error { color: #fca5a5; }

        .ig-ar-runtime-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
          gap: 10px;
        }

        .ig-ar-runtime-stat span {
          display: block;
          color: #8a8f98;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .ig-ar-runtime-stat strong {
          display: block;
          margin-top: 6px;
          color: #f8fafc;
          font-size: 16px;
          overflow-wrap: anywhere;
        }

        .ig-ar-candidates {
          margin-top: 16px;
          min-width: 0;
        }

        .ig-ar-candidates h3 {
          margin: 0 0 10px;
          color: #f8fafc;
          font-size: 14px;
        }

        .ig-ar-candidate-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 8px;
        }

        .ig-ar-candidate-list li {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 4px 10px;
          padding: 10px 12px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #1e2028;
          min-width: 0;
        }

        .ig-ar-candidate-list strong {
          color: #f8fafc;
          overflow-wrap: anywhere;
        }

        .ig-ar-candidate-list span {
          color: #86efac;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }

        .ig-ar-candidate-list small {
          grid-column: 1 / -1;
          color: #8a8f98;
          overflow-wrap: anywhere;
        }

        .ig-ar-confirm {
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 10px;
          padding: 14px;
          background: rgba(15,23,42,0.55);
        }

        .ig-ar-confirm p {
          margin: 0 0 10px;
          color: #e2e8f0;
          line-height: 1.5;
        }
      `}</style>
    </main>
  );
}
