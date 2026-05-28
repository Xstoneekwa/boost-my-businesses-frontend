import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../InstagramDashboardViewNav";
import {
  formatDateTime,
  formatInteger,
  getRadarData,
  statusTone,
  type RadarAccount,
  type RadarDevice,
  type RadarRun,
  type RadarWarning,
} from "../radar-data";

export const dynamic = "force-dynamic";

export default async function InstagramRadarPage() {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const data = await getRadarData();
  const { summary } = data;

  return (
    <main className="dashboard-page ig-radar-page">
      <DashboardPageHeader
        eyebrow="Admin radar"
        title="Instagram Radar"
        description="Traceable diagnostic view for run health, account risk, device readiness, and recent automation warnings."
        action={<InstagramDashboardViewNav active="radar" />}
      />

      {data.errors.length > 0 && (
        <section className="ig-radar-alert" role="alert">
          <strong>Radar data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <section className="ig-radar-source-strip" aria-label="Radar data source status">
        <SourcePill label="Accounts" value={summary.sourceStatus.accounts} />
        <SourcePill label="Runs" value={summary.sourceStatus.runs} />
        <SourcePill label="Warnings" value={summary.sourceStatus.warnings} />
        <SourcePill label="Devices" value={summary.sourceStatus.devices} />
      </section>

      <section className="ig-radar-kpis" aria-label="Instagram radar summary">
        <RadarKpi label="Accounts watched" value={summary.totalAccounts} detail={`OK ${formatInteger(summary.okCount)} · Monitor ${formatInteger(summary.monitorCount)} · Problem ${formatInteger(summary.problemCount)}`} />
        <RadarKpi
          label="Running or queued"
          value={summary.runningCount + (summary.queuedCount ?? 0)}
          detail={`Running ${formatInteger(summary.runningCount)} · ${summary.queuedCount === null ? `Queued source ${summary.queuedSourceStatus}` : `Queued ${formatInteger(summary.queuedCount)}`}`}
          tone={summary.runningCount || summary.queuedCount ? "warning" : "neutral"}
        />
        <RadarKpi
          label="Run warnings"
          value={summary.runWarningsCount}
          detail={`Source: ${summary.sourceStatus.warnings}`}
          tone={summary.runWarningsCount ? "danger" : "good"}
        />
        <RadarKpi
          label="Risk accounts"
          value={summary.riskAccountsCount}
          detail={summary.riskAccountsCount ? "Click to inspect accounts" : "No risk accounts found"}
          tone={summary.riskAccountsCount ? "danger" : "good"}
          href="#risk-accounts"
        />
      </section>

      <section className="ig-radar-grid">
        <AnalyticsSectionCard
          eyebrow="Runs"
          title="Run radar"
          description="Latest run states from the stable Radar data contract. Queued is shown only when the source is connected."
        >
          <RunTable runs={data.runs.slice(0, 10)} emptyText="No runs found from current source." />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Warnings"
          title="Recent warning signals"
          description="Warnings consume the stable RadarWarning contract. Current source may still be legacy logs until incidents/runtime events are connected."
        >
          <WarningList warnings={data.warnings.slice(0, 10)} />
        </AnalyticsSectionCard>
      </section>

      <section id="risk-accounts" className="ig-radar-grid">
        <AnalyticsSectionCard
          eyebrow="Accounts"
          title="Accounts needing attention"
          description="Risk list uses RadarAccount fields: health, phone, Mac host, source, and latest safe update."
        >
          <RiskAccountList accounts={data.riskAccounts} />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Devices"
          title="Device readiness"
          description={data.devices.length ? "Read-only phone/device readiness from the RadarDevice contract." : "Device source pending. No devices found from current source."}
        >
          <DeviceTable devices={data.devices} />
        </AnalyticsSectionCard>
      </section>

      <style>{`
        .ig-radar-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
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
          border-radius: 14px;
          background: rgba(248,113,113,0.08);
          color: rgba(255,255,255,0.74);
          font-size: 13px;
        }

        .ig-radar-alert strong {
          color: #FCA5A5;
        }

        .ig-radar-source-strip,
        .ig-radar-kpis,
        .ig-radar-grid {
          display: grid;
          gap: 14px;
        }

        .ig-radar-source-strip {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 14px;
        }

        .ig-radar-source-pill {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          background: rgba(255,255,255,0.026);
          padding: 10px 12px;
        }

        .ig-radar-kpis {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-radar-kpi,
        .ig-radar-empty,
        .ig-radar-list article {
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.028);
          border-radius: 16px;
        }

        .ig-radar-kpi {
          display: block;
          min-height: 132px;
          padding: 16px;
          text-decoration: none;
        }

        .ig-radar-kpi-link {
          cursor: pointer;
          transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
        }

        .ig-radar-kpi-link:hover,
        .ig-radar-kpi-link:focus-visible {
          border-color: rgba(245,158,11,0.34);
          background: rgba(245,158,11,0.07);
          outline: none;
          transform: translateY(-1px);
        }

        .ig-radar-kpi span,
        .ig-radar-source-pill span,
        .ig-radar-table th,
        .ig-radar-empty span,
        .ig-radar-list span,
        .ig-radar-field-label {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-radar-kpi strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 2rem;
          line-height: 1;
          margin: 16px 0 10px;
        }

        .ig-radar-kpi small,
        .ig-radar-source-pill strong,
        .ig-radar-table td,
        .ig-radar-list p,
        .ig-radar-list small {
          color: rgba(255,255,255,0.60);
          font-size: 12px;
        }

        .ig-radar-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          margin-bottom: 18px;
          align-items: start;
        }

        .ig-radar-table-wrap {
          overflow-x: auto;
        }

        .ig-radar-table {
          width: 100%;
          min-width: 760px;
          border-collapse: collapse;
        }

        .ig-radar-table th,
        .ig-radar-table td {
          padding: 12px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          text-align: left;
          vertical-align: top;
        }

        .ig-radar-list {
          display: grid;
          gap: 10px;
        }

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

        .ig-radar-fields div {
          min-width: 0;
        }

        .ig-radar-field-value {
          display: block;
          margin-top: 4px;
          color: rgba(255,255,255,0.66);
          font-size: 12px;
          overflow-wrap: anywhere;
        }

        .ig-radar-list strong,
        .ig-radar-table td:first-child {
          color: #f0f0ef;
          font-weight: 900;
        }

        .ig-radar-list p {
          margin: 0;
          line-height: 1.5;
        }

        .ig-radar-empty {
          display: grid;
          gap: 8px;
          place-items: center;
          min-height: 180px;
          padding: 28px;
          text-align: center;
        }

        .ig-radar-empty strong {
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 20px;
        }

        .ig-radar-empty p {
          color: rgba(255,255,255,0.48);
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
          .ig-radar-page {
            padding: 22px 14px 40px;
          }

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

function SourcePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="ig-radar-source-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RadarKpi({
  label,
  value,
  detail,
  tone = "neutral",
  href,
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "good" | "warning" | "danger";
  href?: string;
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
      <a className="ig-radar-kpi ig-radar-kpi-link" href={href}>
        {content}
      </a>
    );
  }

  return <article className="ig-radar-kpi">{content}</article>;
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
    return <EmptyState title="No warning logs found." text="No legacy warning logs found. account_incidents/runtime_events source pending migration." />;
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

function RiskAccountList({ accounts }: { accounts: RadarAccount[] }) {
  if (!accounts.length) {
    return <EmptyState title="No risk accounts found" text="No problem, monitor, or unlinked warning accounts found from current sources." />;
  }

  return (
    <div className="ig-radar-list">
      {accounts.map((account) => (
        <article key={account.accountId || account.username}>
          <header>
            <div>
              <strong>{account.username}</strong>
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
    return <EmptyState title="Device source pending" text="No devices found from current source." />;
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
