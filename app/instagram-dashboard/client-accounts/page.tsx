import Link from "next/link";
import { notFound } from "next/navigation";
import { KeyRound, LifeBuoy, RefreshCw, UserRound, type LucideIcon } from "lucide-react";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../InstagramDashboardViewNav";
import AccountStatusActionMenu from "./AccountStatusActionMenu";
import {
  getClientAccountsOperationsData,
  type ClientAccountOperationsItem,
  type ClientAccountOperationsStatus,
} from "../client-accounts-data";
import { formatDateTime, formatInteger, statusTone } from "../manage-data";
import { getRadarData } from "../radar-data";

export const dynamic = "force-dynamic";

type FilterKey = "all" | ClientAccountOperationsStatus | "needs-assistance";

const filterOptions: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "onboarding", label: "Onboarding" },
  { key: "paused", label: "Paused" },
  { key: "cancelled", label: "Cancelled" },
  { key: "needs-assistance", label: "Needs assistance" },
];

function parseFilter(value: string | string[] | undefined): FilterKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return filterOptions.some((option) => option.key === raw) ? (raw as FilterKey) : "all";
}

function filterHref(filter: FilterKey) {
  if (filter === "all") return "/instagram-dashboard/client-accounts";
  return `/instagram-dashboard/client-accounts?status=${encodeURIComponent(filter)}`;
}

function filteredItems(items: ClientAccountOperationsItem[], filter: FilterKey) {
  if (filter === "all") return items;
  if (filter === "needs-assistance") return items.filter((item) => item.needsAssistance);
  return items.filter((item) => item.operationsStatus === filter);
}

function countForFilter(items: ClientAccountOperationsItem[], filter: FilterKey) {
  return filteredItems(items, filter).length;
}

export default async function InstagramClientAccountsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string | string[] }>;
}) {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const query = await searchParams;
  const activeFilter = parseFilter(query?.status);
  const [data, radarData] = await Promise.all([getClientAccountsOperationsData(), getRadarData()]);
  const visibleItems = filteredItems(data.items, activeFilter);

  return (
    <main className="dashboard-page ig-client-accounts-page">
      <DashboardPageHeader
        eyebrow="Accounts"
        title="Client Accounts"
        description=""
        action={<InstagramDashboardViewNav active="client-accounts" badges={{ radar: radarData.notificationSummary.radarBadgeCount, "server-check": radarData.notificationSummary.serverCheckBadgeCount }} notificationItems={{ radar: radarData.notificationItems.radar, "server-check": radarData.notificationItems.serverCheck }} />}
      />

      {data.errors.length > 0 && (
        <section className="ig-client-accounts-alert" role="alert">
          <strong>Client accounts data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <section className="ig-client-accounts-kpis" aria-label="Client Accounts summary">
        <Kpi label="Total" value={formatInteger(data.summary.total)} detail="Safe account rows" />
        <Kpi label="Active" value={formatInteger(data.summary.active)} detail="Lifecycle active + admin active" tone="good" />
        <Kpi label="Pending" value={formatInteger(data.summary.pending)} detail="Pending customer, subscription, or provisioning" tone={data.summary.pending ? "warning" : "neutral"} />
        <Kpi label="Onboarding" value={formatInteger(data.summary.onboarding)} detail="Onboarding status projection" tone={data.summary.onboarding ? "warning" : "neutral"} />
        <Kpi label="Paused" value={formatInteger(data.summary.paused)} detail="Paused business status" tone={data.summary.paused ? "warning" : "neutral"} />
        <Kpi label="Cancelled" value={formatInteger(data.summary.cancelled)} detail="Cancelled customer/subscription status" tone={data.summary.cancelled ? "danger" : "neutral"} />
        <Kpi label="Needs assistance" value={formatInteger(data.summary.needsAssistance)} detail={`${formatInteger(data.summary.reauthRequired)} reauth required`} tone={data.summary.needsAssistance ? "danger" : "good"} />
      </section>

      <AnalyticsSectionCard
        eyebrow="Client accounts"
        title="Account operations worklist"
      >
        <FilterBar items={data.items} activeFilter={activeFilter} />
        <ClientAccountsTable items={visibleItems} />
      </AnalyticsSectionCard>

      <style>{`
        .ig-client-accounts-page {
          max-width: 1480px;
          margin: 0 auto;
          padding: 22px 22px 48px;
        }

        .ig-client-accounts-page .dashboard-page-copy {
          display: none;
        }

        .ig-client-accounts-alert {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid rgba(248,113,113,0.28);
          border-radius: 8px;
          background: rgba(248,113,113,0.08);
          color: #8a8f98;
          font-size: 13px;
        }

        .ig-client-accounts-alert strong {
          color: #fca5a5;
        }

        .ig-client-accounts-kpis {
          display: grid;
          gap: 14px;
        }

        .ig-client-accounts-kpis {
          grid-template-columns: repeat(7, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-client-accounts-kpi,
        .ig-client-accounts-empty {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #161820;
        }

        .ig-client-accounts-empty {
          display: grid;
          gap: 8px;
          padding: 14px;
        }

        .ig-client-accounts-kpi {
          min-height: 122px;
          padding: 16px;
        }

        .ig-client-accounts-kpi span,
        .ig-client-accounts-filters span,
        .ig-client-accounts-table th,
        .ig-client-accounts-status-select-label,
        .ig-client-accounts-empty span {
          color: #4a4f5c;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .ig-client-accounts-empty strong {
          color: #f0f0ee;
          font-size: 14px;
        }

        .ig-client-accounts-kpi small,
        .ig-client-accounts-table td,
        .ig-client-accounts-empty p {
          color: #8a8f98;
          font-size: 12px;
          line-height: 1.5;
        }

        .ig-client-accounts-kpi strong {
          display: block;
          color: #f0f0ee;
          
          font-size: 1.55rem;
          line-height: 1;
          margin: 16px 0 10px;
        }

        .ig-client-accounts-filters {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
          align-items: center;
          gap: 8px;
          margin-bottom: 14px;
          padding: 8px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 18px;
          background: #161820;
        }

        .ig-client-accounts-filter {
          display: inline-flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-height: 36px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 999px;
          color: rgba(255,255,255,0.68);
          font-size: 12px;
          font-weight: 900;
          padding: 0 12px;
          text-decoration: none;
          white-space: nowrap;
          min-width: 0;
        }

        .ig-client-accounts-filter strong {
          color: inherit;
          font-size: 12px;
        }

        .ig-client-accounts-filter-active {
          border-color: rgba(101,88,245,.28);
          background: rgba(101,88,245,.12);
          color: #a594f9;
        }

        .ig-client-accounts-table-wrap {
          overflow-x: auto;
        }

        .ig-client-accounts-table {
          width: 100%;
          min-width: 1040px;
          border-collapse: separate;
          border-spacing: 0 10px;
          table-layout: fixed;
        }

        .ig-client-accounts-table th {
          padding: 0 12px 8px;
          text-align: left;
          vertical-align: bottom;
        }

        .ig-client-accounts-table td {
          background: #1e2028;
          border-bottom: 1px solid rgba(255,255,255,.04);
          border-top: 1px solid rgba(255,255,255,.04);
          padding: 14px 12px;
          vertical-align: middle;
        }

        .ig-client-accounts-table th:nth-child(3),
        .ig-client-accounts-table th:nth-child(4),
        .ig-client-accounts-table th:nth-child(5),
        .ig-client-accounts-table th:nth-child(7),
        .ig-client-accounts-table td:nth-child(3),
        .ig-client-accounts-table td:nth-child(4),
        .ig-client-accounts-table td:nth-child(5) {
          text-align: center;
        }

        .ig-client-accounts-table th:nth-child(7),
        .ig-client-accounts-table td:nth-child(7) {
          text-align: right;
        }

        .ig-client-accounts-table td:nth-child(3),
        .ig-client-accounts-table td:nth-child(4) {
          white-space: nowrap;
        }

        .ig-client-accounts-table td:nth-child(2) {
          overflow-wrap: anywhere;
        }

        .ig-client-accounts-table td:first-child {
          border-left: 1px solid rgba(255,255,255,.04);
          border-radius: 8px 0 0 8px;
        }

        .ig-client-accounts-table td:last-child {
          border-right: 1px solid rgba(255,255,255,.04);
          border-radius: 0 8px 8px 0;
        }

        .ig-client-accounts-account-row {
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr);
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .ig-client-accounts-avatar {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(101,88,245,.16), rgba(255,255,255,.04));
          color: #8a8f98;
          font-size: 13px;
          font-weight: 900;
          line-height: 1;
          text-transform: uppercase;
        }

        .ig-client-accounts-avatar-object {
          background: rgba(255,255,255,0.055);
        }

        .ig-client-accounts-avatar-fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
        }

        .ig-client-accounts-account-cell,
        .ig-client-accounts-status-cell {
          display: grid;
          gap: 6px;
          min-width: 0;
        }

        .ig-client-accounts-account-link,
        .ig-client-accounts-action-link {
          color: #f0f0ee;
          font-weight: 900;
          text-decoration: none;
        }

        .ig-client-accounts-account-link:hover,
        .ig-client-accounts-account-link:focus-visible,
        .ig-client-accounts-action-link:hover,
        .ig-client-accounts-action-link:focus-visible {
          color: #a594f9;
          outline: none;
        }

        .ig-client-accounts-account-cell small,
        .ig-client-accounts-status-cell small {
          color: rgba(255,255,255,0.46);
          font-size: 11px;
          overflow-wrap: anywhere;
        }

        .ig-client-accounts-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: fit-content;
          min-height: 28px;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 999px;
          background: rgba(255,255,255,0.045);
          color: #8a8f98;
          font-size: 11px;
          font-weight: 900;
          padding: 0 10px;
          white-space: nowrap;
        }

        .ig-client-accounts-table td:nth-child(3) .ig-client-accounts-badge,
        .ig-client-accounts-table td:nth-child(4) .ig-client-accounts-badge {
          margin: 0 auto;
        }

        .ig-client-accounts-badge-warning {
          border-color: rgba(101,88,245,.28);
          background: rgba(101,88,245,.12);
          color: #a594f9;
        }

        .ig-client-accounts-badge-danger {
          border-color: rgba(248,113,113,0.34);
          background: rgba(248,113,113,0.12);
          color: #fca5a5;
        }

        .ig-client-accounts-badge-good {
          border-color: rgba(52,211,153,0.30);
          background: rgba(52,211,153,0.12);
          color: #86efac;
        }

        .ig-client-accounts-actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          flex-wrap: nowrap;
          min-width: 0;
        }

        .ig-client-accounts-status-menu {
          position: relative;
          display: inline-flex;
        }

        .ig-client-accounts-action-link,
        .ig-client-accounts-action-disabled {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          min-height: 34px;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 10px;
          background: #1e2028;
          color: #8a8f98;
          padding: 0;
          transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
        }

        .ig-client-accounts-action-link:hover,
        .ig-client-accounts-action-link:focus-visible {
          border-color: rgba(101,88,245,.32);
          background: rgba(101,88,245,.12);
          color: #a594f9;
        }

        .ig-client-accounts-action-link svg,
        .ig-client-accounts-action-disabled svg {
          width: 16px;
          height: 16px;
        }

        .ig-client-accounts-action-disabled {
          color: rgba(255,255,255,0.34);
          cursor: not-allowed;
          opacity: 0.72;
        }

        .ig-client-accounts-status-popover {
          position: absolute;
          z-index: 20;
          right: 0;
          top: calc(100% + 8px);
          display: grid;
          gap: 6px;
          width: 238px;
          padding: 8px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: rgba(9,14,28,0.98);
          box-shadow: 0 18px 40px rgba(0,0,0,0.34);
        }

        .ig-client-accounts-status-menu-item {
          display: grid;
          grid-template-columns: 18px 1fr;
          align-items: center;
          gap: 9px;
          width: 100%;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: #1e2028;
          color: rgba(255,255,255,0.78);
          cursor: pointer;
          padding: 8px;
          text-align: left;
        }

        .ig-client-accounts-status-menu-item:hover,
        .ig-client-accounts-status-menu-item:focus-visible {
          border-color: rgba(101,88,245,.20);
          background: rgba(101,88,245,.14);
          outline: none;
        }

        .ig-client-accounts-status-menu-item:disabled {
          cursor: not-allowed;
          opacity: 0.54;
        }

        .ig-client-accounts-status-menu-item svg {
          width: 16px;
          height: 16px;
        }

        .ig-client-accounts-status-menu-item strong,
        .ig-client-accounts-status-menu-item small {
          display: block;
        }

        .ig-client-accounts-status-menu-item strong {
          color: #f0f0ee;
          font-size: 12px;
        }

        .ig-client-accounts-status-menu-item small {
          margin-top: 2px;
          color: rgba(255,255,255,0.50);
          font-size: 10.5px;
          line-height: 1.35;
        }

        .ig-client-accounts-status-menu-item-danger {
          border-color: rgba(248,113,113,0.18);
        }

        .ig-client-accounts-status-menu-item-danger:hover,
        .ig-client-accounts-status-menu-item-danger:focus-visible {
          border-color: rgba(248,113,113,0.40);
          background: rgba(248,113,113,0.10);
        }

        .ig-client-accounts-status-menu-error {
          color: #fca5a5;
          font-size: 11px;
          line-height: 1.35;
          padding: 2px 4px;
        }

        .ig-client-accounts-empty {
          margin-top: 10px;
        }

        @media (max-width: 1180px) {
          .ig-client-accounts-kpis {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .ig-client-accounts-kpis {
            grid-template-columns: 1fr;
          }

          .ig-client-accounts-filters {
            grid-template-columns: repeat(auto-fit, minmax(146px, 1fr));
          }

          .ig-client-accounts-filter {
            justify-content: space-between;
          }
        }
      `}</style>
    </main>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  return (
    <article className={`ig-client-accounts-kpi ig-client-accounts-kpi-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function FilterBar({ items, activeFilter }: { items: ClientAccountOperationsItem[]; activeFilter: FilterKey }) {
  return (
    <nav className="ig-client-accounts-filters" aria-label="Client account status filters">
      {filterOptions.map((option) => (
        <Link
          key={option.key}
          href={filterHref(option.key)}
          className={activeFilter === option.key ? "ig-client-accounts-filter ig-client-accounts-filter-active" : "ig-client-accounts-filter"}
          aria-current={activeFilter === option.key ? "page" : undefined}
        >
          <span>{option.label}</span>
          <strong>{formatInteger(countForFilter(items, option.key))}</strong>
        </Link>
      ))}
    </nav>
  );
}

function ClientAccountsTable({ items }: { items: ClientAccountOperationsItem[] }) {
  if (items.length === 0) {
    return (
      <div className="ig-client-accounts-empty">
        <span>No accounts</span>
        <strong>No client accounts match this filter.</strong>
        <p>Use All to return to the complete support worklist.</p>
      </div>
    );
  }

  return (
    <div className="ig-client-accounts-table-wrap">
      <table className="ig-client-accounts-table">
        <colgroup>
          <col style={{ width: "27%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Account</th>
            <th>Email</th>
            <th>Password</th>
            <th>2FA</th>
            <th>Created At</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.accountId || item.username}>
              <td>
                <div className="ig-client-accounts-account-row">
                  <AccountAvatar item={item} />
                  <div className="ig-client-accounts-account-cell">
                    <Link className="ig-client-accounts-account-link" href={`/instagram-dashboard/accounts/${encodeURIComponent(item.accountId || item.username)}`}>
                      {item.username}
                    </Link>
                    <small>{item.clientName ?? "Client pending"} · {item.lifecycleStatus}</small>
                    <small style={{ color: statusTone(item.instagramVerificationStatus ?? "pending") }}>
                      username {item.instagramVerificationStatus ?? "pending"}
                    </small>
                  </div>
                </div>
              </td>
              <td>{item.emailDisplay}</td>
              <td>
                <StatusBadge value={passwordLabel(item.passwordStatus)} tone={passwordTone(item.passwordStatus)} />
              </td>
              <td>
                <StatusBadge value={item.twoFactorStatus} tone={twoFactorTone(item.twoFactorStatus)} />
              </td>
              <td>{formatDateTime(item.createdAt)}</td>
              <td>
                <div className="ig-client-accounts-status-cell">
                  <span className="ig-client-accounts-status-select-label">Status</span>
                  <StatusBadge value={item.needsAssistance ? "needs assistance" : item.operationsStatus} tone={item.needsAssistance ? "danger" : statusBadgeTone(item.operationsStatus)} />
                  <small style={{ color: statusTone(item.operationsStatus) }}>{item.adminStatus} · {item.customerStatus} · {item.subscriptionStatus}</small>
                </div>
              </td>
              <td>
                <ActionList item={item} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionList({ item }: { item: ClientAccountOperationsItem }) {
  return (
    <div className="ig-client-accounts-actions">
      {item.actions.map((action) => {
        const Icon = actionIcon(action.key);
        const title = action.disabledReason ? `${action.label}: ${action.disabledReason}` : `${action.label}: ${action.description}`;

        return action.disabled || !action.targetHref ? (
          <button
            key={action.key}
            type="button"
            className="ig-client-accounts-action-disabled"
            title={title}
            aria-label={title}
            disabled
          >
            <Icon aria-hidden />
          </button>
        ) : (
          <Link key={action.key} href={action.targetHref} className="ig-client-accounts-action-link" title={title} aria-label={title}>
            <Icon aria-hidden />
          </Link>
        );
      })}
      <AccountStatusActionMenu
        accountId={item.accountId}
        username={item.username}
        operationsStatus={item.needsAssistance ? "needs-assistance" : item.operationsStatus}
      />
    </div>
  );
}

function AccountAvatar({ item }: { item: ClientAccountOperationsItem }) {
  const initial = (item.username.replace(/^@/, "").trim()[0] || "?").toUpperCase();

  if (item.profileImageUrl) {
    return (
      <object
        className="ig-client-accounts-avatar ig-client-accounts-avatar-object"
        data={item.profileImageUrl}
        type="image/jpeg"
        aria-label={`${item.username} profile image`}
      >
        <span className="ig-client-accounts-avatar-fallback" aria-hidden>{initial}</span>
      </object>
    );
  }

  return (
    <span className="ig-client-accounts-avatar" aria-label={`${item.username} profile image pending`}>
      {initial}
    </span>
  );
}

function actionIcon(key: string): LucideIcon {
  if (key === "open_credentials") return KeyRound;
  if (key === "request_password_update") return RefreshCw;
  if (key === "mark_needs_assistance") return LifeBuoy;
  return UserRound;
}

function StatusBadge({ value, tone }: { value: string; tone: "neutral" | "good" | "warning" | "danger" }) {
  const className = tone === "neutral" ? "ig-client-accounts-badge" : `ig-client-accounts-badge ig-client-accounts-badge-${tone}`;
  return <span className={className}>{value}</span>;
}

function passwordLabel(value: ClientAccountOperationsItem["passwordStatus"]) {
  if (value === "reauth_required") return "reauth required";
  if (value === "update_needed") return "update needed";
  return value;
}

function passwordTone(value: ClientAccountOperationsItem["passwordStatus"]): "neutral" | "good" | "warning" | "danger" {
  if (value === "configured") return "good";
  if (value === "reauth_required" || value === "update_needed") return "danger";
  if (value === "missing") return "warning";
  return "neutral";
}

function twoFactorTone(value: string): "neutral" | "good" | "warning" | "danger" {
  if (value === "enabled" || value === "disabled") return "good";
  if (value === "code required") return "danger";
  if (value === "pending action" || value === "checkpoint" || value === "blocked") return "warning";
  return "neutral";
}

function statusBadgeTone(value: ClientAccountOperationsStatus): "neutral" | "good" | "warning" | "danger" {
  if (value === "active") return "good";
  if (value === "cancelled") return "danger";
  if (value === "pending" || value === "onboarding" || value === "paused") return "warning";
  return "neutral";
}
