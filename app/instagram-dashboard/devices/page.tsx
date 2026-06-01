import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../InstagramDashboardViewNav";
import { formatDateTime, formatInteger, statusTone } from "../manage-data";
import {
  getDevicesData,
  type DeviceHost,
  type DevicesOverview,
  type PhoneAccountSummary,
  type PhoneDevice,
} from "../devices-data";
import { getRadarData } from "../radar-data";

export const dynamic = "force-dynamic";

export default async function InstagramDevicesPage() {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const [data, radarData] = await Promise.all([getDevicesData(), getRadarData()]);

  return (
    <main className="dashboard-page ig-devices-page">
      <DashboardPageHeader
        eyebrow="Inventory"
        title="Devices / Phones"
        description="Phone and host inventory for Instagram automation."
        action={<InstagramDashboardViewNav active="devices" badges={{ radar: radarData.notificationSummary.radarBadgeCount, "server-check": radarData.notificationSummary.serverCheckBadgeCount }} notificationItems={{ radar: radarData.notificationItems.radar, "server-check": radarData.notificationItems.serverCheck }} />}
      />

      {data.errors.length > 0 && (
        <section className="ig-devices-alert" role="alert">
          <strong>Device data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <section className="ig-devices-source-strip" aria-label="Device source status">
        <SourcePill label="Device inventory" value={data.sourceStatus.deviceInventory.label} detail={data.sourceStatus.deviceInventory.description} />
        <SourcePill label="Account assignment" value={data.sourceStatus.accountAssignments.label} detail={data.sourceStatus.accountAssignments.description} />
      </section>

      <section className="ig-devices-kpis" aria-label="Device inventory summary">
        <Kpi label="Hosts" value={formatInteger(data.summary.hostsCount)} detail={data.summary.inventoryStatus} />
        <Kpi label="Phones" value={formatInteger(data.summary.phonesCount)} detail={data.sourceStatus.deviceInventory.label} />
        <Kpi label="Assigned accounts" value={formatInteger(data.summary.accountsAssignedCount)} detail={data.sourceStatus.accountAssignments.label} />
        <Kpi label="Unknown phone accounts" value={formatInteger(data.summary.unknownPhoneAccountsCount)} detail={data.summary.unknownPhoneAccountsCount ? "Inventory pending" : "No unknown phone assignments"} />
        <Kpi label="Problem phones" value={formatInteger(data.summary.problemPhonesCount)} detail={data.summary.problemPhonesCount ? "Review Server Check later" : "No problem phones from current source"} tone={data.summary.problemPhonesCount ? "warning" : "good"} />
      </section>

      <AnalyticsSectionCard
        eyebrow="Hosts"
        title="Mac / host inventory"
        description="Compact read-only host and phone groups. Expand a host, then a phone, to inspect assigned accounts."
      >
        <HostAccordion hosts={data.hosts} phones={data.phones} groups={data.accountsByPhone} />
      </AnalyticsSectionCard>

      <style>{`
        .ig-devices-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
        }

        .ig-devices-alert {
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

        .ig-devices-alert strong {
          color: #FCA5A5;
        }

        .ig-devices-source-strip,
        .ig-devices-kpis,
        .ig-devices-grid {
          display: grid;
          gap: 14px;
        }

        .ig-devices-source-strip {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          margin-bottom: 14px;
        }

        .ig-devices-kpis {
          grid-template-columns: repeat(5, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-devices-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: start;
          margin-bottom: 18px;
        }

        .ig-devices-source-pill,
        .ig-devices-kpi,
        .ig-devices-host,
        .ig-devices-pending {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
        }

        .ig-devices-source-pill,
        .ig-devices-host,
        .ig-devices-pending {
          display: grid;
          gap: 8px;
          padding: 14px;
        }

        .ig-devices-kpi {
          min-height: 126px;
          padding: 16px;
        }

        .ig-devices-source-pill span,
        .ig-devices-kpi span,
        .ig-devices-host span,
        .ig-devices-pending span {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-devices-kpi strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.8rem;
          line-height: 1;
          margin: 16px 0 10px;
        }

        .ig-devices-source-pill strong,
        .ig-devices-kpi small,
        .ig-devices-host p,
        .ig-devices-pending p {
          color: rgba(255,255,255,0.60);
          font-size: 12px;
        }

        .ig-devices-accordion-list {
          display: grid;
          gap: 10px;
        }

        .ig-devices-accordion {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
          overflow: hidden;
        }

        .ig-devices-accordion summary {
          display: grid;
          grid-template-columns: auto minmax(180px, 1.4fr) repeat(5, minmax(110px, 1fr));
          gap: 10px;
          align-items: center;
          min-height: 58px;
          padding: 12px 14px;
          cursor: pointer;
          list-style: none;
        }

        .ig-devices-accordion summary::-webkit-details-marker {
          display: none;
        }

        .ig-devices-accordion summary:hover,
        .ig-devices-accordion summary:focus-visible {
          background: rgba(245,158,11,0.06);
          outline: none;
        }

        .ig-devices-chevron {
          color: rgba(255,255,255,0.44);
          font-size: 16px;
          font-weight: 900;
          transition: transform 160ms ease;
        }

        .ig-devices-accordion[open] > summary .ig-devices-chevron {
          transform: rotate(90deg);
        }

        .ig-devices-summary-title {
          display: grid;
          gap: 4px;
          min-width: 0;
        }

        .ig-devices-summary-title strong {
          color: #f0f0ef;
          font-size: 14px;
          overflow-wrap: anywhere;
        }

        .ig-devices-summary-metric {
          display: grid;
          gap: 4px;
          min-width: 0;
        }

        .ig-devices-summary-metric span,
        .ig-devices-detail-label {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-devices-summary-metric strong {
          color: rgba(255,255,255,0.72);
          font-size: 12px;
          overflow-wrap: anywhere;
        }

        .ig-devices-accordion-body {
          display: grid;
          gap: 10px;
          padding: 0 14px 14px;
        }

        .ig-devices-phone-nested {
          background: rgba(255,255,255,0.025);
        }

        .ig-devices-phone-nested summary {
          grid-template-columns: auto minmax(170px, 1.4fr) repeat(6, minmax(96px, 1fr));
          min-height: 54px;
        }

        .ig-devices-account-list {
          display: grid;
          gap: 8px;
        }

        .ig-devices-account-row {
          display: grid;
          grid-template-columns: minmax(160px, 1.4fr) repeat(5, minmax(110px, 1fr));
          gap: 10px;
          align-items: start;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          background: rgba(255,255,255,0.025);
          padding: 10px 12px;
        }

        .ig-devices-phone-detail-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 10px;
        }

        .ig-devices-safe-detail {
          display: grid;
          gap: 6px;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          background: rgba(255,255,255,0.025);
          padding: 12px;
        }

        .ig-devices-host strong,
        .ig-devices-pending strong {
          color: #f0f0ef;
          font-size: 15px;
        }

        .ig-devices-account-link {
          color: #f0f0ef;
          font-weight: 900;
          text-decoration: none;
        }

        .ig-devices-account-link:hover,
        .ig-devices-account-link:focus-visible {
          color: #FBBF24;
          outline: none;
        }

        @media (max-width: 1120px) {
          .ig-devices-source-strip,
          .ig-devices-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ig-devices-kpis {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .ig-devices-accordion summary,
          .ig-devices-phone-nested summary,
          .ig-devices-account-row,
          .ig-devices-phone-detail-grid {
            grid-template-columns: 1fr;
          }

          .ig-devices-chevron {
            justify-self: start;
          }
        }

        @media (max-width: 760px) {
          .ig-devices-page {
            padding: 22px 14px 40px;
          }

          .ig-devices-source-strip,
          .ig-devices-kpis,
          .ig-devices-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function SourcePill({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="ig-devices-source-pill" title={detail}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Kpi({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "warning" }) {
  const color = tone === "good" ? "#34D399" : tone === "warning" ? "#FBBF24" : "#f0f0ef";

  return (
    <article className="ig-devices-kpi">
      <span>{label}</span>
      <strong style={{ color }}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function HostAccordion({
  hosts,
  phones,
  groups,
}: {
  hosts: DeviceHost[];
  phones: PhoneDevice[];
  groups: DevicesOverview["accountsByPhone"];
}) {
  if (!hosts.length) {
    return <div className="ig-devices-pending"><span>Empty state</span><strong>No hosts found</strong><p>No host inventory or account assignment data is available.</p></div>;
  }

  return (
    <div className="ig-devices-accordion-list">
      {hosts.map((host) => (
        <details className="ig-devices-accordion" key={host.hostName}>
          <summary>
            <span className="ig-devices-chevron" aria-hidden="true">&gt;</span>
            <span className="ig-devices-summary-title">
              <strong>{host.hostName}</strong>
              <span>{host.hostSourceLabel}</span>
            </span>
            <Metric label="Status" value={host.hostStatus} tone={host.hostStatus} />
            <Metric label="Phones" value={formatInteger(host.phonesCount)} />
            <Metric label="Accounts" value={formatInteger(host.accountsCount)} />
            <Metric label="Last seen" value={formatDateTime(host.lastSeenAt)} />
            <Metric label="Source" value={host.sourceStatus} />
          </summary>
          <div className="ig-devices-accordion-body">
            <div className="ig-devices-safe-detail">
              <span className="ig-devices-detail-label">Host details</span>
              <strong>{host.notesStatus}</strong>
              <p>{host.hostSourceLabel}</p>
            </div>
            <PhoneAccordion
              phones={phones.filter((phone) => phone.hostName === host.hostName)}
              groups={groups.filter((group) => group.hostName === host.hostName)}
            />
          </div>
        </details>
      ))}
    </div>
  );
}

function PhoneAccordion({
  phones,
  groups,
}: {
  phones: PhoneDevice[];
  groups: DevicesOverview["accountsByPhone"];
}) {
  if (!phones.length) {
    return <div className="ig-devices-pending"><span>Empty state</span><strong>No phones found</strong><p>No phones found from current source.</p></div>;
  }

  return (
    <div className="ig-devices-accordion-list">
      {phones.map((phone) => {
        const group = groups.find((item) => item.phoneName === phone.phoneName && item.hostName === phone.hostName);

        return (
          <details className="ig-devices-accordion ig-devices-phone-nested" key={`${phone.hostName}-${phone.phoneName}`}>
            <summary>
              <span className="ig-devices-chevron" aria-hidden="true">&gt;</span>
              <span className="ig-devices-summary-title">
                <strong>{phone.phoneName}</strong>
                <span>{phone.hostName}</span>
              </span>
              <Metric label="Health" value={phone.phoneStatus} tone={phone.phoneStatus} />
              <Metric label="Accounts" value={formatInteger(phone.accountsCount)} />
              <Metric label="Problems" value={phone.problemAccountsCount === null ? "unknown" : formatInteger(phone.problemAccountsCount)} tone={phone.problemAccountsCount ? "monitor" : "ok"} />
              <Metric label="Last seen" value={formatDateTime(phone.lastSeenAt)} />
              <Metric label="Last reboot" value={formatDateTime(phone.lastRebootAt)} />
              <Metric label="Source" value={phone.isInventoryPending ? "Inventory pending" : phone.sourceLabel} />
            </summary>
            <div className="ig-devices-accordion-body">
              <div className="ig-devices-phone-detail-grid">
                <div className="ig-devices-safe-detail">
                  <span className="ig-devices-detail-label">Safe details</span>
                  <strong>{phone.healthReason ?? "No issue from current source"}</strong>
                  <p>{phone.sourceLabel}</p>
                </div>
              </div>
              <AccountList accounts={group?.accounts ?? []} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function AccountList({ accounts }: { accounts: PhoneAccountSummary[] }) {
  return (
    <div className="ig-devices-account-list">
      {accounts.length ? (
        accounts.map((account) => (
          <div className="ig-devices-account-row" key={account.accountId || account.username}>
            <div>
              <span className="ig-devices-detail-label">Account</span>
              <Link className="ig-devices-account-link" href={`/instagram-dashboard/accounts/${encodeURIComponent(account.accountId || account.username)}`}>
                {account.username}
              </Link>
            </div>
            <Metric label="Health" value={account.healthStatus} tone={account.healthStatus} />
            <Metric label="Admin" value={account.adminStatus} />
            <Metric label="Login" value={account.loginStatus} />
            <Metric label="Credentials" value={account.credentialsStatus} />
            <Metric label="Source" value={account.sourceLabel} />
          </div>
        ))
      ) : (
        <div className="ig-devices-pending">
          <span>Empty state</span>
          <strong>No accounts assigned</strong>
          <p>No accounts are currently linked to this phone from the current source.</p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="ig-devices-summary-metric">
      <span>{label}</span>
      <strong style={tone ? { color: statusTone(tone) } : undefined}>{value}</strong>
    </span>
  );
}
