import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../InstagramDashboardViewNav";
import {
  getGrowthSettingsData,
  type GrowthAccountOverview,
  type GrowthLimitGroup,
  type GrowthSettingItem,
  type GrowthSourceDetail,
} from "../growth-settings-data";
import { getRadarData } from "../radar-data";

export const dynamic = "force-dynamic";

export default async function InstagramGrowthSettingsPage() {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const [data, radarData] = await Promise.all([getGrowthSettingsData(), getRadarData()]);

  return (
    <main className="dashboard-page ig-growth-page">
      <DashboardPageHeader
        eyebrow="Growth"
        title="Growth Settings"
        description="Package, limits and client-safe growth configuration overview."
        action={<InstagramDashboardViewNav active="growth" badges={{ radar: radarData.notificationSummary.radarBadgeCount, "server-check": radarData.notificationSummary.serverCheckBadgeCount }} notificationItems={{ radar: radarData.notificationItems.radar, "server-check": radarData.notificationItems.serverCheck }} />}
      />

      {data.errors.length > 0 && (
        <section className="ig-growth-alert" role="alert">
          <strong>Growth settings source partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <section className="ig-growth-source-strip" aria-label="Growth Settings source status">
        <SourcePill label="Manage overview" detail={data.sourceDetails.manageOverview} />
        <SourcePill label="Account settings" detail={data.sourceDetails.accountSettings} />
        <SourcePill label="Filters" detail={data.sourceDetails.filters} />
        <SourcePill label="Package model" detail={data.sourceDetails.packageModel} />
        <SourcePill label="Runtime proof" detail={data.sourceDetails.runtimeProof} />
      </section>

      <section className="ig-growth-kpis" aria-label="Growth Settings summary">
        <Kpi label="Accounts" value={String(data.summary.accountsCount)} detail="Accounts from Manage contract" />
        <Kpi label="Client-safe ready" value={String(data.summary.clientSafeReadyCount)} detail="Requires runtime proof first" tone="warning" />
        <Kpi label="Admin-only settings" value={String(data.summary.adminOnlyCount)} detail="Visible only to admin/operators" />
        <Kpi label="Runtime unverified" value={String(data.summary.runtimeUnverifiedCount)} detail="Not pricing/client-ready" tone="warning" />
        <Kpi label="Pending review" value={String(data.summary.pendingReviewCount)} detail="Needs operator/product validation" tone="warning" />
      </section>

      <section className="ig-growth-helper" aria-label="Growth Settings runtime proof note">
        <strong>Runtime proof rule</strong>
        <p>A setting is client/pricing-ready only after runtime application is verified. V1 is read-only and does not create new settings mutations.</p>
      </section>

      <AnalyticsSectionCard
        eyebrow="Accounts"
        title="Growth settings by account"
        description="Compact safe projection. Use the existing Settings drawer for technical edits."
      >
        {data.groupsByAccount.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="ig-growth-accordion-list">
            {data.groupsByAccount.map((entry) => (
              <AccountAccordion key={entry.account.accountId || entry.account.username} entry={entry} />
            ))}
          </div>
        )}
      </AnalyticsSectionCard>

      <style>{`
        .ig-growth-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
        }

        .ig-growth-alert {
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

        .ig-growth-alert strong {
          color: #FCA5A5;
        }

        .ig-growth-source-strip,
        .ig-growth-kpis {
          display: grid;
          gap: 14px;
        }

        .ig-growth-source-strip {
          grid-template-columns: repeat(5, minmax(0, 1fr));
          margin-bottom: 14px;
        }

        .ig-growth-kpis {
          grid-template-columns: repeat(5, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-growth-source-pill,
        .ig-growth-kpi,
        .ig-growth-helper,
        .ig-growth-accordion,
        .ig-growth-group,
        .ig-growth-item,
        .ig-growth-summary-card,
        .ig-growth-empty {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
        }

        .ig-growth-source-pill,
        .ig-growth-helper,
        .ig-growth-empty {
          display: grid;
          gap: 8px;
          padding: 14px;
        }

        .ig-growth-helper {
          margin-bottom: 18px;
        }

        .ig-growth-kpi {
          min-height: 126px;
          padding: 16px;
        }

        .ig-growth-source-pill span,
        .ig-growth-kpi span,
        .ig-growth-helper span,
        .ig-growth-field span,
        .ig-growth-group span,
        .ig-growth-summary-card span,
        .ig-growth-item span,
        .ig-growth-empty span {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .ig-growth-source-pill strong,
        .ig-growth-helper strong,
        .ig-growth-field strong,
        .ig-growth-group strong,
        .ig-growth-summary-card strong,
        .ig-growth-item strong,
        .ig-growth-empty strong {
          color: #f0f0ef;
          font-size: 14px;
        }

        .ig-growth-source-pill small,
        .ig-growth-kpi small,
        .ig-growth-helper p,
        .ig-growth-field small,
        .ig-growth-group p,
        .ig-growth-summary-card small,
        .ig-growth-item small,
        .ig-growth-empty p {
          color: rgba(255,255,255,0.60);
          font-size: 12px;
          line-height: 1.5;
        }

        .ig-growth-kpi strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.65rem;
          line-height: 1;
          margin: 16px 0 10px;
        }

        .ig-growth-accordion-list {
          display: grid;
          gap: 12px;
        }

        .ig-growth-accordion {
          overflow: hidden;
        }

        .ig-growth-accordion summary {
          list-style: none;
          cursor: pointer;
        }

        .ig-growth-accordion summary::-webkit-details-marker {
          display: none;
        }

        .ig-growth-accordion-summary {
          display: grid;
          grid-template-columns: 18px minmax(180px, 1.4fr) minmax(150px, 1fr) minmax(120px, 0.75fr) minmax(170px, 1fr) minmax(150px, 0.85fr) minmax(88px, 0.45fr) minmax(180px, auto);
          gap: 12px;
          align-items: start;
          padding: 14px;
        }

        .ig-growth-field,
        .ig-growth-summary-card {
          display: grid;
          gap: 6px;
          min-width: 0;
        }

        .ig-growth-field strong,
        .ig-growth-summary-card strong,
        .ig-growth-item strong {
          line-height: 1.25;
          overflow-wrap: anywhere;
          word-break: normal;
        }

        .ig-growth-field small {
          overflow-wrap: anywhere;
        }

        .ig-growth-chevron {
          color: rgba(255,255,255,0.48);
          font-weight: 900;
          padding-top: 4px;
        }

        .ig-growth-accordion[open] .ig-growth-chevron {
          transform: rotate(90deg);
        }

        .ig-growth-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 28px;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 999px;
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.72);
          font-size: 10px;
          font-weight: 900;
          line-height: 1.15;
          padding: 4px 9px;
          text-align: center;
          white-space: normal;
        }

        .ig-growth-link-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: flex-start;
        }

        .ig-growth-link-row a,
        .ig-growth-edit-disabled {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 30px;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 999px;
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.70);
          font-size: 12px;
          font-weight: 900;
          padding: 0 10px;
          text-decoration: none;
        }

        .ig-growth-link-row a:hover,
        .ig-growth-link-row a:focus-visible {
          border-color: rgba(245,158,11,0.38);
          color: #FBBF24;
          outline: none;
        }

        .ig-growth-edit-disabled {
          color: rgba(255,255,255,0.38);
          cursor: not-allowed;
        }

        .ig-growth-accordion-body {
          display: grid;
          gap: 12px;
          padding: 0 14px 14px;
        }

        .ig-growth-package-grid,
        .ig-growth-groups-grid {
          display: grid;
          gap: 12px;
        }

        .ig-growth-package-grid {
          grid-template-columns: repeat(4, minmax(160px, 1fr));
        }

        .ig-growth-groups-grid {
          grid-template-columns: repeat(2, minmax(280px, 1fr));
        }

        .ig-growth-group {
          display: grid;
          gap: 12px;
          padding: 14px;
        }

        .ig-growth-group p {
          margin: 0;
        }

        .ig-growth-item-grid {
          display: grid;
          gap: 8px;
        }

        .ig-growth-item {
          display: grid;
          grid-template-columns: minmax(150px, 1fr) minmax(140px, 1fr);
          gap: 10px;
          align-items: start;
          padding: 12px;
        }

        .ig-growth-item-badges {
          grid-column: 1 / -1;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ig-growth-item-warning {
          grid-column: 1 / -1;
          color: rgba(251,191,36,0.80);
          font-size: 12px;
          line-height: 1.4;
        }

        .ig-growth-summary-card {
          min-height: 96px;
          padding: 14px;
        }

        .ig-growth-summary-card strong {
          font-size: 15px;
        }

        .ig-growth-empty {
          place-items: center;
          min-height: 190px;
          text-align: center;
        }

        .ig-growth-empty p {
          max-width: 520px;
          margin: 0;
        }

        @media (max-width: 1180px) {
          .ig-growth-source-strip,
          .ig-growth-kpis,
          .ig-growth-package-grid,
          .ig-growth-groups-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ig-growth-accordion-summary {
            grid-template-columns: 18px repeat(3, minmax(160px, 1fr));
          }
        }

        @media (max-width: 760px) {
          .ig-growth-page {
            padding: 22px 14px 40px;
          }

          .ig-growth-source-strip,
          .ig-growth-kpis,
          .ig-growth-package-grid,
          .ig-growth-groups-grid,
          .ig-growth-accordion-summary,
          .ig-growth-item {
            grid-template-columns: 1fr;
          }

          .ig-growth-chevron {
            padding-top: 0;
          }
        }
      `}</style>
    </main>
  );
}

function SourcePill({ label, detail }: { label: string; detail: GrowthSourceDetail }) {
  return (
    <article className="ig-growth-source-pill" title={detail.description}>
      <span>{label}</span>
      <strong>{detail.label}</strong>
      <small>{detail.description}</small>
    </article>
  );
}

function Kpi({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "warning" }) {
  return (
    <article className="ig-growth-kpi">
      <span>{label}</span>
      <strong style={{ color: tone === "warning" ? "#FBBF24" : "#f0f0ef" }}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AccountAccordion({ entry }: { entry: GrowthAccountOverview }) {
  return (
    <details className="ig-growth-accordion">
      <summary>
        <div className="ig-growth-accordion-summary">
          <span className="ig-growth-chevron" aria-hidden="true">&gt;</span>
          <div className="ig-growth-field">
            <span>Account</span>
            <strong>{entry.account.username}</strong>
            <small>{entry.account.clientName ?? "Client pending"}</small>
          </div>
          <SummaryMetric label="Package" value={entry.account.packageLabel ?? "unknown"} />
          <SummaryMetric label="Subscription" value={entry.account.subscriptionStatus ?? "unknown"} />
          <StatusPill label={entry.runtimeProofStatus === "verified" ? "Runtime verified" : "Runtime pending"} tone="warning" />
          <StatusPill label={visibilityLabel(entry.clientVisibilityStatus)} tone="warning" />
          <SummaryMetric label="Warnings" value={String(entry.warningCount)} />
          <div className="ig-growth-link-row">
            <Link href={entry.account.accountDetailHref}>Account Detail</Link>
            <span className="ig-growth-edit-disabled" title="Open Manage then Settings drawer for V1 edits">{entry.account.editSettingsLabel}</span>
          </div>
        </div>
      </summary>
      <div className="ig-growth-accordion-body">
        <div className="ig-growth-package-grid">
          <SummaryCard label="Package" value={entry.packageSummary.packageLabel} />
          <SummaryCard label="Entitlement" value={entry.packageSummary.entitlementSummary} />
          <SummaryCard label="Runtime proof" value={entry.packageSummary.runtimeProofStatus} />
          <SummaryCard label="Pricing ready" value={entry.packageSummary.pricingReadyStatus} />
        </div>
        <div className="ig-growth-groups-grid">
          {entry.groups.map((group) => (
            <SettingGroup key={group.groupKey} group={group} />
          ))}
        </div>
      </div>
    </details>
  );
}

function SettingGroup({ group }: { group: GrowthLimitGroup }) {
  return (
    <article className="ig-growth-group">
      <div>
        <span>{group.groupKey}</span>
        <strong>{group.title}</strong>
        <p>{group.description}</p>
      </div>
      <div className="ig-growth-item-grid">
        {group.items.map((item) => (
          <SettingItem key={item.key} item={item} />
        ))}
      </div>
    </article>
  );
}

function SettingItem({ item }: { item: GrowthSettingItem }) {
  return (
    <div className="ig-growth-item">
      <div>
        <span>{item.category}</span>
        <strong>{item.label}</strong>
      </div>
      <div>
        <span>Value</span>
        <strong>{item.valueLabel}</strong>
      </div>
      <div className="ig-growth-item-badges">
        <StatusPill label={runtimeLabel(item.runtimeStatus)} tone={item.runtimeStatus === "verified" ? "good" : "warning" } />
        <StatusPill label={visibilityLabel(item.clientVisibility)} tone={item.clientVisibility === "client_safe" ? "good" : item.clientVisibility === "ops_only" ? "danger" : "warning"} />
      </div>
      {item.warning ? <div className="ig-growth-item-warning">{item.warning}</div> : null}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ig-growth-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="ig-growth-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "good" | "warning" | "danger" }) {
  const colors = {
    neutral: "rgba(255,255,255,0.72)",
    good: "#34D399",
    warning: "#FBBF24",
    danger: "#F87171",
  };

  return <span className="ig-growth-pill" style={{ color: colors[tone] }}>{label}</span>;
}

function runtimeLabel(value: string) {
  if (value === "verified") return "Runtime verified";
  if (value === "unverified") return "Runtime unverified";
  if (value === "pending") return "Pending proof";
  return "Runtime unknown";
}

function visibilityLabel(value: string) {
  if (value === "client_safe") return "Client-safe future";
  if (value === "admin_only") return "Admin-only";
  if (value === "ops_only") return "Ops-only hidden";
  return "Pending review";
}

function EmptyState() {
  return (
    <div className="ig-growth-empty">
      <span>Empty state</span>
      <strong>No growth settings found</strong>
      <p>No account rows were returned by the current safe sources.</p>
    </div>
  );
}
