import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../InstagramDashboardViewNav";
import {
  getCredentialsActionsData,
  type CredentialsActionAccount,
  type CredentialsActionsSourceDetail,
  type DashboardActionGroup,
} from "../credentials-actions-data";
import { formatDateTime, formatInteger, getRadarData, statusTone } from "../radar-data";

export const dynamic = "force-dynamic";

export default async function InstagramCredentialsActionsPage() {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const [data, radarData] = await Promise.all([getCredentialsActionsData(), getRadarData()]);

  return (
    <main className="dashboard-page ig-credentials-page">
      <DashboardPageHeader
        eyebrow="Credentials"
        title="Credentials / Dashboard Actions"
        description="Safe credential status and pending account actions."
        action={<InstagramDashboardViewNav active="credentials" badges={{ radar: radarData.notificationSummary.radarBadgeCount, "server-check": radarData.notificationSummary.serverCheckBadgeCount }} notificationItems={{ radar: radarData.notificationItems.radar, "server-check": radarData.notificationItems.serverCheck }} />}
      />

      {data.errors.length > 0 && (
        <section className="ig-credentials-alert" role="alert">
          <strong>Credentials data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <section className="ig-credentials-source-strip" aria-label="Credentials source status">
        <SourcePill label="Manage overview" detail={data.sourceDetails.manageOverview} />
        <SourcePill label="Radar overview" detail={data.sourceDetails.radarOverview} />
        <SourcePill label="Account credentials" detail={data.sourceDetails.accountCredentials} />
        <SourcePill label="Dashboard actions" detail={data.sourceDetails.dashboardActions} />
        <SourcePill label="Mutations" detail={data.sourceDetails.mutations} />
      </section>

      <section className="ig-credentials-kpis" aria-label="Credentials summary">
        <Kpi label="Credentials missing" value={formatInteger(data.summary.credentialsMissingCount)} detail="Safe missing/configured status only" tone={data.summary.credentialsMissingCount ? "warning" : "good"} />
        <Kpi label="Reauth required" value={formatInteger(data.summary.reauthRequiredCount)} detail="Derived from safe reauth signals" tone={data.summary.reauthRequiredCount ? "danger" : "good"} />
        <Kpi label="Login problems" value={formatInteger(data.summary.loginProblemCount)} detail="Problem, blocked, checkpoint, challenge" tone={data.summary.loginProblemCount ? "danger" : "good"} />
        <Kpi label="Pending actions" value={formatInteger(data.summary.pendingActionsCount)} detail="Derived V1 action worklist" tone={data.summary.pendingActionsCount ? "warning" : "good"} />
        <Kpi label="Blocking campaigns" value={formatInteger(data.summary.blockingCampaignCount)} detail="No mutation from this view" tone={data.summary.blockingCampaignCount ? "danger" : "good"} />
        <Kpi label="Client action required" value={formatInteger(data.summary.clientActionRequiredCount)} detail="Client-safe future workflows" tone={data.summary.clientActionRequiredCount ? "warning" : "good"} />
      </section>

      <AnalyticsSectionCard
        eyebrow="Worklist"
        title="Credential review"
        description="Read-only account status from safe Manage/Radar projections. Use Account Detail or Manage controls for existing workflows."
      >
        <AccountWorklist accounts={data.accounts} />
      </AnalyticsSectionCard>

      <AnalyticsSectionCard
        eyebrow="Actions"
        title="Dashboard actions"
        description="V1 actions are derived from safe dashboard status. Resolution buttons are disabled until account_dashboard_actions and credential mutations are connected."
      >
        <ActionsList groups={data.actionGroups} />
      </AnalyticsSectionCard>

      <style>{`
        .ig-credentials-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
        }

        .ig-credentials-alert {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid rgba(248,113,113,0.28);
          border-radius: 14px;
          background: rgba(248,113,113,0.08);
          color: rgba(255,255,255,0.74);
          font-size: 13px;
        }

        .ig-credentials-alert strong {
          color: #FCA5A5;
        }

        .ig-credentials-source-strip,
        .ig-credentials-kpis {
          display: grid;
          gap: 14px;
          margin-bottom: 18px;
        }

        .ig-credentials-source-strip {
          grid-template-columns: repeat(5, minmax(0, 1fr));
          margin-bottom: 14px;
        }

        .ig-credentials-kpis {
          grid-template-columns: repeat(6, minmax(0, 1fr));
        }

        .ig-credentials-source-pill,
        .ig-credentials-kpi,
        .ig-credentials-empty,
        .ig-credentials-action,
        .ig-credentials-signal {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
        }

        .ig-credentials-source-pill,
        .ig-credentials-empty,
        .ig-credentials-action {
          display: grid;
          gap: 8px;
          padding: 14px;
        }

        .ig-credentials-kpi {
          min-height: 128px;
          padding: 16px;
        }

        .ig-credentials-source-pill span,
        .ig-credentials-kpi span,
        .ig-credentials-table th,
        .ig-credentials-empty span,
        .ig-credentials-action span,
        .ig-credentials-action-meta span {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-credentials-source-pill strong,
        .ig-credentials-empty strong,
        .ig-credentials-action strong {
          color: #f0f0ef;
          font-size: 15px;
        }

        .ig-credentials-source-pill small,
        .ig-credentials-kpi small,
        .ig-credentials-table td,
        .ig-credentials-empty p,
        .ig-credentials-action p,
        .ig-credentials-action-meta strong {
          color: rgba(255,255,255,0.60);
          font-size: 12px;
          line-height: 1.5;
        }

        .ig-credentials-kpi strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.65rem;
          line-height: 1;
          margin: 16px 0 10px;
        }

        .ig-credentials-table-wrap {
          overflow-x: auto;
        }

        .ig-credentials-table {
          width: 100%;
          min-width: 1240px;
          border-collapse: collapse;
        }

        .ig-credentials-table th,
        .ig-credentials-table td {
          padding: 12px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          text-align: left;
          vertical-align: top;
        }

        .ig-credentials-account-link,
        .ig-credentials-link {
          color: #f0f0ef;
          font-weight: 900;
          text-decoration: none;
        }

        .ig-credentials-account-link:hover,
        .ig-credentials-account-link:focus-visible,
        .ig-credentials-link:hover,
        .ig-credentials-link:focus-visible {
          color: #FBBF24;
          outline: none;
        }

        .ig-credentials-actions-list {
          display: grid;
          gap: 10px;
        }

        .ig-credentials-action {
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
        }

        .ig-credentials-action-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
        }

        .ig-credentials-action-title {
          display: grid;
          gap: 4px;
        }

        .ig-credentials-action-badges,
        .ig-credentials-action-meta,
        .ig-credentials-signals {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 2px;
        }

        .ig-credentials-action-badge,
        .ig-credentials-signal {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          border-radius: 999px;
          padding: 0 10px;
          font-size: 11px;
          font-weight: 900;
        }

        .ig-credentials-action-badge {
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.72);
        }

        .ig-credentials-signal {
          color: rgba(255,255,255,0.70);
        }

        .ig-credentials-action-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .ig-credentials-action-field {
          display: grid;
          gap: 4px;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          background: rgba(255,255,255,0.026);
          padding: 10px;
        }

        .ig-credentials-action-field strong {
          color: rgba(255,255,255,0.72);
          font-size: 12px;
          overflow-wrap: anywhere;
        }

        .ig-credentials-action-buttons {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .ig-credentials-action-buttons button,
        .ig-credentials-action-buttons a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 32px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.64);
          font-size: 12px;
          font-weight: 900;
          padding: 0 12px;
          text-decoration: none;
        }

        .ig-credentials-action-buttons button {
          color: rgba(255,255,255,0.36);
          cursor: not-allowed;
        }

        .ig-credentials-empty {
          place-items: center;
          min-height: 190px;
          text-align: center;
        }

        .ig-credentials-empty p {
          max-width: 520px;
          margin: 0;
        }

        @media (max-width: 1180px) {
          .ig-credentials-source-strip,
          .ig-credentials-kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ig-credentials-action {
            grid-template-columns: 1fr;
          }

          .ig-credentials-action-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ig-credentials-action-buttons {
            justify-content: flex-start;
          }
        }

        @media (max-width: 760px) {
          .ig-credentials-page {
            padding: 22px 14px 40px;
          }

          .ig-credentials-source-strip,
          .ig-credentials-kpis {
            grid-template-columns: 1fr;
          }

          .ig-credentials-action-header {
            display: grid;
          }

          .ig-credentials-action-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function SourcePill({ label, detail }: { label: string; detail: CredentialsActionsSourceDetail }) {
  return (
    <article className="ig-credentials-source-pill" title={detail.description}>
      <span>{label}</span>
      <strong>{detail.label}</strong>
      <small>{detail.description}</small>
    </article>
  );
}

function Kpi({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "warning" | "danger" }) {
  const colors = {
    neutral: "#f0f0ef",
    good: "#34D399",
    warning: "#FBBF24",
    danger: "#F87171",
  };

  return (
    <article className="ig-credentials-kpi">
      <span>{label}</span>
      <strong style={{ color: colors[tone] }}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AccountWorklist({ accounts }: { accounts: CredentialsActionAccount[] }) {
  if (!accounts.length) {
    return (
      <div className="ig-credentials-empty">
        <span>Empty state</span>
        <strong>No accounts found</strong>
        <p>No account rows were returned by the current Manage source.</p>
      </div>
    );
  }

  return (
    <div className="ig-credentials-table-wrap">
      <table className="ig-credentials-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Client</th>
            <th>Credentials</th>
            <th>Reauth</th>
            <th>Password display</th>
            <th>2FA display</th>
            <th>Login</th>
            <th>Provisioning</th>
            <th>Pending actions</th>
            <th>Blocking</th>
            <th>Last update</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.accountId || account.username}>
              <td>
                <Link className="ig-credentials-account-link" href={`/instagram-dashboard/accounts/${encodeURIComponent(account.accountId || account.username)}`}>
                  {account.username}
                </Link>
              </td>
              <td>{account.clientName ?? "unknown"}</td>
              <td style={{ color: statusTone(account.credentialsStatus), fontWeight: 900 }}>{account.credentialsStatus}</td>
              <td style={{ color: account.reauthRequired ? "#F87171" : "#34D399", fontWeight: 900 }}>{account.reauthRequired ? "required" : "no"}</td>
              <td>{account.passwordDisplay}</td>
              <td>{account.twoFactorDisplay}</td>
              <td style={{ color: statusTone(account.loginStatus), fontWeight: 900 }}>{account.loginStatus}</td>
              <td>{account.provisioningStatus}</td>
              <td>{formatInteger(account.pendingActionsCount)}</td>
              <td>{account.blockingCampaign ? "blocking" : "no"}</td>
              <td>{formatDateTime(account.lastSafeUpdate)}</td>
              <td>
                <Link className="ig-credentials-link" href="/instagram-dashboard">Open Manage</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionsList({ groups }: { groups: DashboardActionGroup[] }) {
  if (!groups.length) {
    return (
      <div className="ig-credentials-empty">
        <span>Empty state</span>
        <strong>No dashboard actions found</strong>
        <p>No derived dashboard actions were found. Dedicated account_dashboard_actions backend remains pending.</p>
      </div>
    );
  }

  return (
    <div className="ig-credentials-actions-list">
      {groups.map((group) => (
        <article className="ig-credentials-action" key={group.accountId || group.username}>
          <div>
            <div className="ig-credentials-action-header">
              <div className="ig-credentials-action-title">
                <span>Action required</span>
                <strong style={{ color: statusTone(group.severity) }}>{group.mainIssue}</strong>
                <p>{group.username}{group.clientName ? ` · ${group.clientName}` : ""}</p>
              </div>
              <div className="ig-credentials-action-badges" aria-label="Action status badges">
                <span className="ig-credentials-action-badge" style={{ color: statusTone(group.severity) }}>{group.severity}</span>
                <span className="ig-credentials-action-badge">{group.backendMutationStatus}</span>
              </div>
            </div>
            <p>{group.description}</p>
            <p><strong>Recommended action:</strong> {group.recommendedAction}</p>
            <div className="ig-credentials-action-meta">
              <span>Severity <strong>{group.severity}</strong></span>
              <span>Audience <strong>{group.audience}</strong></span>
              <span>Status <strong>{group.status}</strong></span>
              <span>Source <strong>{group.sourceLabel}</strong></span>
              <span>Backend <strong>{group.backendMutationStatus}</strong></span>
            </div>
            <div className="ig-credentials-action-grid" aria-label="Account action status">
              <ActionField label="Credentials" value={group.credentialsStatus} tone={group.credentialsStatus} />
              <ActionField label="Reauth" value={group.reauthRequired ? "required" : "no"} tone={group.reauthRequired ? "critical" : "ok" } />
              <ActionField label="Login" value={group.loginStatus} tone={group.loginStatus} />
              <ActionField label="Provisioning" value={group.provisioningStatus} tone={group.provisioningStatus} />
              <ActionField label="Pending actions" value={formatInteger(group.pendingActionsCount)} tone={group.pendingActionsCount ? "warning" : "ok"} />
              <ActionField label="Blocking campaign" value={group.blockingCampaign ? "yes" : "no"} tone={group.blockingCampaign ? "critical" : "ok"} />
              <ActionField label="Types" value={group.actionTypes.join(", ")} />
              <ActionField label="Account" value={group.username} />
            </div>
            <div className="ig-credentials-signals" aria-label="Action signals">
              {group.signals.map((signal) => (
                <span className="ig-credentials-signal" key={`${group.accountId}-${signal.actionType}-${signal.label}`} title={signal.detail}>
                  {signal.label}
                </span>
              ))}
            </div>
          </div>
          <div className="ig-credentials-action-buttons">
            <Link href={group.deepLink ?? `/instagram-dashboard/accounts/${encodeURIComponent(group.accountId || group.username)}`}>View Account</Link>
            <button type="button" disabled title="Requires account_dashboard_actions backend">Future: Resolve</button>
            <button type="button" disabled title="Requires account_dashboard_actions backend">Future: Acknowledge</button>
            <button type="button" disabled title="Requires account_dashboard_actions backend">Future: Dismiss</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ActionField({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="ig-credentials-action-field">
      <span>{label}</span>
      <strong style={tone ? { color: statusTone(tone) } : undefined}>{value || "unknown"}</strong>
    </span>
  );
}
