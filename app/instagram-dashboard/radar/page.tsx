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
  type RadarAccount,
  type RadarDevice,
  type RadarRun,
  type RadarSourceStatus,
  type RadarWarning,
} from "../radar-data";

export const dynamic = "force-dynamic";

type AccountFilter = "all" | "ok" | "monitor" | "problem" | "risk";

const accountFilterLabels: Record<AccountFilter, string> = {
  all: "Accounts watched",
  ok: "OK accounts",
  monitor: "Monitor accounts",
  problem: "Problem accounts",
  risk: "Risk accounts",
};

function parseAccountFilter(value: string | string[] | undefined): AccountFilter | null {
  const filter = Array.isArray(value) ? value[0] : value;
  if (filter === "all" || filter === "ok" || filter === "monitor" || filter === "problem" || filter === "risk") return filter;
  return null;
}

export default async function InstagramRadarPage({
  searchParams,
}: {
  searchParams?: Promise<{ accountFilter?: string | string[] }>;
}) {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const data = await getRadarData();
  const { summary } = data;
  const activeAccountFilter = parseAccountFilter((await searchParams)?.accountFilter);
  const filteredAccounts =
    activeAccountFilter === "ok"
      ? data.accountBreakdown.okAccounts
      : activeAccountFilter === "monitor"
        ? data.accountBreakdown.monitorAccounts
        : activeAccountFilter === "problem"
          ? data.accountBreakdown.problemAccounts
          : activeAccountFilter === "risk"
            ? data.accountBreakdown.riskAccounts
            : activeAccountFilter === "all"
              ? data.accounts
              : [];

  return (
    <main id="radar-top" className="dashboard-page ig-radar-page">
      <DashboardPageHeader
        eyebrow="Admin radar"
        title="Instagram Radar"
        description="Traceable diagnostic view for run health, account risk, device readiness, and recent automation warnings."
      />

      {data.errors.length > 0 && (
        <section className="ig-radar-alert" role="alert">
          <strong>Radar data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <section className="ig-radar-source-strip" aria-label="Radar data source status">
        <SourcePill label="Backend API" source={summary.sourceStatus.backendApi} />
        <SourcePill label="Accounts" source={summary.sourceStatus.accounts} />
        <SourcePill label="Runs" source={summary.sourceStatus.runs} />
        <SourcePill label="Warnings" source={summary.sourceStatus.warnings} />
        <SourcePill label="Devices" source={summary.sourceStatus.devices} />
      </section>

      <section className="ig-radar-api-note" aria-label="Backend API readiness">
        <span>Backend API</span>
        <strong>{summary.sourceStatus.backendApi.label}</strong>
        <small>{summary.sourceStatus.backendApi.description}</small>
      </section>

      <section className="ig-radar-kpis" aria-label="Instagram radar summary">
        <AccountsWatchedKpi summary={summary} activeFilter={activeAccountFilter} />
        <RadarKpi
          label="Risk accounts"
          value={summary.riskAccountsCount}
          detail={summary.riskAccountsCount ? "Click to inspect accounts" : "No risk accounts found"}
          tone={summary.riskAccountsCount ? "danger" : "good"}
          href="/instagram-dashboard/radar?accountFilter=risk#account-drilldown"
          active={activeAccountFilter === "risk"}
        />
        <RadarKpi
          label="Running or queued"
          value={summary.runningCount + (summary.queuedCount ?? 0)}
          detail={`Running: ${formatInteger(summary.runningCount)} · Queued: ${summary.queuedCount === null ? "unknown" : formatInteger(summary.queuedCount)}`}
          tone={summary.runningCount || summary.queuedCount ? "warning" : "neutral"}
        />
        <RadarKpi
          label="Run warnings"
          value={summary.runWarningsCount}
          detail={summary.sourceStatus.warnings.description}
          tone={summary.runWarningsCount ? "danger" : "good"}
        />
      </section>

      {activeAccountFilter ? (
        <section id="account-drilldown">
          <AnalyticsSectionCard
            eyebrow="Account drilldown"
            title={accountFilterLabels[activeAccountFilter]}
            description={`${formatInteger(filteredAccounts.length)} accounts in current filter. Warnings not linked to an account remain visible in Recent warning signals.`}
          >
            <AccountDrilldown filter={activeAccountFilter} accounts={filteredAccounts} />
          </AnalyticsSectionCard>
        </section>
      ) : null}

      <section id="accounts-needing-attention" className="ig-radar-grid">
        <AnalyticsSectionCard
          eyebrow="Accounts"
          title="Accounts needing attention"
          description="Daily worklist from RadarAccount and ServerCheckItem signals: problem, monitor, linked warnings, and unlinked warnings."
        >
          <RiskAccountList accounts={data.riskAccounts} warningCount={data.warnings.length} />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Runs"
          title="Run radar"
          description={summary.sourceStatus.runs.description}
        >
          <RunTable runs={data.runs.slice(0, 10)} emptyText="No runs found from current run source." />
        </AnalyticsSectionCard>
      </section>

      <section className="ig-radar-grid">
        <AnalyticsSectionCard
          eyebrow="Warnings"
          title="Recent warning signals"
          description={summary.sourceStatus.warnings.description}
        >
          <div id="recent-warning-signals">
            <WarningList warnings={data.warnings.slice(0, 10)} />
          </div>
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Devices"
          title="Device readiness"
          description={summary.sourceStatus.devices.description}
        >
          <DeviceTable devices={data.devices} />
        </AnalyticsSectionCard>
      </section>
      <style>{`
        .ig-radar-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 22px 22px 48px;
          scroll-behavior: smooth;
        }

        .ig-radar-alert {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid rgba(248,113,113,0.28);
          border-radius: 8px;
          background: rgba(248,113,113,0.08);
          color: rgba(255,255,255,0.74);
          font-size: 13px;
        }
        .ig-radar-alert strong { color: #fca5a5; }

        .ig-radar-source-strip,
        .ig-radar-kpis,
        .ig-radar-grid {
          display: grid;
          gap: 12px;
        }

        .ig-radar-source-strip {
          grid-template-columns: repeat(5, minmax(0, 1fr));
          margin-bottom: 14px;
        }

        .ig-radar-api-note {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 14px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: rgba(255,255,255,.025);
          padding: 10px 12px;
        }

        .ig-radar-source-pill {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #161820;
          padding: 10px 12px;
        }

        .ig-radar-kpis {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-radar-kpi,
        .ig-radar-empty,
        .ig-radar-list article {
          border: 1px solid rgba(255,255,255,.07);
          background: #161820;
          border-radius: 8px;
        }

        .ig-radar-kpi {
          display: block;
          min-height: 120px;
          padding: 14px 16px;
          text-decoration: none;
        }

        .ig-radar-account-kpi { display: grid; gap: 12px; }

        .ig-radar-kpi-link {
          cursor: pointer;
          transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
        }

        .ig-radar-kpi-link:hover,
        .ig-radar-kpi-link:focus-visible {
          border-color: rgba(101,88,245,.28);
          background: rgba(101,88,245,.08);
          outline: none;
          transform: translateY(-1px);
        }

        .ig-radar-kpi-active {
          border-color: rgba(101,88,245,.35);
          background: rgba(101,88,245,.10);
        }

        .ig-radar-account-total { text-decoration: none; }

        .ig-radar-account-pills { display: flex; flex-wrap: wrap; gap: 8px; }

        .ig-radar-account-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 26px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 999px;
          color: #8a8f98;
          font-size: 11px;
          font-weight: 700;
          padding: 0 10px;
          text-decoration: none;
          transition: all .13s ease;
        }

        .ig-radar-account-pill:hover,
        .ig-radar-account-pill:focus-visible,
        .ig-radar-account-pill-active {
          border-color: rgba(101,88,245,.35);
          background: rgba(101,88,245,.14);
          color: #a594f9;
          outline: none;
        }

        .ig-radar-kpi span,
        .ig-radar-api-note span,
        .ig-radar-source-pill span,
        .ig-radar-table th,
        .ig-radar-empty span,
        .ig-radar-list span,
        .ig-radar-field-label {
          color: #4a4f5c;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .ig-radar-kpi strong {
          display: block;
          color: #f0f0ee;
          font-size: 1.85rem;
          font-weight: 700;
          line-height: 1;
          margin: 14px 0 8px;
        }

        .ig-radar-kpi small,
        .ig-radar-api-note small,
        .ig-radar-source-pill strong,
        .ig-radar-table td,
        .ig-radar-list p,
        .ig-radar-list small {
          color: #8a8f98;
          font-size: 12px;
        }

        .ig-radar-api-note strong {
          color: #8a8f98;
          font-size: 12px;
          text-transform: uppercase;
        }

        .ig-radar-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          margin-bottom: 18px;
          align-items: start;
        }

        #account-drilldown { margin-bottom: 18px; scroll-margin-top: 20px; }

        .ig-radar-drilldown-header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }

        .ig-radar-back-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 30px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 999px;
          color: #8a8f98;
          font-size: 12px;
          font-weight: 700;
          padding: 0 12px;
          text-decoration: none;
          transition: all .13s ease;
        }

        .ig-radar-back-link:hover,
        .ig-radar-back-link:focus-visible {
          border-color: rgba(101,88,245,.35);
          color: #a594f9;
          outline: none;
        }

        .ig-radar-table-wrap { overflow-x: auto; }

        .ig-radar-table {
          width: 100%;
          min-width: 760px;
          border-collapse: collapse;
        }

        .ig-radar-table th {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: #4a4f5c;
          padding: 8px 10px;
          text-align: left;
          border-bottom: 1px solid rgba(255,255,255,.07);
        }

        .ig-radar-table td {
          padding: 9px 10px;
          border-bottom: 1px solid rgba(255,255,255,.04);
          text-align: left;
          vertical-align: top;
          color: #8a8f98;
          font-size: 12px;
        }

        .ig-radar-table tbody tr:last-child td { border-bottom: none; }
        .ig-radar-table tbody tr:hover { background: rgba(255,255,255,.02); }

        .ig-radar-list { display: grid; gap: 10px; }

        .ig-radar-list article {
          display: grid;
          gap: 10px;
          padding: 13px;
        }

        .ig-radar-list article header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .ig-radar-fields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px 12px;
        }

        .ig-radar-fields div { min-width: 0; }

        .ig-radar-field-value {
          display: block;
          margin-top: 4px;
          color: #8a8f98;
          font-size: 12px;
          overflow-wrap: anywhere;
        }

        .ig-radar-list strong,
        .ig-radar-table td:first-child {
          color: #f0f0ee;
          font-weight: 700;
        }

        .ig-radar-account-link {
          color: #f0f0ee;
          font-weight: 700;
          text-decoration: none;
          transition: color .13s ease;
        }

        .ig-radar-account-link:hover,
        .ig-radar-account-link:focus-visible {
          color: #a594f9;
          outline: none;
        }

        .ig-radar-list p { margin: 0; line-height: 1.5; }

        .ig-radar-empty {
          display: grid;
          gap: 8px;
          place-items: center;
          min-height: 180px;
          padding: 28px;
          text-align: center;
        }

        .ig-radar-empty strong {
          color: #f0f0ee;
          font-size: 17px;
          font-weight: 700;
        }

        .ig-radar-empty p {
          color: #8a8f98;
          font-size: 13px;
          line-height: 1.6;
          margin: 0;
          max-width: 420px;
        }

        @media (max-width: 1120px) {
          .ig-radar-source-strip,
          .ig-radar-kpis,
          .ig-radar-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .ig-radar-page { padding: 16px 14px 40px; }
          .ig-radar-source-strip,
          .ig-radar-kpis,
          .ig-radar-grid,
          .ig-radar-fields {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function SourcePill({ label, source }: { label: string; source: RadarSourceStatus }) {
  return (
    <div className="ig-radar-source-pill" title={source.description}>
      <span>{label}</span>
      <strong>{source.label}</strong>
    </div>
  );
}

function AccountsWatchedKpi({
  summary,
  activeFilter,
}: {
  summary: {
    totalAccounts: number;
    okCount: number;
    monitorCount: number;
    problemCount: number;
  };
  activeFilter: AccountFilter | null;
}) {
  return (
    <article className={activeFilter === "all" ? "ig-radar-kpi ig-radar-account-kpi ig-radar-kpi-active" : "ig-radar-kpi ig-radar-account-kpi"}>
      <Link className="ig-radar-account-total" href="/instagram-dashboard/radar?accountFilter=all#account-drilldown">
        <span>Accounts watched</span>
        <strong>{formatInteger(summary.totalAccounts)}</strong>
      </Link>
      <div className="ig-radar-account-pills" aria-label="Account status filters">
        <AccountPill label="OK" value={summary.okCount} filter="ok" activeFilter={activeFilter} />
        <AccountPill label="Monitor" value={summary.monitorCount} filter="monitor" activeFilter={activeFilter} />
        <AccountPill label="Problem" value={summary.problemCount} filter="problem" activeFilter={activeFilter} />
      </div>
    </article>
  );
}

function AccountPill({ label, value, filter, activeFilter }: { label: string; value: number; filter: AccountFilter; activeFilter: AccountFilter | null }) {
  return (
    <Link
      className={activeFilter === filter ? "ig-radar-account-pill ig-radar-account-pill-active" : "ig-radar-account-pill"}
      href={`/instagram-dashboard/radar?accountFilter=${filter}#account-drilldown`}
    >
      {label} {formatInteger(value)}
    </Link>
  );
}

function RadarKpi({
  label,
  value,
  detail,
  tone = "neutral",
  href,
  active = false,
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "good" | "warning" | "danger";
  href?: string;
  active?: boolean;
}) {
  const color = tone === "good" ? "#34D399" : tone === "warning" ? "#FBBF24" : tone === "danger" ? "#F87171" : "#f0f0ef";
  const content = (
    <>
      <span>{label}</span>
      <strong style={{ color }}>{formatInteger(value)}</strong>
      <small>{detail}</small>
    </>
  );

  if (href) {
    return (
      <Link className={active ? "ig-radar-kpi ig-radar-kpi-link ig-radar-kpi-active" : "ig-radar-kpi ig-radar-kpi-link"} href={href}>
        {content}
      </Link>
    );
  }

  return <article className="ig-radar-kpi">{content}</article>;
}

function AccountDrilldown({ filter, accounts }: { filter: AccountFilter; accounts: RadarAccount[] }) {
  return (
    <div>
      <div className="ig-radar-drilldown-header">
        <span className="ig-radar-field-label">Active filter: {accountFilterLabels[filter]}</span>
        <Link className="ig-radar-back-link" href="/instagram-dashboard/radar#radar-top">
          Back to Radar
        </Link>
      </div>
      <AccountDrilldownTable accounts={accounts} emptyTitle={`No ${accountFilterLabels[filter].toLowerCase()} found`} />
    </div>
  );
}

function AccountDrilldownTable({ accounts, emptyTitle }: { accounts: RadarAccount[]; emptyTitle: string }) {
  if (!accounts.length) {
    return <EmptyState title={emptyTitle} text="No accounts found for this filter. Unlinked warnings remain visible in Recent warning signals." />;
  }

  return (
    <div className="ig-radar-table-wrap">
      <table className="ig-radar-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Health</th>
            <th>Reason</th>
            <th>Problem type</th>
            <th>Latest warning</th>
            <th>Phone</th>
            <th>Mac/host</th>
            <th>Last update</th>
            <th>Source</th>
            <th>Recommended action</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.accountId || account.username}>
              <td>
                <Link className="ig-radar-account-link" href={`/instagram-dashboard/accounts/${encodeURIComponent(account.accountId || account.username)}?from=radar`}>
                  {account.username}
                </Link>
              </td>
              <td style={{ color: statusTone(account.healthStatus), fontWeight: 900 }}>{account.healthStatus}</td>
              <td>{account.healthReason}</td>
              <td>{account.latestWarning?.warningType ?? account.latestIncidentSeverity}</td>
              <td>{account.latestWarning ? `${account.latestWarning.message} · ${formatDateTime(account.latestWarning.timestamp)}` : "none from current source"}</td>
              <td>{account.phoneName}</td>
              <td>{account.macHostName}</td>
              <td>{formatDateTime(account.lastSafeUpdate)}</td>
              <td>{account.sourceLabel}</td>
              <td>{account.recommendedAction}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunTable({ runs, emptyText }: { runs: RadarRun[]; emptyText: string }) {
  if (!runs.length) return <EmptyState title="No runs found." text={emptyText} />;

  return (
    <div className="ig-radar-table-wrap">
      <table className="ig-radar-table">
        <thead>
          <tr>
            <th>Run ID</th>
            <th>Account</th>
            <th>Status</th>
            <th>Phone</th>
            <th>Mac/host</th>
            <th>Started</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.runId}>
              <td>{run.runId}</td>
              <td>{run.username ?? "account unknown"}</td>
              <td style={{ color: statusTone(run.status), fontWeight: 900 }}>{run.status}</td>
              <td>{run.phoneName}</td>
              <td>{run.macHostName}</td>
              <td>{formatDateTime(run.startedAt)}</td>
              <td>{formatDateTime(run.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WarningList({ warnings }: { warnings: RadarWarning[] }) {
  if (!warnings.length) {
    return <EmptyState title="No warning logs found." text="No warning signals found from current sources." />;
  }

  return (
    <div className="ig-radar-list">
      {warnings.map((warning) => (
        <article key={warning.id}>
          <header>
            <div>
              <strong>{warning.username ?? "account unknown"}</strong>
              <span>{warning.sourceLabel}</span>
            </div>
            <small style={{ color: statusTone(warning.severity) }}>{warning.severity}</small>
          </header>
          <p>{warning.message}</p>
          <div className="ig-radar-fields">
            <Field label="linked account" value={warning.isLinkedToAccount ? "yes" : "unlinked warning"} />
            <Field label="type" value={warning.warningType} />
            <Field label="run_id" value={warning.runId ?? "run unknown"} />
            <Field label="timestamp" value={formatDateTime(warning.timestamp)} />
            <Field label="phone" value={warning.phoneName} />
            <Field label="Mac/host" value={warning.macHostName} />
          </div>
        </article>
      ))}
    </div>
  );
}

function RiskAccountList({ accounts, warningCount }: { accounts: RadarAccount[]; warningCount: number }) {
  if (!accounts.length) {
    return <EmptyState title="No risk accounts found" text={warningCount ? "No linked risk accounts found. Unlinked warnings remain visible in Recent warning signals." : "No problem, monitor, or linked warning accounts found from current sources."} />;
  }

  return (
    <div className="ig-radar-list">
      {accounts.map((account) => (
        <article key={account.accountId || account.username}>
          <header>
            <div>
              <strong>{account.username}</strong>
              <Link className="ig-radar-account-link" href={`/instagram-dashboard/accounts/${encodeURIComponent(account.accountId || account.username)}?from=radar`}>
                Details
              </Link>
              <span>{account.sourceLabel}</span>
            </div>
            <small style={{ color: statusTone(account.healthStatus) }}>{account.healthStatus}</small>
          </header>
          <p>{account.healthReason}</p>
          <div className="ig-radar-fields">
            <Field label="admin_status" value={account.adminStatus} />
            <Field label="login_status" value={account.loginStatus} />
            <Field label="credentials" value={account.credentialsStatus} />
            <Field label="pending actions" value={formatInteger(account.pendingActionsCount)} />
            <Field label="phone" value={account.phoneName} />
            <Field label="Mac/host" value={account.macHostName} />
            <Field label="last update" value={formatDateTime(account.lastSafeUpdate)} />
            <Field label="recommended action" value="Review in Manage" />
          </div>
        </article>
      ))}
    </div>
  );
}

function DeviceTable({ devices }: { devices: RadarDevice[] }) {
  if (!devices.length) {
    return <EmptyState title="No devices found" text="No devices found from current source." />;
  }

  return (
    <div className="ig-radar-table-wrap">
      <table className="ig-radar-table">
        <thead>
          <tr>
            <th>Mac/host</th>
            <th>Phone/device</th>
            <th>Status</th>
            <th>Health</th>
            <th>Accounts</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.deviceId ?? `${device.macHostName}-${device.phoneName}`}>
              <td>{device.macHostName}</td>
              <td>{device.phoneName}</td>
              <td style={{ color: statusTone(device.healthStatus), fontWeight: 900 }}>{device.statusLabel}</td>
              <td>{device.healthStatus}</td>
              <td>{device.accountsCount === null ? "unknown" : formatInteger(device.accountsCount)}</td>
              <td>{formatDateTime(device.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="ig-radar-field-label">{label}</span>
      <span className="ig-radar-field-value">{value}</span>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="ig-radar-empty">
      <span>Empty state</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
