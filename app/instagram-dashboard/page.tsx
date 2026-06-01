import { notFound } from "next/navigation";
import Link from "next/link";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import AddProfileWizard from "./AddProfileWizard";
import InstagramDashboardButtons from "./InstagramDashboardButtons";
import InstagramDashboardViewNav from "./InstagramDashboardViewNav";
import {
  buildManageKpis,
  formatDateTime,
  formatInteger,
  getManageData,
  manageKpiTone,
  statusTone,
  type ManageAccount,
  type ManageOverview,
} from "./manage-data";

export const dynamic = "force-dynamic";

export default async function InstagramAutomationDashboardPage() {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const data = await getManageData();
  const manageKpis = buildManageKpis(data);

  return (
    <main className="dashboard-page ig-dashboard-page">
      <DashboardPageHeader
        eyebrow="Admin only"
        title="Instagram Automation Dashboard"
        description="Manage internal Instagram Accounts, device assignments, campaigns, recent run health, and automation activity from one private workspace."
        action={<InstagramDashboardViewNav active="manage" />}
      />

      {data.errors.length > 0 && (
        <section className="ig-dashboard-alert" role="alert">
          <strong>Manage data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <section className="ig-dashboard-kpis" aria-label="Instagram account totals">
        {manageKpis.map((kpi) => (
          <article key={kpi.label}>
            <span>{kpi.label}</span>
            <strong style={{ color: manageKpiTone(kpi) }}>{kpi.value}</strong>
            <small>{kpi.detail}</small>
          </article>
        ))}
      </section>

      <AnalyticsSectionCard
        eyebrow="Accounts"
        title="Instagram Accounts"
        description="Server-rendered account inventory with safe archive, trash, restore, and per-account control drawers."
      >
        <AccountLifecycleTabs data={data} />
      </AnalyticsSectionCard>

      <style>{`
        .ig-dashboard-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
        }

        .ig-dashboard-alert {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid rgba(248, 113, 113, 0.28);
          border-radius: 14px;
          background: rgba(248, 113, 113, 0.08);
          color: rgba(255,255,255,0.74);
          font-size: 13px;
        }

        .ig-dashboard-alert strong {
          color: #FCA5A5;
        }

        .ig-dashboard-kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }

        .ig-dashboard-kpis article,
        .ig-dashboard-mobile-card,
        .ig-dashboard-empty {
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.028);
          border-radius: 16px;
        }

        .ig-dashboard-kpis article {
          min-height: 132px;
          padding: 16px;
        }

        .ig-dashboard-kpis span,
        .ig-dashboard-table th,
        .ig-dashboard-mobile-card dt,
        .ig-dashboard-empty span {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-dashboard-kpis strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 2rem;
          line-height: 1;
          margin: 16px 0 10px;
        }

        .ig-dashboard-kpis small,
        .ig-dashboard-table td,
        .ig-dashboard-mobile-card dd {
          color: rgba(255,255,255,0.60);
          font-size: 12px;
        }

        .ig-dashboard-account-tabs {
          display: grid;
          gap: 16px;
        }

        .ig-dashboard-tab-input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }

        .ig-dashboard-tab-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ig-dashboard-tab-list {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ig-dashboard-tab-label {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-height: 36px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.035);
          color: rgba(255,255,255,0.58);
          cursor: pointer;
          font-size: 12px;
          font-weight: 900;
          padding: 0 13px;
        }

        .ig-dashboard-tab-label strong {
          display: inline-grid;
          place-items: center;
          min-width: 22px;
          height: 22px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.72);
          font-size: 11px;
        }

        .ig-dashboard-tab-panel {
          display: none;
        }

        #ig-account-tab-active:checked ~ .ig-dashboard-tab-list label[for="ig-account-tab-active"],
        #ig-account-tab-archives:checked ~ .ig-dashboard-tab-list label[for="ig-account-tab-archives"],
        #ig-account-tab-trash:checked ~ .ig-dashboard-tab-list label[for="ig-account-tab-trash"] {
          border-color: rgba(245,158,11,0.40);
          background: rgba(245,158,11,0.14);
          color: #FBBF24;
        }

        #ig-account-tab-active:checked ~ .ig-dashboard-tab-panel-active,
        #ig-account-tab-archives:checked ~ .ig-dashboard-tab-panel-archives,
        #ig-account-tab-trash:checked ~ .ig-dashboard-tab-panel-trash {
          display: block;
        }

        .ig-dashboard-table-wrap {
          overflow-x: auto;
        }

        .ig-dashboard-table {
          width: 100%;
          min-width: 1200px;
          border-collapse: separate;
          border-spacing: 0 8px;
        }

        .ig-dashboard-table th,
        .ig-dashboard-table td {
          padding: 12px 10px;
          text-align: left;
          vertical-align: middle;
        }

        .ig-dashboard-table tbody tr {
          background: rgba(255,255,255,0.025);
          outline: 1px solid rgba(255,255,255,0.07);
          outline-offset: -1px;
        }

        .ig-dashboard-table tbody td:first-child {
          border-radius: 14px 0 0 14px;
        }

        .ig-dashboard-table tbody td:last-child {
          border-radius: 0 14px 14px 0;
        }

        .ig-dashboard-table strong,
        .ig-dashboard-mobile-card strong {
          color: #f0f0ef;
          font-weight: 800;
        }

        .ig-dashboard-account-link,
        .ig-dashboard-mobile-detail-link {
          color: #f0f0ef;
          font-weight: 900;
          text-decoration: none;
        }

        .ig-dashboard-account-link:hover,
        .ig-dashboard-account-link:focus-visible,
        .ig-dashboard-mobile-detail-link:hover,
        .ig-dashboard-mobile-detail-link:focus-visible {
          color: #FBBF24;
          outline: none;
        }

        .ig-dashboard-mobile-detail-link {
          color: rgba(251,191,36,0.92);
          font-size: 12px;
        }

        .ig-dashboard-username-verification {
          margin-top: 4px;
          font-size: 11px;
          font-weight: 800;
        }

        .ig-dashboard-status {
          font-weight: 800;
          white-space: nowrap;
        }

        .ig-dashboard-row-tools {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
          min-width: 176px;
        }

        .ig-dashboard-tool {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          flex: 0 0 auto;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 10px;
          background: rgba(15,23,42,0.58);
          color: rgba(226,232,240,0.72);
          cursor: pointer;
          transition:
            border-color 160ms ease,
            background 160ms ease,
            box-shadow 160ms ease,
            color 160ms ease,
            transform 160ms ease;
        }

        .ig-dashboard-tool:hover,
        .ig-dashboard-tool:focus-visible {
          border-color: rgba(148,163,184,0.34);
          color: #E2E8F0;
          background: rgba(51,65,85,0.70);
          box-shadow: 0 0 0 1px rgba(148,163,184,0.10), 0 10px 26px rgba(15,23,42,0.28);
          transform: translateY(-1px);
          outline: none;
        }

        .ig-dashboard-tool:disabled {
          cursor: not-allowed;
          opacity: 0.42;
          transform: none;
        }

        .ig-dashboard-tool:disabled:hover,
        .ig-dashboard-tool:disabled:focus-visible {
          border-color: rgba(255,255,255,0.09);
          color: rgba(226,232,240,0.72);
          background: rgba(15,23,42,0.58);
          box-shadow: none;
          transform: none;
        }

        .ig-dashboard-tool-success:hover,
        .ig-dashboard-tool-success:focus-visible {
          border-color: rgba(52,211,153,0.34);
          color: #86EFAC;
          background: rgba(22,101,52,0.20);
          box-shadow: 0 0 0 1px rgba(52,211,153,0.10), 0 10px 26px rgba(22,101,52,0.20);
        }

        .ig-dashboard-tool-neutral:hover,
        .ig-dashboard-tool-neutral:focus-visible {
          border-color: rgba(203,213,225,0.30);
          color: #CBD5E1;
          background: rgba(71,85,105,0.28);
          box-shadow: 0 0 0 1px rgba(203,213,225,0.08), 0 10px 26px rgba(15,23,42,0.26);
        }

        .ig-dashboard-tool-danger:hover,
        .ig-dashboard-tool-danger:focus-visible {
          border-color: rgba(248,113,113,0.36);
          color: #FCA5A5;
          background: rgba(127,29,29,0.22);
          box-shadow: 0 0 0 1px rgba(248,113,113,0.10), 0 10px 26px rgba(127,29,29,0.22);
        }

        .ig-dashboard-tool::after {
          content: attr(data-tooltip);
          position: absolute;
          left: 50%;
          bottom: calc(100% + 9px);
          z-index: 4;
          width: max-content;
          max-width: 160px;
          padding: 6px 8px;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 8px;
          background: rgba(7,17,31,0.96);
          color: rgba(255,255,255,0.84);
          box-shadow: 0 12px 28px rgba(0,0,0,0.24);
          font-size: 11px;
          font-weight: 800;
          opacity: 0;
          pointer-events: none;
          transform: translate(-50%, 4px);
          transition: opacity 140ms ease, transform 140ms ease;
          white-space: nowrap;
        }

        .ig-dashboard-tool::before {
          content: "";
          position: absolute;
          left: 50%;
          bottom: calc(100% + 4px);
          z-index: 5;
          width: 8px;
          height: 8px;
          background: rgba(7,17,31,0.96);
          border-right: 1px solid rgba(255,255,255,0.10);
          border-bottom: 1px solid rgba(255,255,255,0.10);
          opacity: 0;
          pointer-events: none;
          transform: translate(-50%, 4px) rotate(45deg);
          transition: opacity 140ms ease, transform 140ms ease;
        }

        .ig-dashboard-tool:hover::after,
        .ig-dashboard-tool:hover::before,
        .ig-dashboard-tool:focus-visible::after,
        .ig-dashboard-tool:focus-visible::before {
          opacity: 1;
          transform: translate(-50%, 0);
        }

        .ig-dashboard-tool:hover::before,
        .ig-dashboard-tool:focus-visible::before {
          transform: translate(-50%, 0) rotate(45deg);
        }

        .ig-dashboard-mobile-list {
          display: none;
        }

        .ig-dashboard-mobile-card {
          padding: 16px;
        }

        .ig-dashboard-mobile-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .ig-dashboard-mobile-card-head div {
          display: grid;
          gap: 4px;
        }

        .ig-dashboard-mobile-card-head span {
          color: rgba(255,255,255,0.54);
          font-size: 12px;
          font-weight: 700;
        }

        .ig-dashboard-mobile-card dl {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin: 0 0 14px;
        }

        .ig-dashboard-mobile-card dt,
        .ig-dashboard-mobile-card dd {
          margin: 0;
        }

        .ig-dashboard-mobile-card dd {
          margin-top: 4px;
          overflow-wrap: anywhere;
        }

        .ig-dashboard-empty {
          display: grid;
          gap: 8px;
          place-items: center;
          min-height: 180px;
          padding: 28px;
          text-align: center;
        }

        .ig-dashboard-empty strong {
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 20px;
        }

        .ig-dashboard-empty p {
          color: rgba(255,255,255,0.48);
          font-size: 13px;
          line-height: 1.6;
          margin: 0;
          max-width: 420px;
        }

        @media (max-width: 1120px) {
          .ig-dashboard-kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

        }

        @media (max-width: 760px) {
          .ig-dashboard-page {
            padding: 22px 14px 40px;
          }

          .ig-dashboard-kpis {
            grid-template-columns: 1fr;
          }

          .ig-dashboard-table-wrap {
            display: none;
          }

          .ig-dashboard-mobile-list {
            display: grid;
            gap: 12px;
          }

          .ig-dashboard-mobile-card dl {
            grid-template-columns: 1fr;
          }

          .ig-dashboard-row-tools {
            min-width: 0;
          }

          .ig-dashboard-tool {
            width: 36px;
            height: 36px;
          }
        }
      `}</style>
    </main>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="ig-dashboard-empty">
      <span>Empty state</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function accountDetailHref(account: ManageAccount) {
  return `/instagram-dashboard/accounts/${encodeURIComponent(account.accountId || account.username)}`;
}

function AccountLifecycleTabs({ data }: { data: ManageOverview }) {
  const tabs = [
    {
      id: "active",
      label: "Active",
      accounts: data.activeAccounts,
      emptyTitle: "No active Instagram accounts found.",
      emptyText: "Restore archived or trashed accounts to return them to the active dashboard.",
    },
    {
      id: "archives",
      label: "Archives",
      accounts: data.archivedAccounts,
      emptyTitle: "No archived accounts.",
      emptyText: "Archived accounts stay recoverable here before they are eligible to move to trash.",
    },
    {
      id: "trash",
      label: "Trash",
      accounts: data.trashedAccounts,
      emptyTitle: "Trash is empty.",
      emptyText: "Trashed accounts stay recoverable here before future permanent cleanup is enabled.",
    },
  ] as const;

  if (data.allAccounts.length === 0) {
    return <EmptyState title="No Instagram accounts found." text="Add account records in Supabase to populate this admin dashboard." />;
  }

  return (
    <div className="ig-dashboard-account-tabs">
      {tabs.map((tab, index) => (
        <input
          key={`${tab.id}-input`}
          id={`ig-account-tab-${tab.id}`}
          className="ig-dashboard-tab-input"
          type="radio"
          name="ig-account-tab"
          defaultChecked={index === 0}
        />
      ))}
      <div className="ig-dashboard-tab-toolbar">
        <div className="ig-dashboard-tab-list" role="tablist" aria-label="Instagram account lifecycle views">
          {tabs.map((tab) => (
            <label key={`${tab.id}-label`} htmlFor={`ig-account-tab-${tab.id}`} className="ig-dashboard-tab-label">
              <span>{tab.label}</span>
              <strong>{formatInteger(tab.accounts.length)}</strong>
            </label>
          ))}
        </div>
        <AddProfileWizard />
      </div>
      {tabs.map((tab) => (
        <section key={tab.id} className={`ig-dashboard-tab-panel ig-dashboard-tab-panel-${tab.id}`}>
          <AccountList
            accounts={tab.accounts}
            mode={tab.id === "archives" ? "archived" : tab.id === "trash" ? "trashed" : "active"}
            emptyTitle={tab.emptyTitle}
            emptyText={tab.emptyText}
          />
        </section>
      ))}
    </div>
  );
}

function AccountList({
  accounts,
  mode,
  emptyTitle,
  emptyText,
}: {
  accounts: ManageAccount[];
  mode: "active" | "archived" | "trashed";
  emptyTitle: string;
  emptyText: string;
}) {
  if (accounts.length === 0) {
    return <EmptyState title={emptyTitle} text={emptyText} />;
  }

  return (
    <>
      <div className="ig-dashboard-table-wrap">
        <table className="ig-dashboard-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Client</th>
              <th>Subscription</th>
              <th>Package</th>
              <th>Add-ons</th>
              <th>Runtime profile</th>
              <th>Credentials</th>
              <th>Login</th>
              <th>Phone</th>
              <th>Mac/host</th>
              <th>{mode === "archived" ? "Scheduled trash" : mode === "trashed" ? "Scheduled delete" : "Created at"}</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.accountId || account.username}>
                <td>
                  <Link className="ig-dashboard-account-link" href={accountDetailHref(account)}>
                    {account.username}
                  </Link>
                  <UsernameVerificationStatus account={account} />
                </td>
                <td>{account.clientName ?? account.emailDisplay}</td>
                <td>
                  <span className="ig-dashboard-status" style={{ color: statusTone(account.subscriptionStatus) }}>
                    {account.subscriptionStatus}
                  </span>
                </td>
                <td>{account.packageLabel}</td>
                <td>
                  {account.commercialAddonsLabel}
                  <br />
                  <small>Outreach: {account.outreachSourceLabel}</small>
                </td>
                <td>{account.runtimeProfilesLabel}</td>
                <td style={{ color: statusTone(account.credentialsStatus) }}>{account.reauthRequired ? "reauth required" : account.credentialsStatus}</td>
                <td>
                  <span className="ig-dashboard-status" style={{ color: statusTone(account.loginStatus) }}>
                    {account.loginStatus}
                  </span>
                </td>
                <td>{account.phoneName}</td>
                <td>{account.macHostName}</td>
                <td>{mode === "archived" ? formatDateTime(account.scheduledTrashAt) : mode === "trashed" ? formatDateTime(account.scheduledDeleteAt) : formatDateTime(account.createdAt)}</td>
                <td>
                  <InstagramDashboardButtons
                    accountId={account.accountId || account.username}
                    username={account.username}
                    mode={mode}
                    packageLabel={account.packageLabel}
                    entitlementSummary={account.entitlementSummary}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ig-dashboard-mobile-list">
        {accounts.map((account) => (
          <article className="ig-dashboard-mobile-card" key={`${account.accountId || account.username}-mobile`}>
            <div className="ig-dashboard-mobile-card-head">
              <div>
                <strong>{account.username}</strong>
                <Link className="ig-dashboard-mobile-detail-link" href={accountDetailHref(account)}>
                  Details
                </Link>
                <span>{account.clientName ?? account.emailDisplay}</span>
              </div>
              <span style={{ color: statusTone(account.adminStatus) }}>{account.adminStatus}</span>
            </div>
            <dl>
              <div>
                <dt>Subscription</dt>
                <dd style={{ color: statusTone(account.subscriptionStatus) }}>{account.subscriptionStatus}</dd>
              </div>
              <div>
                <dt>Package</dt>
                <dd>{account.packageLabel}</dd>
              </div>
              <div>
                <dt>Add-ons</dt>
                <dd>{account.commercialAddonsLabel}</dd>
              </div>
              <div>
                <dt>Outreach source</dt>
                <dd>{account.outreachSourceLabel}</dd>
              </div>
              <div>
                <dt>Runtime profile</dt>
                <dd>{account.runtimeProfilesLabel}</dd>
              </div>
              <div>
                <dt>Credentials</dt>
                <dd style={{ color: statusTone(account.credentialsStatus) }}>{account.reauthRequired ? "reauth required" : account.credentialsStatus}</dd>
              </div>
              <div>
                <dt>Login</dt>
                <dd style={{ color: statusTone(account.loginStatus) }}>{account.loginStatus}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{account.phoneName}</dd>
              </div>
              <div>
                <dt>Mac/host</dt>
                <dd>{account.macHostName}</dd>
              </div>
              <div>
                <dt>{mode === "archived" ? "Scheduled trash" : mode === "trashed" ? "Scheduled delete" : "Created at"}</dt>
                <dd>{mode === "archived" ? formatDateTime(account.scheduledTrashAt) : mode === "trashed" ? formatDateTime(account.scheduledDeleteAt) : formatDateTime(account.createdAt)}</dd>
              </div>
            </dl>
            <InstagramDashboardButtons
              accountId={account.accountId || account.username}
              username={account.username}
              mode={mode}
              packageLabel={account.packageLabel}
              entitlementSummary={account.entitlementSummary}
            />
          </article>
        ))}
      </div>
    </>
  );
}

function UsernameVerificationStatus({ account }: { account: ManageAccount }) {
  const status = (account.instagramVerificationStatus ?? "").trim().toLowerCase();
  if (!status || status === "pending") return null;

  const label = status === "verified" || status === "matched"
    ? "username verified"
    : status === "mismatch"
      ? "username mismatch"
      : `username ${status}`;

  return (
    <div className="ig-dashboard-username-verification" style={{ color: statusTone(status) }}>
      {label}
    </div>
  );
}
