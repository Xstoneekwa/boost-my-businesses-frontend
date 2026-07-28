import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../InstagramDashboardViewNav";
import { getLiveDevicesOverviewData } from "../devices-live-data";
import { getRadarData } from "../radar-data";
import AddPhoneForm from "./AddPhoneForm";
import { AddPhoneExplainer, DevicesKpis, RegisteredPhonesList } from "./components";

export const dynamic = "force-dynamic";

export default async function InstagramDevicesPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const [data, radarData] = await Promise.all([getLiveDevicesOverviewData(), getRadarData()]);
  const phones = data.phone_devices.length ? data.phone_devices : data.items;

  return (
    <main className="dashboard-page ig-devices-page">
      <DashboardPageHeader
        eyebrow="Inventory"
        title="Devices / Phones"
        description="Register and monitor physical phones used by the Instagram automation runtime."
        action={<InstagramDashboardViewNav active="devices" badges={{ radar: radarData.notificationSummary.radarBadgeCount, "server-check": radarData.notificationSummary.serverCheckBadgeCount }} notificationItems={{ radar: radarData.notificationItems.radar, "server-check": radarData.notificationItems.serverCheck }} />}
      />

      {data.errors.length > 0 && (
        <section className="ig-devices-alert" role="alert">
          <strong>Device data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <DevicesKpis summary={data.phone_inventory_summary} />

      <AnalyticsSectionCard
        eyebrow="Inventory action"
        title="Add phone"
        description="Register a physical phone and its standard Instagram app instances. No credentials, assignments, runs, or provisioning are started here."
      >
        <AddPhoneExplainer />
        <AddPhoneForm />
      </AnalyticsSectionCard>

      <AnalyticsSectionCard
        eyebrow="Registered phones"
        title="Live phone inventory"
        description="Live inventory comes from phone_devices and phone_app_instances. ADB online/offline is only shown when heartbeat data exists; otherwise status remains unknown."
      >
        <RegisteredPhonesList phones={phones} />
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

        .ig-devices-kpis,
        .ig-devices-grid {
          display: grid;
          gap: 14px;
        }

        .ig-devices-kpis {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-devices-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: start;
          margin-bottom: 18px;
        }

        .ig-devices-kpi,
        .ig-devices-host,
        .ig-devices-pending,
        .ig-add-phone-explainer {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
        }

        .ig-devices-host,
        .ig-devices-pending,
        .ig-add-phone-explainer {
          display: grid;
          gap: 8px;
          padding: 14px;
        }

        .ig-add-phone-explainer {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .ig-add-phone-explainer h3 {
          color: #f0f0ef;
          font-size: 13px;
          margin: 0 0 8px;
        }

        .ig-add-phone-explainer ul {
          color: rgba(255,255,255,0.62);
          display: grid;
          font-size: 12px;
          gap: 5px;
          margin: 0;
          padding-left: 18px;
        }

        .ig-add-phone-form {
          display: grid;
          gap: 14px;
        }

        .ig-add-phone-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .ig-add-phone-field {
          display: grid;
          gap: 7px;
        }

        .ig-add-phone-field span {
          color: rgba(255,255,255,0.42);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-add-phone-field input,
        .ig-add-phone-field select,
        .ig-add-phone-field textarea {
          width: 100%;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 12px;
          background: rgba(0,0,0,0.18);
          color: #f0f0ef;
          font: inherit;
          font-size: 13px;
          padding: 11px 12px;
        }

        .ig-add-phone-field textarea {
          min-height: 82px;
          resize: vertical;
        }

        .ig-add-phone-field input:focus-visible,
        .ig-add-phone-field select:focus-visible,
        .ig-add-phone-field textarea:focus-visible {
          border-color: rgba(251,191,36,0.52);
          outline: none;
        }

        .ig-add-phone-actions {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .ig-add-phone-actions button {
          border: 1px solid rgba(245,158,11,0.45);
          border-radius: 999px;
          background: linear-gradient(135deg, #F59E0B, #FBBF24);
          color: #1c1204;
          cursor: pointer;
          font-size: 13px;
          font-weight: 900;
          padding: 10px 16px;
        }

        .ig-add-phone-actions button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .ig-add-phone-actions small {
          color: rgba(255,255,255,0.46);
          font-size: 12px;
        }

        .ig-add-phone-message {
          border-radius: 12px;
          margin: 0;
          padding: 10px 12px;
          font-size: 12px;
        }

        .ig-add-phone-message span,
        .ig-add-phone-message strong {
          display: block;
        }

        .ig-add-phone-message span {
          margin-top: 4px;
        }

        .ig-add-phone-error {
          border: 1px solid rgba(248,113,113,0.28);
          background: rgba(248,113,113,0.08);
          color: #FCA5A5;
        }

        .ig-add-phone-success {
          border: 1px solid rgba(52,211,153,0.24);
          background: rgba(52,211,153,0.08);
          color: #86EFAC;
        }

        .ig-devices-kpi {
          min-height: 126px;
          padding: 16px;
        }

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

        .ig-devices-badge-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .ig-devices-badge {
          border: 1px solid rgba(251,191,36,0.24);
          border-radius: 999px;
          background: rgba(251,191,36,0.08);
          color: #FDE68A;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.02em;
          padding: 4px 8px;
        }

        .ig-devices-badge-good {
          border-color: rgba(52,211,153,0.24);
          background: rgba(52,211,153,0.08);
          color: #86EFAC;
        }

        .ig-devices-badge-warning {
          border-color: rgba(248,113,113,0.26);
          background: rgba(248,113,113,0.08);
          color: #FCA5A5;
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
          .ig-devices-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ig-devices-kpis {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .ig-devices-accordion summary,
          .ig-devices-phone-nested summary,
          .ig-devices-account-row,
          .ig-add-phone-grid,
          .ig-add-phone-explainer,
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

          .ig-devices-kpis,
          .ig-devices-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
